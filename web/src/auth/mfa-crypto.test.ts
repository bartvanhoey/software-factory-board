import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode, RECOVERY_CODE_COUNT } from "./mfa-crypto";
import { generateSecret } from "./totp";

const KEY = randomBytes(32);

describe("secret encryption", () => {
  it("round-trips a secret", () => {
    const secret = generateSecret();
    expect(decryptSecret(KEY, encryptSecret(KEY, secret, "user-1"), "user-1").equals(secret)).toBe(true);
  });

  it("uses a fresh nonce, so the same secret never looks the same twice, and never contains the plaintext", () => {
    const secret = generateSecret();
    const [a, b] = [encryptSecret(KEY, secret, "u"), encryptSecret(KEY, secret, "u")];
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(a).not.toContain(secret.toString("base64url"));
  });

  it("refuses the wrong key, the wrong user and a changed value", () => {
    const stored = encryptSecret(KEY, generateSecret(), "user-1");
    expect(() => decryptSecret(randomBytes(32), stored, "user-1")).toThrow();
    expect(() => decryptSecret(KEY, stored, "user-2")).toThrow();
    const [v, nonce, ct, tag] = stored.split(".") as [string, string, string, string];
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    for (const tampered of [`${v}.${flip(nonce)}.${ct}.${tag}`, `${v}.${nonce}.${flip(ct)}.${tag}`, `${v}.${nonce}.${ct}.${flip(tag)}`]) {
      expect(() => decryptSecret(KEY, tampered, "user-1")).toThrow();
    }
  });

  it("refuses a shortened tag or a wrong-sized nonce instead of accepting a cheaper forgery", () => {
    const stored = encryptSecret(KEY, generateSecret(), "u");
    const [v, nonce, ct, tag] = stored.split(".") as [string, string, string, string];
    const shortTag = Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url");
    expect(() => decryptSecret(KEY, `${v}.${nonce}.${ct}.${shortTag}`, "u")).toThrow();
    const shortNonce = Buffer.from(nonce, "base64url").subarray(0, 8).toString("base64url");
    expect(() => decryptSecret(KEY, `${v}.${shortNonce}.${ct}.${tag}`, "u")).toThrow();
  });

  it("refuses malformed values without a crash", () => {
    for (const bad of ["", "garbage", "v2.a.b.c", "v1.a.b", "v1.a.b.c.d"]) expect(() => decryptSecret(KEY, bad, "u")).toThrow();
  });
});

describe("recovery codes", () => {
  it("makes ten distinct codes in XXXX-XXXX-XXXX form without look-alike characters", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("differs between batches", () => {
    expect(generateRecoveryCodes().some((c) => generateRecoveryCodes().includes(c))).toBe(false);
  });

  it("accepts a code typed in lower case, with spaces or without dashes", () => {
    expect(normalizeRecoveryCode("abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
    expect(normalizeRecoveryCode(" ABCD EFGH JKMN ")).toBe("ABCDEFGHJKMN");
    expect(normalizeRecoveryCode("ABCDEFGHJKMN")).toBe("ABCDEFGHJKMN");
  });

  it("folds case in ASCII only: a look-alike Unicode letter is not the letter", () => {
    expect(normalizeRecoveryCode("\u017fBCD-EFGH-JKMN")).toBeNull(); // long s would fold to S with a plain toUpperCase()
    expect(normalizeRecoveryCode("SBCD-EFGH-JKMN")).toBe("SBCDEFGHJKMN");
  });

  it("rejects anything that cannot be a code", () => {
    for (const bad of ["", "123456", "ABCD-EFGH-JKM", "ABCD-EFGH-JKMNP", "ABCD-EFGH-JKM0", "ABCD-EFGH-JKMI", "ABCD-EFGH-JK!N"]) expect(normalizeRecoveryCode(bad)).toBeNull();
  });

  it("hashes deterministically, depending on both the code and the key", () => {
    const h = hashRecoveryCode(KEY, "ABCDEFGHJKMN");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode(KEY, "ABCDEFGHJKMN")).toBe(h);
    expect(hashRecoveryCode(KEY, "ABCDEFGHJKMP")).not.toBe(h);
    expect(hashRecoveryCode(randomBytes(32), "ABCDEFGHJKMN")).not.toBe(h);
    expect(h).not.toContain("ABCDEFGHJKMN");
  });
});
