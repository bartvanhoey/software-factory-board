import { describe, expect, it } from "vitest";
import { hasTests, parseProject } from "./index.js";

const file = "projects/demo.json";
const base = { name: "demo", repo: "owner/demo" };

describe("ProjectSchema", () => {
  it("applies defaults", () => {
    const p = parseProject(base, file);
    expect(p.defaultBranch).toBe("main");
    expect(p.enabled).toBe(true);
    expect(p.lanes).toEqual({ build: true, qa: true, review: true });
    expect(p.limits).toEqual({ maxTurns: 20, qaMaxTurns: 20, reviewMaxTurns: 20 });
  });

  it("lets a project set the turn caps separately", () => {
    const p = parseProject({ ...base, limits: { maxTurns: 30 } }, file);
    expect(p.limits).toEqual({ maxTurns: 30, qaMaxTurns: 20, reviewMaxTurns: 20 });
    expect(parseProject({ ...base, limits: { qaMaxTurns: 5 } }, file).limits.qaMaxTurns).toBe(5);
    expect(parseProject({ ...base, limits: { reviewMaxTurns: 9 } }, file).limits.reviewMaxTurns).toBe(9);
    expect(() => parseProject({ ...base, limits: { qaMaxTurns: 0 } }, file)).toThrow(/qaMaxTurns/);
    expect(() => parseProject({ ...base, limits: { reviewMaxTurns: 0 } }, file)).toThrow(/reviewMaxTurns/);
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
