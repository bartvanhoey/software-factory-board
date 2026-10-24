import type { NewEvent } from "@factory/shared";

export interface LabelSpec {
  name: string;
  /** Hex colour without the leading #. */
  color: string;
  description: string;
}

export interface IssueData {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export interface IssueEdit {
  addAssignee?: string;
  addLabels?: string[];
  removeLabels?: string[];
}

/** GitHub, through the `gh` CLI. */
export interface Gh {
  whoami(): Promise<{ login: string; id: number }>;
  listLabels(repo: string): Promise<string[]>;
  createLabel(repo: string, spec: LabelSpec): Promise<"created" | "exists">;
  listIssuesByLabel(repo: string, label: string): Promise<{ number: number }[]>;
  getIssue(repo: string, number: number): Promise<IssueData>;
  editIssue(repo: string, number: number, edit: IssueEdit): Promise<void>;
  comment(repo: string, number: number, body: string): Promise<void>;
  /** The open pull request whose head is `branch`, or null. */
  findOpenPr(repo: string, branch: string): Promise<{ number: number; url: string } | null>;
  commentPr(repo: string, number: number, body: string): Promise<void>;
  /** Returns the URL of the new pull request. */
  createDraftPr(repo: string, pr: { base: string; head: string; title: string; body: string }): Promise<string>;
  cloneRepo(repo: string, dir: string): Promise<void>;
}

export interface Git {
  originUrl(cwd: string): Promise<string>;
  fetch(cwd: string, remote: string, branch: string): Promise<void>;
  worktreeAdd(cwd: string, path: string, branch: string, startPoint: string): Promise<void>;
  /** A worktree at one exact commit, on no branch. */
  worktreeAddDetached(cwd: string, path: string, sha: string): Promise<void>;
  revParse(cwd: string, ref: string): Promise<string>;
  /** Removes a worktree if it exists; never throws for a missing one. */
  worktreeRemove(cwd: string, path: string): Promise<void>;
  branchExists(cwd: string, branch: string): Promise<boolean>;
  remoteBranchExists(cwd: string, branch: string): Promise<boolean>;
  deleteBranch(cwd: string, branch: string): Promise<void>;
  commitsAhead(cwd: string, base: string): Promise<number>;
  isClean(cwd: string): Promise<boolean>;
  push(cwd: string, branch: string): Promise<void>;
}

export interface AgentRun {
  cwd: string;
  prompt: string;
  maxTurns: number;
  allowedTools: string[];
  logFile: string;
  /** Extra environment, for example the git author identity. */
  env: Record<string, string>;
}

/** The coding agent (`claude -p`). Resolves with its final text; rejects when it exits with an error. */
export interface AgentRunner {
  run(run: AgentRun): Promise<string>;
}

/** Runs a project command (build or test) through a shell. */
export interface Shell {
  run(command: string, opts: { cwd: string; logFile: string }): Promise<{ ok: boolean }>;
}

export interface EventLog {
  append(event: NewEvent): void;
}

/** Makes sure the lane labels exist in a repo. */
export interface LabelEnsurer {
  ensure(repo: string): Promise<void>;
  /** Forget that a repo was checked, so the next `ensure` looks again. */
  forget(repo: string): void;
}
