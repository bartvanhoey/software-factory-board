import { describe, expect, it } from "vitest";
import { createGitHubIssue } from "./github-issues";

const response = (body: unknown, status = 201): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("createGitHubIssue", () => {
  it("creates an issue with the dedicated token and requested labels", async () => {
    let url = "";
    let request: RequestInit | undefined;
    const result = await createGitHubIssue("Owner/Repo", "issue-token", "A title", "A description", ["ready"], async (input, init) => {
      url = input;
      request = init;
      return response({ number: 42, html_url: "https://github.com/Owner/Repo/issues/42" });
    });

    expect(result).toEqual({ ok: true, number: 42, url: "https://github.com/Owner/Repo/issues/42" });
    expect(url).toBe("https://api.github.com/repos/Owner/Repo/issues");
    expect(request?.method).toBe("POST");
    expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer issue-token");
    expect(JSON.parse(String(request?.body))).toEqual({ title: "A title", body: "A description", labels: ["ready"] });
  });

  it.each([
    [401, "CREATE_ISSUE_GITHUB_TOKEN"],
    [403, "Issues: write"],
    [404, "cannot access it"],
    [422, "GitHub rejected this issue"],
  ])("returns an actionable error for HTTP %i", async (status, message) => {
    const result = await createGitHubIssue("Owner/Repo", "token", "Title", "", [], async () => response({}, status));
    expect(result).toEqual({ ok: false, error: expect.stringContaining(message) });
  });

  it("rejects malformed repository names and unexpected issue URLs", async () => {
    const neverFetch = async () => response({ number: 42, html_url: "https://github.com.evil.example/issue/42" });
    await expect(createGitHubIssue("-Owner/Repo", "token", "Title", "", [], neverFetch)).resolves.toMatchObject({ ok: false });
    await expect(createGitHubIssue("Owner/Repo", "token", "Title", "", [], neverFetch)).resolves.toEqual({
      ok: false,
      error: "GitHub returned an unexpected issue link.",
    });
  });

  it("reports network failures without exposing low-level errors", async () => {
    const result = await createGitHubIssue("Owner/Repo", "token", "Title", "", [], async () => {
      throw new Error("secret transport detail");
    });
    expect(result).toEqual({ ok: false, error: "Could not reach GitHub. Try again." });
  });
});
