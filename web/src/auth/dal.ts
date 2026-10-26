import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAuthConfig } from "./config";
import { getDb } from "./db";
import { gateRedirect } from "./gating";
import { clientIp, sessionCookieName } from "./request";
import type { Ctx } from "./service";
import { validateSession, type SessionInfo } from "./sessions";
import { hasRole, type Role } from "./users";

export async function readToken(): Promise<string | undefined> {
  return (await cookies()).get(sessionCookieName(getAuthConfig().cookieSecure))?.value;
}

/** The validated session for this request, or null. Cached per request. */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const token = await readToken();
  return token ? validateSession(getDb(), token) : null;
});

/** Any logged-in user, whatever state they are in. For the pages gating sends people to. */
export async function requireUser(): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * The check every protected page and action calls, close to the data (layouts do not re-render on
 * navigation, so a layout check is not enough). Sends users to the screen their state requires.
 */
export async function requireAccess(role: Role = "viewer", onDenied?: (session: SessionInfo) => void | Promise<void>): Promise<SessionInfo> {
  const session = await requireUser();
  const gate = gateRedirect(session);
  if (gate) redirect(gate);
  if (!hasRole(session.roles, role)) {
    await onDenied?.(session);
    notFound();
  }
  return session;
}

export async function requestContext(): Promise<Ctx> {
  const h = await headers();
  return { ip: clientIp((name) => h.get(name), getAuthConfig().trustProxy), userAgent: h.get("user-agent") };
}

export async function setSessionCookie(token: string, expiresAt: number): Promise<void> {
  const { cookieSecure } = getAuthConfig();
  (await cookies()).set(sessionCookieName(cookieSecure), token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const { cookieSecure } = getAuthConfig();
  // set + maxAge 0 instead of delete(): a __Host- cookie is only accepted with Secure, and delete() omits it.
  (await cookies()).set(sessionCookieName(cookieSecure), "", { httpOnly: true, secure: cookieSecure, sameSite: "lax", path: "/", maxAge: 0 });
}
