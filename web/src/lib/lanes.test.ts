import { describe, expect, it } from "vitest";
import { demoBoard } from "./demo";
import { groupByLane, parseSelected, resolveLane, selectIssues, timeAgo, toggleProject } from "./lanes";

describe("resolveLane", () => {
  it("puts a single lane label in that lane", () => {
    expect(resolveLane(["bug", "qa"], "OPEN")).toEqual({ lane: "qa", conflict: false });
  });

  it("ignores open issues without a lane label", () => {
    expect(resolveLane(["bug"], "OPEN")).toBeNull();
  });

  it("sends an issue with two lane labels to the furthest lane and flags it", () => {
    expect(resolveLane(["building", "review"], "OPEN")).toEqual({ lane: "review", conflict: true });
  });

  it("always puts closed issues in done", () => {
    expect(resolveLane(["building"], "CLOSED")).toEqual({ lane: "done", conflict: false });
  });
});

describe("groupByLane", () => {
  it("groups by lane and sorts newest first", () => {
    const board = demoBoard(new Date("2026-01-01T12:00:00Z"));
    const issues = selectIssues(board.projects, []);
    const grouped = groupByLane(issues);
    expect(Object.keys(grouped)).toEqual(["ready", "building", "qa", "review", "done"]);
    for (const lane of Object.values(grouped)) {
      const times = lane.map((i) => i.updatedAt);
      expect(times).toEqual([...times].sort().reverse());
    }
    expect(Object.values(grouped).flat()).toHaveLength(issues.length);
  });
});

describe("project selection", () => {
  it("parses the query param", () => {
    expect(parseSelected(undefined)).toEqual([]);
    expect(parseSelected("a,b")).toEqual(["a", "b"]);
    expect(parseSelected(["a", "b,a"])).toEqual(["a", "b"]);
    expect(parseSelected(" , ")).toEqual([]);
  });

  it("toggles a project in and out", () => {
    expect(toggleProject([], "a")).toEqual(["a"]);
    expect(toggleProject(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleProject(["a", "b"], "a")).toEqual(["b"]);
  });

  it("selects all projects when nothing is selected, and skips errored/disabled ones", () => {
    const { projects } = demoBoard();
    const all = selectIssues(projects, []);
    expect(new Set(all.map((i) => i.project))).toEqual(
      new Set(["blazor-employee-management", "orders-api", "inventory-tool"]),
    );
    const one = selectIssues(projects, ["orders-api"]);
    expect(one.length).toBeGreaterThan(0);
    expect(one.every((i) => i.project === "orders-api")).toBe(true);
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-01-10T12:00:00Z");
  it("formats minutes, hours and days", () => {
    expect(timeAgo("2026-01-10T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-01-10T11:15:00Z", now)).toBe("45m ago");
    expect(timeAgo("2026-01-10T07:00:00Z", now)).toBe("5h ago");
    expect(timeAgo("2026-01-07T12:00:00Z", now)).toBe("3d ago");
  });
});
