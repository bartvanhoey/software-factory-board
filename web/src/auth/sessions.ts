import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { hasRole, rolesOf, type Role } from "./users";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Idle = no request for this long; absolute = hard limit from login. Admins get shorter ones. */
export const LIMITS = {
  admin: { idle: HOUR, absolute: 12 * HOUR },
  user: { idle: 8 * HOUR, absolute: 7 * DAY },
};

const TOUCH_EVERY = 60_000;

export interface SessionInfo {
  tokenHash: string;
  userId: string;
  email: string;
  roles: Role[];
  mustChangePassword: boolean;
  expiresAt: number;
}

/** Only this hash is stored, so a leaked database cannot be replayed as cookies. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(
  db: DatabaseSync,
  userId: string,
  ctx: { ip?: string | null; userAgent?: string | null } = {},
  now = Date.now(),
): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const limits = hasRole(rolesOf(db, userId), "admin") ? LIMITS.admin : LIMITS.user;
  const expiresAt = now + limits.absolute;
  db.prepare(
    "INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(hashToken(token), userId, now, now, expiresAt, ctx.ip ?? null, ctx.userAgent?.slice(0, 200) ?? null);
  return { token, expiresAt };
}

/** The live session for a cookie token, or null when unknown, expired, idle too long or the user is disabled. */
export function validateSession(db: DatabaseSync, token: string, now = Date.now()): SessionInfo | null {
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT s.created_at, s.last_seen_at, s.expires_at, u.id AS user_id, u.email, u.disabled_at, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
    )
    .get(tokenHash) as
    | { created_at: number; last_seen_at: number; expires_at: number; user_id: string; email: string; disabled_at: number | null; must_change_password: number }
    | undefined;
  if (!row) return null;

  const roles = rolesOf(db, row.user_id);
  const limits = hasRole(roles, "admin") ? LIMITS.admin : LIMITS.user;
  // expires_at was fixed at login; a user promoted to admin since then must not keep a 7 day session.
  const expiresAt = Math.min(row.expires_at, row.created_at + limits.absolute);
  if (row.disabled_at !== null || now >= expiresAt || now - row.last_seen_at >= limits.idle) {
    db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(tokenHash);
    return null;
  }
  if (now - row.last_seen_at >= TOUCH_EVERY) {
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?").run(now, tokenHash);
  }
  return {
    tokenHash,
    userId: row.user_id,
    email: row.email,
    roles,
    mustChangePassword: row.must_change_password === 1,
    expiresAt,
  };
}

export function deleteSession(db: DatabaseSync, token: string): void {
  db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(hashToken(token));
}

/** Ends every session of a user, optionally keeping one (the one that just changed the password). */
export function revokeSessions(db: DatabaseSync, userId: string, exceptTokenHash?: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND id_hash IS NOT ?").run(userId, exceptTokenHash ?? null);
}

export function purgeExpired(db: DatabaseSync, now = Date.now()): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
}
