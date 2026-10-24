import { join } from "node:path";
import { parseProject, type ProjectInput } from "@factory/shared";
import { describe, expect, it } from "vitest";
import { dryRunGh, dryRunGit } from "../dryRun.js";
import { UsageError } from "../errors.js";
import { createLabelEnsurer } from "../labels.js";
import { FakeAgent, FakeEvents, FakeGh, FakeGit, FakeShell, type CallLog } from "../testing/fakes.js";
import { runBuildLane, type BuildDeps, type BuildResult } from "./build.js";

const TEMPLATE = "Build with {{build_command}}, test with {{test_command}}.";
const WORKTREES = join("work", ".factory-worktrees", "demo");

const makeProject = (extra: Partial<ProjectInput> = {}) =>
  parseProject(
    {
      name: "demo",
      repo: "o/r",
      stack: "dotnet",
      commands: { build: "dotnet build x.sln", test: "dotnet test x.sln" },
      ...extra,
    },
    "projects/demo.json",
  );

function setup(project = makeProject()) {
  const log: CallLog = [];
  const gh = new FakeGh(log);
  const git = new FakeGit(log);
  const agent = new FakeAgent(log);
  const shell = new FakeShell(log);
  const events = new FakeEvents();
  const said: string[] = [];
  const labels = createLabelEnsurer(gh, events, project.name);
  gh.labels = new Set(["ready", "building", "qa", "review"]);

  const deps = (): BuildDeps => ({ gh, git, agent, shell, events, labels, say: (m) => said.push(m) });
  const run = (o: { issue?: number; dryRun?: boolean; template?: string; deps?: BuildDeps } = {}): Promise<BuildResult> =>
    runBuildLane(o.deps ?? deps(), {
      project,
      cloneDir: "clone",
      paths: { worktreeRoot: WORKTREES, logDir: "logs" },
      promptTemplate: o.template ?? TEMPLATE,
      issue: o.issue,
      dryRun: o.dryRun ?? false,
    });
  return { log, gh, git, agent, shell, events, said, run, deps, project };
}

const inOrder = (log: string[], ...steps: string[]) => {
  let at = -1;
  for (const step of steps) {
    const found = log.findIndex((l, i) => i > at && l.startsWith(step));
    expect(found, `"${step}" should come after index ${at} in:\n${log.join("\n")}`).toBeGreaterThan(at);
    at = found;
  }
};

