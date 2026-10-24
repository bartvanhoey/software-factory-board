/** Board lanes, left to right. Lane = GitHub label, except `done` (closed issue). */
export const LANES = ["ready", "building", "qa", "review", "done"] as const;
export type Lane = (typeof LANES)[number];

/** Labels that put an open issue on the board. */
export const LANE_LABELS = ["ready", "building", "qa", "review"] as const;

export const DONE_WINDOW_DAYS = 7;

export type ChecksState = "success" | "failure" | "pending" | "none";

export interface BoardPr {
  number: number;
  url: string;
  draft: boolean;
  merged: boolean;
  checks: ChecksState;
}

/** The branch the factory pushed for an issue, shown while no PR exists yet. */
export interface BoardBranch {
  name: string;
  /** GitHub's compare page against the project's default branch. */
  compareUrl: string;
}

export interface BoardIssue {
  project: string;
  number: number;
  title: string;
  url: string;
  lane: Lane;
  /** True when an open issue carries more than one lane label. */
  laneConflict: boolean;
  assignee: string | null;
  updatedAt: string;
  pr: BoardPr | null;
  /** Set for qa and review cards without a PR: the factory opens the PR only after the review approves. */
  branch: BoardBranch | null;
}

/** What the board needs to know about a project, whichever way it was loaded. */
export interface ProjectInfo {
  name: string;
  repo: string;
  defaultBranch: string;
  stack: string;
  hasTests: boolean;
  enabled: boolean;
}

export type ProjectResult =
  | { info: ProjectInfo; status: "ok"; issues: BoardIssue[] }
  | { info: ProjectInfo; status: "error"; error: string }
  | { info: ProjectInfo; status: "disabled" };

export interface BoardData {
  source: "live" | "demo";
  /** Why demo data is shown, when source is "demo". */
  demoReason?: string;
  fetchedAt: string;
  projects: ProjectResult[];
}
