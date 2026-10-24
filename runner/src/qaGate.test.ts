import { describe, expect, it } from "vitest";
import { latestQaResult } from "./qaGate.js";

const bot = "factory-bot";
const c = (body: string, author = bot) => ({ author, body });
const PASS = "[qa] pass at 3581e9e\nDid: build, test, agent review.\n✅ Done:\n- ok\nNext: review.";

describe("latestQaResult", () => {
  it("reads a pass from the factory's own comment", () => {
    expect(latestQaResult([c(PASS)], bot)).toEqual({ pass: true, sha: "3581e9e" });
  });

  it("reads a fail", () => {
    expect(latestQaResult([c("[qa] fail at 3581e9e\n❌ Not done:\n- x")], bot)).toEqual({ pass: false, sha: "3581e9e" });
  });

  it("returns null when there is no qa result", () => {
    expect(latestQaResult([], bot)).toBeNull();
    expect(latestQaResult([c("looks good to me"), c("[qa] inconclusive at 3581e9e\nwhy")], bot)).toBeNull();
  });

  it("ignores comments from anyone but the factory's account, so a pass cannot be forged", () => {
    expect(latestQaResult([c(PASS, "someone-else")], bot)).toBeNull();
    expect(latestQaResult([c(PASS, "")], bot)).toBeNull();
    expect(latestQaResult([c(PASS, "someone-else"), c("[qa] fail at 1234567")], bot)).toEqual({ pass: false, sha: "1234567" });
  });

  it("matches the account name case-insensitively", () => {
    expect(latestQaResult([c(PASS, "Factory-Bot")], bot)).toEqual({ pass: true, sha: "3581e9e" });
  });

  it("lets the latest result win, so a later fail cancels an earlier pass", () => {
    expect(latestQaResult([c(PASS), c("[qa] fail at 3581e9e")], bot)).toMatchObject({ pass: false });
    expect(latestQaResult([c("[qa] fail at 1111111"), c(PASS)], bot)).toEqual({ pass: true, sha: "3581e9e" });
  });

  it("handles Windows line endings and a result that is not on the first line", () => {
    expect(latestQaResult([c("note\r\n[qa] pass at abcdef1\r\nmore")], bot)).toEqual({ pass: true, sha: "abcdef1" });
  });

  it("only counts a result at the start of a line, with a real commit abbreviation", () => {
    for (const body of [
      "quoted: [qa] pass at 3581e9e",
      "> [qa] pass at 3581e9e",
      "[qa] pass at ",
      "[qa] pass at abc",
      "[qa] pass at xyz1234",
      "[qa] pass at 3581E9E",
      "[qa] passed at 3581e9e",
    ]) {
      expect(latestQaResult([c(body)], bot), body).toBeNull();
    }
  });
});
