import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AUDIT_PAGE, denyNonAdmin, generateTemporaryPassword, listAudit, listUsers, resetMfa, resetPassword, setDisabled, setMfaRequired, setRoles, type AdminCtx } from "./admin";
import { openDb } from "./db";
import { hashParams } from "./password";
import { checkPassword } from "./policy";
import { login, register } from "./service";
import { createSession, validateSession } from "./sessions";
import { recordFailure } from "./throttle";
import { acctThrottleKey } from "./service";
import { createUser, grantRole, hasRole, rolesOf, type Role } from "./users";

const prod = { ...hashParams };
beforeAll(() => Object.assign(hashParams, { N: 2 ** 10, r: 8, p: 1 }));
afterAll(() => Object.assign(hashParams, prod));

let db: ReturnType<typeof openDb>;
const T0 = 1_000_000_000_000;
const ctx: AdminCtx = { ip: null, now: T0 };

function user(email: string, roles: Role[] = [], extra: { disabled?: boolean } = {}): string {
  const id = createUser(db, { email, passwordHash: "x" }, T0);
  for (const r of roles) grantRole(db, id, r, null, T0);
  if (extra.disabled) db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(T0, id);
  return id;
}

const actions = () => (db.prepare("SELECT action FROM audit_log ORDER BY id").all() as { action: string }[]).map((r) => r.action);

let admin: string;
let pending: string;
beforeEach(() => {
  db = openDb(":memory:");
  admin = user("admin@example.com", ["admin"]);
  pending = user("pending@example.com");
});

describe("hasRole", () => {
  it("admin implies everything, issue-admin implies viewer, viewer implies only itself", () => {
    expect(["admin", "issue-admin", "viewer"].every((r) => hasRole(["admin"], r as Role))).toBe(true);
    expect(hasRole(["issue-admin"], "viewer")).toBe(true);
    expect(hasRole(["issue-admin"], "issue-admin")).toBe(true);
    expect(hasRole(["issue-admin"], "admin")).toBe(false);
    expect(hasRole(["viewer"], "issue-admin")).toBe(false);
    expect(hasRole([], "viewer")).toBe(false);
  });
});

describe("setRoles", () => {
  it("grants and revokes roles, and audits each change", () => {
    expect(setRoles(db, admin, pending, ["viewer", "issue-admin"], ctx)).toEqual({ ok: true });
    expect(rolesOf(db, pending).sort()).toEqual(["issue-admin", "viewer"]);
    expect(setRoles(db, admin, pending, ["viewer"], ctx)).toEqual({ ok: true });
    expect(rolesOf(db, pending)).toEqual(["viewer"]);
    expect(actions()).toEqual(["role.granted", "role.granted", "role.revoked"]);
    const row = db.prepare("SELECT actor_user_id, target_user_id, detail FROM audit_log WHERE action = 'role.revoked'").get() as { actor_user_id: string; target_user_id: string; detail: string };
    expect(row).toEqual({ actor_user_id: admin, target_user_id: pending, detail: '{"role":"issue-admin"}' });
  });

  it("records who granted the role", () => {
    setRoles(db, admin, pending, ["viewer"], ctx);
    expect(db.prepare("SELECT granted_by FROM user_roles WHERE user_id = ?").get(pending)).toEqual({ granted_by: admin });
  });

  it("does nothing, and audits nothing, when nothing changes", () => {
    setRoles(db, admin, pending, [], ctx);
    expect(actions()).toEqual([]);
  });

  it("does not end the target's sessions: roles are read live", () => {
    const { token } = createSession(db, pending, {}, T0);
    setRoles(db, admin, pending, ["viewer"], ctx);
    expect(validateSession(db, token, T0)?.roles).toEqual(["viewer"]);
  });

  it("rejects unknown roles and unknown users", () => {
    expect(setRoles(db, admin, pending, ["viewer", "root"], ctx)).toEqual({ ok: false, error: "Unknown role." });
    expect(setRoles(db, admin, "no-such-id", ["viewer"], ctx)).toEqual({ ok: false, error: "User not found." });
    expect(rolesOf(db, pending)).toEqual([]);
  });

  it("refuses to remove your own admin role, but lets you keep it", () => {
    expect(setRoles(db, admin, admin, ["viewer"], ctx)).toEqual({ ok: false, error: "You cannot remove your own admin role." });
    expect(rolesOf(db, admin)).toEqual(["admin"]);
    expect(setRoles(db, admin, admin, ["admin", "viewer"], ctx)).toEqual({ ok: true });
  });

  it("lets one admin demote another who has not set up MFA", () => {
    const other = user("other@example.com", ["admin"]);
    expect(setRoles(db, admin, other, ["viewer"], ctx)).toEqual({ ok: true });
    expect(rolesOf(db, other)).toEqual(["viewer"]);
  });

  it("will not demote an admin who has MFA, which would be a detour around 'only the server resets an admin's MFA'", async () => {
    const other = user("other@example.com", ["admin"]);
    db.prepare("UPDATE users SET mfa_enabled_at = ?, mfa_secret_enc = 'v1.x.y.z' WHERE id = ?").run(T0, other);
    const r = setRoles(db, admin, other, ["viewer"], ctx);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("Disable the account instead") });
    expect(rolesOf(db, other)).toEqual(["admin"]);
    // the whole attack chain therefore stops at its first step
    expect(resetMfa(db, admin, other, ctx).ok).toBe(false);
    // offboarding still works: disable them
    expect(setDisabled(db, admin, other, true, ctx)).toEqual({ ok: true });
  });
});

