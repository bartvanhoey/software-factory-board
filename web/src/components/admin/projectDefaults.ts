/** A project name suggested from its repository: "owner/My_Repo.Web" becomes "my-repo-web". Empty when nothing usable is left. */
export function nameFromRepo(repo: string): string {
  const name = repo.split("/")[1] ?? "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}

/**
 * Build and test commands suggested for a stack. The runner runs the build command and then the test command, so a
 * Node project installs its dependencies in the build. Only stacks the runner image can run have one (it has Node and
 * the .NET SDK, not Python). They are suggestions: the form says so and the Administrator can change them.
 */
export const COMMAND_PRESETS: Record<string, { build: string; test: string }> = {
  dotnet: { build: "dotnet build --nologo -v q", test: "dotnet test --nologo -v q" },
  node: { build: "npm ci && npm run build --if-present", test: "npm test" },
};
