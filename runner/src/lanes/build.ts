import { join } from "node:path";
import type { Project } from "@factory/shared";
import { UsageError, EXIT, errorMessage } from "../errors.js";
import { allowedToolsFor, renderPrompt, verifyStep } from "../prompt.js";
import type { AgentRunner, EventLog, Gh, Git, LabelEnsurer, Shell } from "../ports.js";

export interface BuildDeps {
  gh: Gh;
  git: Git;
  agent: AgentRunner;
  shell: Shell;
  events: EventLog;
  labels: LabelEnsurer;
  say: (message: string) => void;
}

export interface BuildOptions {
  project: Project;
  /** The project's clone; worktrees are created from it. */
  cloneDir: string;
  paths: { worktreeRoot: string; logDir: string };
  promptTemplate: string;
  /** A specific issue to build; default is the oldest `ready` one. */
  issue?: number;
  /** Skip the agent and the verification; mutating calls are expected to be no-ops. */
  dryRun: boolean;
}

export type BuildResult =
  | { status: "noop" }
  | { status: "done"; issue: number; prUrl: string }
  | { status: "failed"; issue?: number; reason: string };

const hasLabel = (labels: readonly string[], name: string): boolean =>
  labels.some((l) => l.toLowerCase() === name);

/**
 * The build lane: claim one `ready` issue, build it in an isolated worktree with the agent,
 * verify the result independently, open a draft PR and move the card to `qa`.
 * On a failure after the claim the card stays in `building` with a comment on the issue.
 */
