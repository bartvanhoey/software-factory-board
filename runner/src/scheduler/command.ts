import { eventsFile, loadSettings } from "../config.js";
import { UsageError } from "../errors.js";
import { createEventLog } from "../events.js";
import { fetchProjects, loadRegistrySettings } from "../registry.js";
import { childLaneRunner, runScheduler } from "./run.js";
import { loadSchedulerSettings } from "./settings.js";

/** `runner schedule`: runs until SIGTERM or SIGINT. */
export async function scheduleCommand(args: readonly string[]): Promise<number> {
  if (args.length > 0) throw new UsageError(`schedule takes no arguments, got "${args.join(" ")}"`);
  const settings = loadSettings();
  const scheduler = loadSchedulerSettings();
  // Fail at start, not at the first pass, when the token is missing: the scheduler cannot do anything without it.
  // (Off, it only idles and needs nothing.)
  const registry = scheduler.enabled ? loadRegistrySettings() : null;

  const stop = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => stop.abort());

  await runScheduler({
    settings: scheduler,
    loadProjects: () => fetchProjects(registry ?? loadRegistrySettings()),
    runLane: childLaneRunner(scheduler.runTimeoutMs, stop.signal),
    events: createEventLog(eventsFile(settings)),
    log: (message) => console.log(`==> scheduler: ${message}`),
    shutdown: stop.signal,
  });
  return 0;
}
