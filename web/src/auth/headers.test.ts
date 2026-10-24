import { describe, expect, it } from "vitest";
import { buildCsp, isNoStorePath, proxyDecision, securityHeaders } from "./headers";

describe("buildCsp", () => {
  const prod = { isDev: false, upgradeInsecure: false };

  it("allows scripts only by nonce and never unsafe-inline or unsafe-eval in production", () => {
    const csp = buildCsp("abc123", prod);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("style-src 'self' 'nonce-abc123'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("blocks framing, plugins, foreign forms and base tags", () => {
    const csp = buildCsp("n", prod);
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "form-action 'self'", "base-uri 'self'", "default-src 'self'"]) {
      expect(csp).toContain(d);
    }
  });

  it("loosens only what the dev server needs", () => {
    const csp = buildCsp("n", { isDev: true, upgradeInsecure: false });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("adds upgrade-insecure-requests only for HTTPS deployments", () => {
    expect(buildCsp("n", prod)).not.toContain("upgrade-insecure-requests");
    expect(buildCsp("n", { ...prod, upgradeInsecure: true })).toContain("upgrade-insecure-requests");
  });

  it("uses a different nonce in every policy it is given", () => {
    expect(buildCsp("a", prod)).not.toBe(buildCsp("b", prod));
  });
});

describe("securityHeaders", () => {
  it("sends HSTS only for HTTPS deployments", () => {
    expect(securityHeaders("n", { isDev: false, upgradeInsecure: false })["Strict-Transport-Security"]).toBeUndefined();
    expect(securityHeaders("n", { isDev: false, upgradeInsecure: true })["Strict-Transport-Security"]).toBe("max-age=31536000");
  });

  it("sets the full baseline", () => {
    const h = securityHeaders("n", { isDev: false, upgradeInsecure: false });
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("no-referrer");
    expect(h["Permissions-Policy"]).toContain("camera=()");
    expect(h["Content-Security-Policy"]).toContain("nonce-n");
  });
});

describe("proxyDecision", () => {
  it("lets public paths through without a cookie", () => {
    for (const p of ["/login", "/register", "/api/health"]) expect(proxyDecision(p, false)).toBe("next");
  });

  it("redirects pages to /login and rejects API calls without a cookie", () => {
    expect(proxyDecision("/", false)).toBe("login");
    expect(proxyDecision("/projects/x", false)).toBe("login");
    expect(proxyDecision("/waiting", false)).toBe("login");
    expect(proxyDecision("/api/anything", false)).toBe("unauthorized");
  });

  it("does not treat lookalike paths as public", () => {
    expect(proxyDecision("/login/../admin", false)).toBe("login");
    expect(proxyDecision("/api/health/extra", false)).toBe("unauthorized");
    expect(proxyDecision("/loginx", false)).toBe("login");
  });

  it("passes anything through when a cookie is present (the DAL validates it)", () => {
    expect(proxyDecision("/", true)).toBe("next");
    expect(proxyDecision("/api/anything", true)).toBe("next");
  });
});

describe("isNoStorePath", () => {
  it("covers the credential pages", () => {
    for (const p of ["/login", "/register", "/waiting", "/account/password", "/admin/users", "/admin/audit"]) expect(isNoStorePath(p)).toBe(true);
    expect(isNoStorePath("/")).toBe(false);
  });
});
