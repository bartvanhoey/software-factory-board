import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitCli } from "./git.js";

// These tests run the real git adapter against a throwaway repository, with no git identity
// configured anywhere, like the Docker container. They need the `git` program.

let root: string;
let repo: string;
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ["HOME", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];

/** Plain git for test setup: it brings its own identity so the repository can be built. */
const git = (...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=setup", "-c", "user.email=setup@example.com", ...args], { encoding: "utf8" });

const commitFile = (file: string, text: string, message: string) => {
  writeFileSync(join(repo, file), text);
  git("add", file);
  git("commit", "-q", "-m", message);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "factory-git-"));
  repo = join(root, "repo");
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  // Refuse to guess an identity from the host name, which is what makes a bare container fail.
  git("config", "user.useConfigOnly", "true");
  commitFile("a.txt", "one\n", "first");
  git("checkout", "-q", "-b", "feature");
  commitFile("b.txt", "feature\n", "feature work");
  git("checkout", "-q", "main");

  for (const key of ENV_KEYS) saved[key] = process.env[key];
  writeFileSync(join(root, "empty-gitconfig"), "");
  process.env.HOME = root;
  process.env.GIT_CONFIG_GLOBAL = join(root, "empty-gitconfig");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  for (const key of ENV_KEYS.filter((k) => k.startsWith("GIT_AUTHOR") || k.startsWith("GIT_COMMITTER"))) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(root, { recursive: true, force: true });
});

describe("gitCli.merge", () => {
  it("merges cleanly without any git identity, leaving the result staged and creating no commit", async () => {
    const head = git("rev-parse", "HEAD").trim();
    const feature = git("rev-parse", "feature").trim();

    expect(await gitCli.merge(repo, feature)).toBe(true);

    expect(git("rev-parse", "HEAD").trim()).toBe(head); // no commit was made
    expect(await gitCli.isClean(repo)).toBe(false); // the merge is staged
    expect(git("status", "--porcelain")).toContain("b.txt");
  });

  it("returns false on a conflict", async () => {
    git("checkout", "-q", "-b", "other", "main");
    commitFile("c.txt", "from other\n", "other work");
    git("checkout", "-q", "main");
    commitFile("c.txt", "from main\n", "main work");
    const other = git("rev-parse", "other").trim();

    expect(await gitCli.merge(repo, other)).toBe(false);
    expect(git("status", "--porcelain")).toMatch(/^(AA|UU) c\.txt/m);
  });

  it("throws, with git's message, for a commit that does not exist, instead of calling it a conflict", async () => {
    await expect(gitCli.merge(repo, "0000000000000000000000000000000000000000")).rejects.toThrow(/git merge failed \(exit 1\)/);
    expect(await gitCli.isClean(repo)).toBe(true);
  });
});

describe("gitCli worktrees and refs", () => {
  it("adds a detached worktree at a commit, reports it clean, and removes it without error", async () => {
    const sha = git("rev-parse", "main").trim();
    const wt = join(root, "wt");
    await gitCli.worktreeAddDetached(repo, wt, sha);
    expect(await gitCli.revParse(wt, "HEAD")).toBe(sha);
    expect(await gitCli.isClean(wt)).toBe(true);
    await gitCli.worktreeRemove(repo, wt);
    await gitCli.worktreeRemove(repo, wt); // a missing worktree is not an error
    expect(git("worktree", "list", "--porcelain")).not.toMatch(/^worktree .*\/wt$/m);
  });

  it("knows whether a local branch exists and counts commits ahead of a base", async () => {
    expect(await gitCli.branchExists(repo, "feature")).toBe(true);
    expect(await gitCli.branchExists(repo, "nope")).toBe(false);
    git("checkout", "-q", "feature");
    expect(await gitCli.commitsAhead(repo, "main")).toBe(1);
  });
});
