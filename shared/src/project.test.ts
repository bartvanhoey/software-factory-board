import { describe, expect, it } from "vitest";
import { ProjectsResponseSchema, hasTests, parseProject } from "./index.js";

const file = "projects/demo.json";
const base = { name: "demo", repo: "owner/demo" };

describe("ProjectSchema", () => {
  it("applies defaults", () => {
    const p = parseProject(base, file);
    expect(p.defaultBranch).toBe("main");
    expect(p.enabled).toBe(true);
    expect(p.lanes).toEqual({ build: true, qa: true, review: true });
    expect(p.limits).toEqual({ maxTurns: 20, qaMaxTurns: 20, reviewMaxTurns: 20, maxReworks: 2 });
  });

  it("lets a project set the turn caps separately", () => {
    const p = parseProject({ ...base, limits: { maxTurns: 30 } }, file);
    expect(p.limits).toEqual({ maxTurns: 30, qaMaxTurns: 20, reviewMaxTurns: 20, maxReworks: 2 });
    expect(parseProject({ ...base, limits: { qaMaxTurns: 5 } }, file).limits.qaMaxTurns).toBe(5);
    expect(parseProject({ ...base, limits: { reviewMaxTurns: 9 } }, file).limits.reviewMaxTurns).toBe(9);
    expect(() => parseProject({ ...base, limits: { qaMaxTurns: 0 } }, file)).toThrow(/qaMaxTurns/);
    expect(() => parseProject({ ...base, limits: { reviewMaxTurns: 0 } }, file)).toThrow(/reviewMaxTurns/);
  });

  it("lets a project cap the automatic reworks, down to none", () => {
    expect(parseProject({ ...base, limits: { maxReworks: 5 } }, file).limits.maxReworks).toBe(5);
    expect(parseProject({ ...base, limits: { maxReworks: 0 } }, file).limits.maxReworks).toBe(0);
    expect(() => parseProject({ ...base, limits: { maxReworks: -1 } }, file)).toThrow(/maxReworks/);
    expect(() => parseProject({ ...base, limits: { maxReworks: 1.5 } }, file)).toThrow(/maxReworks/);
  });

  it("caps the limits so a form cannot set up an unbounded spend", () => {
    expect(parseProject({ ...base, limits: { maxTurns: 100, qaMaxTurns: 100, reviewMaxTurns: 100, maxReworks: 5 } }, file).limits.maxTurns).toBe(100);
    expect(() => parseProject({ ...base, limits: { maxTurns: 101 } }, file)).toThrow(/maxTurns/);
    expect(() => parseProject({ ...base, limits: { qaMaxTurns: 100000 } }, file)).toThrow(/qaMaxTurns/);
    expect(() => parseProject({ ...base, limits: { reviewMaxTurns: 101 } }, file)).toThrow(/reviewMaxTurns/);
    expect(() => parseProject({ ...base, limits: { maxReworks: 6 } }, file)).toThrow(/maxReworks/);
  });

  it("accepts ordinary branch names and refuses ones that git would read as options or paths", () => {
    for (const ok of ["main", "master", "release/1.2", "feature_x-1", "v1.0"]) expect(parseProject({ ...base, defaultBranch: ok }, file).defaultBranch).toBe(ok);
    for (const bad of ["-main", "--upload-pack=x", ".hidden", "a..b", "a//b", "a/", "a.lock", "a b", "a;b", "a\nb", "", "x".repeat(101)]) {
      expect(() => parseProject({ ...base, defaultBranch: bad }, file), bad).toThrow(/defaultBranch/);
    }
  });

  it("accepts GitHub repository names and refuses ones that would escape the workspace or read as options", () => {
    for (const ok of ["owner/name", "Owner/Some.Repo_1", "a-b/c-d", "o/_x", "bartvanhoey/BlazorEmployeeManagementRepo"]) expect(parseProject({ ...base, repo: ok }, file).repo).toBe(ok);
    for (const bad of ["o/.", "o/..", "-u/x", "o/-x", "o/.hidden", "o/n.git", "o/", "/n", "a/b/c", "o /n", "o/n;x", `o/${"x".repeat(200)}`, "-o/x"]) {
      expect(() => parseProject({ ...base, repo: bad }, file), bad).toThrow(/repo/);
    }
  });

  it("bounds the name", () => {
    expect(() => parseProject({ name: "x".repeat(65), repo: "o/n" }, "projects/" + "x".repeat(65) + ".json")).toThrow(/name/);
  });

  it("keeps prompt paths inside the repo", () => {
    expect(parseProject({ ...base, prompts: { qa: "prompts/mine.md" } }, file).prompts.qa).toBe("prompts/mine.md");
    for (const bad of ["../../proc/self/environ", "/etc/passwd", "prompts/../../x", "C:/x", "prompts//x", "", "-x"]) {
      expect(() => parseProject({ ...base, prompts: { builder: bad } }, file), bad).toThrow(/builder/);
    }
  });

  it("keeps a command to one reasonable line", () => {
    expect(parseProject({ ...base, commands: { test: "npm test -- --run" } }, file).commands.test).toBe("npm test -- --run");
    expect(() => parseProject({ ...base, commands: { test: "npm test\nrm -rf /" } }, file)).toThrow(/test/);
    expect(() => parseProject({ ...base, commands: { build: "x".repeat(501) } }, file)).toThrow(/build/);
  });

  it("describes the internal projects response", () => {
    const body = { projects: [parseProject(base, file)] };
    expect(ProjectsResponseSchema.parse(body)).toEqual(body);
    expect(() => ProjectsResponseSchema.parse({ projects: [{ name: "x" }] })).toThrow();
    expect(() => ProjectsResponseSchema.parse({ projects: [], extra: 1 })).toThrow();
  });

  it("accepts a rework prompt override", () => {
    expect(parseProject({ ...base, prompts: { rework: "prompts/mine.md" } }, file).prompts.rework).toBe("prompts/mine.md");
  });

  it("flags a project without a test command", () => {
    expect(hasTests(parseProject(base, file))).toBe(false);
    expect(hasTests(parseProject({ ...base, commands: { test: "npm test" } }, file))).toBe(true);
  });

  it("rejects a bad repo format", () => {
    expect(() => parseProject({ ...base, repo: "nope" }, file)).toThrow(/repo: must be owner\/name/);
  });

  it("rejects a missing repo", () => {
    expect(() => parseProject({ name: "demo" }, file)).toThrow(/repo/);
  });

  it("rejects unknown keys", () => {
    expect(() => parseProject({ ...base, path: "C:/x" }, file)).toThrow(/Unrecognized key/);
  });

  it("rejects a name that differs from the filename", () => {
    expect(() => parseProject({ ...base, name: "other" }, file)).toThrow(/must match filename "demo"/);
  });
});
