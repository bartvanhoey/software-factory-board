import { basename } from "node:path";
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
