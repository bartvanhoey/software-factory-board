"use server";

import { revalidatePath } from "next/cache";
import { denyNonAdmin, type AdminCtx, type Done } from "./admin";
import { requestContext, requireAccess, type AppSession } from "./dal";
import { getDb } from "./db";
import { createProject, getProject, setProjectEnabled, updateProject } from "./projects";
import { hasRole } from "./users";

export interface ProjectState {
  error?: string;
  message?: string;
  /** What was submitted, sent back with an error so the form is not emptied. Never carries anything but the form's own fields. */
  values?: Record<string, string>;
}

const FORM_FIELDS = ["name", "repo", "defaultBranch", "stack", "laneBuild", "laneQa", "laneReview", "maxTurns", "qaMaxTurns", "reviewMaxTurns", "maxReworks", "commandBuild", "commandTest", "enabled"];

/** The submitted fields, as strings ("on" for a ticked box), so a form that failed can be shown again as it was typed. */
function echo(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of FORM_FIELDS) {
    const v = form.get(name);
    if (typeof v === "string") out[name] = v;
  }
  return out;
}

const FAILED: ProjectState = { error: "Something went wrong. Try again." };

// Server actions are public endpoints: each one re-checks the session and the role itself (the page that rendered the
// form proves nothing), then projects.ts checks again inside its transaction against the database.
async function actor(attempted: string): Promise<{ session: AppSession; ctx: AdminCtx; isAdmin: boolean }> {
  const ctx: AdminCtx = { ip: (await requestContext()).ip };
  const session = await requireAccess("issue-admin", (s) => denyNonAdmin(getDb(), s.userId, attempted, ctx));
  return { session, ctx, isAdmin: hasRole(session.roles, "admin") };
}

const text = (form: FormData, name: string): string => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};
const checked = (form: FormData, name: string): boolean => form.get(name) === "on";
/** An empty box means "use the default", so it is left out; anything else is passed on for the schema to judge. */
const number = (form: FormData, name: string): number | undefined => {
  const v = text(form, name);
  return v === "" ? undefined : Number(v);
};
const optional = (form: FormData, name: string): string | undefined => text(form, name) || undefined;

function fields(form: FormData): Record<string, unknown> {
  return {
    name: text(form, "name"),
    repo: text(form, "repo"),
    defaultBranch: optional(form, "defaultBranch"),
    stack: optional(form, "stack"),
    lanes: { build: checked(form, "laneBuild"), qa: checked(form, "laneQa"), review: checked(form, "laneReview") },
    limits: { maxTurns: number(form, "maxTurns"), qaMaxTurns: number(form, "qaMaxTurns"), reviewMaxTurns: number(form, "reviewMaxTurns"), maxReworks: number(form, "maxReworks") },
  };
}

const commandsOf = (form: FormData): Record<string, string> => {
  const out: Record<string, string> = {};
  const build = optional(form, "commandBuild");
  const test = optional(form, "commandTest");
  if (build) out.build = build;
  if (test) out.test = test;
  return out;
};

function version(form: FormData): number {
  const v = Number(text(form, "version"));
  return Number.isInteger(v) && v > 0 ? v : -1;
}

// A database error (for example the file is locked for longer than the busy timeout) must not become a crash page.
// Only the message is logged, never the form.
function failed(err: unknown, form: FormData): ProjectState {
  console.error(`[projects] action failed: ${err instanceof Error ? err.message : "unknown error"}`);
  return { ...FAILED, values: echo(form) };
}

function finish(result: Done, message: string, form: FormData): ProjectState {
  if (!result.ok) return { error: result.error, values: echo(form) };
  revalidatePath("/admin/projects");
  revalidatePath("/");
  return { message };
}

export async function createProjectAction(_prev: ProjectState, form: FormData): Promise<ProjectState> {
  const a = await actor("project.create");
  // A Project manager's form has no commands or switch, so none are read for them: the rules in projects.ts would
  // refuse them anyway, but a form that never carries them is not one that can be talked into it.
  const raw = { ...fields(form), ...(a.isAdmin ? { commands: commandsOf(form), enabled: checked(form, "enabled") } : {}) };
  try {
    return finish(createProject(getDb(), a.session.userId, raw, a.ctx), a.isAdmin ? "Project added." : "Project added, switched off. An Administrator switches it on.", form);
  } catch (err) {
    return failed(err, form);
  }
}

export async function saveProjectAction(_prev: ProjectState, form: FormData): Promise<ProjectState> {
  const a = await actor("project.update");
  const name = text(form, "name");
  try {
    const current = getProject(getDb(), name);
    if (!current) return { error: "Project not found.", values: echo(form) };
    // What the form does not carry stays as it is: the commands for a Project manager, and always the switch and the
    // prompt paths (the switch has its own button).
    const raw = { ...fields(form), enabled: current.enabled, prompts: current.prompts, commands: a.isAdmin ? commandsOf(form) : current.commands };
    return finish(updateProject(getDb(), a.session.userId, name, raw, version(form), a.ctx), "Saved.", form);
  } catch (err) {
    return failed(err, form);
  }
}

export async function setProjectEnabledAction(_prev: ProjectState, form: FormData): Promise<ProjectState> {
  const a = await actor("project.enable");
  const on = form.get("enabled") === "true";
  try {
    return finish(setProjectEnabled(getDb(), a.session.userId, text(form, "name"), on, version(form), a.ctx), on ? "Switched on." : "Switched off.", form);
  } catch (err) {
    return failed(err, form);
  }
}
