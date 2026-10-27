// No "server-only" or next/* imports: vitest and the break-glass CLI load this outside Next.
import { checkPassword } from "./policy";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

export interface AuthConfig {
  dbPath: string;
  /** 32 bytes, encrypts TOTP secrets at rest. */
  mfaKey: Buffer;
  emailVerification: boolean;
  /** Set only when emailVerification is on. */
  smtp: SmtpConfig | null;
  /**
   * The public address of this site (an origin, no trailing slash): the base of every link we email. Set only when
   * emailVerification is on. Links are never built from the request's Host header, which a visitor controls.
   */
  appUrl: string | null;
  cookieSecure: boolean;
  /** Believe X-Forwarded-For (set by a reverse proxy we control). Off = no per-IP limits. */
  trustProxy: boolean;
  /** First-admin seed. Both values or neither. */
  admin: { email: string; password: string } | null;
}

/** Every problem at once. Messages name variables, never their values (they are secrets). */
export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid auth configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** An origin only (scheme and host), https unless it is this machine. A message names the problem, never the value. */
function parseAppUrl(raw: string): URL | string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "must be a full address such as https://board.example.com";
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) return "must start with https:// (http:// is only allowed for localhost)";
  if (url.username || url.password) return "must not contain a username or password";
  if (url.pathname !== "/" || url.search || url.hash) return "must be just the address, with no path, query or fragment";
  return url;
}

/** Where auth.db is. On its own so the break-glass command needs no other setting to be valid. */
export function authDbPath(env: Env = process.env): string {
  return env.AUTH_DB_PATH?.trim() || "/auth/auth.db";
}

export function loadAuthConfig(env: Env = process.env): AuthConfig {
  const problems: string[] = [];
  // compose passes unset variables as empty strings
  const get = (name: string): string | undefined => env[name]?.trim() || undefined;

  const bool = (name: string, fallback: boolean): boolean => {
    const v = get(name);
    if (v === undefined) return fallback;
    if (v === "true") return true;
    if (v === "false") return false;
    problems.push(`${name} must be "true" or "false"`);
    return fallback;
  };

  const dbPath = authDbPath(env);

  let mfaKey = Buffer.alloc(0);
  const rawKey = get("MFA_ENCRYPTION_KEY");
  if (!rawKey) problems.push("MFA_ENCRYPTION_KEY is required (32 random bytes, base64)");
  else {
    const key = BASE64.test(rawKey) ? Buffer.from(rawKey, "base64") : null;
    if (key?.length === 32 && key.every((b) => b === key[0])) problems.push("MFA_ENCRYPTION_KEY must be random bytes, not one byte repeated");
    else if (key?.length === 32) mfaKey = key;
    else problems.push("MFA_ENCRYPTION_KEY must be base64 that decodes to exactly 32 bytes");
  }

  const emailVerification = bool("EMAIL_VERIFICATION", false);
  let smtp: SmtpConfig | null = null;
  let appUrl: string | null = null;
  if (emailVerification) {
    const host = get("SMTP_HOST");
    const user = get("SMTP_USER");
    const password = get("SMTP_PASSWORD");
    const from = get("SMTP_FROM");
    const port = Number(get("SMTP_PORT"));
    for (const [name, value] of [["SMTP_HOST", host], ["SMTP_PORT", get("SMTP_PORT")], ["SMTP_USER", user], ["SMTP_PASSWORD", password], ["SMTP_FROM", from]]) {
      if (!value) problems.push(`${name} is required when EMAIL_VERIFICATION=true`);
    }
    if (get("SMTP_PORT") && !(Number.isInteger(port) && port >= 1 && port <= 65535)) {
      problems.push("SMTP_PORT must be a port number (1-65535)");
    }
    if (from && !EMAIL.test(from)) problems.push("SMTP_FROM must be an email address");
    if (host && user && password && from) smtp = { host, port, user, password, from };

    const rawUrl = get("APP_URL");
    if (!rawUrl) problems.push("APP_URL is required when EMAIL_VERIFICATION=true (the public address of this site, for links in emails)");
    else {
      const parsed = parseAppUrl(rawUrl);
      if (typeof parsed === "string") problems.push(`APP_URL ${parsed}`);
      else appUrl = parsed.origin;
    }
  }

  const cookieSecure = bool("COOKIE_SECURE", env.NODE_ENV === "production");
  const trustProxy = bool("TRUST_PROXY", false);

  let admin: AuthConfig["admin"] = null;
  const adminEmail = get("ADMIN_EMAIL");
  const adminPassword = get("ADMIN_PASSWORD");
  if (adminEmail || adminPassword) {
    if (!adminEmail || !adminPassword) problems.push("ADMIN_EMAIL and ADMIN_PASSWORD must be set together");
    else {
      if (adminEmail.length > 254 || !EMAIL.test(adminEmail)) problems.push("ADMIN_EMAIL must be an email address");
      const weak = checkPassword(adminPassword, adminEmail);
      if (weak) problems.push(`ADMIN_PASSWORD: ${weak}`);
      admin = { email: adminEmail.toLowerCase(), password: adminPassword };
    }
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return { dbPath, mfaKey, emailVerification, smtp, appUrl, cookieSecure, trustProxy, admin };
}

// Next bundles proxy, instrumentation and pages separately; share one parsed config per process.
const cache = globalThis as { __authConfig?: AuthConfig };

/** The validated config for this process. startAuth() has already exited if it is invalid. */
export function getAuthConfig(): AuthConfig {
  cache.__authConfig ??= loadAuthConfig();
  return cache.__authConfig;
}
