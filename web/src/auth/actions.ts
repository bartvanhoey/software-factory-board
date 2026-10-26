"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie, readToken, requestContext, requireUser, setSessionCookie } from "./dal";
import { getDb } from "./db";
import { changePassword, login, logout, register } from "./service";
import { deleteSession } from "./sessions";

export interface FormState {
  error?: string;
  /** Echoed back on a failed submit: React clears the form after an action, and the email should survive. */
  email?: string;
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
  const result = await register(getDb(), { email, password: field(form, "password") }, await requestContext());
  if (!result.ok) return { error: result.error, email };
  await dropCurrentSession();
  await setSessionCookie(result.token, result.expiresAt);
  redirect("/");
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
