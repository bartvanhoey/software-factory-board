import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db";
import { clearMfa, completeLogin, confirmSetup, pendingSetup, proveFactor, recoveryCodesLeft, regenerateRecoveryCodes, SETUP_LIFETIME, startReenrolment, type MfaCtx } from "./mfa";
import { decryptSecret } from "./mfa-crypto";
import { createSession, validateSession } from "./sessions";
import { stepOf, totp } from "./totp";
import { createUser } from "./users";

const KEY = randomBytes(32);
const T0 = 1_700_000_010_000; // a multiple of 30 s, so the steps below are exact
const STEP = 30_000;

let db: ReturnType<typeof openDb>;
let user: string;
const ctx = (now = T0): MfaCtx => ({ ip: null, now });

const actions = () => (db.prepare("SELECT action FROM audit_log ORDER BY id").all() as { action: string }[]).map((r) => r.action);
const secretOf = (table: "users" | "mfa_setup", id = user): Buffer => {
  const col = table === "users" ? "mfa_secret_enc" : "secret_enc";
  const key = table === "users" ? "id" : "user_id";
  const row = db.prepare(`SELECT ${col} AS s FROM ${table} WHERE ${key} = ?`).get(id) as { s: string };
  return decryptSecret(KEY, row.s, id);
};

/** A fresh session of the user, as the `{ tokenHash, userId }` the MFA functions take. */
function sessionOf(now = T0, forUser = user): { token: string; tokenHash: string; userId: string } {
  const { token } = createSession(db, forUser, {}, now);
  return { token, tokenHash: validateSession(db, token, now)!.tokenHash, userId: forUser };
}

/** Runs the real first enrolment and returns what a user would end up holding. */
function enrol(now = T0): { secret: Buffer; codes: string[]; token: string; session: { tokenHash: string; userId: string } } {
  const s = sessionOf(now);
  pendingSetup(db, KEY, user, s.tokenHash, now);
  const secret = secretOf("mfa_setup");
  const result = confirmSetup(db, KEY, s, totp(secret, now), ctx(now));
  if (!result.ok) throw new Error(result.error);
  return { secret, codes: result.recoveryCodes, token: s.token, session: s };
}

beforeEach(() => {
  db = openDb(":memory:");
  user = createUser(db, { email: "person@example.com", passwordHash: "x" }, T0);
});

