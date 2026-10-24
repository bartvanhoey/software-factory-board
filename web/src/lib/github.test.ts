import { describe, expect, it } from "vitest";
import { buildQuery, fetchBoards, type FetchLike } from "./github";
import type { ProjectInfo } from "./types";

const now = new Date("2026-01-10T12:00:00Z");
const day = 86_400_000;
const iso = (offsetMs: number) => new Date(now.getTime() - offsetMs).toISOString();

const a: ProjectInfo = { name: "a", repo: "o/a", defaultBranch: "main", stack: "node", hasTests: true, enabled: true };
const b: ProjectInfo = { name: "b", repo: "o/b", defaultBranch: "main", stack: "node", hasTests: true, enabled: true };
const off: ProjectInfo = { name: "off", repo: "o/off", defaultBranch: "main", stack: "node", hasTests: true, enabled: false };

type Node = Record<string, unknown>;
const node = (number: number, o: Node = {}): Node => ({
  number,
  title: `Issue ${number}`,
  url: `https://github.com/o/a/issues/${number}`,
  updatedAt: iso(1000),
  closedAt: null,
  state: "OPEN",
  labels: { nodes: [] },
  assignees: { nodes: [] },
  closedByPullRequestsReferences: { nodes: [] },
  ...o,
});
const labels = (...names: string[]) => ({ nodes: names.map((name) => ({ name })) });
const conn = (...nodes: Node[]) => ({ nodes });
const repo = (o: Partial<Record<"ready" | "building" | "qa" | "review" | "done", Node[]>> = {}) => ({
  ready: conn(...(o.ready ?? [])),
  building: conn(...(o.building ?? [])),
  qa: conn(...(o.qa ?? [])),
  review: conn(...(o.review ?? [])),
  done: conn(...(o.done ?? [])),
});

const respond = (body: unknown, status = 200): FetchLike => async () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("buildQuery", () => {
  it("uses one alias and variable pair per project, and never inlines names", () => {
    const { query, variables } = buildQuery([a, b]);
    expect(query).toContain("p0: repository(owner: $o0, name: $n0)");
    expect(query).toContain("p1: repository(owner: $o1, name: $n1)");
    expect(query).toContain('labels: ["qa"]');
    expect(variables).toEqual({ o0: "o", n0: "a", o1: "o", n1: "b" });
    expect(query).not.toContain('"o/a"');
  });
});

