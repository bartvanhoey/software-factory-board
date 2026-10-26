import { describe, expect, it } from "vitest";
import { qrSvgPath } from "./qr";
import { generateSecret, otpauthUri } from "./totp";

describe("qrSvgPath", () => {
  it("draws a square code with the three finder squares in the corners", () => {
    const { size, d } = qrSvgPath(otpauthUri("person@example.com", generateSecret()));
    expect(size).toBeGreaterThanOrEqual(21);
    expect(size).toBeLessThanOrEqual(61);
    expect(d.length).toBeGreaterThan(100);
    // every finder pattern starts with a dark row of 7 modules at the top-left of its corner
    for (const [x, y] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      for (let i = 0; i < 7; i++) expect(d).toContain(`M${x! + i} ${y}h1v1h-1z`);
    }
  });

  it("is deterministic for the same text and differs for other text", () => {
    expect(qrSvgPath("hello").d).toBe(qrSvgPath("hello").d);
    expect(qrSvgPath("hello").d).not.toBe(qrSvgPath("world").d);
  });

  it("contains only path commands, never markup", () => {
    expect(qrSvgPath('<script>"&').d).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
  });
});
