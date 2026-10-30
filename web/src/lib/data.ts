import "server-only";
import { hasTests } from "@factory/shared";
import { getDb } from "@/auth/db";
import { listProjects } from "@/auth/projects";
import { demoBoard } from "./demo";
import { fetchBoards } from "./github";
import type { BoardData, ProjectInfo } from "./types";

/**
 * Board data for the page. Falls back to demo data when FACTORY_DEMO=1 or GH_TOKEN is
 * unset, and says why, so demo data is never mistaken for live data.
 */
export async function loadBoard(): Promise<BoardData> {
  const now = new Date();
  if (process.env.FACTORY_DEMO === "1") return { ...demoBoard(now), demoReason: "FACTORY_DEMO=1" };

  const token = process.env.GH_TOKEN;
  if (!token) return { ...demoBoard(now), demoReason: "GH_TOKEN is not set" };

  const infos: ProjectInfo[] = listProjects(getDb()).map((p) => ({
    name: p.name,
    repo: p.repo,
    defaultBranch: p.defaultBranch,
    stack: p.stack,
    hasTests: hasTests(p),
    enabled: p.enabled,
  }));

  return { source: "live", fetchedAt: now.toISOString(), projects: await fetchBoards(infos, token, now) };
}
