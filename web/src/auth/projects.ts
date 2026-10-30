// No "server-only" or next/* imports: the testable core of the project registry. Server actions and the internal API call in here.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ProjectSchema, parseProject, type Project } from "@factory/shared";
import { denyNonAdmin, type AdminCtx, type Done } from "./admin";
import { audit } from "./audit";
import { transaction } from "./db";
import { findUserById, hasRole, rolesOf } from "./users";

/** A project as stored: the shared Project plus the bookkeeping the screen needs. */
export type ProjectRecord = Project & { version: number; createdAt: number; updatedAt: number };

const NOT_ALLOWED = "Project manager or Administrator access is required.";
const ADMIN_ONLY_COMMANDS = "Only an Administrator can set the build and test commands.";
const ADMIN_ONLY_ENABLE = "Only an Administrator can switch a project on.";
const PROMPTS_FIXED = "Prompt files cannot be changed here.";
const STALE = "Someone else changed this project since you opened it. Reload and try again.";
const NOT_FOUND = "Project not found.";
const DUPLICATE_NAME = "A project with this name already exists.";
const DUPLICATE_REPO = "This repository is already registered as a project.";
const SWITCH_OFF_FIRST = "Only an Administrator can change a project that is switched on. Switch it off first, make the change, and ask an Administrator to switch it on again.";
/** Projects are never deleted, so the table is capped: one account cannot fill it and the runner's list with junk. */
export const MAX_PROJECTS = 200;
const TOO_MANY = `There are already ${MAX_PROJECTS} projects.`;

type Level = "admin" | "manager";

/** The actor's level, from the database every time. A session alone is not enough, and a disabled account has none. */
function levelOf(db: DatabaseSync, actorId: string): Level | null {
  const user = findUserById(db, actorId);
  if (!user || user.disabled_at !== null) return null;
  const roles = rolesOf(db, actorId);
  if (hasRole(roles, "admin")) return "admin";
  return hasRole(roles, "issue-admin") ? "manager" : null;
}

interface Row {
  name: string;
  repo: string;
  config: string;
  enabled: number;
  version: number;
  created_at: number;
  updated_at: number;
}

const reported = new Set<string>();

