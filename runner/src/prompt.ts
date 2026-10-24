import type { Project } from "@factory/shared";

const NONE = "(none configured)";

/** Fill the {{...}} placeholders in a prompt. An unknown placeholder is an error, so typos surface early. */
export function renderPrompt(template: string, project: Project): string {
  const values: Record<string, string> = {
    build_command: project.commands.build ?? NONE,
    test_command: project.commands.test ?? NONE,
    project_name: project.name,
    default_branch: project.defaultBranch,
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`unknown placeholder {{${key}}} in prompt`);
    return value;
  });
}

const BASE_TOOLS = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "Bash(git add:*)",
  "Bash(git commit:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
];

const STACK_TOOLS: Record<Project["stack"], string[]> = {
  dotnet: ["Bash(dotnet:*)"],
  node: ["Bash(npm:*)", "Bash(npx:*)"],
  python: ["Bash(python:*)", "Bash(pytest:*)"],
  other: [],
};

/** Tools the builder agent may use: file tools, read-only-ish git, and the stack's own toolchain. */
export function allowedToolsFor(project: Project): string[] {
  return [...BASE_TOOLS, ...STACK_TOOLS[project.stack]];
}

const QA_BASE_TOOLS = ["Read", "Glob", "Grep", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git status:*)"];

/** Tools the qa agent may use. It reviews and may run the stack's toolchain, but has no Edit or Write. */
export function qaToolsFor(project: Project): string[] {
  return [...QA_BASE_TOOLS, ...STACK_TOOLS[project.stack]];
}

/** What the lane runs to check the branch independently of the agent: tests, else a build, else nothing. */
export function verifyStep(project: Project): { kind: "test" | "build"; command: string } | null {
  if (project.commands.test) return { kind: "test", command: project.commands.test };
  if (project.commands.build) return { kind: "build", command: project.commands.build };
  return null;
}