describe("setRoles with the roles the admin saw", () => {
  it("refuses a save made from a stale form instead of undoing someone else's change", () => {
    expect(setRoles(db, admin, pending, ["viewer"], ctx, [])).toEqual({ ok: true }); // admin A saw "no roles" and saves viewer
    const stale = setRoles(db, admin, pending, ["issue-admin"], ctx, []); // admin B still has the old form
    expect(stale).toEqual({ ok: false, error: "The roles changed since you loaded this page. Reload and try again." });
    expect(rolesOf(db, pending)).toEqual(["viewer"]);
  });

  it("accepts a save when the form is current, in any order", () => {
    setRoles(db, admin, pending, ["viewer", "issue-admin"], ctx);
    expect(setRoles(db, admin, pending, ["viewer"], ctx, ["issue-admin", "viewer"])).toEqual({ ok: true });
  });
});

describe("denyNonAdmin", () => {
  it("records a logged-in non-admin who reached for an admin action", () => {
    const viewer = user("viewer@example.com", ["viewer"]);
    denyNonAdmin(db, viewer, "roles.set", ctx);
    expect(db.prepare("SELECT actor_user_id, detail FROM audit_log WHERE action = 'admin.denied'").get()).toEqual({
      actor_user_id: viewer,
      detail: '{"attempted":"roles.set"}',
    });
  });

  it("writes at most 5 entries an hour per user, so a role-less account cannot grow the append-only log", () => {
    for (let i = 0; i < 20; i++) denyNonAdmin(db, pending, "user.disable", ctx);
    expect(actions().filter((a) => a === "admin.denied")).toHaveLength(5);
    denyNonAdmin(db, pending, "user.disable", { ip: null, now: T0 + 3_600_001 });
    expect(actions().filter((a) => a === "admin.denied")).toHaveLength(6);
  });
});

