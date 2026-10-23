import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/** Whether `name` is an executable on PATH (honours PATHEXT on Windows). */
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string | null {
  const dirs = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  const exts = platform === "win32" ? ["", ...(env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")] : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        // not here
      }
    }
  }
  return null;
}

/** First word of a command line, for a "is this tool installed" check. */
export const programOf = (command: string): string => command.trim().split(/\s+/)[0] ?? "";

/** Tools that are missing from PATH, so the run fails before the agent spends any tokens. */
export function missingTools(tools: readonly string[], env: NodeJS.ProcessEnv = process.env): string[] {
  return [...new Set(tools.filter(Boolean))].filter((t) => findOnPath(t, env) === null);
}