describe("pendingSetup", () => {
  it("creates a secret for a user with no MFA, and shows the same one on reload", () => {
    const s = sessionOf();
    const a = pendingSetup(db, KEY, user, s.tokenHash, T0)!;
    expect(pendingSetup(db, KEY, user, s.tokenHash, T0 + 60_000)).toEqual(a);
    expect(a.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(new URL(a.uri).searchParams.get("secret")).toBe(a.secret);
    expect(decodeURIComponent(a.uri)).toContain("person@example.com");
  });

  it("makes a new secret once the old one has waited too long", () => {
    const s = sessionOf();
    const a = pendingSetup(db, KEY, user, s.tokenHash, T0)!;
    expect(pendingSetup(db, KEY, user, s.tokenHash, T0 + SETUP_LIFETIME)!.secret).not.toBe(a.secret);
  });

  it("stores the secret encrypted, never as it is shown", () => {
    const view = pendingSetup(db, KEY, user, sessionOf().tokenHash, T0)!;
    expect(JSON.stringify(db.prepare("SELECT * FROM mfa_setup").all())).not.toContain(view.secret);
  });

  it("gives nothing to a user who already has MFA until they have proven a code", () => {
    const { session } = enrol();
    expect(pendingSetup(db, KEY, user, session.tokenHash, T0 + STEP)).toBeNull();
  });

  it("returns null for an unknown user", () => {
    expect(pendingSetup(db, KEY, "ghost", "hash", T0)).toBeNull();
  });

  it("never shows one session the secret another session of the same user is setting up", () => {
    const a = sessionOf();
    const b = sessionOf();
    const seenByA = pendingSetup(db, KEY, user, a.tokenHash, T0)!;
    const seenByB = pendingSetup(db, KEY, user, b.tokenHash, T0)!; // replaces A's secret; it does not reveal it
    expect(seenByB.secret).not.toBe(seenByA.secret);
    // A, with the secret it saw, can no longer confirm anything
    expect(confirmSetup(db, KEY, a, totp(decryptSecretOf(seenByA.secret), T0), ctx())).toMatchObject({ ok: false, error: expect.stringContaining("expired") });
    expect(confirmSetup(db, KEY, b, totp(decryptSecretOf(seenByB.secret), T0), ctx() ).ok).toBe(true);
  });

  function decryptSecretOf(base32Secret: string): Buffer {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let value = 0;
    const out: number[] = [];
    for (const ch of base32Secret) {
      value = (value << 5) | alphabet.indexOf(ch);
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    return Buffer.from(out);
  }
});

describe("confirmSetup", () => {
  it("turns MFA on with a correct code, returns ten recovery codes and audits it", () => {
    const { codes } = enrol();
    expect(codes).toHaveLength(10);
    const row = db.prepare("SELECT mfa_enabled_at, mfa_last_step, mfa_secret_enc FROM users WHERE id = ?").get(user) as { mfa_enabled_at: number; mfa_last_step: number; mfa_secret_enc: string };
    expect(row.mfa_enabled_at).toBe(T0);
    expect(row.mfa_last_step).toBe(stepOf(T0));
    expect(row.mfa_secret_enc.startsWith("v1.")).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM mfa_setup").get()).toEqual({ n: 0 });
    expect(actions()).toEqual(["mfa.enabled"]);
  });

  it("stores recovery codes only as hashes", () => {
    const { codes } = enrol();
    const dump = JSON.stringify(db.prepare("SELECT * FROM recovery_codes").all());
    for (const c of codes) expect(dump).not.toContain(c.replace(/-/g, ""));
    expect(recoveryCodesLeft(db, user)).toBe(10);
  });

  it("refuses a wrong code and leaves MFA off", () => {
    const s = sessionOf();
    pendingSetup(db, KEY, user, s.tokenHash, T0);
    const r = confirmSetup(db, KEY, s, "000000", ctx());
    expect(r).toEqual({ ok: false, error: "That code is not valid." });
    expect((db.prepare("SELECT mfa_enabled_at FROM users WHERE id = ?").get(user) as { mfa_enabled_at: number | null }).mfa_enabled_at).toBeNull();
    expect(actions()).toEqual(["mfa.failed"]);
  });

  it("refuses an expired setup, and a missing one", () => {
    const s = sessionOf();
    expect(confirmSetup(db, KEY, s, "123456", ctx())).toMatchObject({ ok: false, error: expect.stringContaining("expired") });
    pendingSetup(db, KEY, user, s.tokenHash, T0);
    const late = T0 + SETUP_LIFETIME;
    expect(confirmSetup(db, KEY, s, totp(secretOf("mfa_setup"), late), ctx(late))).toMatchObject({ ok: false, error: expect.stringContaining("expired") });
  });

  it("ends every other session of the user and keeps the one that enrolled", () => {
    const other = createSession(db, user, {}, T0).token;
    const { token } = enrol();
    expect(validateSession(db, other, T0)).toBeNull();
    expect(validateSession(db, token, T0)).not.toBeNull();
  });

  it("throttles guesses at the setup code", () => {
    const s = sessionOf();
    pendingSetup(db, KEY, user, s.tokenHash, T0);
    for (let i = 0; i < 5; i++) confirmSetup(db, KEY, s, "000000", ctx());
    expect(confirmSetup(db, KEY, s, totp(secretOf("mfa_setup"), T0), ctx())).toMatchObject({ ok: false, error: expect.stringContaining("Too many attempts") });
  });

  it("never lowers the step counter", () => {
    const first = enrol();
    const later = T0 + 2 * STEP;
    startReenrolment(db, KEY, first.session, totp(first.secret, later), ctx(later));
    const high = stepOf(T0 + 50 * STEP); // a later code was accepted in the meantime
    db.prepare("UPDATE users SET mfa_last_step = ? WHERE id = ?").run(high, user);
    expect(confirmSetup(db, KEY, first.session, totp(secretOf("mfa_setup"), later), ctx(later)).ok).toBe(true); // an earlier step
    expect((db.prepare("SELECT mfa_last_step AS s FROM users WHERE id = ?").get(user) as { s: number }).s).toBe(high);
  });
});

describe("re-enrolment", () => {
  it("needs a current code, swaps the secret only after the new one is confirmed, and voids the old codes", () => {
    const first = enrol();
    const later = T0 + 2 * STEP;
    expect(startReenrolment(db, KEY, first.session, "000000", ctx(later))).toMatchObject({ ok: false });
    expect(startReenrolment(db, KEY, first.session, totp(first.secret, later), ctx(later))).toEqual({ ok: true });

    // until the new secret is confirmed, the old one is still the live one
    expect(secretOf("users").equals(first.secret)).toBe(true);

    const fresh = secretOf("mfa_setup");
    const evenLater = later + 2 * STEP;
    const done = confirmSetup(db, KEY, first.session, totp(fresh, evenLater), ctx(evenLater));
    if (!done.ok) throw new Error(done.error);
    expect(actions()).toEqual(["mfa.enabled", "mfa.failed", "mfa.reenrolled"]); // the failure is the wrong code tried above
    expect(secretOf("users").equals(fresh)).toBe(true);

    const much = evenLater + 2 * STEP;
    expect(proveFactor(db, KEY, user, totp(first.secret, much), ctx(much))).toMatchObject({ ok: false });
    expect(proveFactor(db, KEY, user, first.codes[0]!, ctx(much))).toMatchObject({ ok: false });
    expect(proveFactor(db, KEY, user, done.recoveryCodes[0]!, ctx(much))).toMatchObject({ ok: true });
  });

  it("a failed re-enrolment leaves the old authenticator working", () => {
    const first = enrol();
    const later = T0 + 2 * STEP;
    startReenrolment(db, KEY, first.session, totp(first.secret, later), ctx(later));
    confirmSetup(db, KEY, first.session, "000000", ctx(later));
    const much = later + 2 * STEP;
    expect(proveFactor(db, KEY, user, totp(first.secret, much), ctx(much))).toMatchObject({ ok: true });
  });

  it("belongs to the session that proved the code: a second session of the user can neither read nor confirm it", () => {
    const first = enrol();
    const later = T0 + 2 * STEP;
    startReenrolment(db, KEY, first.session, totp(first.secret, later), ctx(later));
    const fresh = secretOf("mfa_setup");

    const other = sessionOf(later); // another session of the same user, even a fully logged-in one
    expect(pendingSetup(db, KEY, user, other.tokenHash, later)).toBeNull();
    const evenLater = later + 2 * STEP;
    expect(confirmSetup(db, KEY, other, totp(fresh, evenLater), ctx(evenLater))).toMatchObject({ ok: false, error: expect.stringContaining("expired") });
    expect(secretOf("users").equals(first.secret)).toBe(true);
  });
});

describe("proveFactor", () => {
  it("accepts a current code", () => {
    const { secret } = enrol();
    expect(proveFactor(db, KEY, user, totp(secret, T0 + STEP), ctx(T0 + STEP))).toEqual({ ok: true, via: "totp" });
  });

  it("accepts a code with a space in the middle", () => {
    const { secret } = enrol();
    const code = totp(secret, T0 + STEP);
    expect(proveFactor(db, KEY, user, `${code.slice(0, 3)} ${code.slice(3)}`, ctx(T0 + STEP)).ok).toBe(true);
  });

  it("rejects a code that was already used, even within its 30 seconds", () => {
    const { secret } = enrol();
    const now = T0 + STEP;
    expect(proveFactor(db, KEY, user, totp(secret, now), ctx(now)).ok).toBe(true);
    expect(proveFactor(db, KEY, user, totp(secret, now), ctx(now))).toEqual({ ok: false, error: "That code was already used. Wait for the next one from your app." });
  });

  it("never goes back: once a later step was used, an earlier one is refused", () => {
    const { secret } = enrol();
    const now = T0 + 3 * STEP;
    expect(proveFactor(db, KEY, user, totp(secret, now + STEP), ctx(now)).ok).toBe(true); // clock drift: next step's code
    expect(proveFactor(db, KEY, user, totp(secret, now), ctx(now)).ok).toBe(false);
  });

  it("accepts the next code after one was used", () => {
    const { secret } = enrol();
    expect(proveFactor(db, KEY, user, totp(secret, T0 + STEP), ctx(T0 + STEP)).ok).toBe(true);
    expect(proveFactor(db, KEY, user, totp(secret, T0 + 2 * STEP), ctx(T0 + 2 * STEP)).ok).toBe(true);
  });

  it("rejects wrong codes with one message, and audits only the failure", () => {
    enrol();
    for (const bad of ["000000", "12345", "abcdefg", "", "ABCD-EFGH-JKMN"]) {
      expect(proveFactor(db, KEY, user, bad, ctx(T0 + STEP))).toEqual({ ok: false, error: "That code is not valid." });
    }
    expect(actions().filter((a) => a === "mfa.failed")).toHaveLength(5);
  });

  it("blocks after five failures with a delay, not a lock, and a success only takes back its own attempt", () => {
    const { secret } = enrol();
    for (let i = 0; i < 4; i++) proveFactor(db, KEY, user, "000000", ctx(T0 + STEP));
    expect(proveFactor(db, KEY, user, totp(secret, T0 + STEP), ctx(T0 + STEP)).ok).toBe(true); // the 5th attempt is still allowed
    // the four failures are still on the books: one more is allowed, the one after is delayed
    expect(proveFactor(db, KEY, user, "000000", ctx(T0 + 2 * STEP)).ok).toBe(false);
    expect(proveFactor(db, KEY, user, totp(secret, T0 + 2 * STEP), ctx(T0 + 2 * STEP))).toMatchObject({ ok: false, error: expect.stringContaining("Too many attempts") });
    expect(proveFactor(db, KEY, user, totp(secret, T0 + 40 * STEP), ctx(T0 + 40 * STEP)).ok).toBe(true); // 20 min later
  });

  it("does not let a legitimate login wipe the failures an attacker has piled up", () => {
    const { secret } = enrol();
    for (let i = 0; i < 4; i++) proveFactor(db, KEY, user, "000000", ctx(T0 + STEP)); // someone guessing
    expect(proveFactor(db, KEY, user, totp(secret, T0 + STEP), ctx(T0 + STEP)).ok).toBe(true); // the user logs in
    const row = db.prepare("SELECT count FROM throttle WHERE key = ?").get(`mfa:${user}`) as { count: number };
    expect(row.count).toBe(4);
  });

  it("counts recovery-code guesses and code guesses together", () => {
    enrol();
    for (let i = 0; i < 3; i++) proveFactor(db, KEY, user, "000000", ctx());
    for (let i = 0; i < 2; i++) proveFactor(db, KEY, user, "AAAA-AAAA-AAAA", ctx());
    expect(proveFactor(db, KEY, user, "000000", ctx())).toMatchObject({ error: expect.stringContaining("Too many attempts") });
  });

  it("refuses users without MFA and disabled users", () => {
    expect(proveFactor(db, KEY, user, "123456", ctx())).toMatchObject({ ok: false });
    const { secret } = enrol();
    db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(T0, user);
    expect(proveFactor(db, KEY, user, totp(secret, T0 + STEP), ctx(T0 + STEP))).toMatchObject({ ok: false });
  });
});

describe("recovery codes", () => {
  it("work once, in any case and with or without dashes, and are counted and audited", () => {
    const { codes } = enrol();
    expect(proveFactor(db, KEY, user, codes[0]!.toLowerCase().replace(/-/g, " "), ctx(T0 + STEP))).toEqual({ ok: true, via: "recovery" });
    expect(recoveryCodesLeft(db, user)).toBe(9);
    expect(proveFactor(db, KEY, user, codes[0]!, ctx(T0 + STEP))).toMatchObject({ ok: false });
    expect(db.prepare("SELECT detail FROM audit_log WHERE action = 'mfa.recovery_used'").get()).toEqual({ detail: '{"remaining":9}' });
  });

  it("cannot be used by another user", () => {
    const { codes } = enrol();
    const other = createUser(db, { email: "other@example.com", passwordHash: "x" }, T0);
    expect(proveFactor(db, KEY, other, codes[0]!, ctx())).toMatchObject({ ok: false });
  });

  it("are replaced by regeneration, which needs a current code", () => {
    const { secret, codes } = enrol();
    const now = T0 + 2 * STEP;
    expect(regenerateRecoveryCodes(db, KEY, user, "000000", ctx(now))).toMatchObject({ ok: false });
    const r = regenerateRecoveryCodes(db, KEY, user, totp(secret, now), ctx(now));
    if (!r.ok) throw new Error(r.error);
    expect(r.recoveryCodes).toHaveLength(10);
    expect(r.recoveryCodes.some((c) => codes.includes(c))).toBe(false);
    expect(proveFactor(db, KEY, user, codes[0]!, ctx(now + STEP))).toMatchObject({ ok: false });
    expect(proveFactor(db, KEY, user, r.recoveryCodes[0]!, ctx(now + STEP)).ok).toBe(true);
    expect(actions()).toContain("mfa.recovery_regenerated");
  });
});

describe("completeLogin", () => {
  it("turns a pending session into a full one", () => {
    const { secret } = enrol();
    const { token } = createSession(db, user, { mfaPending: true }, T0 + STEP);
    const pending = validateSession(db, token, T0 + STEP)!;
    expect(pending.mfaPending).toBe(true);
    const r = completeLogin(db, KEY, pending, totp(secret, T0 + 2 * STEP), ctx(T0 + 2 * STEP));
    expect(r).toMatchObject({ ok: true, via: "totp", recoveryLeft: 10 });
    expect(validateSession(db, token, T0 + 2 * STEP)!.mfaPending).toBe(false);
  });

  it("does not let a code fix a session that is not pending", () => {
    const { secret, token } = enrol();
    const full = validateSession(db, token, T0)!;
    expect(completeLogin(db, KEY, full, totp(secret, T0 + 2 * STEP), ctx(T0 + 2 * STEP))).toMatchObject({ ok: false, error: expect.stringContaining("expired") });
  });

  it("cannot be completed for someone else's pending session", () => {
    const { secret } = enrol();
    const other = createUser(db, { email: "other@example.com", passwordHash: "x" }, T0);
    const { token } = createSession(db, other, { mfaPending: true }, T0);
    const pending = validateSession(db, token, T0)!;
    expect(completeLogin(db, KEY, { tokenHash: pending.tokenHash, userId: user }, totp(secret, T0 + 2 * STEP), ctx(T0 + 2 * STEP)).ok).toBe(false);
    expect(validateSession(db, token, T0)!.mfaPending).toBe(true);
  });
});

describe("clearMfa", () => {
  it("removes the secret, the setup and the codes, and the counter", () => {
    enrol();
    clearMfa(db, user);
    const row = db.prepare("SELECT mfa_secret_enc, mfa_enabled_at, mfa_last_step FROM users WHERE id = ?").get(user);
    expect(row).toEqual({ mfa_secret_enc: null, mfa_enabled_at: null, mfa_last_step: 0 });
    expect(recoveryCodesLeft(db, user)).toBe(0);
  });
});