describe("fetchBoards", () => {
  it("sends the token, no library, and maps issues into lanes", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const fetchImpl: FetchLike = async (url, init) => {
      seen = { url, auth: new Headers(init.headers).get("Authorization") };
      return respond({
        data: {
          p0: repo({
            ready: [node(1, { labels: labels("ready") })],
            building: [
              node(2, {
                labels: labels("building"),
                assignees: { nodes: [{ login: "bot" }] },
                closedByPullRequestsReferences: {
                  nodes: [
                    {
                      number: 9,
                      url: "https://github.com/o/a/pull/9",
                      isDraft: true,
                      merged: false,
                      commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
                    },
                  ],
                },
              }),
            ],
          }),
        },
      })("", {});
    };
    const [result] = await fetchBoards([a], "tkn", now, fetchImpl);
    expect(seen).toEqual({ url: "https://api.github.com/graphql", auth: "Bearer tkn" });
    expect(result?.status).toBe("ok");
    if (result?.status !== "ok") return;
    expect(result.issues.map((i) => [i.number, i.lane])).toEqual([
      [1, "ready"],
      [2, "building"],
    ]);
    expect(result.issues[1]).toMatchObject({
      assignee: "bot",
      pr: { number: 9, draft: true, merged: false, checks: "failure" },
    });
  });

  it("links qa and review cards without a PR to the branch compare page, and no others", async () => {
    const pr = { number: 9, url: "https://github.com/o/a/pull/9", isDraft: false, merged: false };
    const master: ProjectInfo = { ...a, defaultBranch: "master" };
    const data = {
      p0: repo({
        ready: [node(1, { labels: labels("ready") })],
        building: [node(2, { labels: labels("building") })],
        qa: [node(3, { labels: labels("qa") })],
        review: [
          node(4, { labels: labels("review") }),
          node(5, { labels: labels("review"), closedByPullRequestsReferences: { nodes: [pr] } }),
        ],
      }),
    };
    const [result] = await fetchBoards([master], "t", now, respond({ data }));
    if (result?.status !== "ok") throw new Error("expected ok");
    const branches = Object.fromEntries(result.issues.map((i) => [i.number, i.branch]));
    expect(branches[1]).toBeNull();
    expect(branches[2]).toBeNull();
    expect(branches[3]).toEqual({ name: "issue-3", compareUrl: "https://github.com/o/a/compare/master...issue-3" });
    expect(branches[4]).toEqual({ name: "issue-4", compareUrl: "https://github.com/o/a/compare/master...issue-4" });
    expect(branches[5]).toBeNull(); // the PR exists, so the card shows the PR
  });

  it("deduplicates an issue that matches several lane queries and flags the conflict", async () => {
    const both = node(3, { labels: labels("building", "qa") });
    const results = await fetchBoards([a], "t", now, respond({ data: { p0: repo({ building: [both], qa: [both] }) } }));
    const r = results[0];
    expect(r?.status === "ok" && r.issues).toHaveLength(1);
    expect(r?.status === "ok" && r.issues[0]).toMatchObject({ lane: "qa", laneConflict: true });
  });

  it("keeps only recent factory work in done", async () => {
    const pr = { number: 5, url: "u", isDraft: false, merged: true };
    const done = [
      node(10, { state: "CLOSED", closedAt: iso(2 * day), closedByPullRequestsReferences: { nodes: [pr] } }),
      node(11, { state: "CLOSED", closedAt: iso(9 * day), closedByPullRequestsReferences: { nodes: [pr] } }),
      node(12, { state: "CLOSED", closedAt: iso(1 * day) }),
      node(13, { state: "CLOSED", closedAt: iso(1 * day), labels: labels("review") }),
    ];
    const results = await fetchBoards([a], "t", now, respond({ data: { p0: repo({ done }) } }));
    const r = results[0];
    expect(r?.status === "ok" && r.issues.map((i) => i.number)).toEqual([10, 13]);
  });

  it("marks only the failing repo as errored", async () => {
    const results = await fetchBoards(
      [a, b],
      "t",
      now,
      respond({
        data: { p0: repo(), p1: null },
        errors: [{ message: "Could not resolve to a Repository", path: ["p1"] }],
      }),
    );
    expect(results.map((r) => r.status)).toEqual(["ok", "error"]);
    expect(results[1]).toMatchObject({ error: "Could not resolve to a Repository" });
  });

  it("does not query disabled projects but still lists them", async () => {
    let body = "";
    const fetchImpl: FetchLike = async (_url, init) => {
      body = String(init.body);
      return respond({ data: { p0: repo() } })("", {});
    };
    const results = await fetchBoards([off, a], "t", now, fetchImpl);
    expect(results.map((r) => [r.info.name, r.status])).toEqual([
      ["off", "disabled"],
      ["a", "ok"],
    ]);
    expect(body).toContain('"o0":"o"');
    expect(body).not.toContain("o/off");
  });

  it("reports a rejected token on every enabled project", async () => {
    const results = await fetchBoards([a, off], "bad", now, respond({ message: "Bad credentials" }, 401));
    expect(results[0]).toMatchObject({ status: "error", error: expect.stringContaining("401") });
    expect(results[1]?.status).toBe("disabled");
  });

  it("reports network failures and malformed responses without throwing", async () => {
    const down: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect((await fetchBoards([a], "t", now, down))[0]).toMatchObject({
      status: "error",
      error: expect.stringContaining("ECONNREFUSED"),
    });
    expect((await fetchBoards([a], "t", now, respond({ data: { p0: { ready: 1 } } })))[0]).toMatchObject({
      status: "error",
      error: "Unexpected response from GitHub.",
    });
  });
});
