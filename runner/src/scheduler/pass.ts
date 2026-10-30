import type { Project } from "@factory/shared";
import type { EventLog } from "../ports.js";
import { Backoff, LANES, classify, type Lane, type Transition } from "./backoff.js";

export interface RunResult {
  /** Null when the run was killed or never exited normally. */
  code: number | null;
  timedOut: boolean;
}

export interface PassDeps {
  /** Read afresh every pass, so edits to projects/*.json (enabled, lanes) apply without a restart. */
  loadProjects: () => Project[];
  runLane: (lane: Lane, project: string) => Promise<RunResult>;
  backoff: Backoff;
  events: EventLog;
  log: (message: string) => void;
  /** True once a shutdown was asked for: no new run starts. */
  stopped: () => boolean;
}

const fingerprintOf = (project: Project): string => JSON.stringify(project);

function announce(deps: PassDeps, project: string, transition: Transition | undefined): void {
  if (!transition) return;
  deps.log(transition.message);
  deps.events.append({ project, lane: "system", type: transition.type, message: transition.message });
}

/**
 * One pass: lane by lane (review, then qa, then build), and within a lane project by project in name order, one run at a
 * time. Downstream lanes go first so work close to done is finished everywhere before any new work is started.
 */
export async function runPass(deps: PassDeps): Promise<void> {
  const projects = deps.loadProjects().sort((a, b) => a.name.localeCompare(b.name));
  for (const project of projects) announce(deps, project.name, deps.backoff.refreshProject(project.name, fingerprintOf(project)));

  for (const lane of LANES) {
    for (const project of projects) {
      if (deps.stopped()) return;
      if (!project.enabled || !project.lanes[lane]) continue;
      const fingerprint = fingerprintOf(project);
      if (!deps.backoff.due(project.name, lane, fingerprint)) continue;

      deps.log(`${project.name}: ${lane}`);
      const result = await deps.runLane(lane, project.name);
      if (deps.stopped()) return; // a run cut short by shutdown says nothing about the lane
      const outcome = classify(lane, result.timedOut ? null : result.code);
      const detail = result.timedOut ? "timed out" : `exit ${result.code ?? "none"}`;
      announce(deps, project.name, deps.backoff.record(project.name, lane, outcome, fingerprint, detail));
    }
  }
}
