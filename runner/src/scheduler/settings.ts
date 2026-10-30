import { UsageError } from "../errors.js";

export interface SchedulerSettings {
  enabled: boolean;
  /** Sleep between the end of one pass and the start of the next. */
  intervalMs: number;
  /** A run longer than this is killed. Under the lock's 3 hour leftover limit, so a killed run never leaves a live-looking lock. */
  runTimeoutMs: number;
}

const MINUTE = 60_000;

function minutes(env: NodeJS.ProcessEnv, name: string, fallback: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback * MINUTE;
  if (!/^[1-9][0-9]*$/.test(raw) || Number(raw) > max) {
    throw new UsageError(`${name} must be a whole number of minutes from 1 to ${max}, got "${raw}"`);
  }
  return Number(raw) * MINUTE;
}

export function loadSchedulerSettings(env: NodeJS.ProcessEnv = process.env): SchedulerSettings {
  const enabled = (env.SCHEDULER_ENABLED?.trim() ?? "").toLowerCase();
  if (enabled !== "" && enabled !== "true" && enabled !== "false") {
    throw new UsageError(`SCHEDULER_ENABLED must be "true" or "false", got "${enabled}"`);
  }
  return {
    enabled: enabled === "true",
    intervalMs: minutes(env, "SCHEDULER_INTERVAL_MINUTES", 5, 1440),
    runTimeoutMs: minutes(env, "SCHEDULER_RUN_TIMEOUT_MINUTES", 120, 170),
  };
}
