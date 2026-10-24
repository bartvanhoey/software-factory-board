import type { Git } from "../ports.js";
import { mustRun, runProcess } from "../process.js";

/**
 * Network commands authenticate through `gh` (GH_TOKEN) for this one command only.
 * Nothing is written to git config, which matters because HOME is wiped on restart.
 */
const AUTH = ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"];

const git = (cwd: string, args: string[], network = false): Promise<string> =>
  mustRun("git", ["-C", cwd, ...(network ? AUTH : []), ...args], { env: { GIT_TERMINAL_PROMPT: "0" } });

/** The real git adapter. */
export const gitCli: Git = {
  async originUrl(cwd) {
    return (await git(cwd, ["remote", "get-url", "origin"])).trim();
  },

  async fetch(cwd, remote, branch) {
    await git(cwd, ["fetch", "-q", remote, branch], true);
  },

  async worktreeAdd(cwd, path, branch, startPoint) {
    await git(cwd, ["worktree", "add", "-b", branch, path, startPoint]);
  },

  async worktreeAddDetached(cwd, path, sha) {
    await git(cwd, ["worktree", "add", "--detach", path, sha]);
  },

  async revParse(cwd, ref) {
    return (await git(cwd, ["rev-parse", ref])).trim();
  },

  async worktreeRemove(cwd, path) {
    await runProcess("git", ["-C", cwd, "worktree", "remove", "--force", path]);
    await runProcess("git", ["-C", cwd, "worktree", "prune"]);
  },

  async branchExists(cwd, branch) {
    const r = await runProcess("git", ["-C", cwd, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return r.code === 0;
  },

  async remoteBranchExists(cwd, branch) {
    const r = await runProcess("git", ["-C", cwd, ...AUTH, "ls-remote", "--exit-code", "--heads", "origin", branch], {
      env: { GIT_TERMINAL_PROMPT: "0" },
    });
    if (r.code === 0) return true;
    if (r.code === 2) return false; // no matching ref
    throw new Error(`git ls-remote failed (exit ${r.code}): ${r.stderr.trim()}`);
  },

  async deleteBranch(cwd, branch) {
    await git(cwd, ["branch", "-D", branch]);
  },

  async commitsAhead(cwd, base) {
    return Number.parseInt((await git(cwd, ["rev-list", "--count", `${base}..HEAD`])).trim(), 10);
  },

  async isClean(cwd) {
    return (await git(cwd, ["status", "--porcelain"])).trim() === "";
  },

  async push(cwd, branch) {
    await git(cwd, ["push", "-u", "origin", branch], true);
  },
};