export async function runBuildLane(deps: BuildDeps, opts: BuildOptions): Promise<BuildResult> {
  const { gh, git, agent, shell, events, labels, say } = deps;
  const { project, cloneDir, dryRun } = opts;
  const repo = project.repo;
  const emit = (type: Parameters<EventLog["append"]>[0]["type"], message: string, extra: { issue?: number; url?: string } = {}) =>
    events.append({ project: project.name, lane: "build", type, message, ...extra });

  // 0. Lane labels must exist before anything tries to use them.
  try {
    await labels.ensure(repo);
  } catch (e) {
    const reason = `could not create the lane labels: ${errorMessage(e)}`;
    say(`FAILED: ${reason}`);
    emit("failed", reason);
    return { status: "failed", reason };
  }

  // 1. Pick.
  let number = opts.issue;
  if (number === undefined) {
    const ready = await gh.listIssuesByLabel(repo, "ready");
    number = ready.map((i) => i.number).sort((a, b) => a - b)[0];
    if (number === undefined) {
      say("no open issue labelled ready");
      emit("noop", "no open issue labelled ready");
      return { status: "noop" };
    }
  }
  const issue = await gh.getIssue(repo, number);
  if (!hasLabel(issue.labels, "ready")) {
    throw new UsageError(`issue #${number} is not labelled ready`, EXIT.precondition);
  }
  // Render before claiming, so a bad prompt template never strands a card in `building`.
  const prompt = `${renderPrompt(opts.promptTemplate, project)}\n\n## Issue #${number}: ${issue.title}\n\n${issue.body}\n`;
  say(`picked #${number}: ${issue.title}`);
  emit("started", `picked #${number}: ${issue.title}`, { issue: number });

  // 2. The base branch must be fetchable before anything is claimed: a wrong branch name in the
  // registry is a config problem and must not strand a card in `building`.
  try {
    await git.fetch(cloneDir, "origin", project.defaultBranch);
  } catch (e) {
    const reason = `could not fetch origin/${project.defaultBranch} (check defaultBranch in the registry): ${errorMessage(e)}`;
    say(`FAILED: ${reason}`);
    emit("failed", reason, { issue: number });
    return { status: "failed", issue: number, reason };
  }

  // 3. Claim: ready -> building. If a label is missing, create it and try once more.
  const me = await gh.whoami();
  say(`claim #${number} as ${me.login} (ready -> building)`);
  const claim = () =>
    gh.editIssue(repo, number, { addAssignee: me.login, removeLabels: ["ready"], addLabels: ["building"] });
  try {
    try {
      await claim();
    } catch (e) {
      if (!/label/i.test(errorMessage(e))) throw e;
      labels.forget(repo);
      await labels.ensure(repo);
      await claim();
    }
  } catch (e) {
    const reason = `could not claim the issue: ${errorMessage(e)}`;
    say(`FAILED: ${reason}`);
    emit("failed", reason, { issue: number });
    return { status: "failed", issue: number, reason };
  }
  emit("claimed", `claimed by ${me.login}`, { issue: number });

  const fail = async (reason: string): Promise<BuildResult> => {
    say(`FAILED: ${reason}`);
    emit("failed", reason, { issue: number });
    try {
      await gh.comment(repo, number, `[build] failed: ${reason}. Card stays in building. Full log is local only.`);
    } catch (e) {
      say(`could not comment on the issue: ${errorMessage(e)}`);
    }
    return { status: "failed", issue: number, reason };
  };

  const branch = `issue-${number}`;
  const worktree = join(opts.paths.worktreeRoot, branch);
  const logFile = join(opts.paths.logDir, `${branch}.log`);
  let worktreeCreated = false;

  try {
    // 4. Isolate.
    if (await git.remoteBranchExists(cloneDir, branch)) {
      return await fail(`branch ${branch} already exists on origin; resolve it by hand`);
    }
    if (await git.branchExists(cloneDir, branch)) {
      say(`removing leftover local branch ${branch} from an earlier failed run`);
      await git.worktreeRemove(cloneDir, worktree);
      await git.deleteBranch(cloneDir, branch);
    }
    say(`worktree ${worktree} on branch ${branch}`);
    await git.worktreeAdd(cloneDir, worktree, branch, `origin/${project.defaultBranch}`);
    worktreeCreated = !dryRun;

    // 5. Build, then verify without trusting the agent's own claims.
    const verify = verifyStep(project);
    if (dryRun) {
      say(`dry-run: would run the agent in ${worktree} (max ${project.limits.maxTurns} turns)`);
    } else {
      say(`builder agent running; follow with: tail -f ${logFile}`);
      const identity = { name: me.login, email: `${me.id}+${me.login}@users.noreply.github.com` };
      try {
        await agent.run({
          cwd: worktree,
          prompt,
          maxTurns: project.limits.maxTurns,
          allowedTools: allowedToolsFor(project),
          logFile,
          env: {
            GIT_AUTHOR_NAME: identity.name,
            GIT_AUTHOR_EMAIL: identity.email,
            GIT_COMMITTER_NAME: identity.name,
            GIT_COMMITTER_EMAIL: identity.email,
          },
        });
      } catch (e) {
        return await fail(`builder agent exited with an error (${errorMessage(e)})`);
      }
      emit("agent_done", "builder agent finished", { issue: number });

      if ((await git.commitsAhead(worktree, `origin/${project.defaultBranch}`)) < 1) return await fail("builder made no commit");
      if (!(await git.isClean(worktree))) return await fail("builder left uncommitted changes");

      if (verify) {
        say(`independent ${verify.kind} run: ${verify.command}`);
        const result = await shell.run(verify.command, { cwd: worktree, logFile });
        if (!result.ok) return await fail(`${verify.kind} failed on the branch`);
        emit("verified", `${verify.kind} passed`, { issue: number });
      } else {
        say("no build or test command configured: skipping independent verification");
        emit("verified", "skipped: no build or test command configured", { issue: number });
      }
    }

    // 6. Hand off.
    const verifyLine = verify
      ? verify.kind === "test"
        ? `Independent \`${verify.command}\`: passed.`
        : `No tests configured. Independent build \`${verify.command}\`: passed.`
      : "Tests: none configured.";
    say(`push ${branch} and open draft PR`);
    let prUrl: string;
    try {
      await git.push(worktree, branch);
      prUrl = await gh.createDraftPr(repo, {
        base: project.defaultBranch,
        head: branch,
        title: issue.title,
        body: `Closes #${number}\n\nBuilt by the build lane (runner).\n${verifyLine}`,
      });
    } catch (e) {
      return await fail(`could not push or open the pull request (${errorMessage(e)})`);
    }
    emit("pr_opened", `draft PR ${prUrl}`, { issue: number, url: prUrl });

    say("building -> qa");
    await gh.editIssue(repo, number, { removeLabels: ["building"], addLabels: ["qa"] });
    await gh.comment(repo, number, `[build] done. Draft PR: ${prUrl}. ${verifyLine} Next: qa.`);
    emit("handed_off", "building -> qa", { issue: number, url: prUrl });
    say(`done: ${prUrl}`);
    return { status: "done", issue: number, prUrl };
  } catch (e) {
    return await fail(`unexpected error: ${errorMessage(e)}`);
  } finally {
    if (worktreeCreated) {
      try {
        await git.worktreeRemove(cloneDir, worktree);
      } catch (e) {
        say(`could not remove worktree ${worktree}: ${errorMessage(e)}`);
      }
    }
  }
}