describe("who may administer", () => {
  it.each([
    ["a viewer", ["viewer"] as Role[], false],
    ["an issue-admin", ["issue-admin"] as Role[], false],
    ["a user with no role", [] as Role[], false],
    ["a disabled admin", ["admin"] as Role[], true],
  ])("refuses %s everywhere, and audits the attempt", async (_name, roles, disabled) => {
    const actor = user("actor@example.com", roles, { disabled });
    expect(setRoles(db, actor, pending, ["admin"], ctx)).toEqual({ ok: false, error: "Administrator access is required." });
    expect(setDisabled(db, actor, pending, true, ctx).ok).toBe(false);
    expect((await resetPassword(db, actor, pending, ctx)).ok).toBe(false);
    expect(() => listUsers(db, actor)).toThrow();
    expect(() => listAudit(db, actor)).toThrow();
    expect(rolesOf(db, pending)).toEqual([]);
    expect(actions().filter((a) => a === "admin.denied")).toHaveLength(3);
  });

  it("refuses an unknown actor id without breaking the audit foreign key", async () => {
    expect(setRoles(db, "ghost", pending, ["admin"], ctx).ok).toBe(false);
    expect(db.prepare("SELECT actor_user_id FROM audit_log WHERE action = 'admin.denied'").get()).toEqual({ actor_user_id: null });
  });

  it("stops two admins who disable each other: the second finds its actor already disabled", () => {
    const b = user("b@example.com", ["admin"]);
    expect(setDisabled(db, admin, b, true, ctx)).toEqual({ ok: true });
    expect(setDisabled(db, b, admin, true, ctx)).toEqual({ ok: false, error: "Administrator access is required." });
    expect(isStillAdmin()).toBe(true);
  });

  function isStillAdmin(): boolean {
    return listUsers(db, admin).users.some((u) => u.id === admin && u.status === "active");
  }
});

describe("setDisabled", () => {
  it("disables a user, ends their sessions, blocks login, and can undo it", async () => {
    await register(db, { email: "member@example.com", password: "a long test passphrase 7" }, { ip: null, userAgent: null, now: T0 });
    const member = (db.prepare("SELECT id FROM users WHERE email = 'member@example.com'").get() as { id: string }).id;
    const { token } = createSession(db, member, {}, T0);

    expect(setDisabled(db, admin, member, true, ctx)).toEqual({ ok: true });
    expect(validateSession(db, token, T0)).toBeNull();
    expect(await login(db, { email: "member@example.com", password: "a long test passphrase 7" }, { ip: null, userAgent: null, now: T0 + 1 })).toMatchObject({ ok: false });

    expect(setDisabled(db, admin, member, false, ctx)).toEqual({ ok: true });
    expect((await login(db, { email: "member@example.com", password: "a long test passphrase 7" }, { ip: null, userAgent: null, now: T0 + 2 })).ok).toBe(true);
    expect(actions().filter((a) => a.startsWith("user."))).toEqual(["user.registered", "user.disabled", "user.enabled"]);
  });

  it("refuses to disable yourself", () => {
    expect(setDisabled(db, admin, admin, true, ctx)).toEqual({ ok: false, error: "You cannot disable your own account." });
  });

  it("is a no-op when the user is already in that state", () => {
    expect(setDisabled(db, admin, pending, false, ctx)).toEqual({ ok: true });
    expect(actions()).toEqual([]);
  });

  it("can disable another admin while one active admin remains", () => {
    const other = user("other@example.com", ["admin"]);
    expect(setDisabled(db, admin, other, true, ctx)).toEqual({ ok: true });
  });
});

