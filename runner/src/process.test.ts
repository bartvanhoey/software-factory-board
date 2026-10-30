import { describe, expect, it } from "vitest";
import { childEnv, runProcess, runShellCommand } from "./process.js";

describe("childEnv", () => {
  it("drops RUNNER_API_TOKEN and keeps the rest", () => {
    const env = childEnv({ EXTRA: "1" }, { PATH: "/bin", GH_TOKEN: "gh", RUNNER_API_TOKEN: "secret" });
    expect(env).toEqual({ PATH: "/bin", GH_TOKEN: "gh", EXTRA: "1" });
  });

  it("does not let a caller put it back by accident", () => {
    expect(childEnv(undefined, { RUNNER_API_TOKEN: "secret" })).toEqual({});
  });
});

describe("what a lane starts", () => {
  const key = "RUNNER_API_TOKEN";
  const script = `process.stdout.write(String(process.env.${key} === undefined))`;

  it("does not see RUNNER_API_TOKEN, as a program or through the shell", async () => {
    process.env[key] = "secret-value";
    try {
      expect((await runProcess(process.execPath, ["-e", script])).stdout).toBe("true");
      expect((await runShellCommand(`"${process.execPath}" -e "${script.replace(/"/g, '\\"')}"`)).stdout).toBe("true");
    } finally {
      delete process.env[key];
    }
  });
});
