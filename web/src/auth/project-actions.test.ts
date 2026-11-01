import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookupDefaultBranch } from "../lib/repo";
import { openDb } from "./db";
import { lookupBranchAction } from "./project-actions";
import { createSession } from "./sessions";
import { createUser, grantRole, type Role } from "./users";

// What is replaced is the framework around the action (cookies, redirects, the database file, the GitHub call). The
// access check itself, requireAccess with real sessions and roles from a real in-memory database, is what is tested.
const world = vi.hoisted(() => ({ db: undefined as unknown, token: undefined as string | undefined }));

vi.mock("server-only", () => ({}));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T>(fn: T) => fn }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "session" && world.token ? { name, value: world.token } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("./config", async (original) => ({
  ...(await original<typeof import("./config")>()),
  getAuthConfig: () => ({ cookieSecure: false, emailVerification: false, trustProxy: false }),
}));
vi.mock("./db", async (original) => ({ ...(await original<typeof import("./db")>()), getDb: () => world.db }));
vi.mock("../lib/repo", () => ({ lookupDefaultBranch: vi.fn() }));

let db: ReturnType<typeof openDb>;
const lookup = vi.mocked(lookupDefaultBranch);

/** Logs a new account in: the cookie the action will see belongs to a user with exactly these roles. */
function logInWith(...roles: Role[]): string {
  const id = createUser(db, { email: `${roles[0] ?? "nobody"}@example.com`, passwordHash: "x" });
  for (const role of roles) grantRole(db, id, role, null);
  world.token = createSession(db, id).token;
  return id;
}

const audited = () => db.prepare("SELECT actor_user_id AS actor, action, detail FROM audit_log").all() as { actor: string | null; action: string; detail: string }[];

beforeEach(() => {
  db = openDb(":memory:");
  world.db = db;
  world.token = undefined;
  lookup.mockReset();
  lookup.mockResolvedValue({ ok: true, branch: "develop" });
  vi.stubEnv("BOARD_GITHUB_TOKEN", "board-token");
});
afterEach(() => vi.unstubAllEnvs());

describe("lookupBranchAction", () => {
  it("sends a visitor to the login page and looks nothing up", async () => {
    await expect(lookupBranchAction("owner/repo")).rejects.toThrow("redirect:/login");
    expect(lookup).not.toHaveBeenCalled();
    expect(audited()).toEqual([]);
  });

  it("refuses a Member, looks nothing up and records the attempt", async () => {
    const id = logInWith("viewer");
    await expect(lookupBranchAction("owner/repo")).rejects.toThrow("notFound");
    expect(lookup).not.toHaveBeenCalled();
    expect(audited()).toEqual([{ actor: id, action: "admin.denied", detail: JSON.stringify({ attempted: "project.lookup" }) }]);
  });

  it("lets a Project manager look up a branch, with the board token and the repository trimmed", async () => {
    logInWith("issue-admin");
    await expect(lookupBranchAction("  owner/repo  ")).resolves.toEqual({ branch: "develop" });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("owner/repo", "board-token");
    expect(audited()).toEqual([]);
  });

  it("passes on why a lookup failed", async () => {
    logInWith("issue-admin");
    lookup.mockResolvedValue({ ok: false, error: "GitHub does not know that repository, or the board token cannot see it." });
    await expect(lookupBranchAction("owner/missing")).resolves.toEqual({ error: "GitHub does not know that repository, or the board token cannot see it." });
  });
});
