import { spawn } from "node:child_process";
import { errorMessage } from "../errors.js";
import type { EventLog } from "../ports.js";
import type { Project } from "@factory/shared";
import { Backoff, type Lane } from "./backoff.js";
import { runPass, type RunResult } from "./pass.js";
import type { SchedulerSettings } from "./settings.js";

/** After SIGTERM a run gets this long to exit before it is killed outright. */
const KILL_AFTER_MS = 10_000;

/** The command that runs one lane of one project. */
export type Launch = (lane: Lane, project: string) => [command: string, args: string[]];

const ownCommand: Launch = (lane, project) => [process.execPath, [...process.execArgv, process.argv[1] ?? "", lane, "--project", project]];

export type LaneRunner = (lane: Lane, project: string) => Promise<RunResult>;

/**
 * Runs `runner <lane> --project <name>` as a child process of its own: a crash or hang in one run cannot take the scheduler
 * down, and a stuck run can be killed. The child is started the same way this process was (same node, same loader flags).
 */
export function childLaneRunner(runTimeoutMs: number, shutdown: AbortSignal, launch: Launch = ownCommand): LaneRunner {
  return (lane, project) =>
    new Promise<RunResult>((resolve) => {
      const [command, args] = launch(lane, project);
      // Its own process group, so a stop reaches the agent and the build and test commands the run started, not just the
      // runner process. Otherwise they would live on as orphans, still spending tokens, while a new run took the lock.
      const child = spawn(command, args, { stdio: "inherit", detached: true });
      let timedOut = false;
      let killTimer: NodeJS.Timeout | undefined;
      const signalGroup = (signal: NodeJS.Signals): void => {
        try {
          if (child.pid === undefined) throw new Error("not started");
          process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      };
      const stop = (): void => {
        signalGroup("SIGTERM");
        killTimer ??= setTimeout(() => signalGroup("SIGKILL"), KILL_AFTER_MS);
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        stop();
      }, runTimeoutMs);
      shutdown.addEventListener("abort", stop, { once: true });
      const done = (code: number | null): void => {
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        shutdown.removeEventListener("abort", stop);
        resolve({ code, timedOut });
      };
      child.on("error", () => done(null));
      child.on("close", (code) => done(code));
      if (shutdown.aborted) stop();
    });
}

export function sleepUnless(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    // setTimeout turns Infinity into 1 ms, and an abort listener alone does not keep the process alive. An endless wait is
    // therefore a timer that does nothing until the abort clears it.
    const timer = Number.isFinite(ms) ? setTimeout(done, ms) : setInterval(() => undefined, 2 ** 30);
    function done(): void {
      clearTimeout(timer);
      clearInterval(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export interface SchedulerDeps {
  settings: SchedulerSettings;
  loadProjects: () => Promise<Project[]>;
  runLane: LaneRunner;
  events: EventLog;
  log: (message: string) => void;
  shutdown: AbortSignal;
  backoff?: Backoff;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** The scheduler: pass after pass until shutdown. Does nothing but wait when it is switched off. */
export async function runScheduler(deps: SchedulerDeps): Promise<void> {
  const { settings, shutdown, log } = deps;
  const sleep = deps.sleep ?? sleepUnless;
  if (!settings.enabled) {
    log("the scheduler is off (SCHEDULER_ENABLED is not \"true\"); idling. Lanes can still be run by hand.");
    await sleep(Number.POSITIVE_INFINITY, shutdown);
    return;
  }

  const backoff = deps.backoff ?? new Backoff();
  log(`the scheduler is on: a pass every ${settings.intervalMs / 60_000} min after the last one ends, a run is stopped after ${settings.runTimeoutMs / 60_000} min`);
  deps.events.append({ project: "-", lane: "system", type: "started", message: "scheduler started" });

  let lastSkip: string | undefined;
  while (!shutdown.aborted) {
    try {
      await runPass({ loadProjects: deps.loadProjects, runLane: deps.runLane, backoff, events: deps.events, log, stopped: () => shutdown.aborted });
      lastSkip = undefined;
    } catch (e) {
      // For example the web service being down or refusing the token. The next pass asks again. Recorded once per distinct
      // message, so a file left broken does not add an event every pass.
      const message = `pass skipped: ${errorMessage(e)}`;
      log(message);
      if (message !== lastSkip) deps.events.append({ project: "-", lane: "system", type: "failed", message });
      lastSkip = message;
    }
    await sleep(settings.intervalMs, shutdown);
  }
  log("the scheduler has stopped");
}
