// No "server-only" or next/* imports: this is the testable core. Server actions re-check the session, then call in here.
import { randomInt } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { audit } from "./audit";
import { voidTokens } from "./email-tokens";
import { transaction } from "./db";
import { hashPassword } from "./password";
import { acctThrottleKey } from "./service";
import { revokeSessions } from "./sessions";
import { consume, resetFailures } from "./throttle";
import { BREAKGLASS_RESET_MFA } from "./breakglass-hint";
import { clearMfa } from "./mfa";
import { findUserById, ROLES, rolesOf, type Role } from "./users";

export interface AdminCtx {
  ip: string | null;
  now?: number;
}

export type Done<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const NOT_ADMIN = "Administrator access is required.";
const NOT_FOUND = "User not found.";
const LAST_ADMIN = "At least one active administrator is required.";

/** Admin role and not disabled. Checked in the database every time; a session alone is not enough. */
export function isActiveAdmin(db: DatabaseSync, userId: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM users u JOIN user_roles r ON r.user_id = u.id WHERE u.id = ? AND u.disabled_at IS NULL AND r.role = 'admin'")
    .get(userId);
  return row !== undefined;
}

function activeAdminCount(db: DatabaseSync): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM users u WHERE u.disabled_at IS NULL AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'admin')")
    .get() as { n: number };
  return row.n;
}

/**
 * Runs a change as one write transaction after re-checking, inside it, that the actor is still an active admin.
 * Two admins disabling each other at once then cannot both succeed: the second finds its actor already disabled.
 */
function asAdmin<T extends object>(db: DatabaseSync, actorId: string, attempted: string, targetId: string | null, ctx: AdminCtx, change: (now: number) => Done<T>): Done<T> {
  const now = ctx.now ?? Date.now();
  return transaction(db, () => {
    if (!isActiveAdmin(db, actorId)) {
      audit(db, { action: "admin.denied", actor: findUserById(db, actorId) ? actorId : null, target: targetId && findUserById(db, targetId) ? targetId : null, ip: ctx.ip, detail: { attempted } }, now);
      return { ok: false, error: NOT_ADMIN };
    }
    return change(now);
  });
}

/**
 * Records a logged-in user without the admin role who reached for an admin action (a forged request, since the UI
 * never shows them the controls). Capped per user so a role-less account cannot grow the append-only log.
 */
export function denyNonAdmin(db: DatabaseSync, userId: string, attempted: string, ctx: AdminCtx): void {
  const now = ctx.now ?? Date.now();
  if (!consume(db, `denied:${userId}`, 5, 3_600_000, now)) return;
  audit(db, { action: "admin.denied", actor: userId, ip: ctx.ip, detail: { attempted } }, now);
}

/**
 * `expected` is the role list the admin saw when the form loaded. If someone else changed the roles since, the save
 * is refused instead of silently undoing their change.
 */
export function setRoles(db: DatabaseSync, actorId: string, targetId: string, wanted: readonly string[], ctx: AdminCtx, expected?: readonly string[]): Done {
  if (!wanted.every((r): r is Role => (ROLES as readonly string[]).includes(r))) return { ok: false, error: "Unknown role." };
  const roles = new Set(wanted as Role[]);

  return asAdmin(db, actorId, "roles.set", targetId, ctx, (now) => {
    const target = findUserById(db, targetId);
    if (!target) return { ok: false, error: NOT_FOUND };
    const current = new Set(rolesOf(db, targetId));
    if (expected && (expected.length !== current.size || !expected.every((r) => current.has(r as Role)))) {
      return { ok: false, error: "The roles changed since you loaded this page. Reload and try again." };
    }

    const removesAdmin = current.has("admin") && !roles.has("admin");
    if (removesAdmin && targetId === actorId) return { ok: false, error: "You cannot remove your own admin role." };
    // Otherwise the rule that only the server can reset an admin's MFA is a detour away: demote them, reset their MFA
    // and password as an ordinary user, grant admin back, and log in as them. Disable the account instead.
    if (removesAdmin && target.mfa_enabled_at !== null) {
      return { ok: false, error: `An administrator who has MFA cannot be demoted here, because that would make their MFA resettable. Disable the account instead, or remove their MFA from the server first: ${BREAKGLASS_RESET_MFA}` };
    }
    if (removesAdmin && target.disabled_at === null && activeAdminCount(db) - 1 < 1) return { ok: false, error: LAST_ADMIN };

    for (const role of ROLES) {
      if (roles.has(role) && !current.has(role)) {
        db.prepare("INSERT INTO user_roles (user_id, role, granted_by, granted_at) VALUES (?, ?, ?, ?)").run(targetId, role, actorId, now);
        audit(db, { action: "role.granted", actor: actorId, target: targetId, ip: ctx.ip, detail: { role } }, now);
      } else if (!roles.has(role) && current.has(role)) {
        db.prepare("DELETE FROM user_roles WHERE user_id = ? AND role = ?").run(targetId, role);
        audit(db, { action: "role.revoked", actor: actorId, target: targetId, ip: ctx.ip, detail: { role } }, now);
      }
    }
    return { ok: true };
  });
}

