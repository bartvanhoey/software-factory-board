// No "server-only" or next/* imports. RFC 4226 (HOTP) and RFC 6238 (TOTP) on Node's built-in crypto, SHA-1,
// because that is what every authenticator app supports.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const STEP_SECONDS = 30;
export const DIGITS = 6;
const ISSUER = "Software Factory";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 20 random bytes, the size RFC 4226 recommends for SHA-1. */
export function generateSecret(): Buffer {
  return randomBytes(20);
}

/** RFC 4648 base32 without padding: how authenticator apps want the secret typed in. */
export function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** RFC 4226: HMAC-SHA1 over the 8-byte big-endian counter, dynamic truncation, then modulo 10^digits. */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(message).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** The time step a moment falls in (steps are 30 s since the Unix epoch). */
export function stepOf(timeMs: number): number {
  return Math.floor(timeMs / 1000 / STEP_SECONDS);
}

export function totp(secret: Buffer, timeMs: number, digits = DIGITS): string {
  return hotp(secret, stepOf(timeMs), digits);
}

/**
 * The step whose code matches, or null. One step either side of now is accepted for clock drift. Every candidate
 * is compared whatever the outcome, so the timing does not show which step was close. The caller must still reject
 * a step it has already accepted (replay).
 */
export function verifyTotp(secret: Buffer, code: string, nowMs: number, window = 1): number | null {
  const given = code.replace(/\s/g, "");
  if (!/^\d+$/.test(given) || given.length !== DIGITS) return null;
  const submitted = Buffer.from(given);
  const current = stepOf(nowMs);
  let matched: number | null = null;
  for (let step = current - window; step <= current + window; step++) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, submitted) && matched === null) matched = step;
  }
  return matched;
}

/** The otpauth:// link a QR code carries, per the Google Authenticator key URI format. */
export function otpauthUri(email: string, secret: Buffer): string {
  const label = `${encodeURIComponent(ISSUER)}:${encodeURIComponent(email)}`;
  const query = new URLSearchParams({ secret: base32(secret), issuer: ISSUER, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${query.toString().replace(/\+/g, "%20")}`;
}
