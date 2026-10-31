// No "server-only" or next/* imports: this is the testable core. Server actions only add cookies and redirects.
import type { DatabaseSync } from "node:sqlite";
import { audit } from "./audit";
import { transaction } from "./db";
import { decryptSecret, encryptSecret, generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from "./mfa-crypto";
import { waitMessage } from "./service";
import { markMfaVerified, revokeSessions } from "./sessions";
import { recordFailure, releaseFailure, resetFailures, retryAfter } from "./throttle";
import { base32, generateSecret, otpauthUri, verifyTotp } from "./totp";
import { findUserById, rolesOf } from "./users";

export interface MfaCtx {
  ip: string | null;
  now?: number;
}

export type MfaResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** How long a freshly generated secret waits for its first correct code. */
export const SETUP_LIFETIME = 15 * 60_000;

const INVALID = "That code is not valid.";
const USED = "That code was already used. Wait for the next one from your app.";

/** Attempts at the second factor (codes and recovery codes alike) share one counter per user. */
const throttleKey = (userId: string): string => `mfa:${userId}`;

export interface SetupView {
  /** For typing into an authenticator app by hand. */
  secret: string;
  /** What the QR code carries. */
  uri: string;
}

function viewOf(key: Buffer, userId: string, email: string, secretEnc: string): SetupView {
  const secret = decryptSecret(key, secretEnc, userId);
  return { secret: base32(secret), uri: otpauthUri(email, secret) };
}

function createSetup(db: DatabaseSync, key: Buffer, userId: string, email: string, sessionHash: string, now: number): SetupView {
  const secret = generateSecret();
  const secretEnc = encryptSecret(key, secret, userId);
  db.prepare(
    `INSERT INTO mfa_setup (user_id, secret_enc, session_hash, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET secret_enc = excluded.secret_enc, session_hash = excluded.session_hash, created_at = excluded.created_at`,
  ).run(userId, secretEnc, sessionHash, now);
  return { secret: base32(secret), uri: otpauthUri(email, secret) };
}

/**
 * The secret to show on the setup page: the one this session already has waiting, or a new one for a user who has
 * no MFA yet. A user who already has MFA gets null until their session has proven a current code (see
 * startReenrolment), because a stolen session must not be able to swap the authenticator. A secret another session
 * of the same user asked for is never shown here: that session could otherwise read it and later use it.
 */
export function pendingSetup(db: DatabaseSync, key: Buffer, userId: string, sessionHash: string, now = Date.now()): SetupView | null {
  const user = findUserById(db, userId);
  if (!user) return null;
  const row = db.prepare("SELECT secret_enc, session_hash, created_at FROM mfa_setup WHERE user_id = ?").get(userId) as
    | { secret_enc: string; session_hash: string; created_at: number }
    | undefined;
  if (row && row.session_hash === sessionHash && now - row.created_at < SETUP_LIFETIME) return viewOf(key, userId, user.email, row.secret_enc);
  if (user.mfa_enabled_at !== null) return null;
  return createSetup(db, key, userId, user.email, sessionHash, now);
}

function remainingRecoveryCodes(db: DatabaseSync, userId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL").get(userId) as { n: number };
  return row.n;
}

export const recoveryCodesLeft = remainingRecoveryCodes;

function replaceRecoveryCodes(db: DatabaseSync, key: Buffer, userId: string): string[] {
  const codes = generateRecoveryCodes();
  db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(userId);
  const insert = db.prepare("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)");
  for (const code of codes) insert.run(userId, hashRecoveryCode(key, normalizeRecoveryCode(code)!));
  return codes;
}

/**
 * Checks a 6-digit code or a recovery code for a user who has MFA. Used at login, and as the "prove it is still
 * you" step before replacing the authenticator or the recovery codes.
 *
 * The attempt is counted before it is checked and given back on success, so a burst of simultaneous guesses cannot
 * all pass the throttle (the same lesson as the password login).
 */
export function proveFactor(db: DatabaseSync, key: Buffer, userId: string, input: string, ctx: MfaCtx): MfaResult<{ via: "totp" | "recovery" }> {
  const now = ctx.now ?? Date.now();
  const limit = throttleKey(userId);
  const blocked = retryAfter(db, limit, now);
  if (blocked > 0) return { ok: false, error: waitMessage(blocked) };
  recordFailure(db, limit, now);

  const user = findUserById(db, userId);
  if (!user || user.disabled_at !== null || !user.mfa_secret_enc || user.mfa_enabled_at === null) return { ok: false, error: INVALID };

  const fail = (error: string): MfaResult<{ via: "totp" | "recovery" }> => {
    audit(db, { action: "mfa.failed", actor: userId, target: userId, ip: ctx.ip }, now);
    return { ok: false, error };
  };

  // Six digits is an authenticator code; a recovery code has 12 characters, so the two can never be confused.
  const compact = input.replace(/[\s-]/g, "");
  if (/^\d{6}$/.test(compact)) {
    const step = verifyTotp(decryptSecret(key, user.mfa_secret_enc, userId), compact, now);
    if (step === null) return fail(INVALID);
    // Only a step newer than the last accepted one counts, and the update decides it atomically: a replayed code,
    // or two requests racing with the same code, cannot both win.
    const won = db.prepare("UPDATE users SET mfa_last_step = ? WHERE id = ? AND mfa_last_step < ?").run(step, userId, step);
    if (Number(won.changes) !== 1) return fail(USED);
    releaseFailure(db, limit); // takes back this attempt only; failures by anyone else still count
    return { ok: true, via: "totp" };
  }

  const normalized = normalizeRecoveryCode(input);
  if (!normalized) return fail(INVALID);
  const spent = db
    .prepare("UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL")
    .run(now, userId, hashRecoveryCode(key, normalized));
  if (Number(spent.changes) !== 1) return fail(INVALID);
  releaseFailure(db, limit);
  audit(db, { action: "mfa.recovery_used", actor: userId, target: userId, ip: ctx.ip, detail: { remaining: remainingRecoveryCodes(db, userId) } }, now);
  return { ok: true, via: "recovery" };
}

/** The second step of a login: on success the pending session becomes a full one. */
export function completeLogin(
  db: DatabaseSync,
  key: Buffer,
  session: { tokenHash: string; userId: string },
  input: string,
  ctx: MfaCtx,
): MfaResult<{ via: "totp" | "recovery"; recoveryLeft: number }> {
  const result = proveFactor(db, key, session.userId, input, ctx);
  if (!result.ok) return result;
  if (!markMfaVerified(db, session.tokenHash, session.userId)) return { ok: false, error: "Your login expired. Log in again." };
  return { ok: true, via: result.via, recoveryLeft: remainingRecoveryCodes(db, session.userId) };
}

/**
 * Proves a current code, then prepares a new secret for THIS session (replacing a live one only after the new one
 * is confirmed). Another session of the same user cannot read or confirm it.
 */
export function startReenrolment(db: DatabaseSync, key: Buffer, session: { tokenHash: string; userId: string }, input: string, ctx: MfaCtx): MfaResult {
  const proof = proveFactor(db, key, session.userId, input, ctx);
  if (!proof.ok) return proof;
  const user = findUserById(db, session.userId)!;
  createSetup(db, key, session.userId, user.email, session.tokenHash, ctx.now ?? Date.now());
  return { ok: true };
}

/**
 * Turns on MFA (or swaps the secret) once the user types a correct code from the new secret. Returns the recovery
 * codes, to be shown once. The user's other sessions end, so nobody else stays logged in under the old arrangement.
 */
export function confirmSetup(
  db: DatabaseSync,
  key: Buffer,
  session: { tokenHash: string; userId: string },
  input: string,
  ctx: MfaCtx,
): MfaResult<{ recoveryCodes: string[] }> {
  const now = ctx.now ?? Date.now();
  const limit = throttleKey(session.userId);
  const blocked = retryAfter(db, limit, now);
  if (blocked > 0) return { ok: false, error: waitMessage(blocked) };
  recordFailure(db, limit, now);

  const row = db.prepare("SELECT secret_enc, session_hash, created_at FROM mfa_setup WHERE user_id = ?").get(session.userId) as
    | { secret_enc: string; session_hash: string; created_at: number }
    | undefined;
  // Not this session's secret counts as no secret: it must have been shown to this session to be confirmed by it.
  if (!row || row.session_hash !== session.tokenHash || now - row.created_at >= SETUP_LIFETIME) {
    return { ok: false, error: "This setup expired. Reload the page to start again." };
  }

  const step = verifyTotp(decryptSecret(key, row.secret_enc, session.userId), input, now);
  if (step === null) {
    audit(db, { action: "mfa.failed", actor: session.userId, target: session.userId, ip: ctx.ip, detail: { stage: "setup" } }, now);
    return { ok: false, error: INVALID };
  }

  const recoveryCodes = transaction(db, () => {
    // Re-read under the lock: the break-glass command may have ended this session or removed the pending secret
    // since the checks above, and a stale confirmation must not turn MFA back on with a secret nobody holds.
    const still = db.prepare("SELECT secret_enc, session_hash FROM mfa_setup WHERE user_id = ?").get(session.userId) as { secret_enc: string; session_hash: string } | undefined;
    const alive = db.prepare("SELECT 1 AS ok FROM sessions WHERE id_hash = ?").get(session.tokenHash);
    if (!still || still.secret_enc !== row.secret_enc || still.session_hash !== session.tokenHash || !alive) return null;
    const was = findUserById(db, session.userId)!.mfa_enabled_at !== null;
    // MAX: the step counter only ever moves forward, so a code that was already accepted can never come back.
    db.prepare("UPDATE users SET mfa_secret_enc = ?, mfa_enabled_at = ?, mfa_last_step = MAX(mfa_last_step, ?) WHERE id = ?").run(row.secret_enc, now, step, session.userId);
    db.prepare("DELETE FROM mfa_setup WHERE user_id = ?").run(session.userId);
    const codes = replaceRecoveryCodes(db, key, session.userId);
    revokeSessions(db, session.userId, session.tokenHash);
    audit(db, { action: was ? "mfa.reenrolled" : "mfa.enabled", actor: session.userId, target: session.userId, ip: ctx.ip }, now);
    return codes;
  });
  if (!recoveryCodes) return { ok: false, error: "This setup expired. Reload the page to start again." };
  releaseFailure(db, limit);
  return { ok: true, recoveryCodes };
}

/** Proves a current code, then issues ten new recovery codes and voids the old ones. */
export function regenerateRecoveryCodes(db: DatabaseSync, key: Buffer, userId: string, input: string, ctx: MfaCtx): MfaResult<{ recoveryCodes: string[] }> {
  const proof = proveFactor(db, key, userId, input, ctx);
  if (!proof.ok) return proof;
  const now = ctx.now ?? Date.now();
  const recoveryCodes = transaction(db, () => {
    const codes = replaceRecoveryCodes(db, key, userId);
    audit(db, { action: "mfa.recovery_regenerated", actor: userId, target: userId, ip: ctx.ip }, now);
    return codes;
  });
  return { ok: true, recoveryCodes };
}

/**
 * An administrator takes their own authenticator off after proving a current code, so a stolen session cannot do it.
 * Not while MFA is required for them (they would be sent straight back to setup): stop requiring it first. Other
 * sessions end; this one stays.
 */
export function disableOwnMfa(db: DatabaseSync, key: Buffer, session: { tokenHash: string; userId: string }, input: string, ctx: MfaCtx): MfaResult {
  const refusal = (): string | null => {
    const user = findUserById(db, session.userId);
    if (!user || !rolesOf(db, user.id).includes("admin")) return "Only an administrator can turn their own MFA off. Ask an administrator.";
    if (user.mfa_required === 1) return "MFA is required for your account. Stop requiring it on the Users screen first.";
    return null;
  };
  const early = refusal();
  if (early) return { ok: false, error: early };
  const proof = proveFactor(db, key, session.userId, input, ctx);
  if (!proof.ok) return proof;
  const now = ctx.now ?? Date.now();
  // Checked again under the write lock: the role or the requirement may have changed since the first look.
  return transaction(db, (): MfaResult => {
    const late = refusal();
    if (late) return { ok: false, error: late };
    clearMfa(db, session.userId);
    revokeSessions(db, session.userId, session.tokenHash);
    audit(db, { action: "mfa.disabled", actor: session.userId, target: session.userId, ip: ctx.ip }, now);
    return { ok: true };
  });
}

/** Removes everything MFA for a user. Callers decide who may do this and end the sessions. */
export function clearMfa(db: DatabaseSync, userId: string): void {
  db.prepare("UPDATE users SET mfa_secret_enc = NULL, mfa_enabled_at = NULL, mfa_last_step = 0 WHERE id = ?").run(userId);
  db.prepare("DELETE FROM mfa_setup WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(userId);
  resetFailures(db, throttleKey(userId));
}
