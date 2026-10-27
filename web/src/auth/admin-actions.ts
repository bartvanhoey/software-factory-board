"use server";

import { revalidatePath } from "next/cache";
import { denyNonAdmin, markEmailVerified, resetMfa, resetPassword, setDisabled, setMfaRequired, setRoles, type AdminCtx, type Done } from "./admin";
import { requestContext, requireAccess } from "./dal";
import { getDb } from "./db";

export interface AdminState {
  error?: string;
  message?: string;
  /** Shown once. It lives only in this response and is never stored, audited or logged. */
  temporaryPassword?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAILED: AdminState = { error: "Something went wrong. Try again." };

// Server actions are public endpoints: each one re-checks the session and the admin role itself (the page that
// rendered the button proves nothing), then admin.ts checks again inside its transaction. A logged-in user who is
// not an admin and calls one anyway is recorded, then gets a 404.
async function admin(form: FormData, attempted: string): Promise<{ actorId: string; targetId: string; ctx: AdminCtx } | AdminState> {
  const ctx: AdminCtx = { ip: (await requestContext()).ip };
  const session = await requireAccess("admin", (s) => denyNonAdmin(getDb(), s.userId, attempted, ctx));
  const target = form.get("userId");
  if (typeof target !== "string" || !UUID.test(target)) return { error: "Unknown user." };
  return { actorId: session.userId, targetId: target, ctx };
}

const isState = (v: object): v is AdminState => !("actorId" in v);

// A database error (for example the file is locked for longer than the busy timeout) must not become a crash page.
// Only the message is logged, never the form.
function failed(err: unknown): AdminState {
  console.error(`[admin] action failed: ${err instanceof Error ? err.message : "unknown error"}`);
  return FAILED;
}

function finish(result: Done, message: string): AdminState {
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin/users");
  return { message };
}

export async function saveRolesAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const a = await admin(form, "roles.set");
  if (isState(a)) return a;
  const roles = form.getAll("roles").filter((r): r is string => typeof r === "string");
  const seen = form.get("expected");
  const expected = typeof seen === "string" ? seen.split(",").filter(Boolean) : undefined;
  try {
    return finish(setRoles(getDb(), a.actorId, a.targetId, roles, a.ctx, expected), "Roles saved.");
  } catch (err) {
    return failed(err);
  }
}

export async function setDisabledAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const a = await admin(form, "user.disable");
  if (isState(a)) return a;
  const flag = form.get("disabled");
  if (flag !== "true" && flag !== "false") return { error: "Invalid request." };
  try {
    return finish(setDisabled(getDb(), a.actorId, a.targetId, flag === "true", a.ctx), flag === "true" ? "Account disabled." : "Account enabled.");
  } catch (err) {
    return failed(err);
  }
}

export async function resetPasswordAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const a = await admin(form, "password.reset");
  if (isState(a)) return a;
  try {
    const result = await resetPassword(getDb(), a.actorId, a.targetId, a.ctx);
    if (!result.ok) return { error: result.error };
    revalidatePath("/admin/users");
    return { message: "Temporary password set. It is shown once; the user must change it at next login.", temporaryPassword: result.temporaryPassword };
  } catch (err) {
    return failed(err);
  }
}

export async function setMfaRequiredAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const a = await admin(form, "mfa.require");
  if (isState(a)) return a;
  const flag = form.get("required");
  if (flag !== "true" && flag !== "false") return { error: "Invalid request." };
  try {
    return finish(setMfaRequired(getDb(), a.actorId, a.targetId, flag === "true", a.ctx), flag === "true" ? "MFA is now required for this user." : "MFA is no longer required for this user.");
  } catch (err) {
    return failed(err);
  }
}

export async function resetMfaAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const a = await admin(form, "mfa.reset");
  if (isState(a)) return a;
  try {
    return finish(resetMfa(getDb(), a.actorId, a.targetId, a.ctx), "MFA removed. The user's sessions ended.");
  } catch (err) {
    return failed(err);
  }
}

export async function markEmailVerifiedAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const a = await admin(form, "email.verify");
  if (isState(a)) return a;
  try {
    return finish(markEmailVerified(getDb(), a.actorId, a.targetId, a.ctx), "Email address marked as confirmed.");
  } catch (err) {
    return failed(err);
  }
}
