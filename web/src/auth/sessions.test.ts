import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db";
import { createSession, deleteSession, hashToken, LIMITS, markMfaVerified, MFA_PENDING_LIMIT, purgeExpired, revokeSessions, validateSession } from "./sessions";
import { createUser, grantRole } from "./users";

let db: ReturnType<typeof openDb>;
let user: string;
let admin: string;
const T0 = 1_000_000_000_000;
const HOUR = 3_600_000;

beforeEach(() => {
  db = openDb(":memory:");
  user = createUser(db, { email: "user@example.com", passwordHash: "x" }, T0);
  admin = createUser(db, { email: "admin@example.com", passwordHash: "x" }, T0);
  grantRole(db, admin, "admin", null, T0);
});

describe("sessions", () => {
  it("stores only a hash of the token", () => {
    const { token } = createSession(db, user, {}, T0);
    const rows = db.prepare("SELECT id_hash FROM sessions").all() as { id_hash: string }[];
    expect(rows).toEqual([{ id_hash: hashToken(token) }]);
    expect(rows[0]!.id_hash).not.toBe(token);
  });

  it("validates a fresh session and reports roles and the forced-change flag", () => {
    grantRole(db, user, "viewer", null, T0);
    const { token } = createSession(db, user, {}, T0);
    const s = validateSession(db, token, T0 + 1000)!;
    expect(s.email).toBe("user@example.com");
    expect(s.roles).toEqual(["viewer"]);
    expect(s.mustChangePassword).toBe(false);
  });

  it("rejects unknown tokens", () => {
    expect(validateSession(db, "nope", T0)).toBeNull();
  });

  it("expires a normal user after 8 hours idle and 7 days absolute", () => {
    const idle = createSession(db, user, {}, T0).token;
    expect(validateSession(db, idle, T0 + LIMITS.user.idle - 1)).not.toBeNull();
    expect(validateSession(db, idle, T0 + LIMITS.user.idle * 2)).toBeNull();

    const busy = createSession(db, user, {}, T0).token;
    // active every 6 hours: never idle, but the 7 day limit still ends it
    for (let t = T0 + 6 * HOUR; t < T0 + LIMITS.user.absolute; t += 6 * HOUR) expect(validateSession(db, busy, t)).not.toBeNull();
    expect(validateSession(db, busy, T0 + LIMITS.user.absolute)).toBeNull();
  });

  it("gives admins 1 hour idle and 12 hours absolute", () => {
    const a = createSession(db, admin, {}, T0).token;
    expect(validateSession(db, a, T0 + HOUR - 1)).not.toBeNull();
    expect(validateSession(db, a, T0 + 2 * HOUR)).toBeNull();
    const b = createSession(db, admin, {}, T0).token;
    expect(validateSession(db, b, T0 + LIMITS.admin.absolute - 1)).toBeNull(); // idle long before that
    expect(createSession(db, admin, {}, T0).expiresAt).toBe(T0 + LIMITS.admin.absolute);
  });

  it("applies the shorter admin idle limit to a user promoted later", () => {
    const { token } = createSession(db, user, {}, T0);
    grantRole(db, user, "admin", null, T0);
    expect(validateSession(db, token, T0 + 2 * HOUR)).toBeNull();
  });

  it("caps a session at the admin limit once its user is promoted, even though it was created with 7 days", () => {
    const { token } = createSession(db, user, {}, T0); // no role yet: expires_at = T0 + 7 days
    grantRole(db, user, "admin", null, T0);
    const justBefore = T0 + LIMITS.admin.absolute - 1000;
    db.prepare("UPDATE sessions SET last_seen_at = ?").run(justBefore - 1000); // active, so idle is not what ends it
    expect(validateSession(db, token, justBefore)).not.toBeNull();
    expect(validateSession(db, token, T0 + LIMITS.admin.absolute + 1000)).toBeNull();
  });

  it("starts pending when asked, and only a code can change that", () => {
    const { token } = createSession(db, user, { mfaPending: true }, T0);
    const s = validateSession(db, token, T0)!;
    expect(s.mfaPending).toBe(true);
    expect(markMfaVerified(db, "wrong-hash", user)).toBe(false);
    expect(markMfaVerified(db, s.tokenHash, admin)).toBe(false); // someone else's session
    expect(markMfaVerified(db, s.tokenHash, user)).toBe(true);
    expect(validateSession(db, token, T0)!.mfaPending).toBe(false);
    expect(markMfaVerified(db, s.tokenHash, user)).toBe(false); // no longer pending
  });

  it("reports whether the address is confirmed, so the gate can read it live", () => {
    const { token } = createSession(db, user, {}, T0);
    expect(validateSession(db, token, T0)!.emailVerified).toBe(false);
    db.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(T0, user);
    expect(validateSession(db, token, T0 + 1000)!.emailVerified).toBe(true); // the same session sees it at once
  });

  it("gives a pending session only five minutes", () => {
    const { token } = createSession(db, user, { mfaPending: true }, T0);
    expect(validateSession(db, token, T0 + MFA_PENDING_LIMIT - 1000)).not.toBeNull();
    expect(validateSession(db, token, T0 + MFA_PENDING_LIMIT)).toBeNull();
    // a full session is not affected
    const full = createSession(db, user, {}, T0).token;
    expect(validateSession(db, full, T0 + MFA_PENDING_LIMIT + 1000)).not.toBeNull();
  });

  it("says when MFA is required and not set up: only when the flag is on, for admins as for everyone", () => {
    const u = validateSession(db, createSession(db, user, {}, T0).token, T0)!;
    expect(u).toMatchObject({ mfaRequired: false, mfaEnabled: false, needsMfaSetup: false });
    db.prepare("UPDATE users SET mfa_required = 1 WHERE id = ?").run(user);
    expect(validateSession(db, createSession(db, user, {}, T0).token, T0)).toMatchObject({ mfaRequired: true, needsMfaSetup: true });
    const a = validateSession(db, createSession(db, admin, {}, T0).token, T0)!;
    expect(a).toMatchObject({ mfaRequired: false, needsMfaSetup: false });
    db.prepare("UPDATE users SET mfa_required = 1 WHERE id = ?").run(admin);
    expect(validateSession(db, createSession(db, admin, {}, T0).token, T0)).toMatchObject({ mfaRequired: true, needsMfaSetup: true });
    db.prepare("UPDATE users SET mfa_enabled_at = ? WHERE id = ?").run(T0, admin);
    expect(validateSession(db, createSession(db, admin, {}, T0).token, T0)).toMatchObject({ mfaEnabled: true, needsMfaSetup: false });
  });

  it("applies a newly set MFA requirement to a session that already exists", () => {
    const { token } = createSession(db, user, {}, T0);
    expect(validateSession(db, token, T0)!.needsMfaSetup).toBe(false);
    db.prepare("UPDATE users SET mfa_required = 1 WHERE id = ?").run(user);
    expect(validateSession(db, token, T0 + 1000)!.needsMfaSetup).toBe(true);
  });

  it("touches last_seen at most once a minute", () => {
    const { token } = createSession(db, user, {}, T0);
    const seen = () => (db.prepare("SELECT last_seen_at AS t FROM sessions").get() as { t: number }).t;
    validateSession(db, token, T0 + 10_000);
    expect(seen()).toBe(T0);
    validateSession(db, token, T0 + 61_000);
    expect(seen()).toBe(T0 + 61_000);
  });

  it("rejects a disabled user and removes the session", () => {
    const { token } = createSession(db, user, {}, T0);
    db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(T0, user);
    expect(validateSession(db, token, T0 + 1000)).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  it("deletes one session or all but one", () => {
    const a = createSession(db, user, {}, T0).token;
    const b = createSession(db, user, {}, T0).token;
    const c = createSession(db, user, {}, T0).token;
    deleteSession(db, a);
    expect(validateSession(db, a, T0)).toBeNull();
    revokeSessions(db, user, hashToken(b));
    expect(validateSession(db, b, T0)).not.toBeNull();
    expect(validateSession(db, c, T0)).toBeNull();
    revokeSessions(db, user);
    expect(validateSession(db, b, T0)).toBeNull();
  });

  it("sweeps pending sessions that were never completed, but not recent ones or full ones", () => {
    createSession(db, user, { mfaPending: true }, T0);
    createSession(db, user, {}, T0);
    createSession(db, user, { mfaPending: true }, T0 + MFA_PENDING_LIMIT);
    purgeExpired(db, T0 + MFA_PENDING_LIMIT);
    const left = db.prepare("SELECT mfa_pending AS p, created_at AS c FROM sessions ORDER BY created_at").all();
    expect(left).toEqual([{ p: 0, c: T0 }, { p: 1, c: T0 + MFA_PENDING_LIMIT }]);
  });

  it("purges expired sessions", () => {
    createSession(db, user, {}, T0);
    purgeExpired(db, T0 + LIMITS.user.absolute + 1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });
});
