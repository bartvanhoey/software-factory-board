import { z } from "zod";
import { ProjectSchema } from "@factory/shared";

const API = "https://api.github.com";
const IssueSchema = z.object({
  number: z.number().int().positive(),
  html_url: z.string().url(),
});

export type GitHubIssueResult =
  | { ok: true; number: number; url: string }
  | { ok: false; error: string };

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Create an issue with the dedicated write token; the board's read-only token is never used here. */
export async function createGitHubIssue(
  repo: string,
  token: string,
  title: string,
  body: string,
  labels: readonly string[],
  fetchImpl: FetchLike = fetch,
): Promise<GitHubIssueResult> {
  const parsedRepo = ProjectSchema.shape.repo.safeParse(repo);
  if (!parsedRepo.success) return { ok: false, error: "The selected project has an invalid repository." };
  const [owner = "", name = ""] = parsedRepo.data.split("/");

  let response: Response;
  try {
    response = await fetchImpl(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "software-factory-board",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title, body, labels }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, error: "Could not reach GitHub. Try again." };
  }

  if (response.status === 401) return { ok: false, error: "GitHub rejected CREATE_ISSUE_GITHUB_TOKEN. Check its configuration." };
  if (response.status === 403 || response.status === 429) {
    return { ok: false, error: "GitHub denied the request or is rate-limiting it. Check Issues: write and repository access." };
  }
  if (response.status === 404) {
    return { ok: false, error: "GitHub could not find the repository, or CREATE_ISSUE_GITHUB_TOKEN cannot access it." };
  }
  if (response.status === 422) return { ok: false, error: "GitHub rejected this issue. Check its title, body, and labels." };
  if (!response.ok) return { ok: false, error: `GitHub returned status ${response.status} while creating the issue.` };

  const json: unknown = await response.json().catch(() => null);
  const issue = IssueSchema.safeParse(json);
  if (!issue.success) return { ok: false, error: "GitHub returned an unexpected response while creating the issue." };

  let url: URL;
  try {
    url = new URL(issue.data.html_url);
  } catch {
    return { ok: false, error: "GitHub returned an unexpected issue link." };
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    return { ok: false, error: "GitHub returned an unexpected issue link." };
  }

  return { ok: true, number: issue.data.number, url: url.toString() };
}
