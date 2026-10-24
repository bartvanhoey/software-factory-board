import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalConfigSchema, type LocalConfig, type Project } from "@factory/shared";
import { UsageError, EXIT } from "./errors.js";
import type { Gh, Git } from "./ports.js";

/** Root of this repo: runner/src/config.ts -> ../.. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface Settings {
  projectsDir: string;
  dataDir: string;
  /** Where clones and worktrees live; null when neither local.json nor FACTORY_WORKSPACE says. */
  workspace: string | null;
  local: LocalConfig | null;
}

export function loadLocalConfig(file: string): LocalConfig | null {
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new UsageError(`${file} is not valid JSON: ${(e as Error).message}`, EXIT.missingFile);
  }
  const parsed = LocalConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new UsageError(`${file} is invalid: ${issues}`, EXIT.missingFile);
  }
  return parsed.data;
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const local = loadLocalConfig(env.FACTORY_LOCAL_CONFIG ?? join(REPO_ROOT, "local.json"));
  return {
    projectsDir: env.FACTORY_PROJECTS_DIR ?? join(REPO_ROOT, "projects"),
    dataDir: env.FACTORY_DATA ?? join(REPO_ROOT, "data"),
    workspace: local?.workspace ?? env.FACTORY_WORKSPACE ?? null,
    local,
  };
}

/** Clone path: local.json override, else <workspace>/<repo name>. */
export function resolveCloneDir(project: Project, settings: Settings): string {
  const override = settings.local?.overrides[project.name];
  if (override) return resolve(override);
  if (!settings.workspace) {
    throw new UsageError(
      `no workspace for ${project.name}: set "workspace" in local.json or FACTORY_WORKSPACE`,
      EXIT.missingFile,
    );
  }
  return join(settings.workspace, project.repo.split("/")[1] ?? project.name);
}

/** Parent folder for worktrees: the workspace, or the clone's parent when only an override is set. */
export function worktreeRoot(project: Project, settings: Settings, cloneDir: string): string {
  return join(settings.workspace ?? dirname(cloneDir), ".factory-worktrees", project.name);
}

const sameRepo = (url: string, repo: string): boolean =>
  url.toLowerCase().replace(/\.git$/, "").endsWith(`/${repo.toLowerCase()}`) ||
  url.toLowerCase().replace(/\.git$/, "").endsWith(`:${repo.toLowerCase()}`);

/** Clone the project if it is missing; refuse a folder that holds a different repo. */
export async function ensureClone(gh: Gh, git: Git, project: Project, dir: string, say: (m: string) => void): Promise<void> {
  if (!existsSync(dir)) {
    say(`cloning ${project.repo} into ${dir}`);
    await gh.cloneRepo(project.repo, dir);
    return;
  }
  const origin = await git.originUrl(dir);
  if (!sameRepo(origin, project.repo)) {
    throw new UsageError(
      `${dir} is a clone of ${origin}, not ${project.repo}: set an override for ${project.name} in local.json`,
      EXIT.precondition,
    );
  }
}

/** Prompt file: the project's own override (relative to the repo root), else the default. */
export function promptPath(project: Project): string {
  return join(REPO_ROOT, project.prompts.builder ?? join("prompts", "builder.md"));
}

/** The qa prompt file: the project's own override (relative to the repo root), else the default. */
export function qaPromptPath(project: Project): string {
  return join(REPO_ROOT, project.prompts.qa ?? join("prompts", "qa.md"));
}

/** The review prompt file: the project's own override (relative to the repo root), else the default. */
export function reviewPromptPath(project: Project): string {
  return join(REPO_ROOT, project.prompts.review ?? join("prompts", "review.md"));
}

export const logDirFor = (settings: Settings, project: Project): string => join(settings.dataDir, "logs", project.name);
export const lockDirFor = (settings: Settings, project: Project): string => join(settings.dataDir, "locks", `${project.name}.lock`);
export const eventsFile = (settings: Settings): string => join(settings.dataDir, "events.jsonl");