export function setDisabled(db: DatabaseSync, actorId: string, targetId: string, disabled: boolean, ctx: AdminCtx): Done {
  return asAdmin(db, actorId, disabled ? "user.disable" : "user.enable", targetId, ctx, (now) => {
    if (targetId === actorId) return { ok: false, error: "You cannot disable your own account." };
    const target = findUserById(db, targetId);
    if (!target) return { ok: false, error: NOT_FOUND };
    if ((target.disabled_at !== null) === disabled) return { ok: true };

    if (disabled && rolesOf(db, targetId).includes("admin") && activeAdminCount(db) - 1 < 1) return { ok: false, error: LAST_ADMIN };

    db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(disabled ? now : null, targetId);
    if (disabled) revokeSessions(db, targetId);
    audit(db, { action: disabled ? "user.disabled" : "user.enabled", actor: actorId, target: targetId, ip: ctx.ip }, now);
    return { ok: true };
  });
}

/**
 * For an address that cannot receive mail (a typo, a mailbox that is gone) or a person the admin has verified another
 * way. Without this, switching EMAIL_VERIFICATION on could lock such a user out for good.
 */
export function markEmailVerified(db: DatabaseSync, actorId: string, targetId: string, ctx: AdminCtx): Done {
  return asAdmin(db, actorId, "email.verify", targetId, ctx, (now) => {
    const target = findUserById(db, targetId);
    if (!target) return { ok: false, error: NOT_FOUND };
    if (target.email_verified_at !== null) return { ok: true };
    db.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(now, targetId);
    voidTokens(db, targetId, "verify");
    audit(db, { action: "email.verified_by_admin", actor: actorId, target: targetId, ip: ctx.ip }, now);
    return { ok: true };
  });
}

/**
 * The per-user "must use MFA" flag. It applies on the user's next request, because the gate reads it live.
 * Stopping it for a non-admin also removes their authenticator and ends their sessions. An administrator's
 * authenticator stays (their own comes off at /account/mfa with a current code, anyone else's from the server).
 */
export function setMfaRequired(db: DatabaseSync, actorId: string, targetId: string, required: boolean, ctx: AdminCtx): Done {
  return asAdmin(db, actorId, "mfa.require", targetId, ctx, (now) => {
    const target = findUserById(db, targetId);
    if (!target) return { ok: false, error: NOT_FOUND };
    const flagChanged = (target.mfa_required === 1) !== required;
    const removesMfa = !required && target.mfa_enabled_at !== null && !rolesOf(db, targetId).includes("admin");
    if (!flagChanged && !removesMfa) return { ok: true };
    if (flagChanged) {
      db.prepare("UPDATE users SET mfa_required = ? WHERE id = ?").run(required ? 1 : 0, targetId);
      audit(db, { action: required ? "mfa.required_set" : "mfa.required_cleared", actor: actorId, target: targetId, ip: ctx.ip }, now);
    }
    if (removesMfa) {
      clearMfa(db, targetId);
      revokeSessions(db, targetId);
      audit(db, { action: "mfa.reset_by_admin", actor: actorId, target: targetId, ip: ctx.ip }, now);
    }
    return { ok: true };
  });
}

/**
 * For a user who lost their authenticator and their recovery codes: removes their MFA and ends their sessions.
 * An administrator's MFA is out of reach here on purpose (a stolen admin session must not be able to strip another
 * admin's second factor); that needs the break-glass command on the server (see breakglass.ts).
 */
export function resetMfa(db: DatabaseSync, actorId: string, targetId: string, ctx: AdminCtx): Done {
  return asAdmin(db, actorId, "mfa.reset", targetId, ctx, (now) => {
    if (targetId === actorId) return { ok: false, error: "You cannot reset your own MFA here." };
    const target = findUserById(db, targetId);
    if (!target) return { ok: false, error: NOT_FOUND };
    if (rolesOf(db, targetId).includes("admin")) return { ok: false, error: `An administrator's MFA can only be reset from the server: ${BREAKGLASS_RESET_MFA}` };
    if (target.mfa_enabled_at === null) return { ok: true };
    clearMfa(db, targetId);
    revokeSessions(db, targetId);
    audit(db, { action: "mfa.reset_by_admin", actor: actorId, target: targetId, ip: ctx.ip }, now);
    return { ok: true };
  });
}

