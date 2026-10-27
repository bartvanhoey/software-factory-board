// No "server-only" or next/* imports: the break-glass CLI runs this outside Next, inside the web container.
//
// Access to the server is the authorisation here: whoever can run the command can use it, so there is no login
// and no actor. What it leaves behind is an audit entry per change (no actor, `via: "cli"`, and the reason).
import type { DatabaseSync } from "node:sqlite";
import { generateTemporaryPassword } from "./admin";
import { audit } from "./audit";
import { transaction } from "./db";
import { clearMfa } from "./mfa";
import { hashPassword } from "./password";
import { acctThrottleKey } from "./service";
import { revokeSessions } from "./sessions";
import { resetFailures } from "./throttle";
import { findUserByEmail, normalizeEmail, rolesOf, type UserRow } from "./users";

export type Outcome<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const REASON_MAX = 200;

/**
 * Why this is being done. Trimmed, one line, at most REASON_MAX characters, some real letter or digit in it, and no
 * control, line-separator or invisible formatting characters (bidi overrides, zero-width): it ends up in the audit
 * log, and it must not be able to disguise itself there. Null when it does not qualify.
 */
export function cleanReason(raw: string): string | null {
  const reason = raw.trim();
  if (reason.length < 1 || reason.length > REASON_MAX) return null;
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(reason)) return null;
  return /[\p{L}\p{N}]/u.test(reason) ? reason : null;
}

function find(db: DatabaseSync, rawEmail: string): { ok: true; user: UserRow } | { ok: false; error: string } {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, error: "That is not a valid email address." };
  const user = findUserByEmail(db, email);
  return user ? { ok: true, user } : { ok: false, error: `No account with the email ${email}.` };
}

const NEEDS_REASON = `A reason is required (1 to ${REASON_MAX} characters, one line).`;

export interface ResetMfaResult {
  email: string;
  /** False when the account had no MFA at all: nothing was touched (not even its sessions) and nothing was audited. */
  changed: boolean;
  disabled: boolean;
  /** MFA is required for this account (an admin, or the flag is on), so they must set it up again at next login. */
  mustSetUpAgain: boolean;
}

/**
 * Removes a user's MFA (secret, pending setup, recovery codes, attempt counter) and ends all their sessions.
 * Works on administrators, which is the one thing the web app refuses to do.
 */
export function resetMfaByCli(db: DatabaseSync, input: { email: string; reason: string }, now = Date.now()): Outcome<ResetMfaResult> {
  const reason = cleanReason(input.reason);
  if (!reason) return { ok: false, error: NEEDS_REASON };
  const found = find(db, input.email);
  if (!found.ok) return found;

  return transaction(db, (): Outcome<ResetMfaResult> => {
    const user = findUserByEmail(db, found.user.email)!; // re-read inside the lock
    const roles = rolesOf(db, user.id);
    const base = { email: user.email, disabled: user.disabled_at !== null, mustSetUpAgain: user.mfa_required === 1 || roles.includes("admin") };
    // Any trace counts, not only a finished enrolment: a half-finished one (a pending secret on a stolen session)
    // is exactly what an operator mid-incident wants gone, together with the sessions.
    const hasTrace =
      user.mfa_enabled_at !== null ||
      user.mfa_secret_enc !== null ||
      db.prepare("SELECT 1 AS x FROM mfa_setup WHERE user_id = ?").get(user.id) !== undefined ||
      db.prepare("SELECT 1 AS x FROM recovery_codes WHERE user_id = ?").get(user.id) !== undefined;
    if (!hasTrace) return { ok: true, changed: false, ...base };
    clearMfa(db, user.id);
    revokeSessions(db, user.id);
    audit(db, { action: "mfa.reset_by_cli", target: user.id, detail: { via: "cli", reason } }, now);
    return { ok: true, changed: true, ...base };
  });
}

export interface ResetPasswordResult {
  email: string;
  /** Shown once to whoever ran the command. Never stored, logged or audited. */
  temporaryPassword: string;
  disabled: boolean;
  /** The account has MFA, so the first login also asks for a code. */
  hasMfa: boolean;
}

/**
 * Sets a temporary password that must be changed at next login, ends all sessions and clears the login throttle.
 * Does not touch MFA: a lost password alone must not remove a second factor (use reset-mfa for that).
 */
export async function resetPasswordByCli(db: DatabaseSync, input: { email: string; reason: string }, now = Date.now()): Promise<Outcome<ResetPasswordResult>> {
  const reason = cleanReason(input.reason);
  if (!reason) return { ok: false, error: NEEDS_REASON };
  const found = find(db, input.email);
  if (!found.ok) return found;

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword); // slow, so before the write lock

  return transaction(db, (): Outcome<ResetPasswordResult> => {
    const user = findUserByEmail(db, found.user.email)!;
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(passwordHash, user.id);
    revokeSessions(db, user.id);
    // Otherwise earlier failed attempts could still be delaying the very login the temporary password is for.
    resetFailures(db, acctThrottleKey(user.email));
    resetFailures(db, `login:chpw:${user.id}`);
    audit(db, { action: "password.reset_by_cli", target: user.id, detail: { via: "cli", reason } }, now);
    return { ok: true, email: user.email, temporaryPassword, disabled: user.disabled_at !== null, hasMfa: user.mfa_enabled_at !== null };
  });
}