describe("runBuildLane: happy path", () => {
  it("takes a ready issue to a pushed branch and the qa label, in order, without opening a PR", async () => {
    const t = setup();
    t.gh.addIssue(4, ["ready", "bug"], { title: "Add paging", body: "Page the list." });

    const result = await t.run();

    expect(result).toEqual({ status: "done", issue: 4, branch: "issue-4", compareUrl: "https://github.com/o/r/compare/main...issue-4" });
    inOrder(
      t.log,
      "gh.listLabels",
      "gh.listIssuesByLabel ready",
      "gh.getIssue 4",
      "git.fetch main",
      "gh.whoami",
      "gh.editIssue 4 +[building] -[ready]",
      "git.remoteBranchExists issue-4",
      "git.worktreeAdd issue-4 from origin/main",
      "agent.run",
      "git.commitsAhead",
      "git.isClean",
      "shell.run dotnet test x.sln",
      "git.push issue-4",
      "gh.editIssue 4 +[qa] -[building]",
      "gh.comment 4",
      "git.worktreeRemove",
    );
    expect(t.gh.issues.get(4)?.labels).toEqual(["bug", "qa"]);
    expect(t.gh.edits[0]?.edit.addAssignee).toBe("factory-bot");
    expect(t.events.types).toEqual(["started", "claimed", "agent_done", "verified", "pushed", "handed_off"]);
    // A PR means "approved", and only the review lane opens one.
    expect(t.gh.prs).toEqual([]);
    expect(t.log.some((l) => l.startsWith("gh.createPr") || l.startsWith("gh.findOpenPr"))).toBe(false);
  });

  it("runs the agent in the worktree with the rendered prompt, the stack's tools and a git identity", async () => {
    const t = setup();
    t.gh.addIssue(4, ["ready"], { title: "Add paging", body: "Page the list." });
    await t.run();

    const run = t.agent.runs[0];
    expect(run?.cwd).toBe(join(WORKTREES, "issue-4"));
    expect(run?.prompt).toContain("Build with dotnet build x.sln, test with dotnet test x.sln.");
    expect(run?.prompt).toContain("## Issue #4: Add paging");
    expect(run?.prompt).toContain("Page the list.");
    expect(run?.maxTurns).toBe(20);
    expect(run?.allowedTools).toContain("Bash(dotnet:*)");
    expect(run?.allowedTools).not.toContain("Bash(npm:*)");
    expect(run?.logFile).toBe(join("logs", "issue-4.log"));
    expect(run?.env).toMatchObject({
      GIT_AUTHOR_NAME: "factory-bot",
      GIT_AUTHOR_EMAIL: "42+factory-bot@users.noreply.github.com",
      GIT_COMMITTER_NAME: "factory-bot",
    });
  });

  it("comments on the issue with the compare link against the default branch and the test result", async () => {
    const t = setup(makeProject({ defaultBranch: "develop" }));
    t.gh.addIssue(4, ["ready"], { title: "Add paging" });
    await t.run();

    expect(t.gh.prs).toEqual([]);
    expect(t.log).toContain("git.worktreeAdd issue-4 from origin/develop");
    expect(t.gh.comments).toHaveLength(1);
    expect(t.gh.comments[0]?.body).toBe(
      "[build] done. Branch issue-4 pushed (compare: https://github.com/o/r/compare/develop...issue-4). Independent `dotnet test x.sln`: passed. Next: qa.",
    );
    expect(t.shell.commands[0]).toEqual({ command: "dotnet test x.sln", cwd: join(WORKTREES, "issue-4") });
  });

  it("picks the lowest-numbered ready issue", async () => {
    const t = setup();
    t.gh.addIssue(9, ["ready"]);
    t.gh.addIssue(3, ["ready"]);
    expect((await t.run()).status).toBe("done");
    expect(t.gh.edits[0]?.number).toBe(3);
  });

  it("builds a specific issue when asked, and accepts a differently cased ready label", async () => {
    const t = setup();
    t.gh.addIssue(9, ["ready"]);
    t.gh.addIssue(5, ["Ready"]);
    expect((await t.run({ issue: 5 })).status).toBe("done");
    expect(t.gh.edits[0]?.number).toBe(5);
    expect(t.log.some((l) => l.startsWith("gh.listIssuesByLabel"))).toBe(false);
  });
});

describe("runBuildLane: nothing to do, or wrong input", () => {
  it("does nothing when no issue is ready", async () => {
    const t = setup();
    t.gh.addIssue(4, ["building"]);
    expect(await t.run()).toEqual({ status: "noop" });
    expect(t.gh.edits).toEqual([]);
    expect(t.events.types).toEqual(["noop"]);
    expect(t.agent.runs).toEqual([]);
  });

  it("refuses an issue that is not labelled ready, without touching it", async () => {
    const t = setup();
    t.gh.addIssue(4, ["qa"]);
    const error = await t.run({ issue: 4 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).exitCode).toBe(65);
    expect(t.gh.edits).toEqual([]);
    expect(t.gh.comments).toEqual([]);
  });

  it("rejects a prompt template with an unknown placeholder before claiming anything", async () => {
    const t = setup();
    t.gh.addIssue(4, ["ready"]);
    await expect(t.run({ template: "Use {{nope}}" })).rejects.toThrow("unknown placeholder {{nope}}");
    expect(t.gh.edits).toEqual([]);
  });
});

describe("runBuildLane: verification by project", () => {
  it("runs the build command when a project has no tests", async () => {
    const t = setup(makeProject({ commands: { build: "make build" } }));
    t.gh.addIssue(4, ["ready"]);
    await t.run();
    expect(t.shell.commands.map((c) => c.command)).toEqual(["make build"]);
    expect(t.gh.comments[0]?.body).toContain("No tests configured. Independent build `make build`: passed.");
  });

  it("skips verification and says so when there is neither build nor test command", async () => {
    const t = setup(makeProject({ stack: "other", commands: {} }));
    t.gh.addIssue(4, ["ready"]);
    const result = await t.run();
    expect(result.status).toBe("done");
    expect(t.shell.commands).toEqual([]);
    expect(t.gh.comments[0]?.body).toContain("Tests: none configured.");
    expect(t.gh.comments[0]?.body).not.toContain("passed");
    expect(t.events.events.find((e) => e.type === "verified")?.message).toMatch(/skipped/);
    expect(t.agent.runs[0]?.prompt).toContain("(none configured)");
  });

  it("limits the agent's tools by stack and honours maxTurns", async () => {
    const t = setup(makeProject({ stack: "node", limits: { maxTurns: 7 } }));
    t.gh.addIssue(4, ["ready"]);
    await t.run();
    expect(t.agent.runs[0]?.maxTurns).toBe(7);
    expect(t.agent.runs[0]?.allowedTools).toContain("Bash(npm:*)");
    expect(t.agent.runs[0]?.allowedTools).not.toContain("Bash(dotnet:*)");
  });
});