function fromRow(row: Row): ProjectRecord | null {
  try {
    const project = ProjectSchema.parse({ ...(JSON.parse(row.config) as object), name: row.name, repo: row.repo, enabled: row.enabled === 1 });
    return { ...project, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
  } catch {
    // One damaged row must not take the board, the API and every lane down with it. Said once, not on every request.
    if (!reported.has(row.name)) {
      reported.add(row.name);
      console.error(`[projects] ignoring ${row.name}: its stored configuration is not valid`);
    }
    return null;
  }
}

export function listProjects(db: DatabaseSync): ProjectRecord[] {
  const rows = db.prepare("SELECT name, repo, config, enabled, version, created_at, updated_at FROM projects ORDER BY name").all() as unknown as Row[];
  return rows.map(fromRow).filter((p): p is ProjectRecord => p !== null);
}

export function getProject(db: DatabaseSync, name: string): ProjectRecord | undefined {
  const row = db.prepare("SELECT name, repo, config, enabled, version, created_at, updated_at FROM projects WHERE name = ?").get(name) as Row | undefined;
  return row ? (fromRow(row) ?? undefined) : undefined;
}

/** Everything about a project except what has its own column. */
function configOf(p: Project): string {
  const { defaultBranch, stack, commands, lanes, limits, prompts } = p;
  return JSON.stringify({ defaultBranch, stack, commands, lanes, limits, prompts });
}

function parse(raw: unknown): { ok: true; project: Project } | { ok: false; error: string } {
  const result = ProjectSchema.safeParse(raw);
  if (result.success) return { ok: true, project: result.data };
  const first = result.error.issues[0];
  return { ok: false, error: `${first?.path.join(".") || "project"}: ${first?.message ?? "is not valid"}` };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function flatten(p: Project): Record<string, unknown> {
  return {
    repo: p.repo,
    enabled: p.enabled,
    defaultBranch: p.defaultBranch,
    stack: p.stack,
    "commands.build": p.commands.build ?? null,
    "commands.test": p.commands.test ?? null,
    "lanes.build": p.lanes.build,
    "lanes.qa": p.lanes.qa,
    "lanes.review": p.lanes.review,
    "limits.maxTurns": p.limits.maxTurns,
    "limits.qaMaxTurns": p.limits.qaMaxTurns,
    "limits.reviewMaxTurns": p.limits.reviewMaxTurns,
    "limits.maxReworks": p.limits.maxReworks,
  };
}

/** Which fields changed, old and new, for the audit log. Commands are not secrets; they are recorded in full. */
function changes(before: Project, after: Project): Record<string, { from: unknown; to: unknown }> {
  const a = flatten(before);
  const b = flatten(after);
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(b)) if (!same(a[key], b[key])) out[key] = { from: a[key], to: b[key] };
  return out;
}

/** What a new project is made of, for the audit log. The commands are included: they run in the runner container. */
function detailOf(p: Project): Record<string, unknown> {
  return { repo: p.repo, enabled: p.enabled, defaultBranch: p.defaultBranch, stack: p.stack, commands: p.commands, lanes: p.lanes, limits: p.limits };
}

function deny(db: DatabaseSync, actorId: string, attempted: string, ctx: AdminCtx, error: string): Done<never> {
  // An id that belongs to no user cannot be an audit actor (foreign key); there is nobody to record it against.
  if (findUserById(db, actorId)) denyNonAdmin(db, actorId, attempted, ctx);
  return { ok: false, error };
}

function isUnique(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/.test(err.message);
}

/**
 * Adds a project. A Project manager's project starts switched off and cannot carry commands; an Administrator's starts
 * as asked. Prompt paths are never accepted here (they are file paths the runner reads).
 */
export function createProject(db: DatabaseSync, actorId: string, raw: unknown, ctx: AdminCtx): Done<{ name: string }> {
  const now = ctx.now ?? Date.now();
  return transaction(db, (): Done<{ name: string }> => {
    const level = levelOf(db, actorId);
    if (!level) return deny(db, actorId, "project.create", ctx, NOT_ALLOWED);
    const parsed = parse(raw);
    if (!parsed.ok) return parsed;
    const project = parsed.project;
    if (Object.keys(project.prompts).length > 0) return { ok: false, error: PROMPTS_FIXED };
    if ((db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n >= MAX_PROJECTS) return { ok: false, error: TOO_MANY };
    if (level === "manager") {
      if (project.commands.build !== undefined || project.commands.test !== undefined) return deny(db, actorId, "project.create", ctx, ADMIN_ONLY_COMMANDS);
      project.enabled = false;
    }
    try {
      db.prepare("INSERT INTO projects (name, repo, config, enabled, version, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)").run(
        project.name,
        project.repo,
        configOf(project),
        project.enabled ? 1 : 0,
        actorId,
        now,
        actorId,
        now,
      );
    } catch (err) {
      if (!isUnique(err)) throw err;
      const nameTaken = db.prepare("SELECT 1 AS taken FROM projects WHERE name = ?").get(project.name) !== undefined;
      return { ok: false, error: nameTaken ? DUPLICATE_NAME : DUPLICATE_REPO };
    }
    audit(db, { action: "project.created", actor: actorId, ip: ctx.ip, detail: { name: project.name, ...detailOf(project) } }, now);
    return { ok: true, name: project.name };
  });
}

/**
 * Saves a whole project. The name never changes. A Project manager cannot change the commands or the enabled flag, and
 * nobody can change the prompt paths here. `expectedVersion` is the version the form was loaded with.
 */
export function updateProject(db: DatabaseSync, actorId: string, name: string, raw: unknown, expectedVersion: number, ctx: AdminCtx): Done {
  const now = ctx.now ?? Date.now();
  return transaction(db, (): Done => {
    const level = levelOf(db, actorId);
    if (!level) return deny(db, actorId, "project.update", ctx, NOT_ALLOWED);
    const current = getProject(db, name);
    if (!current) return { ok: false, error: NOT_FOUND };
    const parsed = parse(raw);
    if (!parsed.ok) return parsed;
    const next = parsed.project;
    if (next.name !== name) return { ok: false, error: "The name of a project cannot be changed." };
    if (!same(next.prompts, current.prompts)) return { ok: false, error: PROMPTS_FIXED };
    // Checked first: a save from a stale form is a stale form, not an attempt, and must not be audited as one.
    if (current.version !== expectedVersion) return { ok: false, error: STALE };
    const changed = changes(current, next);
    if (level === "manager") {
      if (!same(next.commands, current.commands)) return deny(db, actorId, "project.update", ctx, ADMIN_ONLY_COMMANDS);
      // Switching off is open to a Project manager; switching on is the Administrator's decision.
      if (next.enabled && !current.enabled) return deny(db, actorId, "project.update", ctx, ADMIN_ONLY_ENABLE);
      // An Administrator switched this project on after vetting its repository and commands. Pointing it at another
      // repository (or another branch, or more lanes) would run those commands, and the agent with the runner's tokens,
      // on code nobody vetted. So a project that stays on is the Administrator's to change.
      if (current.enabled && next.enabled && Object.keys(changed).length > 0) return deny(db, actorId, "project.update", ctx, SWITCH_OFF_FIRST);
    }
    if (Object.keys(changed).length === 0) return { ok: true };
    try {
      db.prepare("UPDATE projects SET repo = ?, config = ?, enabled = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE name = ?").run(
        next.repo,
        configOf(next),
        next.enabled ? 1 : 0,
        actorId,
        now,
        name,
      );
    } catch (err) {
      if (!isUnique(err)) throw err;
      return { ok: false, error: DUPLICATE_REPO };
    }
    const action = "enabled" in changed ? (next.enabled ? "project.enabled" : "project.disabled") : "project.updated";
    audit(db, { action, actor: actorId, ip: ctx.ip, detail: { name, changes: changed } }, now);
    return { ok: true };
  });
}

/** Switches a project on (Administrator only) or off (a Project manager can too). */
export function setProjectEnabled(db: DatabaseSync, actorId: string, name: string, enabled: boolean, expectedVersion: number, ctx: AdminCtx): Done {
  const current = getProject(db, name);
  if (!current) return { ok: false, error: NOT_FOUND };
  const { version: _version, createdAt: _c, updatedAt: _u, ...project } = current;
  return updateProject(db, actorId, name, { ...project, enabled }, expectedVersion, ctx);
}

export interface ImportResult {
  imported: string[];
  skipped: string[];
}

/**
 * Brings projects/*.json into an empty table, once. When the table already has rows it does nothing, so a later start
 * can never undo an edit. A file that does not validate is skipped and named; the others still go in.
 */
export function importProjects(db: DatabaseSync, dir: string, log: (message: string) => void = console.log, now: number = Date.now()): ImportResult {
  const result: ImportResult = { imported: [], skipped: [] };
  const count = db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number };
  if (count.n > 0 || !existsSync(dir)) return result;

  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  transaction(db, () => {
    const insert = db.prepare("INSERT INTO projects (name, repo, config, enabled, version, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, 1, NULL, ?, NULL, ?)");
    for (const file of files) {
      try {
        const project = parseProject(JSON.parse(readFileSync(join(dir, file), "utf8")), join(dir, file));
        insert.run(project.name, project.repo, configOf(project), project.enabled ? 1 : 0, now, now);
        audit(db, { action: "project.imported", detail: { name: project.name, ...detailOf(project), file } }, now);
        result.imported.push(project.name);
      } catch (err) {
        result.skipped.push(file);
        log(`[projects] skipped ${file}: ${err instanceof Error ? err.message.split("\n").join(" ") : "unreadable"}`);
      }
    }
  });
  if (result.imported.length > 0) log(`[projects] imported ${result.imported.length} project(s) from ${dir}: ${result.imported.join(", ")}`);
  return result;
}
