// No "server-only" or next/* imports: the testable core of the links we email.
import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { transaction } from "./db";

export type TokenPurpose = "verify" | "reset";

const HOUR = 3_600_000;

/** How long a link works. A reset link is the more dangerous one, so it is short. */
export const LIFETIME: Record<TokenPurpose, number> = { verify: 24 * HOUR, reset: HOUR };

// 32 random bytes in base64url. Anything else cannot be one of ours, so it is refused without touching the database.
const SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** The purpose is part of what is hashed: a verify token fails as a reset token even if the rows were tampered with. */
function hashOf(purpose: TokenPurpose, token: string): string {
  return createHash("sha256").update(`${purpose}:${token}`).digest("hex");
}

/**
 * Makes a link token for a user. Any earlier unused token of the same kind for that user stops working, so only the
 * newest link in their inbox is live. Returns the plaintext, which goes into the email and is never stored.
 */
export function issueToken(db: DatabaseSync, userId: string, purpose: TokenPurpose, now = Date.now(), keepOlder = false): string {
  const token = randomBytes(32).toString("base64url");
  transaction(db, () => {
    // Opportunistic cleanup, so the table cannot grow without bound: expired a day ago, or used a day ago.
    db.prepare("DELETE FROM email_tokens WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)").run(now - 24 * HOUR, now - 24 * HOUR);
    // keepOlder: the caller voids the older links itself once the new one has really been sent, so a failed send does
    // not cost the user the link they already had.
    if (!keepOlder) db.prepare("DELETE FROM email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL").run(userId, purpose);
    db.prepare("INSERT INTO email_tokens (user_id, purpose, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(
      userId,
      purpose,
      hashOf(purpose, token),
      now,
      now + LIFETIME[purpose],
    );
  });
  return token;
}

/**
 * Whose link this is, without using it up, or null if it would not work. For the page that shows the "confirm" button
 * or the new-password form, and for checking a new password before the link is spent on it.
 */
export function peekToken(db: DatabaseSync, token: string, purpose: TokenPurpose, now = Date.now()): { userId: string } | null {
  if (!SHAPE.test(token)) return null;
  const row = db
    .prepare("SELECT user_id FROM email_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
    .get(hashOf(purpose, token), now) as { user_id: string } | undefined;
  return row ? { userId: row.user_id } : null;
}

export function tokenIsLive(db: DatabaseSync, token: string, purpose: TokenPurpose, now = Date.now()): boolean {
  return peekToken(db, token, purpose, now) !== null;
}

/**
 * Uses a link up. One atomic UPDATE decides it, so two requests with the same link (a double click, a scanner and a
 * person) cannot both win. Returns the user it belongs to, or null if it is unknown, expired, used or the wrong kind.
 */
export function consumeToken(db: DatabaseSync, token: string, purpose: TokenPurpose, now = Date.now()): { userId: string } | null {
  if (!SHAPE.test(token)) return null;
  const row = db
    .prepare("UPDATE email_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id")
    .get(now, hashOf(purpose, token), now) as { user_id: string } | undefined;
  return row ? { userId: row.user_id } : null;
}

/** Ends the unused links of a kind for a user except the one given (the new one, once it has been sent). */
export function voidOtherTokens(db: DatabaseSync, userId: string, purpose: TokenPurpose, keep: string): void {
  db.prepare("DELETE FROM email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL AND token_hash <> ?").run(userId, purpose, hashOf(purpose, keep));
}

/** Drops one link (a new one that could not be sent). */
export function discardToken(db: DatabaseSync, token: string, purpose: TokenPurpose): void {
  db.prepare("DELETE FROM email_tokens WHERE token_hash = ?").run(hashOf(purpose, token));
}

/** Whether the user has a link that would still work: "we sent you a link" is only true if so. */
export function hasLiveToken(db: DatabaseSync, userId: string, purpose: TokenPurpose, now = Date.now()): boolean {
  return db.prepare("SELECT 1 AS ok FROM email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?").get(userId, purpose, now) !== undefined;
}

/** Ends every unused link of a kind for a user (for example all reset links once the password has been reset). */
export function voidTokens(db: DatabaseSync, userId: string, purpose: TokenPurpose): void {
  db.prepare("DELETE FROM email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL").run(userId, purpose);
}
