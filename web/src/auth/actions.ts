"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie, readToken, requestContext, requireUser, setSessionCookie } from "./dal";
import { getMailEnv } from "./mail-env";
import { getDb } from "./db";
import { changePassword, login, logout, register } from "./service";
import { deleteSession, validateSession } from "./sessions";
import { sendVerification } from "./verification";

export interface FormState {
  error?: string;
  /** Echoed back on a failed submit: React clears the form after an action, and the email should survive. */
  email?: string;
  /** A message that replaces the form (for example "we sent a link"). */
  notice?: string;
}

/** Ends the session the browser already holds, so logging in as someone else leaves no stale one behind. */
async function dropCurrentSession(): Promise<void> {
  const old = await readToken();
  if (old) deleteSession(getDb(), old);
}

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

// Server actions are public endpoints (Next compares Origin to Host); each one validates its own input.

export async function registerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = field(form, "email");
  if (field(form, "password") !== field(form, "confirm")) return { error: "The two passwords do not match.", email };
  const ctx = await requestContext();
  const result = await register(getDb(), { email, password: field(form, "password") }, ctx);
  if (!result.ok) {
    // An address someone else registered cannot be told apart from your own earlier account; point to the way back in.
    const hint = result.error.includes("already exists") && getMailEnv() ? ' If it is yours, use "Forgot your password?" on the login page.' : "";
    return { error: result.error + hint, email };
  }
  // With verification on the account starts unconfirmed: send the link. If that fails the account still exists and the
  // "check your email" page has a Resend button; the failure is already logged and audited.
  const mail = getMailEnv();
  const created = mail ? validateSession(getDb(), result.token) : null;
  let sent: Awaited<ReturnType<typeof sendVerification>> | null = null;
  try {
    sent = mail && created ? await sendVerification(getDb(), mail, created.userId, { ip: ctx.ip }) : null;
  } catch (err) {
    // The account exists and the session cookie is still set below; the page says the email did not go out.
    console.error(`[mail] verify email failed: ${err instanceof Error ? err.message : "unknown error"}`);
    sent = { ok: false, error: "send failed" };
  }
  await dropCurrentSession();
  await setSessionCookie(result.token, result.expiresAt);
  // The page they are held on says so when the first email did not go out, instead of claiming it did.
  redirect(sent && !sent.ok ? "/account/verify?failed=1" : "/");
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = field(form, "email");
  const result = await login(getDb(), { email, password: field(form, "password") }, await requestContext());
  if (!result.ok) return { error: result.error, email };
  await dropCurrentSession();
  await setSessionCookie(result.token, result.expiresAt);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const token = await readToken();
  if (token) logout(getDb(), token, await requestContext());
  await clearSessionCookie();
  redirect("/login");
}

export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (field(form, "next") !== field(form, "confirm")) return { error: "The two new passwords do not match." };
  await requireUser(); // refuses a session that has not passed the second factor
  const token = await readToken();
  if (!token) redirect("/login");
  const result = await changePassword(getDb(), token, { current: field(form, "current"), next: field(form, "next") }, await requestContext());
  if (!result.ok) return { error: result.error };
  redirect("/");
}
