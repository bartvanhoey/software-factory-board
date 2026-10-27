import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPassword as adminResetPassword, setDisabled } from "./admin";
import { resetPasswordByCli } from "./breakglass";
import { openDb } from "./db";
import { issueToken, peekToken } from "./email-tokens";
import type { Mail, Mailer } from "./mail";
import { hashParams } from "./password";
import { acctThrottleKey, changePassword, login, register } from "./service";
import { createSession, validateSession } from "./sessions";
import { recordFailure } from "./throttle";
import { createUser, grantRole } from "./users";
import { BUDGET_PER_HOUR, confirmEmail, INVALID_LINK, PER_ADDRESS_PER_HOUR, requestPasswordReset, resetPasswordWithToken, sendVerification, type MailEnv } from "./verification";

const prod = { ...hashParams };
beforeAll(() => Object.assign(hashParams, { N: 2 ** 10, r: 8, p: 1 }));
afterAll(() => Object.assign(hashParams, prod));

const T0 = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 3_600_000;
const APP = "https://board.example.com";
const PW = "a long test passphrase 7";
const NEW_PW = "a completely new passphrase";

let db: ReturnType<typeof openDb>;
let sent: Mail[];
let behaviour: "ok" | "fail" | "hang";

const mailer: Mailer = {
  send: (mail) => {
    if (behaviour === "hang") return new Promise<void>(() => {});
    if (behaviour === "fail") return Promise.reject(new Error("relay down"));
    sent.push(mail);
    return Promise.resolve();
  },
};
const env: MailEnv = { mailer, appUrl: APP };
const ctx = (now = T0, ip: string | null = null) => ({ ip, now });
const flush = () => new Promise<void>((r) => setImmediate(r));
const actions = () => (db.prepare("SELECT action FROM audit_log ORDER BY id").all() as { action: string }[]).map((r) => r.action);
const tokenIn = (mail: Mail): string => /token=([A-Za-z0-9_-]{43})/.exec(mail.text)![1]!;
const throttleRows = () => (db.prepare("SELECT COUNT(*) AS n FROM throttle").get() as { n: number }).n;

function user(email = "person@example.com"): string {
  return createUser(db, { email, passwordHash: "x" }, T0);
}