describe("runBuildLane: failures keep the card in building", () => {
  const expectFailed = (t: ReturnType<typeof setup>, result: BuildResult, reason: RegExp) => {
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.reason).toMatch(reason);
    expect(t.gh.comments).toHaveLength(1);
    expect(t.gh.comments[0]?.body).toMatch(/^\[build\] failed: /);
    expect(t.gh.comments[0]?.body).toContain("Card stays in building");
    expect(t.gh.issues.get(4)?.labels).toEqual(["building"]);
    expect(t.gh.prs).toEqual([]);
    expect(t.events.types.at(-1)).toBe("failed");
  };

  it("when the agent exits with an error, and cleans up the worktree", async () => {
    const t = setup();
    t.gh.addIssue(4, ["ready"]);
    t.agent.error = new Error("claude exited with code 1");
    expectFailed(t, await t.run(), /builder agent exited with an error/);
    expect(t.log).toContain("git.worktreeRemove");
    expect(t.log).not.toContain("git.push issue-4");
  });

  it("when the agent made no commit", async () => {
    const t = setup();
    t.gh.addIssue(4, ["ready"]);
    t.git.ahead = 0;
    expectFailed(t, await t.run(), /builder made no commit/);
    expect(t.log).not.toContain("git.push issue-4");
  });

  it("when the agent left uncommitted changes", async () => {
    const t = setup();
    t.gh.addIssue(4, ["ready"]);
    t.git.clean = false;
    expectFailed(t, await t.run(), /uncommitted changes/);
    expect(t.log).not.toContain("git.push issue-4");
  });

  it("when the independent test run fails", async () => {
    const t = setup();
    t.gh.addIssue(4, ["ready"]);
    t.shell.ok = false;
    expectFailed(t, await t.run(), /test failed on the branch/);
    expect(t.log).not.toContain("git.push issue-4");
  });

  it("when the push fails", async () => {
    const t = setup();
    t.gh.addIssue(4, ["ready"]);
    t.git.failOnce.set("push", new Error("remote rejected"));
    expectFailed(t, await t.run(), /could not push the branch \(remote rejected\)/);
  });

  it("when the branch already exists on origin, without creating a worktree", async () => {
    const t = setup();
    t.gh.addIssue(4, ["ready"]);
    t.git.remoteBranches.add("issue-4");
    expectFailed(t, await t.run(), /already exists on origin/);
    expect(t.log.some((l) => l.startsWith("git.worktreeAdd"))).toBe(false);
    expect(t.agent.runs).toEqual([]);
  });

  it("when an unexpected error happens, after claiming", async () => {
    const t = setup();
    t.gh.addIssue(4, ["ready"]);
    t.git.failOnce.set("worktreeAdd", new Error("disk full"));
    expectFailed(t, await t.run(), /unexpected error: disk full/);
  });

  it("still reports the failure when commenting on the issue also fails", async () => {
    const t = setup();
    t.gh.addIssue(4, ["ready"]);
    t.git.ahead = 0;
    t.gh.failOnce.set("comment", new Error("HTTP 500"));
    const result = await t.run();
    expect(result.status).toBe("failed");
    expect(t.said.some((m) => m.includes("could not comment"))).toBe(true);
  });
});

describe("runBuildLane: base branch", () => {
  it("fails before claiming when the base branch cannot be fetched, leaving the card in ready", async () => {
    const t = setup();
    t.gh.addIssue(4, ["ready"]);
    t.git.failOnce.set("fetch", new Error("couldn't find remote ref main"));
    const result = await t.run();
    expect(result).toMatchObject({ status: "failed", issue: 4, reason: expect.stringContaining("could not fetch origin/main") });
    expect(result.status === "failed" && result.reason).toContain("defaultBranch");
    expect(t.gh.edits).toEqual([]);
    expect(t.gh.comments).toEqual([]);
    expect(t.gh.issues.get(4)?.labels).toEqual(["ready"]);
    expect(t.log).not.toContain("gh.whoami");
    expect(t.events.types).toEqual(["started", "failed"]);
  });
});

