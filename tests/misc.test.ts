import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, generatePublicCode, normalizeCode } from "@/lib/code";
import { isUsablePublicUrl } from "@/lib/app-url";
import { ordinal, zonedLocalToUtc } from "@/lib/format";

describe("public codes", () => {
  it("are six unambiguous characters", () => {
    for (let i = 0; i < 500; i++) {
      const c = generatePublicCode();
      expect(c).toHaveLength(6);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
    }
    expect(normalizeCode(" k7q4mx ")).toBe("K7Q4MX");
    expect(normalizeCode("K0Q4MX")).toBeNull(); // 0 is excluded
  });
});

describe("QR base URL guard", () => {
  it("rejects localhost and preview hosts", () => {
    expect(isUsablePublicUrl("http://localhost:3000")).toBe(false);
    expect(isUsablePublicUrl("https://127.0.0.1")).toBe(false);
    expect(isUsablePublicUrl("https://poker-git-main-team.vercel.app")).toBe(false);
    expect(isUsablePublicUrl("http://clock.example.com")).toBe(false);
    expect(isUsablePublicUrl("https://clock.example.com")).toBe(true);
  });
});

describe("formatting", () => {
  it("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  });
  it("interprets form times in the venue zone", () => {
    expect(zonedLocalToUtc("2026-10-09T19:00", "America/New_York").toISOString()).toBe("2026-10-09T23:00:00.000Z");
    expect(zonedLocalToUtc("2026-01-09T19:00", "America/New_York").toISOString()).toBe("2026-01-10T00:00:00.000Z");
    expect(zonedLocalToUtc("2026-10-09T19:00", "America/Los_Angeles").toISOString()).toBe("2026-10-10T02:00:00.000Z");
  });
});