// No look-alike characters (0/O, 1/l/I), since an admin reads this out or pastes it to someone.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** 16 characters, about 93 bits. Passes the password policy. */
export function generateTemporaryPassword(): string {
  return Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

/**
 * Sets a temporary password the user must change at next login and ends their sessions. It does not touch MFA.
 * The plaintext is returned once to the caller and is never stored, audited or logged.
 */
export async function resetPassword(db: DatabaseSync, actorId: string, targetId: string, ctx: AdminCtx): Promise<Done<{ temporaryPassword: string }>> {
  // Cheap check before the slow hash so a non-admin cannot make the server burn CPU; re-checked in the transaction.
  if (!isActiveAdmin(db, actorId)) return asAdmin(db, actorId, "password.reset", targetId, ctx, () => ({ ok: false, error: NOT_ADMIN }));
  if (targetId === actorId) return { ok: false, error: "Use Change password for your own account." };
  if (!findUserById(db, targetId)) return { ok: false, error: NOT_FOUND }; // do not pay for a hash for nobody

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const result = asAdmin<object>(db, actorId, "password.reset", targetId, ctx, (now) => {
    const target = findUserById(db, targetId);
    if (!target) return { ok: false, error: NOT_FOUND };
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(passwordHash, targetId);
    revokeSessions(db, targetId);
    // The user must not stay blocked by earlier failed attempts, or the temporary password would not help.
    resetFailures(db, acctThrottleKey(target.email));
    resetFailures(db, `login:chpw:${targetId}`);
    audit(db, { action: "password.reset_by_admin", actor: actorId, target: targetId, ip: ctx.ip }, now);
    return { ok: true };
  });
  return result.ok ? { ok: true, temporaryPassword } : result;
}

export interface UserListItem {
  id: string;
  email: string;
  status: "pending" | "active" | "disabled";
  roles: Role[];
  createdAt: number;
  emailVerified: boolean;
  mfaEnabled: boolean;
  /** The per-user flag. Off by default for everyone, admins included. */
  mfaRequired: boolean;
}

function requireAdmin(db: DatabaseSync, actorId: string): void {
  if (!isActiveAdmin(db, actorId)) throw new Error(NOT_ADMIN);
}

/** Pending accounts (no role yet) first, then by email. */
export function listUsers(db: DatabaseSync, actorId: string): { users: UserListItem[]; pending: number } {
  requireAdmin(db, actorId);
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.created_at, u.disabled_at, u.email_verified_at, u.mfa_enabled_at, u.mfa_required, group_concat(r.role) AS roles
       FROM users u LEFT JOIN user_roles r ON r.user_id = u.id GROUP BY u.id`,
    )
    .all() as {
    id: string;
    email: string;
    created_at: number;
    disabled_at: number | null;
    email_verified_at: number | null;
    mfa_enabled_at: number | null;
    mfa_required: number;
    roles: string | null;
  }[];

  const users = rows.map((r): UserListItem => {
    const roles = (r.roles ? r.roles.split(",") : []) as Role[];
    return {
      id: r.id,
      email: r.email,
      status: r.disabled_at !== null ? "disabled" : roles.length === 0 ? "pending" : "active",
      roles: ROLES.filter((role) => roles.includes(role)),
      createdAt: r.created_at,
      emailVerified: r.email_verified_at !== null,
      mfaEnabled: r.mfa_enabled_at !== null,
      mfaRequired: r.mfa_required === 1,
    };
  });
  const order = { pending: 0, active: 1, disabled: 2 };
  users.sort((a, b) => order[a.status] - order[b.status] || a.email.localeCompare(b.email));
  return { users, pending: users.filter((u) => u.status === "pending").length };
}

export interface AuditItem {
  id: number;
  at: number;
  action: string;
  actor: string | null;
  target: string | null;
  ip: string | null;
  detail: string | null;
}

export const AUDIT_PAGE = 50;

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Newest first. `before` is the id of the last row of the previous page (keyset paging suits an append-only table). */
export function listAudit(
  db: DatabaseSync,
  actorId: string,
  filter: { action?: string; user?: string; before?: number } = {},
): { items: AuditItem[]; next: number | null; actions: string[] } {
  requireAdmin(db, actorId);
  const action = filter.action?.slice(0, 64);
  const user = filter.user?.slice(0, 254).trim() ? `%${escapeLike(filter.user.slice(0, 254).trim().toLowerCase())}%` : null;
  const rows = db
    .prepare(
      `SELECT a.id, a.at, a.action, a.ip, a.detail, actor.email AS actor, target.email AS target
       FROM audit_log a
       LEFT JOIN users actor ON actor.id = a.actor_user_id
       LEFT JOIN users target ON target.id = a.target_user_id
       WHERE (? IS NULL OR a.action = ?)
         AND (? IS NULL OR a.id < ?)
         AND (? IS NULL OR actor.email LIKE ? ESCAPE '\\' OR target.email LIKE ? ESCAPE '\\')
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(
      action ?? null, action ?? null,
      filter.before ?? null, filter.before ?? null,
      user, user, user,
      AUDIT_PAGE + 1,
    ) as unknown as AuditItem[];

  const items = rows.slice(0, AUDIT_PAGE);
  const actions = (db.prepare("SELECT DISTINCT action FROM audit_log ORDER BY action").all() as { action: string }[]).map((r) => r.action);
  return { items, next: rows.length > AUDIT_PAGE ? items[items.length - 1]!.id : null, actions };
}
