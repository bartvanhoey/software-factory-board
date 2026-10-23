import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** No run lasts this long, so an older lock is a leftover (for example after a container restart). */
const MAX_AGE_MS = 3 * 60 * 60 * 1000;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isStale(dir: string, now: number): boolean {
  try {
    const pid = Number.parseInt(readFileSync(join(dir, "pid"), "utf8"), 10);
    if (Number.isFinite(pid) && !pidAlive(pid)) return true;
    return now - statSync(dir).mtimeMs > MAX_AGE_MS;
  } catch {
    return true; // unreadable lock: treat as a leftover
  }
}

/**
 * One run per project at a time. A lock is a directory (mkdir is atomic) holding the owner's pid.
 * Returns a release function, or null when another live run holds the lock.
 */
export function acquireLock(dir: string, now: () => number = Date.now): (() => void) | null {
  mkdirSync(join(dir, ".."), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, "pid"), String(process.pid));
      return () => rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (!isStale(dir, now())) return null;
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return null;
}
