import { describe, expect, it, vi } from "vitest";
import { lookupDefaultBranch } from "./repo";

const reply = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("lookupDefaultBranch", () => {
  it("returns the default branch GitHub reports", async () => {
    const f = reply(200, { default_branch: "master" });
    expect(await lookupDefaultBranch("owner/repo", undefined, f)).toEqual({ ok: true, branch: "master" });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/owner/repo");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("sends the token, and only to api.github.com", async () => {
    const f = reply(200, { default_branch: "main" });
    await lookupDefaultBranch("owner/repo", "secret-token", f);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(new URL(url).host).toBe("api.github.com");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
  });

  it("does not call GitHub for something that is not owner/name", async () => {
    const f = reply(200, { default_branch: "main" });
    for (const bad of ["", "nope", "a/b/c", "../x", "owner/repo.git", "owner/-x", "own er/repo", "owner/repo?x=1#"]) {
      expect((await lookupDefaultBranch(bad, undefined, f)).ok).toBe(false);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("explains the usual failures", async () => {
    expect(await lookupDefaultBranch("o/r", undefined, reply(404))).toEqual({ ok: false, error: expect.stringMatching(/does not know/) });
    expect(await lookupDefaultBranch("o/r", "t", reply(401))).toEqual({ ok: false, error: expect.stringMatching(/rejected the board token/) });
    expect(await lookupDefaultBranch("o/r", undefined, reply(403))).toEqual({ ok: false, error: expect.stringMatching(/limiting/) });
    expect(await lookupDefaultBranch("o/r", undefined, reply(429))).toEqual({ ok: false, error: expect.stringMatching(/limiting/) });
    expect(await lookupDefaultBranch("o/r", undefined, reply(500))).toEqual({ ok: false, error: expect.stringMatching(/status 500/) });
  });

  it("reports a network failure", async () => {
    const f = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await lookupDefaultBranch("o/r", undefined, f)).toEqual({ ok: false, error: "Could not reach GitHub." });
  });

  it("refuses a branch name the project rules would refuse", async () => {
    for (const branch of ["--upload-pack=x", "a..b", "-x", "", 5, null]) {
      expect((await lookupDefaultBranch("o/r", undefined, reply(200, { default_branch: branch }))).ok).toBe(false);
    }
    expect((await lookupDefaultBranch("o/r", undefined, reply(200, {}))).ok).toBe(false);
  });
});
