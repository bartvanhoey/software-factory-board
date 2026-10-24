import { describe, expect, it } from "vitest";
import { ConfigError, loadAuthConfig } from "./config";

const KEY = Buffer.alloc(32, 7).toString("base64");
const SMTP = { SMTP_HOST: "smtp.example.com", SMTP_PORT: "587", SMTP_USER: "u", SMTP_PASSWORD: "p", SMTP_FROM: "factory@example.com" };

function problemsOf(env: Record<string, string>): string[] {
  try {
    loadAuthConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  return [];
}

describe("loadAuthConfig", () => {
  it("accepts the minimal config and applies defaults", () => {
    const cfg = loadAuthConfig({ MFA_ENCRYPTION_KEY: KEY });
    expect(cfg.dbPath).toBe("/auth/auth.db");
    expect(cfg.mfaKey).toHaveLength(32);
    expect(cfg.emailVerification).toBe(false);
    expect(cfg.smtp).toBeNull();
    expect(cfg.cookieSecure).toBe(false);
    expect(cfg.trustProxy).toBe(false);
    expect(cfg.admin).toBeNull();
  });

  it("turns COOKIE_SECURE on by default in production only", () => {
    expect(loadAuthConfig({ MFA_ENCRYPTION_KEY: KEY, NODE_ENV: "production" }).cookieSecure).toBe(true);
    expect(loadAuthConfig({ MFA_ENCRYPTION_KEY: KEY, NODE_ENV: "production", COOKIE_SECURE: "false" }).cookieSecure).toBe(false);
  });

  it("requires MFA_ENCRYPTION_KEY and treats an empty value as missing", () => {
    expect(problemsOf({})).toEqual([expect.stringContaining("MFA_ENCRYPTION_KEY is required")]);
    expect(problemsOf({ MFA_ENCRYPTION_KEY: "" })).toEqual([expect.stringContaining("MFA_ENCRYPTION_KEY is required")]);
  });

  it("rejects a key that is not 32 bytes of base64", () => {
    const short = Buffer.alloc(16, 1).toString("base64");
    expect(problemsOf({ MFA_ENCRYPTION_KEY: short })).toEqual([expect.stringContaining("exactly 32 bytes")]);
    expect(problemsOf({ MFA_ENCRYPTION_KEY: "not base64 !!" })).toEqual([expect.stringContaining("exactly 32 bytes")]);
  });

  it("ignores SMTP settings while EMAIL_VERIFICATION is off", () => {
    expect(loadAuthConfig({ MFA_ENCRYPTION_KEY: KEY, ...SMTP }).smtp).toBeNull();
  });

  it("requires every SMTP setting when EMAIL_VERIFICATION=true", () => {
    const problems = problemsOf({ MFA_ENCRYPTION_KEY: KEY, EMAIL_VERIFICATION: "true" });
    expect(problems).toHaveLength(5);
    expect(problems.join()).toContain("SMTP_HOST is required");
  });

  it("returns the SMTP settings when EMAIL_VERIFICATION=true and all are set", () => {
    const cfg = loadAuthConfig({ MFA_ENCRYPTION_KEY: KEY, EMAIL_VERIFICATION: "true", ...SMTP });
    expect(cfg.smtp).toEqual({ host: "smtp.example.com", port: 587, user: "u", password: "p", from: "factory@example.com" });
  });

  it("rejects a bad SMTP port and a bad sender", () => {
    const problems = problemsOf({ MFA_ENCRYPTION_KEY: KEY, EMAIL_VERIFICATION: "true", ...SMTP, SMTP_PORT: "70000", SMTP_FROM: "nope" });
    expect(problems).toEqual([expect.stringContaining("SMTP_PORT must be a port"), expect.stringContaining("SMTP_FROM must be an email")]);
  });

  it("rejects a boolean that is not true or false", () => {
    expect(problemsOf({ MFA_ENCRYPTION_KEY: KEY, EMAIL_VERIFICATION: "yes" })).toEqual([expect.stringContaining("EMAIL_VERIFICATION must be")]);
  });

  it("reads TRUST_PROXY and rejects a non-boolean", () => {
    expect(loadAuthConfig({ MFA_ENCRYPTION_KEY: KEY, TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(problemsOf({ MFA_ENCRYPTION_KEY: KEY, TRUST_PROXY: "1" })).toEqual([expect.stringContaining("TRUST_PROXY must be")]);
  });

  it("needs ADMIN_EMAIL and ADMIN_PASSWORD together", () => {
    expect(problemsOf({ MFA_ENCRYPTION_KEY: KEY, ADMIN_EMAIL: "a@example.com" })).toEqual([expect.stringContaining("set together")]);
    expect(problemsOf({ MFA_ENCRYPTION_KEY: KEY, ADMIN_PASSWORD: "correct horse battery" })).toEqual([expect.stringContaining("set together")]);
  });

  it("lowercases the admin email and enforces the password length", () => {
    const cfg = loadAuthConfig({ MFA_ENCRYPTION_KEY: KEY, ADMIN_EMAIL: "Admin@Example.com", ADMIN_PASSWORD: "correct horse battery" });
    expect(cfg.admin).toEqual({ email: "admin@example.com", password: "correct horse battery" });
    expect(problemsOf({ MFA_ENCRYPTION_KEY: KEY, ADMIN_EMAIL: "a@example.com", ADMIN_PASSWORD: "short" })).toEqual([expect.stringContaining("at least 12")]);
  });

  it("reports every problem at once", () => {
    expect(problemsOf({ EMAIL_VERIFICATION: "true" }).length).toBeGreaterThan(5);
  });

  it("never puts a value in the error message", () => {
    const secret = "hunter2-secret-value";
    const env = { MFA_ENCRYPTION_KEY: secret, EMAIL_VERIFICATION: "true", SMTP_HOST: secret, SMTP_PORT: secret, SMTP_FROM: secret, ADMIN_EMAIL: secret, ADMIN_PASSWORD: secret };
    expect(() => loadAuthConfig(env)).toThrow(ConfigError);
    try {
      loadAuthConfig(env);
    } catch (err) {
      expect((err as Error).message).not.toContain(secret);
    }
  });
});
