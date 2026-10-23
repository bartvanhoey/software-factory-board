import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ProjectSchema, type Project } from "./project.js";

export function parseProject(raw: unknown, file: string): Project {
  const result = ProjectSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid project file ${file}:\n${issues}`);
  }
  const expected = basename(file, ".json");
  if (result.data.name !== expected) {
    throw new Error(`Invalid project file ${file}:\n  name: "${result.data.name}" must match filename "${expected}"`);
  }
  return result.data;
}

export function loadProjects(dir: string): Project[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const projects = files.map((f) => {
    const path = join(dir, f);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      throw new Error(`Invalid project file ${path}: ${(e as Error).message}`);
    }
    return parseProject(raw, path);
  });
  const repos = new Set<string>();
  for (const p of projects) {
    const key = p.repo.toLowerCase();
    if (repos.has(key)) throw new Error(`Duplicate repo in projects/: ${p.repo}`);
    repos.add(key);
  }
  return projects;
}
