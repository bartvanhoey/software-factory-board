import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfig } from "./auth/config";
import { isNoStorePath, proxyDecision, securityHeaders } from "./auth/headers";
import { sessionCookieName } from "./auth/request";

function withHeaders(response: NextResponse, headers: Record<string, string>, pathname: string): NextResponse {
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  if (isNoStorePath(pathname)) response.headers.set("Cache-Control", "no-store");
  return response;
}

export function proxy(request: NextRequest): NextResponse {
  const { cookieSecure } = getAuthConfig();
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const headers = securityHeaders(nonce, { isDev: process.env.NODE_ENV === "development", upgradeInsecure: cookieSecure });
  const { pathname } = request.nextUrl;

  const decision = proxyDecision(pathname, request.cookies.has(sessionCookieName(cookieSecure)));
  if (decision === "login") return withHeaders(NextResponse.redirect(new URL("/login", request.url)), headers, pathname);
  if (decision === "unauthorized") return withHeaders(NextResponse.json({ error: "unauthorized" }, { status: 401 }), headers, pathname);

  // Next reads the nonce from the request's CSP header and applies it to its own scripts and styles.
  // x-nonce is for the few scripts we write ourselves (the theme script in the root layout): they need it too.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"]!);
  requestHeaders.set("x-nonce", nonce);
  return withHeaders(NextResponse.next({ request: { headers: requestHeaders } }), headers, pathname);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
