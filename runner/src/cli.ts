import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadProjects, type Project } from "@factory/shared";
import { claudeAgent, shellRunner } from "./adapters/claude.js";
import { ghCli } from "./adapters/gh.js";
import { gitCli } from "./adapters/git.js";
import {
  ensureClone,
  eventsFile,
  loadSettings,
  lockDirFor,
  logDirFor,
  promptPath,
  qaPromptPath,
  resolveCloneDir,
  worktreeRoot,
} from "./config.js";
import { dryRunGh, dryRunGit } from "./dryRun.js";
import { EXIT, UsageError } from "./errors.js";
import { createEventLog } from "./events.js";
import { createLabelEnsurer, ensureLabels } from "./labels.js";
import { runBuildLane } from "./lanes/build.js";
import { qaExitCode, runQaLane } from "./lanes/qa.js";
import { acquireLock } from "./lock.js";
import { missingTools, programOf } from "./preflight.js";
import type { EventLog } from "./ports.js";
import { runProcess } from "./process.js";
import { verifyStep } from "./prompt.js";

const USAGE = `usage:
  runner build  --project <name> [--issue <number>] [--dry-run]
  runner qa     --project <name> [--issue <number>] [--dry-run]
  runner labels --project <name> [--dry-run]

  build   run the build lane once: take one ready issue to a draft PR and the qa label
  qa      run the qa lane once: test the PR of one qa card, then move it to review or back to building
  labels  create the missing ready/building/qa/review labels in the project's repo

  exit codes: 0 ok, 1 failed or sent back, 2 qa inconclusive, 64 usage, 65 precondition, 69 missing tool, 75 locked`;

export interface Args {
  command: "build" | "qa" | "labels";
  project: string;
  issue?: number;
  dryRun: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const [command, ...rest] = argv;
  if (command !== "build" && command !== "qa" && command !== "labels") throw new UsageError(USAGE);
  let project: string | undefined;
  let issue: number | undefined;
  let dryRun = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--project") project = rest[++i];
    else if (arg === "--issue") {
      const value = rest[++i] ?? "";
      if (!/^[1-9][0-9]*$/.test(value)) throw new UsageError(`--issue needs a positive number, got "${value}"`);
      issue = Number(value);
    } else throw new UsageError(`unknown argument "${arg}"\n${USAGE}`);
  }
  if (!project) throw new UsageError(`--project is required\n${USAGE}`);
  if (issue !== undefined && command === "labels") throw new UsageError("--issue only applies to build and qa");
  return { command, project, issue, dryRun };
}

const say = (message: string): void => console.log(`==> ${message}`);

function writeText(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

async function requireTools(tools: string[]): Promise<void> {
  const missing = missingTools(tools);
  if (missing.length > 0) throw new UsageError(`missing tool: ${missing.join(", ")}`, EXIT.missingTool);
  const auth = await runProcess("gh", ["auth", "status"], { env: { GH_PROMPT_DISABLED: "1" } });
  if (auth.code !== 0) throw new UsageError("gh is not logged in (set GH_TOKEN)", EXIT.missingTool);
}

function findProject(projects: Project[], name: string): Project {
  const project = projects.find((p) => p.name === name);
  if (!project) {
    throw new UsageError(`unknown project "${name}". known: ${projects.map((p) => p.name).join(", ") || "(none)"}`);
  }
  return project;
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const settings = loadSettings();
  const project = findProject(loadProjects(settings.projectsDir), args.project);

  if (!project.enabled) {
    say(`${project.name} is disabled in its registry file`);
    return 0;
  }
  if (args.command === "build" && !project.lanes.build) {
    say(`the build lane is disabled for ${project.name}`);
    return 0;
  }
  if (args.command === "qa" && !project.lanes.qa) {
    say(`the qa lane is disabled for ${project.name}`);
    return 0;
  }

  const tools = ["git", "gh"];
  if (args.command === "build") {
    tools.push("claude");
    const verify = verifyStep(project);
    if (verify) tools.push(programOf(verify.command));
  }
  if (args.command === "qa") {
    tools.push("claude");
    for (const command of [project.commands.build, project.commands.test]) {
      if (command) tools.push(programOf(command));
    }
  }
  await requireTools(tools);

  const noEvents: EventLog = { append: () => undefined };
  const events = args.dryRun ? noEvents : createEventLog(eventsFile(settings));
  const gh = args.dryRun ? dryRunGh(ghCli, say) : ghCli;
  const git = args.dryRun ? dryRunGit(gitCli, say) : gitCli;
  const labels = createLabelEnsurer(gh, events, project.name);

  if (args.command === "labels") {
    const created = await ensureLabels(gh, project.repo);
    say(created.length > 0 ? `created labels in ${project.repo}: ${created.join(", ")}` : `all lane labels exist in ${project.repo}`);
    return 0;
  }

  const release = acquireLock(lockDirFor(settings, project));
  if (!release) throw new UsageError(`another run holds the lock for ${project.name}`, EXIT.locked);
  try {
    const cloneDir = resolveCloneDir(project, settings);
    await ensureClone(gh, git, project, cloneDir, say);
    if (!existsSync(cloneDir)) {
      say("dry-run: the clone does not exist yet, so nothing further can be checked");
      return 0;
    }

    const file = args.command === "qa" ? qaPromptPath(project) : promptPath(project);
    if (!existsSync(file)) throw new UsageError(`missing file: ${file}`, EXIT.missingFile);
    const paths = { worktreeRoot: worktreeRoot(project, settings, cloneDir), logDir: logDirFor(settings, project) };

    if (args.command === "qa") {
      const result = await runQaLane(
        { gh, git, agent: claudeAgent, shell: shellRunner, events, labels, say, writeText },
        { project, cloneDir, paths, promptTemplate: readFileSync(file, "utf8"), issue: args.issue, dryRun: args.dryRun },
      );
      return qaExitCode(result);
    }

    const result = await runBuildLane(
      { gh, git, agent: claudeAgent, shell: shellRunner, events, labels, say },
      {
        project,
        cloneDir,
        paths,
        promptTemplate: readFileSync(file, "utf8"),
        issue: args.issue,
        dryRun: args.dryRun,
      },
    );
    return result.status === "failed" ? EXIT.failed : 0;
  } finally {
    release();
  }
}
