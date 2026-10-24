import { describe, expect, it } from "vitest";
import { EventSchema } from "./index.js";

const ok = { ts: "2026-01-01T12:00:00.000Z", project: "demo", lane: "build", type: "claimed", message: "claimed #4" };

describe("EventSchema", () => {
  it("accepts a valid event, with and without an issue", () => {
    expect(EventSchema.parse(ok)).toEqual(ok);
    expect(EventSchema.parse({ ...ok, issue: 4, url: "https://github.com/o/r/pull/1" }).issue).toBe(4);
  });

  it("accepts the qa lane and its event types", () => {
    for (const type of ["passed", "sent_back", "inconclusive"]) {
      expect(EventSchema.safeParse({ ...ok, lane: "qa", type }).success, type).toBe(true);
    }
  });

  it("accepts the review lane and its event types", () => {
    for (const type of ["approved", "merged", "back_to_qa", "sent_back", "inconclusive"]) {
      expect(EventSchema.safeParse({ ...ok, lane: "review", type }).success, type).toBe(true);
    }
  });

  it("rejects unknown lanes, types, keys and bad timestamps", () => {
    expect(EventSchema.safeParse({ ...ok, lane: "deploy" }).success).toBe(false);
    expect(EventSchema.safeParse({ ...ok, type: "exploded" }).success).toBe(false);
    expect(EventSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(EventSchema.safeParse({ ...ok, ts: "yesterday" }).success).toBe(false);
    expect(EventSchema.safeParse({ ...ok, issue: 0 }).success).toBe(false);
  });
});
