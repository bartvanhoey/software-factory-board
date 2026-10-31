"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuthConfig } from "./config";
import { requestContext, requirePendingMfa, requireState } from "./dal";
import { getDb } from "./db";
import { completeLogin, confirmSetup, disableOwnMfa, regenerateRecoveryCodes, startReenrolment, type MfaCtx } from "./mfa";

export interface MfaState {
  error?: string;
  /** Shown once, in this response only. */
  recoveryCodes?: string[];
}

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.slice(0, 64) : "";
};

async function context(): Promise<MfaCtx> {
  return { ip: (await requestContext()).ip };
}

// A database error must not become a crash page; only the message is logged, never the form.
function failed(err: unknown): MfaState {
  console.error(`[mfa] action failed: ${err instanceof Error ? err.message : "unknown error"}`);
  return { error: "Something went wrong. Try again." };
}

// Server actions are public endpoints: each one re-checks the session and which state it belongs to.

/** The second step of a login. */
export async function verifyMfaAction(_prev: MfaState, form: FormData): Promise<MfaState> {
  const session = await requirePendingMfa();
  let result: ReturnType<typeof completeLogin>;
  try {
    result = completeLogin(getDb(), getAuthConfig().mfaKey, session, field(form, "code"), await context());
  } catch (err) {
    return failed(err);
  }
  if (!result.ok) return { error: result.error };
  // After using up a recovery code, show how many are left rather than the board.
  redirect(result.via === "recovery" ? "/account/mfa" : "/");
}

/** Confirms the secret on the setup page. Returns the recovery codes for the page to show once. */
export async function confirmSetupAction(_prev: MfaState, form: FormData): Promise<MfaState> {
  const session = await requireState("/account/mfa/setup");
  try {
    const result = confirmSetup(getDb(), getAuthConfig().mfaKey, session, field(form, "code"), await context());
    return result.ok ? { recoveryCodes: result.recoveryCodes } : { error: result.error };
  } catch (err) {
    return failed(err);
  }
}

/** Replacing the authenticator needs a current code first, so a stolen session cannot swap it. */
export async function startReenrolmentAction(_prev: MfaState, form: FormData): Promise<MfaState> {
  const session = await requireState("/account/mfa");
  let result: ReturnType<typeof startReenrolment>;
  try {
    result = startReenrolment(getDb(), getAuthConfig().mfaKey, session, field(form, "code"), await context());
  } catch (err) {
    return failed(err);
  }
  if (!result.ok) return { error: result.error };
  redirect("/account/mfa/setup");
}

/** An administrator turning their own MFA off. Needs a current code, so a stolen session cannot do it. */
export async function disableOwnMfaAction(_prev: MfaState, form: FormData): Promise<MfaState> {
  const session = await requireState("/account/mfa");
  let result: ReturnType<typeof disableOwnMfa>;
  try {
    result = disableOwnMfa(getDb(), getAuthConfig().mfaKey, session, field(form, "code"), await context());
  } catch (err) {
    return failed(err);
  }
  if (!result.ok) return { error: result.error };
  redirect("/account/mfa");
}

export async function regenerateRecoveryCodesAction(_prev: MfaState, form: FormData): Promise<MfaState> {
  const session = await requireState("/account/mfa");
  try {
    const result = regenerateRecoveryCodes(getDb(), getAuthConfig().mfaKey, session.userId, field(form, "code"), await context());
    if (!result.ok) return { error: result.error };
    revalidatePath("/account/mfa"); // the "N codes left" line
    return { recoveryCodes: result.recoveryCodes };
  } catch (err) {
    return failed(err);
  }
}