describe("resetPassword", () => {
  it("sets a temporary password that works once, forces a change and ends the sessions", async () => {
    await register(db, { email: "member@example.com", password: "a long test passphrase 7" }, { ip: null, userAgent: null, now: T0 });
    const member = (db.prepare("SELECT id FROM users WHERE email = 'member@example.com'").get() as { id: string }).id;
    const { token } = createSession(db, member, {}, T0);

    const r = await resetPassword(db, admin, member, ctx);
    if (!r.ok) throw new Error(r.error);
    expect(r.temporaryPassword).toHaveLength(16);
    expect(validateSession(db, token, T0)).toBeNull();
    expect(await login(db, { email: "member@example.com", password: "a long test passphrase 7" }, { ip: null, userAgent: null, now: T0 + 1 })).toMatchObject({ ok: false });

    const again = await login(db, { email: "member@example.com", password: r.temporaryPassword }, { ip: null, userAgent: null, now: T0 + 2 });
    if (!again.ok) throw new Error("temporary password rejected");
    expect(validateSession(db, again.token, T0 + 2)?.mustChangePassword).toBe(true);
  });

  it("clears the login throttle so the temporary password is usable at once", async () => {
    const member = user("member@example.com", ["viewer"]);
    for (let i = 0; i < 6; i++) recordFailure(db, acctThrottleKey("member@example.com"), T0);
    recordFailure(db, `login:chpw:${member}`, T0);
    await resetPassword(db, admin, member, ctx);
    expect(db.prepare("SELECT COUNT(*) AS n FROM throttle").get()).toEqual({ n: 0 });
  });

  it("never touches MFA settings", async () => {
    const member = user("member@example.com", ["viewer"]);
    db.prepare("UPDATE users SET mfa_required = 1 WHERE id = ?").run(member);
    await resetPassword(db, admin, member, ctx);
    expect(db.prepare("SELECT mfa_required AS m FROM users WHERE id = ?").get(member)).toEqual({ m: 1 });
  });

  it("can reset another admin, but never your own", async () => {
    const other = user("other@example.com", ["admin"]);
    expect((await resetPassword(db, admin, other, ctx)).ok).toBe(true);
    expect(await resetPassword(db, admin, admin, ctx)).toEqual({ ok: false, error: "Use Change password for your own account." });
  });

  it("keeps the plaintext out of the audit log and the database", async () => {
    const member = user("member@example.com", ["viewer"]);
    const r = await resetPassword(db, admin, member, ctx);
    if (!r.ok) throw new Error(r.error);
    const dump = JSON.stringify(db.prepare("SELECT * FROM audit_log").all()) + JSON.stringify(db.prepare("SELECT * FROM users").all());
    expect(dump).not.toContain(r.temporaryPassword);
    expect(actions()).toContain("password.reset_by_admin");
  });

  it("reports an unknown user", async () => {
    expect(await resetPassword(db, admin, "no-such-id", ctx)).toEqual({ ok: false, error: "User not found." });
  });
});

describe("setMfaRequired", () => {
  it("sets and clears the flag, audits each change and ignores a repeat", () => {
    expect(setMfaRequired(db, admin, pending, true, ctx)).toEqual({ ok: true });
    expect(db.prepare("SELECT mfa_required AS m FROM users WHERE id = ?").get(pending)).toEqual({ m: 1 });
    setMfaRequired(db, admin, pending, true, ctx);
    expect(setMfaRequired(db, admin, pending, false, ctx)).toEqual({ ok: true });
    expect(actions()).toEqual(["mfa.required_set", "mfa.required_cleared"]);
  });

  it("is for admins only and reports an unknown user", () => {
    const viewer = user("viewer@example.com", ["viewer"]);
    expect(setMfaRequired(db, viewer, pending, true, ctx)).toEqual({ ok: false, error: "Administrator access is required." });
    expect(setMfaRequired(db, admin, "no-such-id", true, ctx)).toEqual({ ok: false, error: "User not found." });
  });

  it("shows in the user list", () => {
    setMfaRequired(db, admin, pending, true, ctx);
    const row = listUsers(db, admin).users.find((u) => u.id === pending)!;
    expect(row).toMatchObject({ mfaRequired: true, mfaEnabled: false });
  });
});

