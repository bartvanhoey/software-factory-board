import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProject } from "@factory/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArgs } from "./cli.js";
import { REPO_ROOT, ensureClone, loadLocalConfig, loadSettings, resolveCloneDir, worktreeRoot, type Settings } from "./config.js";
import { UsageError } from "./errors.js";
import { createEventLog } from "./events.js";
import { acquireLock } from "./lock.js";
import { findOnPath, missingTools, programOf } from "./preflight.js";
import { allowedToolsFor, qaToolsFor, renderPrompt, verifyStep } from "./prompt.js";
import { FakeGh, FakeGit } from "./testing/fakes.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "factory-runner-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const project = (extra: Record<string, unknown> = {}) =>
  parseProject({ name: "demo", repo: "Owner/Repo", ...extra }, "projects/demo.json");

describe("parseArgs", () => {
  it("parses build and labels", () => {
    expect(parseArgs(["build", "--project", "demo"])).toEqual({ command: "build", project: "demo", issue: undefined, merge: false, dryRun: false });
    expect(parseArgs(["build", "--project", "demo", "--issue", "12", "--dry-run"])).toMatchObject({ issue: 12, dryRun: true });
    expect(parseArgs(["labels", "--project", "demo"]).command).toBe("labels");
  });

  it("parses review, where --merge is opt-in and only valid", () => {
    expect(parseArgs(["review", "--project", "demo"])).toEqual({ command: "review", project: "demo", issue: undefined, merge: false, dryRun: false });
    expect(parseArgs(["review", "--project", "demo", "--issue", "53", "--merge", "--dry-run"])).toMatchObject({
      command: "review",
      issue: 53,
      merge: true,
      dryRun: true,
    });
    for (const command of ["build", "qa", "labels"]) {
      expect(() => parseArgs([command, "--project", "demo", "--merge"]), command).toThrow(/--merge only applies to review/);
    }
  });

  it("parses qa, with an optional issue and dry run", () => {
    expect(parseArgs(["qa", "--project", "demo"])).toEqual({ command: "qa", project: "demo", issue: undefined, merge: false, dryRun: false });
    expect(parseArgs(["qa", "--project", "demo", "--issue", "53", "--dry-run"])).toMatchObject({ command: "qa", issue: 53, dryRun: true });
    expect(() => parseArgs(["qa"])).toThrow(UsageError);
  });

  it("rejects bad input with a usage error", () => {
    for (const argv of [[], ["fly"], ["build"], ["build", "--project"], ["build", "--project", "d", "--issue", "x"],
      ["build", "--project", "d", "--issue", "0"], ["build", "--project", "d", "--wat"], ["labels", "--project", "d", "--issue", "3"]]) {
      expect(() => parseArgs(argv), JSON.stringify(argv)).toThrow(UsageError);
    }
  });
});