beforeEach(() => {
  db = openDb(":memory:");
  sent = [];
  behaviour = "ok";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sendVerification", () => {
  it("emails one plain-text message to the address with a link built only from APP_URL", async () => {
    const id = user();
    expect(await sendVerification(db, env, id, ctx())).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("person@example.com");
    expect(sent[0]!.text).toContain(`${APP}/verify?token=`);
    expect(sent[0]!.text).toContain("24 hours");
    expect(peekToken(db, tokenIn(sent[0]!), "verify", T0 + 1000)).toEqual({ userId: id });
    expect(actions()).toEqual(["email.verification_sent"]);
  });

  it("tells the reader that they must be logged in to the account, and what to do if it is not theirs", async () => {
    await sendVerification(db, env, user(), ctx());
    expect(sent[0]!.text).toContain("log in to that account");
    expect(sent[0]!.text).toContain("do not log in");
  });

  it("never puts the token anywhere but the email", async () => {
    await sendVerification(db, env, user(), ctx());
    const token = tokenIn(sent[0]!);
    expect(JSON.stringify(db.prepare("SELECT * FROM audit_log").all()) + JSON.stringify(db.prepare("SELECT * FROM email_tokens").all())).not.toContain(token);
  });

  it("allows one request a minute and five an hour per user, and a newer link replaces the older", async () => {
    const id = user();
    expect((await sendVerification(db, env, id, ctx(T0))).ok).toBe(true);
    expect(await sendVerification(db, env, id, ctx(T0 + 30_000))).toEqual({ ok: false, error: "Please wait a while before asking for another email." });
    expect(sent).toHaveLength(1);
    for (let i = 1; i < PER_ADDRESS_PER_HOUR; i++) expect((await sendVerification(db, env, id, ctx(T0 + i * 61_000))).ok).toBe(true);
    expect((await sendVerification(db, env, id, ctx(T0 + 6 * 61_000))).ok).toBe(false); // the sixth within the hour
    expect(sent).toHaveLength(PER_ADDRESS_PER_HOUR);
    expect(peekToken(db, tokenIn(sent[0]!), "verify", T0 + 10 * MIN)).toBeNull(); // an older link no longer works
    expect(peekToken(db, tokenIn(sent.at(-1)!), "verify", T0 + 10 * MIN)).not.toBeNull();
    expect((await sendVerification(db, env, id, ctx(T0 + HOUR + 2 * MIN))).ok).toBe(true); // a new hour
  });

  it("keeps the earlier link working when the new one could not be sent, and records no 'sent'", async () => {
    const id = user();
    await sendVerification(db, env, id, ctx(T0));
    const earlier = tokenIn(sent[0]!);
    behaviour = "fail";
    expect((await sendVerification(db, env, id, ctx(T0 + 2 * MIN))).ok).toBe(false);
    expect(peekToken(db, earlier, "verify", T0 + 3 * MIN)).toEqual({ userId: id }); // not lost
    expect(db.prepare("SELECT COUNT(*) AS n FROM email_tokens").get()).toEqual({ n: 1 }); // the unsent one was dropped
    expect(actions()).toEqual(["email.verification_sent", "email.send_failed"]); // one real send, one failure; nothing 'sent' for the failed one
  });

  it("limits per IP too, when the IP is known", async () => {
    for (let i = 0; i < 10; i++) expect((await sendVerification(db, env, user(`u${i}@example.com`), ctx(T0 + i, "9.9.9.9"))).ok).toBe(true);
    expect((await sendVerification(db, env, user("late@example.com"), ctx(T0 + 100, "9.9.9.9"))).ok).toBe(false);
    expect((await sendVerification(db, env, user("other@example.com"), ctx(T0 + 100, "8.8.8.8"))).ok).toBe(true);
  });

  it("refuses an address that is already confirmed, a disabled account and an unknown user, sending nothing", async () => {
    const done = user("done@example.com");
    db.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(T0, done);
    const off = user("off@example.com");
    db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(T0, off);
    expect(await sendVerification(db, env, done, ctx())).toEqual({ ok: false, error: "This address is already confirmed." });
    expect((await sendVerification(db, env, off, ctx())).ok).toBe(false);
    expect((await sendVerification(db, env, "ghost", ctx())).ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it("tells the user when the relay failed, without any detail, and records it", async () => {
    behaviour = "fail";
    const r = await sendVerification(db, env, user(), ctx());
    expect(r).toEqual({ ok: false, error: "We could not send the email. Try again in a little while, or ask an administrator." });
    expect(actions()).toEqual(["email.send_failed"]);
    expect(console.error).toHaveBeenCalledWith("[mail] verify email failed: relay down");
  });

  it("logs the error code when the message is empty (a refused connection)", async () => {
    const refused = Object.assign(new Error(""), { code: "ESOCKET" });
    await sendVerification(db, { ...env, mailer: { send: () => Promise.reject(refused) } }, user(), ctx());
    expect(console.error).toHaveBeenCalledWith("[mail] verify email failed: ESOCKET");
  });

  it("blanks out an address that the relay echoed back in its error, so it never reaches the log", async () => {
    const echo = new Error('550 5.1.1 <person@example.com>: Recipient address rejected, and also person@example.com again');
    await sendVerification(db, { ...env, mailer: { send: () => Promise.reject(echo) } }, user(), ctx());
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).not.toContain("person@example.com");
    expect(logged).toContain("<address>");
  });
});

describe("the mail budgets", () => {
  it("stop sending at the hourly budget and say the service is busy, not 'wait a minute'", async () => {
    for (let i = 0; i < BUDGET_PER_HOUR; i++) expect((await sendVerification(db, env, user(`u${i}@example.com`), ctx(T0 + i))).ok).toBe(true);
    expect(await sendVerification(db, env, user("one-more@example.com"), ctx(T0 + 100))).toEqual({ ok: false, error: "Email is very busy right now. Try again in a little while." });
    expect(sent).toHaveLength(BUDGET_PER_HOUR);
  });

  it("are separate: using up the forgot-password budget does not stop registrations and resends, and the reverse", async () => {
    for (let i = 0; i < BUDGET_PER_HOUR; i++) user(`r${i}@example.com`);
    for (let i = 0; i < BUDGET_PER_HOUR + 5; i++) requestPasswordReset(db, env, `r${i % BUDGET_PER_HOUR}@example.com`, ctx(T0 + i * 5));
    requestPasswordReset(db, env, "r0@example.com", ctx(T0 + 3 * MIN)); // r0 again, a new minute
    await flush();
    const resetsSent = sent.length;
    expect(resetsSent).toBeLessThanOrEqual(BUDGET_PER_HOUR);
    expect(resetsSent).toBeGreaterThanOrEqual(BUDGET_PER_HOUR - 1);
    expect((await sendVerification(db, env, user("fresh@example.com"), ctx(T0 + 4 * MIN))).ok).toBe(true); // verification budget untouched
  });

  it("are not spent by a request that is refused for coming too often", async () => {
    const id = user();
    await sendVerification(db, env, id, ctx(T0));
    const used = () => (db.prepare("SELECT count FROM throttle WHERE key = 'mail:budget:verify'").get() as { count: number }).count;
    expect(used()).toBe(1);
    for (let i = 1; i <= 10; i++) await sendVerification(db, env, id, ctx(T0 + i * 1000)); // all within the minute
    expect(used()).toBe(1);
  });
});

describe("confirmEmail", () => {
  async function link(): Promise<{ id: string; token: string }> {
    const id = user();
    await sendVerification(db, env, id, ctx(T0));
    return { id, token: tokenIn(sent[0]!) };
  }

  it("confirms the address, once, for the user who is logged in as that account, and audits it", async () => {
    const { id, token } = await link();
    expect(confirmEmail(db, token, id, ctx(T0 + 1000))).toEqual({ ok: true });
    expect((db.prepare("SELECT email_verified_at FROM users WHERE id = ?").get(id) as { email_verified_at: number }).email_verified_at).toBe(T0 + 1000);
    expect(confirmEmail(db, token, id, ctx(T0 + 2000))).toEqual({ ok: false, error: INVALID_LINK });
    expect(actions()).toContain("email.verified");
  });

  it("does nothing for anyone else: a squatter's account is not confirmed because the real owner clicked the link", async () => {
    const { id, token } = await link(); // the link was mailed to the address of account `id` (the squatter's registration)
    const owner = user("owner@example.com"); // whoever is clicking is some other user, or nobody who is logged in as `id`
    expect(confirmEmail(db, token, owner, ctx(T0 + 1000))).toEqual({ ok: false, error: INVALID_LINK });
    expect(confirmEmail(db, token, "no-session", ctx(T0 + 1000))).toEqual({ ok: false, error: INVALID_LINK });
    expect((db.prepare("SELECT email_verified_at FROM users WHERE id = ?").get(id) as { email_verified_at: number | null }).email_verified_at).toBeNull();
    // and the failed attempts did not use the link up: the account's own login can still confirm
    expect(confirmEmail(db, token, id, ctx(T0 + 2000))).toEqual({ ok: true });
  });

  it("does not create a session: a link proves the inbox, not who is holding it", async () => {
    const { id, token } = await link();
    confirmEmail(db, token, id, ctx(T0 + 1000));
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  it("refuses an expired link, a reset link, garbage and nothing", async () => {
    const { id, token } = await link();
    expect(confirmEmail(db, token, id, ctx(T0 + 24 * HOUR))).toEqual({ ok: false, error: INVALID_LINK });
    const other = user("b@example.com");
    const resetToken = issueToken(db, other, "reset", T0);
    expect(confirmEmail(db, resetToken, other, ctx(T0 + 1000))).toEqual({ ok: false, error: INVALID_LINK });
    for (const bad of ["", "nope", "x".repeat(43)]) expect(confirmEmail(db, bad, id, ctx())).toEqual({ ok: false, error: INVALID_LINK });
  });
});

describe("requestPasswordReset", () => {
  it("emails a reset link, valid for an hour, to a real account", async () => {
    const id = user();
    requestPasswordReset(db, env, "Person@Example.com", ctx());
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("person@example.com");
    expect(sent[0]!.text).toContain(`${APP}/reset-password?token=`);
    expect(sent[0]!.text).toContain("1 hour");
    expect(peekToken(db, tokenIn(sent[0]!), "reset", T0 + 59 * MIN)).toEqual({ userId: id });
    expect(peekToken(db, tokenIn(sent[0]!), "reset", T0 + HOUR)).toBeNull();
    expect(actions()).toEqual(["password.reset_requested"]);
  });

  it("returns at once and does nothing that depends on the account until after it has returned", async () => {
    user();
    expect(requestPasswordReset(db, env, "person@example.com", ctx())).toBeUndefined();
    // nothing has happened yet: no lookup-dependent work, so the call takes the same time for any address
    expect(db.prepare("SELECT COUNT(*) AS n FROM email_tokens").get()).toEqual({ n: 0 });
    expect(actions()).toEqual([]);
    await flush();
    expect(db.prepare("SELECT COUNT(*) AS n FROM email_tokens").get()).toEqual({ n: 1 });
  });

  it("does not wait for the relay either", async () => {
    behaviour = "hang";
    user();
    requestPasswordReset(db, env, "person@example.com", ctx());
    await flush(); // completes even though the relay never answers
    expect(actions()).toEqual(["password.reset_requested"]);
  });

  it("does nothing, records nothing and uses no limit rows or budget for an unknown, disabled or malformed address", async () => {
    const off = user("off@example.com");
    db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(T0, off);
    for (let i = 0; i < 100; i++) requestPasswordReset(db, env, `stranger${i}@example.com`, ctx(T0 + i));
    for (const email of ["off@example.com", "not an email", ""]) requestPasswordReset(db, env, email, ctx());
    await flush();
    expect(sent).toEqual([]);
    expect(actions()).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM email_tokens").get()).toEqual({ n: 0 });
    expect(throttleRows()).toBe(0); // strangers' input cannot grow the table or spend the shared budget
  });

  it("is rate-limited per address, silently", async () => {
    user();
    requestPasswordReset(db, env, "person@example.com", ctx(T0));
    requestPasswordReset(db, env, "person@example.com", ctx(T0 + 10_000)); // within a minute
    await flush();
    expect(sent).toHaveLength(1);
    for (let i = 1; i < PER_ADDRESS_PER_HOUR; i++) requestPasswordReset(db, env, "person@example.com", ctx(T0 + i * 61_000));
    requestPasswordReset(db, env, "person@example.com", ctx(T0 + 6 * 61_000)); // the sixth within the hour
    await flush();
    expect(sent).toHaveLength(PER_ADDRESS_PER_HOUR);
  });

  it("replaces the earlier reset link with the newer one", async () => {
    user();
    requestPasswordReset(db, env, "person@example.com", ctx(T0));
    requestPasswordReset(db, env, "person@example.com", ctx(T0 + 2 * MIN));
    await flush();
    expect(sent).toHaveLength(2);
    expect(peekToken(db, tokenIn(sent[0]!), "reset", T0 + 3 * MIN)).toBeNull();
    expect(peekToken(db, tokenIn(sent[1]!), "reset", T0 + 3 * MIN)).not.toBeNull();
  });

  it("survives a failing relay: no error reaches the caller, and the failure is recorded for the real account", async () => {
    behaviour = "fail";
    user();
    expect(() => requestPasswordReset(db, env, "person@example.com", ctx())).not.toThrow();
    await flush();
    expect(actions()).toEqual(["password.reset_requested", "email.send_failed"]);
  });

  it("survives a database error in the deferred work without crashing the process", async () => {
    user();
    const broken = { ...db, prepare: () => { throw new Error("database is closed"); } } as unknown as typeof db;
    expect(() => requestPasswordReset(broken, env, "person@example.com", ctx())).not.toThrow();
    await flush();
    expect(console.error).toHaveBeenCalledWith("[mail] reset request failed: database is closed");
  });
});

describe("resetPasswordWithToken", () => {
  async function requested(email = "person@example.com"): Promise<{ id: string; token: string }> {
    const reg = await register(db, { email, password: PW }, { ip: null, userAgent: null, now: T0 });
    if (!reg.ok) throw new Error(reg.error);
    const id = (db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string }).id;
    requestPasswordReset(db, env, email, ctx(T0 + 1000));
    await flush();
    return { id, token: tokenIn(sent.at(-1)!) };
  }

  it("sets the new password, so the old one stops working and the new one logs in", async () => {
    const { token } = await requested();
    expect(await resetPasswordWithToken(db, token, NEW_PW, ctx(T0 + 2000))).toEqual({ ok: true });
    const at = { ip: null, userAgent: null, now: T0 + 3000 };
    expect((await login(db, { email: "person@example.com", password: PW }, at)).ok).toBe(false);
    expect((await login(db, { email: "person@example.com", password: NEW_PW }, { ...at, now: T0 + 4000 })).ok).toBe(true);
    expect(actions()).toContain("password.reset_by_email");
  });

  it("ends every session, clears a forced change, and counts as proof of the inbox", async () => {
    const { id, token } = await requested();
    const s = createSession(db, id, {}, T0 + 1500).token;
    db.prepare("UPDATE users SET must_change_password = 1").run();
    await resetPasswordWithToken(db, token, NEW_PW, ctx(T0 + 2000));
    expect(validateSession(db, s, T0 + 2000)).toBeNull();
    expect(db.prepare("SELECT must_change_password AS m, email_verified_at AS v FROM users WHERE id = ?").get(id)).toEqual({ m: 0, v: T0 + 2000 });
  });

  it("does not touch MFA: the next login still asks for a code", async () => {
    const { id, token } = await requested();
    db.prepare("UPDATE users SET mfa_enabled_at = ?, mfa_secret_enc = 'v1.x.y.z' WHERE id = ?").run(T0, id);
    await resetPasswordWithToken(db, token, NEW_PW, ctx(T0 + 2000));
    const l = await login(db, { email: "person@example.com", password: NEW_PW }, { ip: null, userAgent: null, now: T0 + 3000 });
    if (!l.ok) throw new Error("setup");
    expect(validateSession(db, l.token, T0 + 3000)!.mfaPending).toBe(true);
    expect((db.prepare("SELECT mfa_enabled_at FROM users WHERE id = ?").get(id) as { mfa_enabled_at: number }).mfa_enabled_at).toBe(T0);
  });

  it("clears login delays so the first login with the new password is not held up", async () => {
    const { id, token } = await requested();
    for (let i = 0; i < 8; i++) recordFailure(db, acctThrottleKey("person@example.com"), T0);
    recordFailure(db, `login:chpw:${id}`, T0);
    await resetPasswordWithToken(db, token, NEW_PW, ctx(T0 + 2000));
    expect(db.prepare("SELECT COUNT(*) AS n FROM throttle WHERE key LIKE 'login:%'").get()).toEqual({ n: 0 });
  });

  it("works once only, and voids the user's other links, reset and verify", async () => {
    const { id, token } = await requested();
    const verify = issueToken(db, id, "verify", T0 + 1500);
    expect(await resetPasswordWithToken(db, token, NEW_PW, ctx(T0 + 2000))).toEqual({ ok: true });
    expect(await resetPasswordWithToken(db, token, "another new passphrase!!", ctx(T0 + 3000))).toEqual({ ok: false, error: INVALID_LINK });
    expect(peekToken(db, verify, "verify", T0 + 3000)).toBeNull();
  });

  it("refuses a weak password WITHOUT using the link up, so the user can try again", async () => {
    const { token } = await requested();
    expect(await resetPasswordWithToken(db, token, "short", ctx(T0 + 2000))).toEqual({ ok: false, error: expect.stringContaining("at least 12") });
    expect(await resetPasswordWithToken(db, token, "passwordpassword", ctx(T0 + 2000))).toMatchObject({ ok: false });
    expect(await resetPasswordWithToken(db, token, NEW_PW, ctx(T0 + 3000))).toEqual({ ok: true });
  });

  it("refuses an expired link, a verify link, a made-up one and a disabled account, all with the same message", async () => {
    const { id, token } = await requested();
    expect(await resetPasswordWithToken(db, token, NEW_PW, ctx(T0 + 2 * HOUR))).toEqual({ ok: false, error: INVALID_LINK });
    const verify = issueToken(db, id, "verify", T0);
    expect(await resetPasswordWithToken(db, verify, NEW_PW, ctx(T0 + 1000))).toEqual({ ok: false, error: INVALID_LINK });
    expect(await resetPasswordWithToken(db, "x".repeat(43), NEW_PW, ctx())).toEqual({ ok: false, error: INVALID_LINK });
    const fresh = issueToken(db, id, "reset", T0 + 3 * HOUR);
    db.prepare("UPDATE users SET disabled_at = ?").run(T0);
    expect(await resetPasswordWithToken(db, fresh, NEW_PW, ctx(T0 + 3 * HOUR))).toEqual({ ok: false, error: INVALID_LINK });
  });

  it("changes nothing when it fails", async () => {
    const { id } = await requested();
    const before = (db.prepare("SELECT password_hash FROM users WHERE id = ?").get(id) as { password_hash: string }).password_hash;
    await resetPasswordWithToken(db, "x".repeat(43), NEW_PW, ctx());
    expect((db.prepare("SELECT password_hash FROM users WHERE id = ?").get(id) as { password_hash: string }).password_hash).toBe(before);
  });
});

describe("a reset link does not outlive a password change, by any route", () => {
  async function withLink(): Promise<{ id: string; token: string; session: string }> {
    const reg = await register(db, { email: "person@example.com", password: PW }, { ip: null, userAgent: null, now: T0 });
    if (!reg.ok) throw new Error(reg.error);
    const id = (db.prepare("SELECT id FROM users WHERE email = 'person@example.com'").get() as { id: string }).id;
    requestPasswordReset(db, env, "person@example.com", ctx(T0 + 1000));
    await flush();
    return { id, token: tokenIn(sent.at(-1)!), session: reg.token };
  }
  const live = (token: string) => peekToken(db, token, "reset", T0 + 2000) !== null;

  it("changing it yourself", async () => {
    const { token, session } = await withLink();
    expect(live(token)).toBe(true);
    expect(await changePassword(db, session, { current: PW, next: NEW_PW }, { ip: null, userAgent: null, now: T0 + 1500 })).toEqual({ ok: true });
    expect(live(token)).toBe(false);
  });

  it("an admin resetting it", async () => {
    const { token } = await withLink();
    const admin = createUser(db, { email: "admin@example.com", passwordHash: "x" }, T0);
    grantRole(db, admin, "admin", null, T0);
    const target = (db.prepare("SELECT id FROM users WHERE email = 'person@example.com'").get() as { id: string }).id;
    expect((await adminResetPassword(db, admin, target, ctx(T0 + 1500))).ok).toBe(true);
    expect(live(token)).toBe(false);
  });

  it("the break-glass command resetting it", async () => {
    const { token } = await withLink();
    expect((await resetPasswordByCli(db, { email: "person@example.com", reason: "incident" }, T0 + 1500)).ok).toBe(true);
    expect(live(token)).toBe(false);
  });

  it("a second reset by email", async () => {
    const { token } = await withLink();
    requestPasswordReset(db, env, "person@example.com", ctx(T0 + 2 * MIN));
    await flush();
    expect(live(token)).toBe(false); // the newer link replaced it
    expect(await resetPasswordWithToken(db, tokenIn(sent.at(-1)!), NEW_PW, ctx(T0 + 3 * MIN))).toEqual({ ok: true });
  });

  it("disabling the account ends every unused link, of both kinds, even if it is enabled again", async () => {
    const { id, token } = await withLink();
    const verify = issueToken(db, id, "verify", T0 + 1100);
    const admin = createUser(db, { email: "admin@example.com", passwordHash: "x" }, T0);
    grantRole(db, admin, "admin", null, T0);
    expect(setDisabled(db, admin, id, true, ctx(T0 + 1500))).toEqual({ ok: true });
    expect(setDisabled(db, admin, id, false, ctx(T0 + 1600))).toEqual({ ok: true });
    expect(live(token)).toBe(false);
    expect(peekToken(db, verify, "verify", T0 + 2000)).toBeNull();
  });

  it("but a verification link survives a password change (only the reset link is tied to the password)", async () => {
    const { id } = await withLink();
    const verify = issueToken(db, id, "verify", T0 + 1100);
    db.prepare("UPDATE users SET password_hash = 'scrypt$1024$8$1$aa$bb' WHERE id = ?").run(id);
    expect(peekToken(db, verify, "verify", T0 + 2000)).toEqual({ userId: id });
  });
});
