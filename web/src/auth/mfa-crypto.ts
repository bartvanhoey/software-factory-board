// No "server-only" or next/* imports: vitest and the break-glass CLI load this outside Next.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt } from "node:crypto";

/** One master key (MFA_ENCRYPTION_KEY), a separate derived key per purpose, so a use in one place says nothing about another. */
function subkey(master: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `software-factory:${purpose}`, 32));
}

/**
 * AES-256-GCM. The user id is authenticated but not stored with the value, so a secret copied from one user's
 * row to another's fails to decrypt. Stored as `v1.nonce.ciphertext.tag` (base64url).
 */
export function encryptSecret(master: Buffer, secret: Buffer, userId: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subkey(master, "totp-secret"), nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return ["v1", nonce, ciphertext, cipher.getAuthTag()].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/** Throws on a wrong key, a wrong user, or any change to the stored value. */
export function decryptSecret(master: Buffer, stored: string, userId: string): Buffer {
  const [version, nonce, ciphertext, tag, extra] = stored.split(".");
  if (version !== "v1" || !nonce || !ciphertext || !tag || extra !== undefined) throw new Error("unreadable MFA secret");
  const nonceBytes = Buffer.from(nonce, "base64url");
  const tagBytes = Buffer.from(tag, "base64url");
  // Fixed sizes: GCM accepts a shortened tag unless told otherwise, which would make a forgery cheaper.
  if (nonceBytes.length !== 12 || tagBytes.length !== 16) throw new Error("unreadable MFA secret");
  const decipher = createDecipheriv("aes-256-gcm", subkey(master, "totp-secret"), nonceBytes, { authTagLength: 16 });
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(tagBytes);
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]);
}

// 32 characters, no I/O/0/1, so a code read off paper is not ambiguous. 12 characters = 60 bits.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 12;
export const RECOVERY_CODE_COUNT = 10;

function newRecoveryCode(): string {
  const raw = Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(newRecoveryCode());
  return [...codes];
}

/** The canonical form (no dashes or spaces, upper case), or null when it cannot be a recovery code. */
export function normalizeRecoveryCode(input: string): string | null {
  // ASCII only: toUpperCase() alone would also fold characters such as the long s into "S".
  const code = input.replace(/[\s-]/g, "").replace(/[a-z]/g, (c) => c.toUpperCase());
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

/**
 * Keyed HMAC, not scrypt: the code already has 60 bits of entropy, so a slow hash adds nothing, and without the
 * key a copy of the database cannot be used to brute-force them. Takes the canonical form.
 */
export function hashRecoveryCode(master: Buffer, normalized: string): string {
  return createHmac("sha256", subkey(master, "recovery-code")).update(normalized).digest("hex");
}
