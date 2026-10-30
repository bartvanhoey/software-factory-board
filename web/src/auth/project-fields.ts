/** Which form input an error from the project rules is about. Those errors are worded "field.path: message". */
const FIELD_OF: Record<string, string> = {
  name: "name",
  repo: "repo",
  defaultBranch: "defaultBranch",
  stack: "stack",
  "limits.maxTurns": "maxTurns",
  "limits.qaMaxTurns": "qaMaxTurns",
  "limits.reviewMaxTurns": "reviewMaxTurns",
  "limits.maxReworks": "maxReworks",
  "commands.build": "commandBuild",
  "commands.test": "commandTest",
};

export function errorField(error: string | undefined): string | null {
  const prefix = error?.split(":", 1)[0] ?? "";
  return FIELD_OF[prefix] ?? null;
}
