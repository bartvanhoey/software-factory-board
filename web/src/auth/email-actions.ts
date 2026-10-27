"use server";

import { notFound, redirect } from "next/navigation";
import type { FormState } from "./actions";
import { requestContext, requireUser } from "./dal";
import { getDb } from "./db";
import { getMailEnv } from "./mail-env";
import { confirmEmail, requestPasswordReset, resetPasswordWithToken, sendVerification } from "./verification";

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.slice(0, 256) : "";
};

// A database or mail error must not become a crash page; only the message is logged, never the form or a link.
function failed(err: unknown): FormState {
  console.error(`[mail] action failed: ${err instanceof Error ? err.message : "unknown error"}`);
  return { error: "Something went wrong. Try again." };
}

// These are public endpoints, and they only exist while EMAIL_VERIFICATION is on.
function mailOr404() {
  const mail = getMailEnv();
  if (!mail) notFound();
  return mail;
}

/** Asks for another confirmation link. For a logged-in user whose address is not confirmed yet. */
export async function resendVerificationAction(): Promise<FormState> {
  const session = await requireUser(); // refuses a session that has not passed the second factor
  const mail = mailOr404();
  try {
    const result = await sendVerification(getDb(), mail, session.userId, { ip: (await requestContext()).ip });
    return result.ok ? { notice: "We sent a new link. The older one no longer works." } : { error: result.error };
  } catch (err) {
    return failed(err);
  }
}

/**
 * The button on the confirmation page. A GET never confirms anything: mail scanners open links before people do. And the
 * person must be logged in as the account the link is for (requireUser also refuses a session that has not passed its
 * second factor), so that opening a link from your own inbox cannot confirm an account someone else registered in
 * your name.
 */
export async function confirmEmailAction(_prev: FormState, form: FormData): Promise<FormState> {
  mailOr404();
  const session = await requireUser();
  let ok: boolean;
  let error = "";
  try {
    const result = confirmEmail(getDb(), field(form, "token"), session.userId, { ip: (await requestContext()).ip });
    ok = result.ok;
    if (!result.ok) error = result.error;
  } catch (err) {
    return failed(err);
  }
  if (!ok) return { error };
  redirect("/login?verified=1");
}

/** Always answers the same way, whether or not the address has an account (see requestPasswordReset). */
export async function forgotPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const mail = mailOr404();
  try {
    requestPasswordReset(getDb(), mail, field(form, "email"), { ip: (await requestContext()).ip });
  } catch (err) {
    console.error(`[mail] forgot-password failed: ${err instanceof Error ? err.message : "unknown error"}`);
    // still the same message: an error here must not tell a stranger anything about the address
  }
  return { notice: "If that address has an account, we have sent a link to reset the password. It works for one hour." };
}

export async function resetPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  mailOr404();
  if (field(form, "next") !== field(form, "confirm")) return { error: "The two passwords do not match." };
  let ok: boolean;
  let error = "";
  try {
    const result = await resetPasswordWithToken(getDb(), field(form, "token"), field(form, "next"), { ip: (await requestContext()).ip });
    ok = result.ok;
    if (!result.ok) error = result.error;
  } catch (err) {
    return failed(err);
  }
  if (!ok) return { error };
  redirect("/login?reset=1");
}
