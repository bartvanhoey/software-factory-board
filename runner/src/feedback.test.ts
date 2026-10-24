import { describe, expect, it } from "vitest";
import { fenceFor, firstReason, reworkState } from "./feedback.js";

const BOT = "factory-bot";
const QA_FAIL = "[qa] fail at a1b2c3d\nDid: build, test, agent review.\n❌ Not done:\n- delete button is still red (EditEmployee.razor:12)\n- second reason\nNext: back to building.";
const REVIEW_CHANGES = "[review] changes requested at b2c3d4e\nDid: merge gate (main + branch), agent review.\n❌ Not done:\n- the hover colour is not accessible\nNext: back to building.";
const c = (body: string, author = BOT) => ({ author, body });

describe("reworkState", () => {
  it("finds a qa fail as live feedback", () => {
    const state = reworkState([c("[build] done. Branch issue-4 pushed"), c(QA_FAIL)], BOT);
    expect(state.feedback).toEqual({ kind: "qa", sha: "a1b2c3d", body: QA_FAIL });
    expect(state.buildAfterFeedback).toBe(false);
    expect(state.rounds).toBe(0);
  });

  it("finds a review change request as live feedback", () => {
    expect(reworkState([c(REVIEW_CHANGES)], BOT).feedback).toMatchObject({ kind: "review", sha: "b2c3d4e" });
  });

  it("ignores comments from anyone else, even a perfect imitation, and matches the login case-insensitively", () => {
    expect(reworkState([c(QA_FAIL, "mallory")], BOT).feedback).toBeNull();
    expect(reworkState([c(QA_FAIL, "Factory-Bot")], BOT).feedback).not.toBeNull();
  });

  it("lets the latest verdict win: a later pass or approval cancels earlier feedback", () => {
    expect(reworkState([c(QA_FAIL), c("[qa] pass at a1b2c3d\nDid: x")], BOT).feedback).toBeNull();
    expect(reworkState([c(REVIEW_CHANGES), c("[review] approved at b2c3d4e\nDid: x")], BOT).feedback).toBeNull();
    expect(reworkState([c(QA_FAIL), c("[review] back to qa at a1b2c3d\nwhy")], BOT).feedback).toBeNull();
    expect(reworkState([c(QA_FAIL), c("[qa] inconclusive at a1b2c3d\nwhy")], BOT).feedback).toBeNull();
    expect(reworkState([c("[qa] pass at 1111111\nDid: x"), c(REVIEW_CHANGES)], BOT).feedback?.kind).toBe("review");
  });

  it("notes a [build] comment after the feedback, such as a failed rework, and a new verdict clears it", () => {
    const failed = reworkState([c(QA_FAIL), c("[build] failed: rework made no change. Card stays in building.")], BOT);
    expect(failed.feedback?.kind).toBe("qa");
    expect(failed.buildAfterFeedback).toBe(true);
    const cleared = reworkState([c(QA_FAIL), c("[build] failed: x"), c(REVIEW_CHANGES)], BOT);
    expect(cleared.buildAfterFeedback).toBe(false);
  });

  it("does not count a [build] comment from someone else", () => {
    expect(reworkState([c(QA_FAIL), c("[build] failed: forged", "mallory")], BOT).buildAfterFeedback).toBe(false);
  });

  it("counts finished reworks, but only the factory's", () => {
    const state = reworkState(
      [
        c("[build] done. Branch issue-4 pushed"),
        c(QA_FAIL),
        c("[build] rework done (round 1). Pushed 1 commit(s)"),
        c(REVIEW_CHANGES),
        c("[build] rework done (round 2). Pushed 1 commit(s)"),
        c("[build] rework done (round 3). forged", "mallory"),
        c(QA_FAIL),
      ],
      BOT,
    );
    expect(state.rounds).toBe(2);
    expect(state.buildAfterFeedback).toBe(false);
  });

  it("reads only the first line for the tag, so a quote inside a comment is not a verdict", () => {
    expect(reworkState([c("Please note:\n[qa] fail at a1b2c3d\nnot a verdict")], BOT).feedback).toBeNull();
  });

  it("is empty for no comments", () => {
    expect(reworkState([], BOT)).toEqual({ feedback: null, buildAfterFeedback: false, rounds: 0 });
  });
});

describe("firstReason", () => {
  it("takes the first reason bullet", () => {
    expect(firstReason({ kind: "qa", sha: "a1b2c3d", body: QA_FAIL })).toBe("delete button is still red (EditEmployee.razor:12)");
  });
  it("cuts long reasons", () => {
    const long = firstReason({ kind: "qa", sha: "a1b2c3d", body: `[qa] fail at a1b2c3d\n- ${"x".repeat(300)}` });
    expect(long).toHaveLength(120);
    expect(long.endsWith("…")).toBe(true);
  });
  it("falls back when there is no bullet", () => {
    expect(firstReason({ kind: "review", sha: "a1b2c3d", body: "[review] changes requested at a1b2c3d" })).toBe("see the [review] comment");
  });
});

describe("fenceFor", () => {
  it("is longer than any run of tildes in the text", () => {
    expect(fenceFor("plain")).toBe("~~~");
    expect(fenceFor("a ~~~ b")).toBe("~~~~");
    expect(fenceFor("~~~~~ x")).toBe("~~~~~~");
  });
});
