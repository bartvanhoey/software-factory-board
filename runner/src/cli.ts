import { existsSync, readFileSync } from "node:fs";
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
  resolveCloneDir,
  worktreeRoot,
} from "./config.js";
import { dryRunGh, dryRunGit } from "./dryRun.js";
import { EXIT, UsageError } from "./errors.js";
import { createEventLog } from "./events.js";
import { createLabelEnsurer, ensureLabels } from "./labels.js";
import { runBuildLane } from "./lanes/build.js";
import { acquireLock } from "./lock.js";
import { missingTools, programOf } from "./preflight.js";
import type { EventLog } from "./ports.js";
import { runProcess } from "./process.js";
import { verifyStep } from "./prompt.js";

const USAGE = `usage:
  runner build  --project <name> [--issue <number>] [--dry-run]
  runner labels --project <name> [--dry-run]

  build   run the build lane once: take one ready issue to a draft PR and the qa label
  labels  create the missing ready/building/qa/review labels in the project's repo`;

export interface Args {
  command: "build" | "labels";
  project: string;
  issue?: number;
  dryRun: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const [command, ...rest] = argv;
  if (command !== "build" && command !== "labels") throw new UsageError(USAGE);
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
  if (issue !== undefined && command !== "build") throw new UsageError("--issue only applies to build");
  return { command, project, issue, dryRun };
}

const say = (message: string): void => console.log(`==> ${message}`);

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

  const tools = ["git", "gh"];
  if (args.command === "build") {
    tools.push("claude");
    const verify = verifyStep(project);
    if (verify) tools.push(programOf(verify.command));
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

    const file = promptPath(project);
    if (!existsSync(file)) throw new UsageError(`missing file: ${file}`, EXIT.missingFile);

    const result = await runBuildLane(
      { gh, git, agent: claudeAgent, shell: shellRunner, events, labels, say },
      {
        project,
        cloneDir,
        paths: { worktreeRoot: worktreeRoot(project, settings, cloneDir), logDir: logDirFor(settings, project) },
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
