import { loadProjects } from "@factory/shared";
import { eventsFile, loadSettings } from "../config.js";
import { UsageError } from "../errors.js";
import { createEventLog } from "../events.js";
import { childLaneRunner, runScheduler } from "./run.js";
import { loadSchedulerSettings } from "./settings.js";

/** `runner schedule`: runs until SIGTERM or SIGINT. */
export async function scheduleCommand(args: readonly string[]): Promise<number> {
  if (args.length > 0) throw new UsageError(`schedule takes no arguments, got "${args.join(" ")}"`);
  const settings = loadSettings();
  const scheduler = loadSchedulerSettings();

  const stop = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => stop.abort());

  await runScheduler({
    settings: scheduler,
    loadProjects: () => loadProjects(settings.projectsDir),
    runLane: childLaneRunner(scheduler.runTimeoutMs, stop.signal),
    events: createEventLog(eventsFile(settings)),
    log: (message) => console.log(`==> scheduler: ${message}`),
    shutdown: stop.signal,
  });
  return 0;
}
