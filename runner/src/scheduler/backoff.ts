import { EXIT } from "../errors.js";

export const LANES = ["review", "qa", "build"] as const;
export type Lane = (typeof LANES)[number];

/** What one finished run means for the scheduler. */
export type Outcome = "progress" | "no-progress" | "skip" | "pause-project";

/**
 * `code` is null when the run was killed (timeout) or never exited normally. Exit 1 is a failure only for build: for qa and
 * review it is a card honestly sent back, which is the pipeline working. 69 (a tool is missing or gh is not logged in)
 * will not fix itself on a retry and hits every lane of the project. 65 is NOT a project problem: qa and review raise it
 * for one card (no branch, wrong label), and pausing a whole project for a label someone added would be a denial of service.
 */
export function classify(lane: Lane, code: number | null): Outcome {
  if (code === 0) return "progress";
  if (code === EXIT.failed) return lane === "build" ? "no-progress" : "progress";
  if (code === EXIT.locked) return "skip";
  if (code === EXIT.missingTool) return "pause-project";
  return "no-progress";
}

const MINUTE = 60_000;
/** Wait after the 1st, 2nd and 3rd no-progress result in a row; later ones wait an hour. */
const WAITS = [5 * MINUTE, 10 * MINUTE, 20 * MINUTE];
const PAUSED_WAIT = 60 * MINUTE;
/** After this many in a row the lane counts as paused: probed once an hour until a run makes progress. */
export const PAUSE_AFTER = 3;

export interface Transition {
  type: "paused" | "resumed";
  message: string;
}

interface LaneState {
  fails: number;
  nextAt: number;
}

/** In memory only: a restart starts clean. */
export class Backoff {
  private lanes = new Map<string, LaneState>();
  /** Project name -> the registry fingerprint it was paused under. */
  private projects = new Map<string, string>();

  constructor(private now: () => number = Date.now) {}

  private key = (project: string, lane: Lane): string => `${project}/${lane}`;

  /** True when this project and lane may run now. `fingerprint` identifies the project's current registry entry. */
  due(project: string, lane: Lane, fingerprint: string): boolean {
    if (this.projects.get(project) === fingerprint) return false;
    return this.now() >= (this.lanes.get(this.key(project, lane))?.nextAt ?? 0);
  }

  /** A paused project resumes when its registry entry changes. Call once per pass before `due`. */
  refreshProject(project: string, fingerprint: string): Transition | undefined {
    const paused = this.projects.get(project);
    if (paused === undefined || paused === fingerprint) return undefined;
    this.projects.delete(project);
    return { type: "resumed", message: `${project} resumed: its settings changed` };
  }

  record(project: string, lane: Lane, outcome: Outcome, fingerprint: string, detail: string): Transition | undefined {
    const k = this.key(project, lane);
    if (outcome === "skip") return undefined;
    if (outcome === "pause-project") {
      this.projects.set(project, fingerprint);
      return { type: "paused", message: `${project} paused until its settings change in the web app or the runner restarts: ${detail}` };
    }
    const state = this.lanes.get(k);
    if (outcome === "progress") {
      this.lanes.delete(k);
      return state && state.fails >= PAUSE_AFTER ? { type: "resumed", message: `${project} ${lane} lane resumed: a run made progress` } : undefined;
    }
    const fails = (state?.fails ?? 0) + 1;
    this.lanes.set(k, { fails, nextAt: this.now() + (WAITS[fails - 1] ?? PAUSED_WAIT) });
    if (fails === PAUSE_AFTER) {
      return { type: "paused", message: `${project} ${lane} lane paused after ${fails} runs without progress (${detail}); probing once an hour` };
    }
    return undefined;
  }
}
