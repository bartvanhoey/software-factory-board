import { ProjectSchema } from "@factory/shared";

export type BranchLookup = { ok: true; branch: string } | { ok: false; error: string };

const REPO = ProjectSchema.shape.repo;
const BRANCH = ProjectSchema.shape.defaultBranch;

/**
 * The default branch of a GitHub repository, so a person adding a project does not have to know it. The repository is
 * checked against the same rules as a stored project before it goes into a URL, and what GitHub answers is checked
 * against the branch rules before it is offered. The token (the board's read-only one, when there is one) only ever goes
 * to api.github.com; without it a public repository still works, within GitHub's lower anonymous rate limit.
 */
export async function lookupDefaultBranch(repo: string, token: string | undefined, fetchFn: typeof fetch = fetch): Promise<BranchLookup> {
  const parsed = REPO.safeParse(repo);
  if (!parsed.success) return { ok: false, error: "Enter the repository as owner/name first." };
  const [owner = "", name = ""] = parsed.data.split("/");

  let res: Response;
  try {
    res = await fetchFn(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "software-factory-board",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { ok: false, error: "Could not reach GitHub." };
  }

  if (res.status === 404) return { ok: false, error: "GitHub does not know that repository, or the board token cannot see it." };
  if (res.status === 401) return { ok: false, error: "GitHub rejected the board token." };
  if (res.status === 403 || res.status === 429) return { ok: false, error: "GitHub is limiting lookups right now." };
  if (!res.ok) return { ok: false, error: `GitHub answered with status ${res.status}.` };

  const body: unknown = await res.json().catch(() => null);
  const reported = (body as { default_branch?: unknown } | null)?.default_branch;
  // The schema fills in "main" for a missing value; here a missing value must stay a failure, not become a guess.
  const branch = typeof reported === "string" ? BRANCH.safeParse(reported) : null;
  if (!branch?.success) return { ok: false, error: "GitHub did not return a usable default branch." };
  return { ok: true, branch: branch.data };
}
