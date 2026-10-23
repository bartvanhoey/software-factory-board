import type { BoardData, BoardIssue, BoardPr, ChecksState, Lane, ProjectInfo, ProjectResult } from "./types";

const MIN = 60_000;

const blazor: ProjectInfo = {
  name: "blazor-employee-management",
  repo: "bartvanhoey/BlazorEmployeeManagementRepo",
  stack: "dotnet",
  hasTests: true,
  enabled: true,
};
const orders: ProjectInfo = { name: "orders-api", repo: "acme/orders-api", stack: "node", hasTests: true, enabled: true };
const inventory: ProjectInfo = {
  name: "inventory-tool",
  repo: "acme/inventory-tool",
  stack: "python",
  hasTests: false,
  enabled: true,
};
const portal: ProjectInfo = { name: "legacy-portal", repo: "acme/legacy-portal", stack: "other", hasTests: false, enabled: true };
const mobile: ProjectInfo = { name: "mobile-app", repo: "acme/mobile-app", stack: "other", hasTests: true, enabled: false };

/** Demo board with timestamps relative to `now`, so it always looks freshly updated. */
export function demoBoard(now: Date = new Date()): BoardData {
  const ago = (minutes: number) => new Date(now.getTime() - minutes * MIN).toISOString();

  const pr = (number: number, project: ProjectInfo, checks: ChecksState, o: Partial<BoardPr> = {}): BoardPr => ({
    number,
    url: `https://github.com/${project.repo}/pull/${number}`,
    draft: false,
    merged: false,
    checks,
    ...o,
  });

  const issue = (
    project: ProjectInfo,
    number: number,
    title: string,
    lane: Lane,
    minutes: number,
    o: Partial<BoardIssue> = {},
  ): BoardIssue => ({
    project: project.name,
    number,
    title,
    url: `https://github.com/${project.repo}/issues/${number}`,
    lane,
    laneConflict: false,
    assignee: lane === "ready" ? null : "factory-bot",
    updatedAt: ago(minutes),
    pr: null,
    ...o,
  });

  const blazorIssues = [
    issue(blazor, 14, "Add pagination to the employee list", "ready", 35),
    issue(blazor, 15, "Validate email format on the edit form", "ready", 190),
    issue(blazor, 12, "Show department name in the employee card", "building", 12, {
      pr: pr(21, blazor, "pending", { draft: true }),
    }),
    issue(blazor, 9, "Delete confirmation dialog", "qa", 48, { pr: pr(20, blazor, "success", { draft: true }) }),
    issue(blazor, 7, "Fix date picker timezone offset", "review", 300, { pr: pr(18, blazor, "success") }),
    issue(blazor, 5, "Seed data for the API project", "done", 60 * 26, { pr: pr(16, blazor, "success", { merged: true }) }),
    issue(blazor, 3, "Add xUnit tests for EmployeeService", "done", 60 * 24 * 4, {
      pr: pr(11, blazor, "success", { merged: true }),
    }),
  ];

  const ordersIssues = [
    issue(orders, 88, "Rate limit the /orders endpoint", "ready", 20),
    issue(orders, 87, "Return 404 for unknown order ids", "ready", 75),
    issue(orders, 85, "Retry failed webhook deliveries", "building", 6, { pr: pr(91, orders, "pending", { draft: true }) }),
    issue(orders, 84, "Add OpenAPI examples", "building", 60 * 30, { pr: pr(90, orders, "failure", { draft: true }) }),
    issue(orders, 80, "Paginate order history", "qa", 25, { pr: pr(89, orders, "failure", { draft: true }) }),
    issue(orders, 79, "Normalize currency rounding", "review", 90, { pr: pr(86, orders, "success") }),
    issue(orders, 77, "Log request ids", "review", 60 * 5, { pr: pr(84, orders, "success") }),
    issue(orders, 74, "Upgrade to Node 22", "done", 60 * 50, { pr: pr(80, orders, "success", { merged: true }) }),
  ];

  const inventoryIssues = [
    issue(inventory, 31, "Export stock levels to CSV", "ready", 140),
    issue(inventory, 29, "Handle empty barcode scans", "building", 18, { pr: pr(33, inventory, "none", { draft: true }) }),
    issue(inventory, 27, "Low-stock email alert", "review", 60 * 8, { pr: pr(32, inventory, "none") }),
    issue(inventory, 25, "Fix SKU sort order", "qa", 55, { laneConflict: true, pr: pr(31, inventory, "none", { draft: true }) }),
    issue(inventory, 22, "Rename warehouse table", "done", 60 * 24 * 2, { pr: pr(28, inventory, "none", { merged: true }) }),
  ];

  const results: ProjectResult[] = [
    { info: blazor, status: "ok", issues: blazorIssues },
    { info: orders, status: "ok", issues: ordersIssues },
    { info: inventory, status: "ok", issues: inventoryIssues },
    {
      info: portal,
      status: "error",
      error: "Could not resolve to a Repository with the name 'acme/legacy-portal'.",
    },
    { info: mobile, status: "disabled" },
  ];

  return { source: "demo", fetchedAt: now.toISOString(), projects: results };
}
