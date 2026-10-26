// No "server-only" or next/* imports: the policy is plain data so it can be tested.

export interface CspOptions {
  isDev: boolean;
  /** Only with HTTPS: it would break plain http on localhost. */
  upgradeInsecure: boolean;
}

/**
 * Next injects inline bootstrap scripts, so "script-src 'self'" alone breaks hydration. A per-request nonce
 * with 'strict-dynamic' allows exactly those. This forces dynamic rendering, which every page here has anyway.
 */
export function buildCsp(nonce: string, { isDev, upgradeInsecure }: CspOptions): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(upgradeInsecure ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function securityHeaders(nonce: string, options: CspOptions): Record<string, string> {
  return {
    ...(options.upgradeInsecure ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
    "Content-Security-Policy": buildCsp(nonce, options),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

const PUBLIC_PATHS = new Set(["/login", "/register", "/api/health"]);

export type ProxyDecision = "next" | "login" | "unauthorized";

/**
 * Optimistic check on the cookie's presence only (Next's guidance: no database in Proxy). It is a
 * convenience redirect; pages and actions still validate the session through the DAL.
 */
export function proxyDecision(pathname: string, hasSessionCookie: boolean): ProxyDecision {
  if (PUBLIC_PATHS.has(pathname) || hasSessionCookie) return "next";
  return pathname.startsWith("/api/") ? "unauthorized" : "login";
}

/** Pages that show or handle credentials must never be cached. */
export function isNoStorePath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/") || pathname === "/register" || pathname === "/waiting" || pathname.startsWith("/account/") || pathname.startsWith("/admin/");
}
