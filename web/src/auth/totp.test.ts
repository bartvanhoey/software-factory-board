import { describe, expect, it } from "vitest";
import { base32, generateSecret, hotp, otpauthUri, stepOf, totp, verifyTotp } from "./totp";

// RFC 4226 appendix D and RFC 6238 appendix B use this ASCII secret with SHA-1.
const RFC_SECRET = Buffer.from("12345678901234567890");

describe("hotp (RFC 4226 appendix D)", () => {
  it.each([
    [0, "755224"], [1, "287082"], [2, "359152"], [3, "969429"], [4, "338314"],
    [5, "254676"], [6, "287922"], [7, "162583"], [8, "399871"], [9, "520489"],
  ])("counter %i gives %s", (counter, expected) => {
    expect(hotp(RFC_SECRET, counter)).toBe(expected);
  });
});

describe("totp (RFC 6238 appendix B, SHA-1)", () => {
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("at %is the 8-digit code is %s", (seconds, expected) => {
    expect(totp(RFC_SECRET, seconds * 1000, 8)).toBe(expected);
  });

  it("gives the same moments as 6-digit codes (the last six digits)", () => {
    expect(totp(RFC_SECRET, 59_000)).toBe("287082");
    expect(totp(RFC_SECRET, 1111111109_000)).toBe("081804");
    expect(totp(RFC_SECRET, 1234567890_000)).toBe("005924");
  });

  it("changes every 30 seconds and not in between", () => {
    expect(stepOf(0)).toBe(0);
    expect(stepOf(29_999)).toBe(0);
    expect(stepOf(30_000)).toBe(1);
    expect(totp(RFC_SECRET, 30_000)).toBe(totp(RFC_SECRET, 59_999));
    expect(totp(RFC_SECRET, 30_000)).not.toBe(totp(RFC_SECRET, 60_000));
  });
});

describe("verifyTotp", () => {
  const now = 1234567890_000;
  const step = stepOf(now);
  const at = (s: number) => hotp(RFC_SECRET, s);

  it("accepts the current code and reports its step", () => {
    expect(verifyTotp(RFC_SECRET, at(step), now)).toBe(step);
  });

  it("accepts one step either side for clock drift, and reports that step", () => {
    expect(verifyTotp(RFC_SECRET, at(step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, at(step + 1), now)).toBe(step + 1);
  });

  it("rejects two steps away", () => {
    expect(verifyTotp(RFC_SECRET, at(step - 2), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, at(step + 2), now)).toBeNull();
  });

  it("ignores spaces and rejects anything that is not exactly six digits", () => {
    const code = at(step);
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(step);
    for (const bad of ["", "12345", "1234567", "abcdef", "12345a", `${code}0`, "٠٠٠٠٠٠"]) expect(verifyTotp(RFC_SECRET, bad, now)).toBeNull();
  });

  it("rejects a code for a different secret", () => {
    expect(verifyTotp(generateSecret(), at(step), now)).toBeNull();
  });

  it("keeps leading zeros", () => {
    expect(at(step)).toBe("005924"); // RFC 6238: the code for 1234567890 starts with two zeros
    expect(verifyTotp(RFC_SECRET, "005924", 1234567890_000)).toBe(step);
  });
});

describe("secrets and the setup link", () => {
  it("generates 20 random bytes each time", () => {
    const a = generateSecret();
    expect(a).toHaveLength(20);
    expect(a.equals(generateSecret())).toBe(false);
  });

  it("encodes base32 per RFC 4648 (test vectors, no padding)", () => {
    expect(base32(Buffer.from(""))).toBe("");
    expect(base32(Buffer.from("f"))).toBe("MY");
    expect(base32(Buffer.from("fo"))).toBe("MZXQ");
    expect(base32(Buffer.from("foo"))).toBe("MZXW6");
    expect(base32(Buffer.from("foob"))).toBe("MZXW6YQ");
    expect(base32(Buffer.from("fooba"))).toBe("MZXW6YTB");
    expect(base32(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("builds an otpauth link an authenticator app can read", () => {
    const uri = new URL(otpauthUri("person+tag@example.com", RFC_SECRET));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/Software Factory:person+tag@example.com");
    expect(uri.searchParams.get("secret")).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(uri.searchParams.get("issuer")).toBe("Software Factory");
    expect(uri.searchParams.get("algorithm")).toBe("SHA1");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
  });
});
