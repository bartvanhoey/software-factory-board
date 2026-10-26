/**
 * The client IP, only when a proxy we control sets X-Forwarded-For (TRUST_PROXY). Otherwise null: Next does
 * not expose the socket address and the header is spoofable, so per-IP limits would be worthless.
 */
export function clientIp(get: (name: string) => string | null, trustProxy: boolean): string | null {
  if (!trustProxy) return null;
  const last = get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return last && last.length <= 45 && /^[0-9a-fA-F:.]+$/.test(last) ? last : null;
}

export function sessionCookieName(secure: boolean): string {
  return secure ? "__Host-session" : "session";
}
