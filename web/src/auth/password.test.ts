import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashParams, hashPassword, needsRehash, verifyDummy, verifyPassword } from "./password";
import { checkPassword } from "./policy";

const prod = { ...hashParams };
beforeAll(() => Object.assign(hashParams, { N: 2 ** 10, r: 8, p: 1 }));
afterAll(() => Object.assign(hashParams, prod));

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterz", hash)).toBe(false);
  });

  it("uses a fresh salt and stores the parameters in the hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same password 1"), hashPassword("same password 1")]);
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$1024$8$1$")).toBe(true);
  });

  it("treats visually equal unicode as the same password (NFKC)", async () => {
    const hash = await hashPassword("café au lait 123");
    expect(await verifyPassword("café au lait 123", hash)).toBe(true);
  });

  it("returns false for malformed hashes instead of throwing", async () => {
    for (const bad of ["", "plain", "scrypt$1$2$3", "bcrypt$1024$8$1$aa$bb", "scrypt$1023$8$1$aa$bb", "scrypt$99999999$8$1$aa$bb", "scrypt$1024$8$1$aa$bb$extra"]) {
      expect(await verifyPassword("x", bad)).toBe(false);
    }
  });

  it("flags hashes made with other parameters for rehash", async () => {
    const hash = await hashPassword("some password 12");
    expect(needsRehash(hash)).toBe(false);
    hashParams.N = 2 ** 11;
    expect(needsRehash(hash)).toBe(true);
    expect(await verifyPassword("some password 12", hash)).toBe(true);
    hashParams.N = 2 ** 10;
    expect(needsRehash("garbage")).toBe(true);
  });

  it("runs a dummy check without throwing", async () => {
    await expect(verifyDummy("anything at all")).resolves.toBeUndefined();
  });

  it("finishes many hashes at once under the concurrency cap", async () => {
    const hashes = await Promise.all(Array.from({ length: 6 }, (_, i) => hashPassword(`password number ${i}`)));
    expect(new Set(hashes).size).toBe(6);
  });
});

describe("checkPassword", () => {
  it("enforces 12-128 characters, counting characters not bytes", () => {
    expect(checkPassword("short")).toMatch(/at least 12/);
    expect(checkPassword("x".repeat(129))).toMatch(/at most 128/);
    expect(checkPassword("\u{1F600}".repeat(12))).toBeNull();
    expect(checkPassword("a-long-enough-pw")).toBeNull();
  });

  it("rejects common passwords case-insensitively", () => {
    expect(checkPassword("PasswordPassword")).toMatch(/too common/);
    expect(checkPassword("QWERTYUIOP12")).toMatch(/too common/);
  });

  it("rejects the email address as password", () => {
    expect(checkPassword("Person@Example.com", "person@example.com")).toMatch(/email/);
  });
});
