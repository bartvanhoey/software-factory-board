import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db";
import { gateRedirect } from "./gating";
import { clientIp, sessionCookieName } from "./request";
import { consume, delayFor, recordFailure, releaseFailure, resetFailures, retryAfter } from "./throttle";

let db: ReturnType<typeof openDb>;
const T0 = 1_000_000_000_000;
beforeEach(() => {
  db = openDb(":memory:");
});

describe("delayFor", () => {
  it("is free for four failures, then 30 s doubling up to 15 minutes", () => {
    expect([0, 1, 4].map(delayFor)).toEqual([0, 0, 0]);
    expect([5, 6, 7, 8, 9].map(delayFor)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000]);
    expect(delayFor(10)).toBe(15 * 60_000);
    expect(delayFor(500)).toBe(15 * 60_000);
  });
});

describe("login failures", () => {
  it("allows four failures, then blocks without a hard lock", () => {
    for (let i = 0; i < 4; i++) recordFailure(db, "k", T0);
    expect(retryAfter(db, "k", T0)).toBe(0);
    recordFailure(db, "k", T0);
    expect(retryAfter(db, "k", T0)).toBe(30_000);
    expect(retryAfter(db, "k", T0 + 29_000)).toBe(1_000);
    expect(retryAfter(db, "k", T0 + 30_000)).toBe(0);
  });

  it("keeps keys independent and resets on success", () => {
    for (let i = 0; i < 5; i++) recordFailure(db, "a", T0);
    expect(retryAfter(db, "b", T0)).toBe(0);
    resetFailures(db, "a");
    expect(retryAfter(db, "a", T0)).toBe(0);
  });

  it("forgets old failures after a day", () => {
    for (let i = 0; i < 12; i++) recordFailure(db, "k", T0);
    expect(retryAfter(db, "k", T0 + 25 * 3_600_000)).toBe(0);
    recordFailure(db, "k", T0 + 25 * 3_600_000);
    expect(retryAfter(db, "k", T0 + 25 * 3_600_000)).toBe(0);
  });
});

describe("reserving attempts", () => {
  it("releaseFailure takes back one attempt and removes the row at zero", () => {
    recordFailure(db, "k", T0);
    recordFailure(db, "k", T0);
    releaseFailure(db, "k");
    expect(db.prepare("SELECT count FROM throttle WHERE key = 'k'").get()).toEqual({ count: 1 });
    releaseFailure(db, "k");
    expect(db.prepare("SELECT COUNT(*) AS n FROM throttle").get()).toEqual({ n: 0 });
    releaseFailure(db, "missing"); // no row: nothing happens
  });

  it("forgets rows older than a day whenever a new failure is recorded", () => {
    for (let i = 0; i < 50; i++) recordFailure(db, `junk${i}`, T0);
    recordFailure(db, "fresh", T0 + 25 * 3_600_000);
    expect(db.prepare("SELECT key FROM throttle").all()).toEqual([{ key: "fresh" }]);
  });
});

describe("consume (fixed window)", () => {
  it("allows up to the limit, then refuses until the window passes", () => {
    for (let i = 0; i < 3; i++) expect(consume(db, "w", 3, 1000, T0)).toBe(true);
    expect(consume(db, "w", 3, 1000, T0 + 500)).toBe(false);
    expect(consume(db, "w", 3, 1000, T0 + 1000)).toBe(true);
  });
});

describe("gateRedirect", () => {
  it("sends a forced password change first, then role-less users to the waiting page", () => {
    expect(gateRedirect({ mustChangePassword: true, roles: [] })).toBe("/account/password");
    expect(gateRedirect({ mustChangePassword: true, roles: ["admin"] })).toBe("/account/password");
    expect(gateRedirect({ mustChangePassword: false, roles: [] })).toBe("/waiting");
    expect(gateRedirect({ mustChangePassword: false, roles: ["viewer"] })).toBeNull();
  });
});

describe("request helpers", () => {
  it("only trusts X-Forwarded-For when told to, and takes the last hop", () => {
    const h = (v: string | null) => () => v;
    expect(clientIp(h("1.2.3.4"), false)).toBeNull();
    expect(clientIp(h("9.9.9.9, 1.2.3.4"), true)).toBe("1.2.3.4");
    expect(clientIp(h(null), true)).toBeNull();
    expect(clientIp(h("<script>"), true)).toBeNull();
  });

  it("uses a __Host- cookie only when Secure", () => {
    expect(sessionCookieName(true)).toBe("__Host-session");
    expect(sessionCookieName(false)).toBe("session");
  });
});
