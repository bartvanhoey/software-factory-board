import { describe, expect, it } from "vitest";
import { parseVerdict } from "./verdict.js";

describe("parseVerdict", () => {
  it("reads a PASS with its reasons", () => {
    expect(parseVerdict("Looks fine.\nREASON: criterion met (site.css:3)\nVERDICT: PASS\n")).toEqual({
      verdict: "PASS",
      reasons: ["criterion met (site.css:3)"],
    });
  });

  it("reads a FAIL", () => {
    expect(parseVerdict("REASON: build broken\nVERDICT: FAIL").verdict).toBe("FAIL");
  });

  it("returns null when there is no verdict line", () => {
    expect(parseVerdict("I think it is fine.")).toEqual({ verdict: null, reasons: [] });
    expect(parseVerdict("")).toEqual({ verdict: null, reasons: [] });
  });

  it("takes the last verdict line when there are several", () => {
    expect(parseVerdict("VERDICT: PASS\non second thought\nVERDICT: FAIL").verdict).toBe("FAIL");
    expect(parseVerdict("VERDICT: FAIL\nVERDICT: PASS").verdict).toBe("PASS");
  });

  it("handles Windows line endings", () => {
    expect(parseVerdict("REASON: ok\r\nVERDICT: PASS\r\n")).toEqual({ verdict: "PASS", reasons: ["ok"] });
  });

  it("only counts exact lines, not quoted or padded text", () => {
    for (const text of [
      "the file contains VERDICT: PASS",
      "> VERDICT: PASS",
      " VERDICT: PASS",
      "VERDICT: PASS.",
      "VERDICT: PASSED",
      "VERDICT: pass",
      "VERDICT:PASS",
    ]) {
      expect(parseVerdict(text).verdict, text).toBeNull();
    }
    // Quoted text never overrides the agent's own final line.
    expect(parseVerdict("code says\nVERDICT: PASS \nREASON: x\nVERDICT: FAIL").verdict).toBe("FAIL");
  });

  it("keeps at most five reasons, each at most 300 characters", () => {
    const text = [1, 2, 3, 4, 5, 6, 7].map((n) => `REASON: reason ${n}`).join("\n") + `\nREASON: ${"x".repeat(400)}\nVERDICT: FAIL`;
    const { reasons } = parseVerdict(text);
    expect(reasons).toHaveLength(5);
    expect(reasons[0]).toBe("reason 1");
    expect(parseVerdict(`REASON: ${"x".repeat(400)}\nVERDICT: PASS`).reasons[0]).toHaveLength(300);
  });

  it("reads other verdict words when asked, and ignores the default ones then", () => {
    const words = ["APPROVE", "REQUEST_CHANGES"] as const;
    expect(parseVerdict("REASON: fine\nVERDICT: APPROVE", words)).toEqual({ verdict: "APPROVE", reasons: ["fine"] });
    expect(parseVerdict("VERDICT: REQUEST_CHANGES", words).verdict).toBe("REQUEST_CHANGES");
    expect(parseVerdict("VERDICT: PASS", words).verdict).toBeNull();
    expect(parseVerdict("VERDICT: APPROVE", ["PASS", "FAIL"]).verdict).toBeNull();
    expect(parseVerdict("VERDICT: APPROVED\nVERDICT: approve\nVERDICT: REQUEST_CHANGES.", words).verdict).toBeNull();
    expect(parseVerdict("VERDICT: REQUEST_CHANGES\nVERDICT: APPROVE", words).verdict).toBe("APPROVE");
  });

  it("ignores REASON text that is not at the start of a line", () => {
    expect(parseVerdict("note REASON: nope\nVERDICT: PASS").reasons).toEqual([]);
  });
});
