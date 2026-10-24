import type { DatabaseSync } from "node:sqlite";

const FREE_FAILURES = 5;
const BASE_DELAY = 30_000;
const MAX_DELAY = 15 * 60_000;
const FORGET_AFTER = 24 * 3_600_000;

/** How long to wait after this many consecutive failures: none up to 4, then 30 s doubling to 15 min. */
export function delayFor(failures: number): number {
  if (failures < FREE_FAILURES) return 0;
  return Math.min(MAX_DELAY, BASE_DELAY * 2 ** (failures - FREE_FAILURES));
}

function row(db: DatabaseSync, key: string): { count: number; updated_at: number } | undefined {
  return db.prepare("SELECT count, updated_at FROM throttle WHERE key = ?").get(key) as { count: number; updated_at: number } | undefined;
}

/** Milliseconds until another attempt is allowed for this key, 0 when allowed. There is no hard lock. */
export function retryAfter(db: DatabaseSync, key: string, now = Date.now()): number {
  const r = row(db, key);
  if (!r || now - r.updated_at > FORGET_AFTER) return 0;
  return Math.max(0, r.updated_at + delayFor(r.count) - now);
}

/**
 * Counts an attempt. Callers count BEFORE the slow password check and release on success, so a burst of
 * concurrent guesses cannot all pass the check while the count is still zero.
 */
export function recordFailure(db: DatabaseSync, key: string, now = Date.now()): void {
  // Keys come from unauthenticated input; drop what has aged out so the table cannot grow forever.
  db.prepare("DELETE FROM throttle WHERE updated_at < ?").run(now - FORGET_AFTER);
  const r = row(db, key);
  const count = r && now - r.updated_at <= FORGET_AFTER ? r.count + 1 : 1;
  db.prepare(
    "INSERT INTO throttle (key, count, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET count = excluded.count, updated_at = excluded.updated_at",
  ).run(key, count, now);
}

/** Takes back one counted attempt (the IP key after a successful login). */
export function releaseFailure(db: DatabaseSync, key: string): void {
  const r = row(db, key);
  if (!r) return;
  if (r.count <= 1) resetFailures(db, key);
  else db.prepare("UPDATE throttle SET count = count - 1 WHERE key = ?").run(key);
}

export function resetFailures(db: DatabaseSync, key: string): void {
  db.prepare("DELETE FROM throttle WHERE key = ?").run(key);
}

/** Fixed window: true and counts the hit while under the limit, false once the window is full. */
export function consume(db: DatabaseSync, key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const r = row(db, key);
  if (!r || now - r.updated_at >= windowMs) {
    db.prepare(
      "INSERT INTO throttle (key, count, updated_at) VALUES (?, 1, ?) ON CONFLICT (key) DO UPDATE SET count = 1, updated_at = excluded.updated_at",
    ).run(key, now);
    return true;
  }
  if (r.count >= limit) return false;
  db.prepare("UPDATE throttle SET count = count + 1 WHERE key = ?").run(key);
  return true;
}
