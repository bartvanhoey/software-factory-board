import { describe, expect, it } from "vitest";
import { LANE_LABEL_SPECS, createLabelEnsurer, ensureLabels, missingLabels } from "./labels.js";
import { FakeEvents, FakeGh } from "./testing/fakes.js";

describe("LANE_LABEL_SPECS", () => {
  it("has the four lanes in order, with grey, blue, yellow and green colours", () => {
    expect(LANE_LABEL_SPECS.map((s) => [s.name, s.color])).toEqual([
      ["ready", "8b949e"],
      ["building", "1f6feb"],
      ["qa", "d4a72c"],
      ["review", "2da44e"],
    ]);
    for (const s of LANE_LABEL_SPECS) expect(s.description.length).toBeGreaterThan(0);
  });
});

describe("missingLabels", () => {
  const names = (list: readonly { name: string }[]) => list.map((s) => s.name);

  it("returns all four when none exist", () => {
    expect(names(missingLabels([]))).toEqual(["ready", "building", "qa", "review"]);
  });
  it("returns none when all exist", () => {
    expect(missingLabels(["ready", "building", "qa", "review", "bug"])).toEqual([]);
  });
  it("returns only the missing ones", () => {
    expect(names(missingLabels(["bug", "ready"]))).toEqual(["building", "qa", "review"]);
  });
  it("matches names case-insensitively", () => {
    expect(names(missingLabels(["Ready", "QA"]))).toEqual(["building", "review"]);
  });
});

describe("ensureLabels", () => {
  it("creates only the missing labels and never touches existing ones", async () => {
    const gh = new FakeGh();
    gh.labels = new Set(["ready", "bug"]);
    expect(await ensureLabels(gh, "o/r")).toEqual(["building", "qa", "review"]);
    expect(gh.createdLabels.map((s) => s.name)).toEqual(["building", "qa", "review"]);
    expect([...gh.labels].sort()).toEqual(["bug", "building", "qa", "ready", "review"]);
  });

  it("does nothing when everything exists", async () => {
    const gh = new FakeGh();
    gh.labels = new Set(["ready", "building", "qa", "review"]);
    expect(await ensureLabels(gh, "o/r")).toEqual([]);
    expect(gh.createdLabels).toEqual([]);
  });

  it("treats a label created by someone else in between as success", async () => {
    const gh = new FakeGh();
    gh.labels = new Set(["ready"]);
    // listLabels sees only `ready`, but `qa` appears before createLabel runs.
    const realList = gh.listLabels.bind(gh);
    gh.listLabels = async () => {
      const seen = await realList();
      gh.labels.add("qa");
      return seen;
    };
    expect(await ensureLabels(gh, "o/r")).toEqual(["building", "review"]);
  });

  it("lets a create failure (for example a 403) propagate", async () => {
    const gh = new FakeGh();
    gh.failOnce.set("createLabel", new Error("HTTP 403"));
    await expect(ensureLabels(gh, "o/r")).rejects.toThrow("403");
  });
});

describe("createLabelEnsurer", () => {
  it("checks a repo once, records an event, and checks again after forget", async () => {
    const gh = new FakeGh();
    const events = new FakeEvents();
    const ensurer = createLabelEnsurer(gh, events, "demo");

    await ensurer.ensure("o/r");
    await ensurer.ensure("o/r");
    expect(gh.createdLabels).toHaveLength(4);
    expect(events.events).toEqual([
      { project: "demo", lane: "system", type: "labels_created", message: "created labels: ready, building, qa, review" },
    ]);

    gh.labels.delete("qa");
    await ensurer.ensure("o/r"); // cached: no new check
    expect(gh.labels.has("qa")).toBe(false);
    ensurer.forget("o/r");
    await ensurer.ensure("o/r");
    expect(gh.labels.has("qa")).toBe(true);
  });

  it("does not mark a repo as checked when creating fails", async () => {
    const gh = new FakeGh();
    gh.failOnce.set("createLabel", new Error("HTTP 403"));
    const ensurer = createLabelEnsurer(gh, new FakeEvents(), "demo");
    await expect(ensurer.ensure("o/r")).rejects.toThrow("403");
    await expect(ensurer.ensure("o/r")).resolves.toBeUndefined();
    expect(gh.labels.size).toBe(4);
  });
});