describe("renderPrompt / allowedToolsFor / verifyStep", () => {
  it("fills the placeholders and marks missing commands", () => {
    const p = project({ commands: { build: "make" } });
    expect(renderPrompt("b={{build_command}} t={{ test_command }} n={{project_name}}", p)).toBe("b=make t=(none configured) n=demo");
  });

  it("fills {{default_branch}} from the project, defaulting to main", () => {
    expect(renderPrompt("origin/{{default_branch}}", project())).toBe("origin/main");
    expect(renderPrompt("origin/{{ default_branch }}...HEAD", project({ defaultBranch: "master" }))).toBe("origin/master...HEAD");
    expect(renderPrompt("origin/{{default_branch}}", project({ defaultBranch: "release/2026" }))).toBe("origin/release/2026");
  });

  it("renders the real prompt files, using the project's default branch and no hard-coded one", () => {
    for (const name of ["builder.md", "qa.md", "review.md", "rework.md"]) {
      const template = readFileSync(join(REPO_ROOT, "prompts", name), "utf8");
      for (const defaultBranch of ["main", "master", "develop"]) {
        const text = renderPrompt(template, project({ defaultBranch, commands: { build: "make", test: "make test" } }));
        expect(text, `${name} (${defaultBranch}) has an unfilled placeholder`).not.toMatch(/\{\{/);
        for (const other of ["main", "master"].filter((b) => b !== defaultBranch)) {
          expect(text, `${name} hard-codes origin/${other}`).not.toContain(`origin/${other}`);
        }
      }
    }
    const qa = readFileSync(join(REPO_ROOT, "prompts", "qa.md"), "utf8");
    expect(renderPrompt(qa, project({ defaultBranch: "master" }))).toContain("`git diff origin/master...HEAD`");
    const rework = readFileSync(join(REPO_ROOT, "prompts", "rework.md"), "utf8");
    expect(renderPrompt(rework, project({ defaultBranch: "master" }))).toContain("git diff origin/master...HEAD");
    const review = readFileSync(join(REPO_ROOT, "prompts", "review.md"), "utf8");
    expect(renderPrompt(review, project({ defaultBranch: "master" }))).toContain("git diff origin/master...<commit under review>");
  });

  it("rejects an unknown placeholder", () => {
    expect(() => renderPrompt("{{oops}}", project())).toThrow("unknown placeholder {{oops}}");
  });

  it("adds toolchain tools per stack, and never a general Bash", () => {
    expect(allowedToolsFor(project({ stack: "dotnet" }))).toContain("Bash(dotnet:*)");
    expect(allowedToolsFor(project({ stack: "node" }))).toEqual(expect.arrayContaining(["Bash(npm:*)", "Bash(npx:*)"]));
    expect(allowedToolsFor(project({ stack: "python" }))).toEqual(expect.arrayContaining(["Bash(python:*)", "Bash(pytest:*)"]));
    expect(allowedToolsFor(project({ stack: "other" })).some((t) => t.startsWith("Bash(") && !t.startsWith("Bash(git "))).toBe(false);
    for (const stack of ["dotnet", "node", "python", "other"] as const) {
      expect(allowedToolsFor(project({ stack }))).not.toContain("Bash");
    }
  });

  it("gives the qa agent the same toolchain but no way to write or commit", () => {
    const tools = qaToolsFor(project({ stack: "dotnet" }));
    expect(tools).toEqual(expect.arrayContaining(["Read", "Glob", "Grep", "Bash(git diff:*)", "Bash(dotnet:*)"]));
    for (const stack of ["dotnet", "node", "python", "other"] as const) {
      const t = qaToolsFor(project({ stack }));
      for (const forbidden of ["Edit", "Write", "Bash", "Bash(git add:*)", "Bash(git commit:*)"]) expect(t, `${stack} ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("prefers tests, then build, then nothing", () => {
    expect(verifyStep(project({ commands: { build: "b", test: "t" } }))).toEqual({ kind: "test", command: "t" });
    expect(verifyStep(project({ commands: { build: "b" } }))).toEqual({ kind: "build", command: "b" });
    expect(verifyStep(project())).toBeNull();
  });
});

describe("acquireLock", () => {
  it("is exclusive, and can be taken again after release", () => {
    const dir = join(tmp, "locks", "demo.lock");
    const release = acquireLock(dir);
    expect(release).not.toBeNull();
    expect(acquireLock(dir)).toBeNull();
    release?.();
    const again = acquireLock(dir);
    expect(again).not.toBeNull();
    again?.();
  });

  it("takes over a lock whose process is gone", () => {
    const dir = join(tmp, "locks", "demo.lock");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pid"), "2147483646");
    const release = acquireLock(dir);
    expect(release).not.toBeNull();
    release?.();
  });

  it("takes over a lock that is far too old, even if the pid looks alive", () => {
    const dir = join(tmp, "locks", "demo.lock");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pid"), String(process.pid));
    const old = new Date(Date.now() - 4 * 60 * 60 * 1000);
    utimesSync(dir, old, old);
    expect(acquireLock(dir)).not.toBeNull();
  });

  it("does not take over a fresh lock held by a live process", () => {
    const dir = join(tmp, "locks", "demo.lock");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pid"), String(process.pid));
    expect(acquireLock(dir)).toBeNull();
  });
});

describe("createEventLog", () => {
  it("appends validated JSON lines, creating the folder", () => {
    const file = join(tmp, "data", "events.jsonl");
    const log = createEventLog(file, () => new Date("2026-01-01T12:00:00Z"));
    log.append({ project: "demo", lane: "build", type: "claimed", message: "claimed #4", issue: 4 });
    log.append({ project: "demo", lane: "build", type: "noop", message: "nothing" });
    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ ts: "2026-01-01T12:00:00.000Z", project: "demo", lane: "build", type: "claimed", message: "claimed #4", issue: 4 });
  });

  it("never throws when the log cannot be written", () => {
    const blocker = join(tmp, "file");
    writeFileSync(blocker, "x");
    const log = createEventLog(join(blocker, "events.jsonl"));
    expect(() => log.append({ project: "demo", lane: "build", type: "noop", message: "x" })).not.toThrow();
  });
});

describe("config", () => {
  const settings = (over: Partial<Settings> = {}): Settings => ({ dataDir: "d", workspace: join(tmp, "ws"), local: null, ...over });

  it("resolves the clone as <workspace>/<repo name>, with local.json overrides first", () => {
    expect(resolveCloneDir(project(), settings())).toBe(join(tmp, "ws", "Repo"));
    const local = { workspace: "x", overrides: { demo: join(tmp, "elsewhere") } };
    expect(resolveCloneDir(project(), settings({ local }))).toBe(join(tmp, "elsewhere"));
  });

  it("needs a workspace unless there is an override", () => {
    expect(() => resolveCloneDir(project(), settings({ workspace: null }))).toThrow(/no workspace/);
  });

  it("puts worktrees under the workspace, or next to an overridden clone", () => {
    expect(worktreeRoot(project(), settings(), "any")).toBe(join(tmp, "ws", ".factory-worktrees", "demo"));
    expect(worktreeRoot(project(), settings({ workspace: null }), join(tmp, "elsewhere", "Repo"))).toBe(
      join(tmp, "elsewhere", ".factory-worktrees", "demo"),
    );
  });

  it("reads local.json, and reports a broken one clearly", () => {
    expect(loadLocalConfig(join(tmp, "missing.json"))).toBeNull();
    const ok = join(tmp, "local.json");
    writeFileSync(ok, JSON.stringify({ workspace: "/w" }));
    expect(loadLocalConfig(ok)).toEqual({ workspace: "/w", overrides: {} });
    const bad = join(tmp, "bad.json");
    writeFileSync(bad, JSON.stringify({ workspace: "/w", extra: 1 }));
    expect(() => loadLocalConfig(bad)).toThrow(/is invalid/);
    writeFileSync(bad, "{nope");
    expect(() => loadLocalConfig(bad)).toThrow(/not valid JSON/);
  });

  it("takes the workspace from the environment when local.json has none", () => {
    const s = loadSettings({ FACTORY_LOCAL_CONFIG: join(tmp, "none.json"), FACTORY_WORKSPACE: "/ws", FACTORY_DATA: "/data" });
    expect(s).toMatchObject({ workspace: "/ws", dataDir: "/data", local: null });
  });

  it("clones a missing project, and accepts or refuses an existing folder by its origin", async () => {
    const gh = new FakeGh();
    const git = new FakeGit();
    const said: string[] = [];
    await ensureClone(gh, git, project(), join(tmp, "new"), (m) => said.push(m));
    expect(gh.cloneRepo).toBeDefined();
    expect(said[0]).toContain("cloning Owner/Repo");

    const dir = join(tmp, "ws", "Repo");
    mkdirSync(dir, { recursive: true });
    git.origin = "https://github.com/owner/repo.git";
    await expect(ensureClone(gh, git, project(), dir, () => undefined)).resolves.toBeUndefined();
    git.origin = "git@github.com:owner/repo.git";
    await expect(ensureClone(gh, git, project(), dir, () => undefined)).resolves.toBeUndefined();
    git.origin = "https://github.com/someone/other.git";
    await expect(ensureClone(gh, git, project(), dir, () => undefined)).rejects.toThrow(/not Owner\/Repo/);
  });
});

describe("preflight", () => {
  it("finds an executable on PATH and reports missing tools", () => {
    const bin = join(tmp, "bin");
    mkdirSync(bin);
    const tool = join(bin, "mytool");
    writeFileSync(tool, "#!/bin/sh\n");
    chmodSync(tool, 0o755);
    const env = { PATH: bin };
    if (process.platform !== "win32") expect(findOnPath("mytool", env)).toBe(tool);
    expect(findOnPath("definitely-not-installed", env)).toBeNull();
    expect(missingTools(["definitely-not-installed", "definitely-not-installed", ""], env)).toEqual(["definitely-not-installed"]);
  });

  it("takes the program from a command line", () => {
    expect(programOf("  dotnet test x.sln --nologo ")).toBe("dotnet");
    expect(programOf("")).toBe("");
  });
});