describe("runBuildLane: retries and leftovers", () => {
  it("removes a leftover local branch from an earlier failed run before building again", async () => {
    const t = setup();
    t.gh.addIssue(4, ["ready"]);
    t.git.localBranches.add("issue-4");
    expect((await t.run()).status).toBe("done");
    inOrder(t.log, "git.branchExists issue-4", "git.worktreeRemove", "git.deleteBranch issue-4", "git.worktreeAdd issue-4");
  });
});

describe("runBuildLane: lane labels", () => {
  it("creates missing labels before picking a card", async () => {
    const t = setup();
    t.gh.labels = new Set(["bug"]);
    t.gh.addIssue(4, ["ready"]);
    expect((await t.run()).status).toBe("done");
    expect(t.gh.createdLabels.map((s) => s.name)).toEqual(["ready", "building", "qa", "review"]);
    inOrder(t.log, "gh.listLabels", "gh.createLabel ready", "gh.listIssuesByLabel ready");
    expect(t.events.types[0]).toBe("labels_created");
  });

  it("fails the run, without touching any issue, when the labels cannot be created", async () => {
    const t = setup();
    t.gh.labels = new Set();
    t.gh.addIssue(4, ["ready"]);
    t.gh.failOnce.set("createLabel", new Error("HTTP 403"));
    const result = await t.run();
    expect(result).toMatchObject({ status: "failed", reason: expect.stringContaining("could not create the lane labels") });
    expect(t.gh.edits).toEqual([]);
    expect(t.gh.comments).toEqual([]);
    expect(t.events.types).toEqual(["failed"]);
  });

  it("re-checks the labels and retries once when the claim fails because a label is missing", async () => {
    const t = setup();
    t.gh.addIssue(4, ["ready"]);
    t.gh.failOnce.set("editIssue", new Error("could not add label: 'building' not found"));
    expect((await t.run()).status).toBe("done");
    expect(t.log.filter((l) => l === "gh.listLabels")).toHaveLength(2);
    expect(t.log.filter((l) => l.startsWith("gh.editIssue 4 +[building]"))).toHaveLength(2);
  });

  it("gives up without a comment when the claim fails for another reason", async () => {
    const t = setup();
    t.gh.addIssue(4, ["ready"]);
    t.gh.failOnce.set("editIssue", new Error("HTTP 502"));
    const result = await t.run();
    expect(result).toMatchObject({ status: "failed", reason: expect.stringContaining("could not claim the issue") });
    expect(t.gh.comments).toEqual([]);
    expect(t.gh.issues.get(4)?.labels).toEqual(["ready"]);
    expect(t.log.some((l) => l.startsWith("git.worktreeAdd"))).toBe(false);
    expect(t.agent.runs).toEqual([]);
  });
});

describe("runBuildLane: dry run", () => {
  it("prints the changes instead of making them, and skips the agent and the tests", async () => {
    const t = setup();
    t.gh.addIssue(4, ["ready"]);
    const printed: string[] = [];
    const deps: BuildDeps = { ...t.deps(), gh: dryRunGh(t.gh, (l) => printed.push(l)), git: dryRunGit(t.git, (l) => printed.push(l)) };

    const result = await t.run({ dryRun: true, deps });

    expect(result).toMatchObject({ status: "done", issue: 4, branch: "issue-4" });
    expect(t.gh.edits).toEqual([]);
    expect(t.gh.comments).toEqual([]);
    expect(t.gh.prs).toEqual([]);
    expect(t.agent.runs).toEqual([]);
    expect(t.shell.commands).toEqual([]);
    expect(t.log).not.toContain("git.push issue-4");
    expect(t.log).not.toContain("git.worktreeRemove");
    expect(printed.some((l) => l.includes("editIssue"))).toBe(true);
    expect(printed.some((l) => l.includes("worktreeAdd"))).toBe(true);
    expect(printed.some((l) => l.includes("createPr"))).toBe(false);
    expect(printed.some((l) => l.includes("push"))).toBe(true);
  });

  it("does not create labels in a dry run", async () => {
    const t = setup();
    t.gh.labels = new Set();
    t.gh.addIssue(4, ["ready"]);
    const printed: string[] = [];
    const gh = dryRunGh(t.gh, (l) => printed.push(l));
    await t.run({ dryRun: true, deps: { ...t.deps(), gh, labels: createLabelEnsurer(gh, t.events, "demo") } });
    expect(t.gh.createdLabels).toEqual([]);
    expect(printed.filter((l) => l.includes("createLabel"))).toHaveLength(4);
  });
});
