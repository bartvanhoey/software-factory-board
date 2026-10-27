import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db";
import { consumeToken, discardToken, hasLiveToken, issueToken, LIFETIME, peekToken, tokenIsLive, voidOtherTokens, voidTokens } from "./email-tokens";
import { createUser } from "./users";

let db: ReturnType<typeof openDb>;
let user: string;
const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

beforeEach(() => {
  db = openDb(":memory:");
  user = createUser(db, { email: "person@example.com", passwordHash: "x" }, T0);
});

describe("issueToken", () => {
  it("returns a 43-character url-safe token that differs every time", () => {
    const a = issueToken(db, user, "verify", T0);
    const b = issueToken(db, user, "reset", T0);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("stores only a hash, never the token", () => {
    const token = issueToken(db, user, "verify", T0);
    const dump = JSON.stringify(db.prepare("SELECT * FROM email_tokens").all());
    expect(dump).not.toContain(token);
    expect(db.prepare("SELECT token_hash FROM email_tokens").get()).toEqual({ token_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("gives a verify link a day and a reset link an hour", () => {
    issueToken(db, user, "verify", T0);
    issueToken(db, user, "reset", T0);
    const rows = db.prepare("SELECT purpose, expires_at - created_at AS life FROM email_tokens ORDER BY purpose").all();
    expect(rows).toEqual([
      { purpose: "reset", life: HOUR },
      { purpose: "verify", life: 24 * HOUR },
    ]);
    expect(LIFETIME).toEqual({ verify: 24 * HOUR, reset: HOUR });
  });

  it("makes the newest link the only live one of its kind for that user", () => {
    const first = issueToken(db, user, "reset", T0);
    const second = issueToken(db, user, "reset", T0 + 1000);
    expect(tokenIsLive(db, first, "reset", T0 + 2000)).toBe(false);
    expect(consumeToken(db, first, "reset", T0 + 2000)).toBeNull();
    expect(consumeToken(db, second, "reset", T0 + 2000)).toEqual({ userId: user });
  });

  it("does not touch another kind of link, or another user's", () => {
    const verify = issueToken(db, user, "verify", T0);
    const other = createUser(db, { email: "other@example.com", passwordHash: "x" }, T0);
    const theirs = issueToken(db, other, "reset", T0);
    issueToken(db, user, "reset", T0 + 1000);
    expect(tokenIsLive(db, verify, "verify", T0 + 2000)).toBe(true);
    expect(tokenIsLive(db, theirs, "reset", T0 + 2000)).toBe(true);
  });

  it("sweeps links that expired or were used more than a day ago", () => {
    const old = issueToken(db, user, "verify", T0);
    consumeToken(db, old, "verify", T0 + 1000);
    const expired = issueToken(db, createUser(db, { email: "b@example.com", passwordHash: "x" }, T0), "reset", T0);
    expect(expired).toBeTruthy();
    issueToken(db, user, "verify", T0 + 3 * 24 * HOUR);
    expect(db.prepare("SELECT COUNT(*) AS n FROM email_tokens").get()).toEqual({ n: 1 });
  });
});

describe("consumeToken", () => {
  it("works once, then never again", () => {
    const token = issueToken(db, user, "verify", T0);
    expect(consumeToken(db, token, "verify", T0 + 1000)).toEqual({ userId: user });
    expect(consumeToken(db, token, "verify", T0 + 2000)).toBeNull();
    expect(tokenIsLive(db, token, "verify", T0 + 2000)).toBe(false);
  });

  it("works right up to the expiry and not at it", () => {
    const v = issueToken(db, user, "verify", T0);
    expect(consumeToken(db, v, "verify", T0 + 24 * HOUR - 1)).not.toBeNull();
    const r = issueToken(db, user, "reset", T0);
    expect(tokenIsLive(db, r, "reset", T0 + HOUR - 1)).toBe(true);
    expect(consumeToken(db, r, "reset", T0 + HOUR)).toBeNull();
  });

  it("is refused for the wrong kind, and a failed attempt does not use the link up", () => {
    const token = issueToken(db, user, "verify", T0);
    expect(consumeToken(db, token, "reset", T0 + 1000)).toBeNull();
    expect(consumeToken(db, token, "verify", T0 + 1000)).toEqual({ userId: user });
  });

  it("cannot be turned into another kind by editing the row", () => {
    const token = issueToken(db, user, "verify", T0);
    db.prepare("UPDATE email_tokens SET purpose = 'reset'").run();
    expect(consumeToken(db, token, "reset", T0 + 1000)).toBeNull(); // the hash covers the purpose
  });

  it("refuses anything that cannot be one of ours, including unknown tokens and odd input", () => {
    issueToken(db, user, "verify", T0);
    for (const bad of ["", "short", "x".repeat(42), "x".repeat(44), "A".repeat(43), "has space ".padEnd(43, "a"), "%".repeat(43), "a'; DROP TABLE users;--".padEnd(43, "a")]) {
      expect(consumeToken(db, bad, "verify", T0 + 1000)).toBeNull();
      expect(tokenIsLive(db, bad, "verify", T0 + 1000)).toBe(false);
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 1 });
  });

  it("lets only one of several simultaneous uses of a link win", () => {
    const token = issueToken(db, user, "reset", T0);
    const results = Array.from({ length: 5 }, () => consumeToken(db, token, "reset", T0 + 1000));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });
});

describe("tokenIsLive", () => {
  it("looks without using the link up", () => {
    const token = issueToken(db, user, "verify", T0);
    for (let i = 0; i < 3; i++) expect(tokenIsLive(db, token, "verify", T0 + 1000)).toBe(true);
    expect(consumeToken(db, token, "verify", T0 + 1000)).not.toBeNull();
  });
});

describe("peekToken", () => {
  it("says whose link it is without using it, and nothing for a link that would not work", () => {
    const token = issueToken(db, user, "reset", T0);
    expect(peekToken(db, token, "reset", T0 + 1000)).toEqual({ userId: user });
    expect(peekToken(db, token, "reset", T0 + 1000)).toEqual({ userId: user });
    expect(peekToken(db, token, "verify", T0 + 1000)).toBeNull();
    expect(peekToken(db, token, "reset", T0 + HOUR)).toBeNull();
    expect(peekToken(db, "nope", "reset", T0)).toBeNull();
    expect(consumeToken(db, token, "reset", T0 + 1000)).toEqual({ userId: user });
    expect(peekToken(db, token, "reset", T0 + 2000)).toBeNull();
  });
});

describe("keeping the older link until the new one is sent", () => {
  it("issueToken with keepOlder leaves the earlier link working, until voidOtherTokens ends it", () => {
    const first = issueToken(db, user, "verify", T0);
    const second = issueToken(db, user, "verify", T0 + 1000, true);
    expect(tokenIsLive(db, first, "verify", T0 + 2000)).toBe(true);
    expect(tokenIsLive(db, second, "verify", T0 + 2000)).toBe(true);
    voidOtherTokens(db, user, "verify", second);
    expect(tokenIsLive(db, first, "verify", T0 + 2000)).toBe(false);
    expect(tokenIsLive(db, second, "verify", T0 + 2000)).toBe(true);
  });

  it("discardToken drops just the one link", () => {
    const first = issueToken(db, user, "verify", T0);
    const second = issueToken(db, user, "verify", T0 + 1000, true);
    discardToken(db, second, "verify");
    expect(tokenIsLive(db, first, "verify", T0 + 2000)).toBe(true);
    expect(tokenIsLive(db, second, "verify", T0 + 2000)).toBe(false);
  });

  it("hasLiveToken says whether a link would still work for the user", () => {
    expect(hasLiveToken(db, user, "verify", T0)).toBe(false);
    const token = issueToken(db, user, "verify", T0);
    expect(hasLiveToken(db, user, "verify", T0 + 1000)).toBe(true);
    expect(hasLiveToken(db, user, "reset", T0 + 1000)).toBe(false);
    expect(hasLiveToken(db, user, "verify", T0 + 24 * HOUR)).toBe(false);
    consumeToken(db, token, "verify", T0 + 1000);
    expect(hasLiveToken(db, user, "verify", T0 + 2000)).toBe(false);
  });
});

describe("database triggers: a link must not outlive the credential it helps with", () => {
  it("a changed password ends the unused reset links, but not verify links, and an unchanged one ends nothing", () => {
    const reset = issueToken(db, user, "reset", T0);
    const verify = issueToken(db, user, "verify", T0);
    db.prepare("UPDATE users SET password_hash = 'x' WHERE id = ?").run(user); // same value
    expect(tokenIsLive(db, reset, "reset", T0 + 1000)).toBe(true);
    db.prepare("UPDATE users SET password_hash = 'y' WHERE id = ?").run(user);
    expect(tokenIsLive(db, reset, "reset", T0 + 1000)).toBe(false);
    expect(tokenIsLive(db, verify, "verify", T0 + 1000)).toBe(true);
  });

  it("only touches that user's links", () => {
    const other = createUser(db, { email: "other@example.com", passwordHash: "x" }, T0);
    const theirs = issueToken(db, other, "reset", T0);
    issueToken(db, user, "reset", T0);
    db.prepare("UPDATE users SET password_hash = 'z' WHERE id = ?").run(user);
    expect(tokenIsLive(db, theirs, "reset", T0 + 1000)).toBe(true);
  });

  it("disabling the account ends all its unused links, and enabling it again brings none back", () => {
    const reset = issueToken(db, user, "reset", T0);
    const verify = issueToken(db, user, "verify", T0);
    db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(T0, user);
    expect(tokenIsLive(db, reset, "reset", T0 + 1000)).toBe(false);
    expect(tokenIsLive(db, verify, "verify", T0 + 1000)).toBe(false);
    db.prepare("UPDATE users SET disabled_at = NULL WHERE id = ?").run(user);
    expect(tokenIsLive(db, reset, "reset", T0 + 1000)).toBe(false);
  });
});

describe("voidTokens", () => {
  it("ends the unused links of one kind for one user", () => {
    const reset = issueToken(db, user, "reset", T0);
    const verify = issueToken(db, user, "verify", T0);
    voidTokens(db, user, "reset");
    expect(tokenIsLive(db, reset, "reset", T0 + 1000)).toBe(false);
    expect(tokenIsLive(db, verify, "verify", T0 + 1000)).toBe(true);
  });
});
