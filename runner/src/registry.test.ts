import { parseProject } from "@factory/shared";
import { describe, expect, it } from "vitest";
import { UsageError } from "./errors.js";
import { RegistryError, fetchProjects, loadRegistrySettings } from "./registry.js";

const TOKEN = "super-secret-runner-token-value";
const settings = { url: "http://web:2999", token: TOKEN };
const project = parseProject({ name: "demo", repo: "o/demo" }, "projects/demo.json");

const reply = (body: unknown, status = 200): typeof fetch => (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("loadRegistrySettings", () => {
  it("needs the token and defaults the address to the compose service", () => {
    expect(() => loadRegistrySettings({})).toThrow(UsageError);
    expect(() => loadRegistrySettings({ RUNNER_API_TOKEN: "  " })).toThrow(/RUNNER_API_TOKEN/);
    expect(loadRegistrySettings({ RUNNER_API_TOKEN: ` ${TOKEN} ` })).toEqual({ url: "http://web:2999", token: TOKEN });
  });

  it("accepts a plain http(s) address and refuses anything that could send the token elsewhere", () => {
    expect(loadRegistrySettings({ RUNNER_API_TOKEN: TOKEN, FACTORY_WEB_URL: "https://board.example.com/" }).url).toBe("https://board.example.com");
    for (const bad of ["web:2999", "ftp://web", "http://user:pw@web:2999", "http://web:2999/api", "http://web:2999?x=1", "http://web:2999/#x"]) {
      expect(() => loadRegistrySettings({ RUNNER_API_TOKEN: TOKEN, FACTORY_WEB_URL: bad }), bad).toThrow(UsageError);
    }
  });
});

describe("fetchProjects", () => {
  it("sends the bearer token to the internal endpoint and returns the validated projects", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response(JSON.stringify({ projects: [project] })))) as unknown as typeof fetch;
    expect(await fetchProjects(settings, fetchFn)).toEqual([project]);
    expect(seen?.url).toBe("http://web:2999/api/internal/projects");
    expect((seen?.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen?.init.redirect).toBe("error"); // the token must not follow a redirect to another host
  });

  it("explains an unreachable web service without printing the token", async () => {
    const down = (async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }) as unknown as typeof fetch;
    const error = await fetchProjects(settings, down).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RegistryError);
    expect((error as Error).message).toMatch(/cannot reach the web service at http:\/\/web:2999 \(ECONNREFUSED\)/);
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("names a wrong token, a server error, a non-JSON answer and an answer of the wrong shape", async () => {
    await expect(fetchProjects(settings, reply({ error: "unauthorized" }, 401))).rejects.toThrow(/refused RUNNER_API_TOKEN/);
    await expect(fetchProjects(settings, reply({ error: "unavailable" }, 503))).rejects.toThrow(/answered 503/);
    await expect(fetchProjects(settings, reply("<html>"))).rejects.toThrow(/not JSON/);
    await expect(fetchProjects(settings, reply({ projects: [{ name: "x" }] }))).rejects.toThrow(/does not understand/);
    await expect(fetchProjects(settings, reply({ projects: [], extra: 1 }))).rejects.toThrow(/does not understand/);
    for (const bad of [reply({ error: "x" }, 401), reply("<html>")]) {
      await expect(fetchProjects(settings, bad)).rejects.not.toThrow(TOKEN);
    }
  });

  it("returns an empty list for an empty registry", async () => {
    expect(await fetchProjects(settings, reply({ projects: [] }))).toEqual([]);
  });
});
