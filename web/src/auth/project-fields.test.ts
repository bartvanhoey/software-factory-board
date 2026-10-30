import { describe, expect, it } from "vitest";
import { createProject } from "./projects";
import { errorField } from "./project-fields";
import { openDb } from "./db";
import { createUser, grantRole } from "./users";

describe("errorField", () => {
  it("maps the schema's field paths to the form's input names", () => {
    expect(errorField("repo: must be owner/name")).toBe("repo");
    expect(errorField("limits.qaMaxTurns: Number must be less than or equal to 100")).toBe("qaMaxTurns");
    expect(errorField("commands.test: must be a single line")).toBe("commandTest");
    expect(errorField("defaultBranch: is not a valid branch name")).toBe("defaultBranch");
  });

  it("returns null for an error that is not about one input", () => {
    for (const e of [undefined, "", "Something went wrong. Try again.", "Someone else changed this project since you opened it.", "project: Required"]) expect(errorField(e)).toBeNull();
  });

  it("matches what the rules really say for each field a form can get wrong", () => {
    const db = openDb(":memory:");
    const admin = createUser(db, { email: "a@example.com", passwordHash: "x" }, 1);
    grantRole(db, admin, "admin", null, 1);
    const cases: [Record<string, unknown>, string][] = [
      [{ name: "ok", repo: "not a repo" }, "repo"],
      [{ name: "Bad Name", repo: "o/n" }, "name"],
      [{ name: "ok", repo: "o/n", defaultBranch: "--x" }, "defaultBranch"],
      [{ name: "ok", repo: "o/n", limits: { maxTurns: 101 } }, "maxTurns"],
      [{ name: "ok", repo: "o/n", limits: { maxReworks: 6 } }, "maxReworks"],
      [{ name: "ok", repo: "o/n", commands: { test: "a\nb" } }, "commandTest"],
      [{ name: "ok", repo: "o/n", commands: { build: "x".repeat(501) } }, "commandBuild"],
    ];
    for (const [raw, field] of cases) {
      const r = createProject(db, admin, raw, { ip: null, now: 2 });
      expect(r.ok).toBe(false);
      expect(errorField(r.ok ? undefined : r.error), JSON.stringify(raw)).toBe(field);
    }
  });
});
