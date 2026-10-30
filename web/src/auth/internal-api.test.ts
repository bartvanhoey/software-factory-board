import { createHash } from "node:crypto";
import { ProjectsResponseSchema } from "@factory/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db";
import { isRunner, projectsPayload } from "./internal-api";
import { createProject } from "./projects";
import { createUser, grantRole } from "./users";

const token = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 3)).toString("base64");
const digest = createHash("sha256").update(token).digest();

describe("isRunner", () => {
  it("accepts exactly the runner token as a bearer token", () => {
    expect(isRunner(`Bearer ${token}`, digest)).toBe(true);
  });

  it("refuses everything else the same way", () => {
    for (const header of [null, "", "Bearer", "Bearer ", `Bearer  ${token}`, `bearer ${token}`, `Basic ${token}`, token, `Bearer ${token}x`, `Bearer ${token.slice(1)}`, "Bearer wrong", `Bearer ${token} extra`]) {
      expect(isRunner(header, digest), String(header)).toBe(false);
    }
  });
});

describe("projectsPayload", () => {
  it("lists every project, disabled ones included, without bookkeeping, in the shape the runner validates", () => {
    const db = openDb(":memory:");
    const admin = createUser(db, { email: "admin@example.com", passwordHash: "x" }, 1);
    grantRole(db, admin, "admin", null, 1);
    const manager = createUser(db, { email: "m@example.com", passwordHash: "x" }, 1);
    grantRole(db, manager, "issue-admin", null, 1);
    const ctx = { ip: null, now: 5 };
    createProject(db, admin, { name: "b-on", repo: "o/b", commands: { test: "npm test" } }, ctx);
    createProject(db, manager, { name: "a-off", repo: "o/a" }, ctx); // starts disabled

    const payload = projectsPayload(db);
    expect(payload.projects.map((p) => [p.name, p.enabled])).toEqual([["a-off", false], ["b-on", true]]);
    expect(payload.projects[1]!.commands.test).toBe("npm test");
    expect(JSON.stringify(payload)).not.toMatch(/version|createdAt|updatedAt|created_by/);
    expect(ProjectsResponseSchema.parse(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  });

  it("is an empty list for an empty table", () => {
    expect(projectsPayload(openDb(":memory:"))).toEqual({ projects: [] });
  });
});