describe("resetMfa", () => {
  function withMfa(email: string, roles: Role[] = ["viewer"]): string {
    const id = user(email, roles);
    db.prepare("UPDATE users SET mfa_enabled_at = ?, mfa_secret_enc = 'v1.x.y.z' WHERE id = ?").run(T0, id);
    db.prepare("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, 'hash')").run(id);
    return id;
  }

  it("removes a user's MFA, ends their sessions and audits it", () => {
    const member = withMfa("member@example.com");
    const { token } = createSession(db, member, {}, T0);
    expect(resetMfa(db, admin, member, ctx)).toEqual({ ok: true });
    expect(db.prepare("SELECT mfa_enabled_at, mfa_secret_enc FROM users WHERE id = ?").get(member)).toEqual({ mfa_enabled_at: null, mfa_secret_enc: null });
    expect(db.prepare("SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ?").get(member)).toEqual({ n: 0 });
    expect(validateSession(db, token, T0)).toBeNull();
    expect(actions()).toContain("mfa.reset_by_admin");
  });

  it("will not touch an administrator's MFA, not even another admin's, nor your own", () => {
    const other = withMfa("other-admin@example.com", ["admin"]);
    expect(resetMfa(db, admin, other, ctx)).toEqual({ ok: false, error: expect.stringContaining("break-glass") });
    expect(resetMfa(db, admin, admin, ctx)).toEqual({ ok: false, error: "You cannot reset your own MFA here." });
    expect(db.prepare("SELECT mfa_enabled_at FROM users WHERE id = ?").get(other)).toEqual({ mfa_enabled_at: T0 });
  });

  it("does nothing for a user without MFA, refuses non-admins and reports unknown users", () => {
    expect(resetMfa(db, admin, pending, ctx)).toEqual({ ok: true });
    expect(actions()).toEqual([]);
    const viewer = user("viewer@example.com", ["viewer"]);
    expect(resetMfa(db, viewer, pending, ctx).ok).toBe(false);
    expect(resetMfa(db, admin, "no-such-id", ctx)).toEqual({ ok: false, error: "User not found." });
  });
});

describe("generateTemporaryPassword", () => {
  it("is 16 characters without look-alikes, passes the policy and differs each time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generateTemporaryPassword();
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);
      expect(checkPassword(p)).toBeNull();
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});

describe("listUsers", () => {
  it("lists pending first, then active, then disabled, with the pending count", () => {
    user("zed@example.com", ["viewer"]);
    user("gone@example.com", ["viewer"], { disabled: true });
    const { users, pending: n } = listUsers(db, admin);
    expect(users.map((u) => [u.email, u.status])).toEqual([
      ["pending@example.com", "pending"],
      ["admin@example.com", "active"],
      ["zed@example.com", "active"],
      ["gone@example.com", "disabled"],
    ]);
    expect(n).toBe(1);
    expect(users.find((u) => u.email === "admin@example.com")!.roles).toEqual(["admin"]);
  });

  it("never exposes password hashes", () => {
    expect(JSON.stringify(listUsers(db, admin))).not.toContain("password");
  });
});

describe("listAudit", () => {
  function fill(n: number): void {
    for (let i = 0; i < n; i++) db.prepare("INSERT INTO audit_log (at, action, actor_user_id, target_user_id) VALUES (?, ?, ?, ?)").run(T0 + i, i % 2 ? "login.success" : "logout", admin, pending);
  }

  it("returns newest first with actor and target emails", () => {
    fill(3);
    const { items } = listAudit(db, admin);
    expect(items.map((i) => i.id)).toEqual([3, 2, 1]);
    expect(items[0]).toMatchObject({ actor: "admin@example.com", target: "pending@example.com" });
  });

  it("pages with a keyset and reports where the next page starts", () => {
    fill(AUDIT_PAGE + 5);
    const first = listAudit(db, admin);
    expect(first.items).toHaveLength(AUDIT_PAGE);
    expect(first.next).toBe(first.items[AUDIT_PAGE - 1]!.id);
    const second = listAudit(db, admin, { before: first.next! });
    expect(second.items).toHaveLength(5);
    expect(second.next).toBeNull();
    expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(AUDIT_PAGE + 5);
  });

  it("copes with absurdly long filters", () => {
    fill(2);
    expect(listAudit(db, admin, { action: "x".repeat(100_000), user: "y".repeat(100_000) }).items).toEqual([]);
  });

  it("filters by action and by user, treating % and _ literally", () => {
    fill(6);
    expect(listAudit(db, admin, { action: "logout" }).items.every((i) => i.action === "logout")).toBe(true);
    expect(listAudit(db, admin, { user: "PENDING@" }).items).toHaveLength(6);
    expect(listAudit(db, admin, { user: "nobody" }).items).toHaveLength(0);
    expect(listAudit(db, admin, { user: "%" }).items).toHaveLength(0);
    expect(listAudit(db, admin, { user: "_dmin" }).items).toHaveLength(0);
    expect(listAudit(db, admin).actions).toEqual(["login.success", "logout"]);
  });
});
