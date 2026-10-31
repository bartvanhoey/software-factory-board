// No "server-only" or next/* imports: the testable core of the runner's internal endpoint. The route handler is a thin shell.
import { createHash, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ProjectsResponseSchema, type ProjectsResponse } from "@factory/shared";
import { listProjects } from "./projects";

/**
 * True when the Authorization header is `Bearer <the runner token>`. Both sides are hashed first, so the comparison has a
 * fixed length and no early exit that depends on how much of the token was right.
 */
export function isRunner(authorization: string | null, expectedDigest: Buffer): boolean {
  const match = /^Bearer ([^\s]+)$/.exec(authorization ?? "");
  if (!match) return false;
  const given = createHash("sha256").update(match[1] as string).digest();
  return given.length === expectedDigest.length && timingSafeEqual(given, expectedDigest);
}

/** Every project in use, disabled ones included (a lane command says "disabled" rather than "unknown project"); archived ones are left out. No bookkeeping fields. */
export function projectsPayload(db: DatabaseSync): ProjectsResponse {
  const projects = listProjects(db).map(({ version: _v, createdAt: _c, updatedAt: _u, archivedAt: _a, ...project }) => project);
  return ProjectsResponseSchema.parse({ projects });
}
