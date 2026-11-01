import { ProjectSchema } from "@factory/shared";
import { describe, expect, it } from "vitest";
import { COMMAND_PRESETS, nameFromRepo } from "./projectDefaults";

describe("nameFromRepo", () => {
  it("makes a slug from the repository name", () => {
    expect(nameFromRepo("bartvanhoey/BlazorEmployeeManagementRepo")).toBe("blazoremployeemanagementrepo");
    expect(nameFromRepo("o/My_Repo.Web")).toBe("my-repo-web");
    expect(nameFromRepo("o/--odd--name--")).toBe("odd-name");
  });

  it("is empty until there is a repository name", () => {
    for (const partial of ["", "owner", "owner/", "owner/---"]) expect(nameFromRepo(partial)).toBe("");
  });

  it("always gives a name the project rules accept", () => {
    for (const repo of ["o/Repo", "o/a.b.c", "o/9lives", "o/" + "x".repeat(150), "o/a_b_c-d"]) {
      const name = nameFromRepo(repo);
      expect(ProjectSchema.safeParse({ name, repo }).success, `${repo} -> ${name}`).toBe(true);
    }
  });
});

describe("COMMAND_PRESETS", () => {
  it("only offers commands the project rules accept", () => {
    for (const [stack, commands] of Object.entries(COMMAND_PRESETS)) {
      expect(ProjectSchema.safeParse({ name: "x", repo: "o/x", stack, commands }).success, stack).toBe(true);
    }
  });
});
