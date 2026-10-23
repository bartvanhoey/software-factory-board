import { LANES, LANE_LABELS, type BoardIssue, type Lane, type ProjectResult } from "./types";

const OPEN_LANES = LANE_LABELS as readonly string[];

/**
 * Lane of an issue, or null when it is not on the board.
 * Closed issues are always `done`. An open issue with several lane labels goes to the
 * furthest lane and is flagged, so a stuck label swap is visible instead of hidden.
 */
export function resolveLane(
  labels: readonly string[],
  state: "OPEN" | "CLOSED",
): { lane: Lane; conflict: boolean } | null {
  if (state === "CLOSED") return { lane: "done", conflict: false };
  const found = labels.filter((l) => OPEN_LANES.includes(l));
  if (found.length === 0) return null;
  const furthest = Math.max(...found.map((l) => LANES.indexOf(l as Lane)));
  return { lane: LANES[furthest] as Lane, conflict: new Set(found).size > 1 };
}

export function emptyLanes(): Record<Lane, BoardIssue[]> {
  return { ready: [], building: [], qa: [], review: [], done: [] };
}

/** Group issues by lane, newest update first. */
export function groupByLane(issues: readonly BoardIssue[]): Record<Lane, BoardIssue[]> {
  const grouped = emptyLanes();
  for (const issue of issues) grouped[issue.lane].push(issue);
  for (const lane of LANES) grouped[lane].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return grouped;
}

/** Parse the `project` query param ("a,b") into a list of project names. */
export function parseSelected(param: string | string[] | undefined): string[] {
  const raw = Array.isArray(param) ? param.join(",") : (param ?? "");
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

/** Issues of the selected projects; an empty selection means all projects. */
export function selectIssues(results: readonly ProjectResult[], selected: readonly string[]): BoardIssue[] {
  return results.flatMap((r) =>
    r.status === "ok" && (selected.length === 0 || selected.includes(r.info.name)) ? r.issues : [],
  );
}

/** Next selection after clicking a project chip: toggles it in or out. */
export function toggleProject(selected: readonly string[], name: string): string[] {
  return selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name];
}

export function timeAgo(iso: string, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
