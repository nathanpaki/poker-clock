import { describe, expect, it } from "vitest";
import { buildExport, escapeFormula, exportFilename, toCsv } from "@/lib/export-format";

const at = (h: number, m: number) => new Date(Date.UTC(2026, 9, 10, h, m)); // 2026-10-10
const none = { voidedAt: null, voidedBy: null, reason: null };

const input = {
  tournament: { name: "Friday Tournament", scheduledAt: at(23, 0), startedAt: at(23, 5), completedAt: null },
  leagueName: "Smokey Mountain",
  venueName: "Craft Brewery",
  timezone: "America/New_York",
  userNames: new Map([["u1", "Dana"]]),
  now: at(26 - 24, 0),
  includeHistory: true,
  registrations: [
    { playerId: "p1", playerName: "Hank", registeredAt: at(22, 0), checkIns: [{ at: at(22, 50), by: "u1", ...none }], eliminations: [{ at: at(23, 50), by: "u1", ...none, position: 3, levelNumber: 4 }] },
    { playerId: "p2", playerName: "=HYPERLINK(\"x\")", registeredAt: at(22, 0), checkIns: [{ at: at(22, 55), by: "u1", ...none }], eliminations: [{ at: at(23, 30), by: "u1", voidedAt: at(23, 31), voidedBy: "u1", reason: "wrong player", position: 3, levelNumber: 3 }] },
    { playerId: "p3", playerName: "Nia", registeredAt: at(22, 0), checkIns: [], eliminations: [] },
  ],
};

describe("check-in / bust-out export", () => {
  it("builds rows in venue time with no-shows and corrections", () => {
    const { rows, summary } = buildExport(input);
    const hank = rows.find((r) => r.Player === "Hank")!;
    expect(hank["Check-in time"]).toBe("2026-10-10 18:50:00"); // EDT
    expect(hank["Elimination time"]).toBe("2026-10-10 19:50:00");
    expect(hank["Eliminated by"]).toBe("Dana");
    expect(hank["Finish position"]).toBe(3);
    expect(hank["Level at elimination"]).toBe(4);
    expect(hank["Time played"]).toBe("1h 00m");
    const nia = rows.find((r) => r.Player === "Nia")!;
    expect(nia.Status).toBe("No-show");
    const p2 = rows.find((r) => r["Player ID"] === "p2")!;
    expect(p2.Status).toBe("Still in");
    expect(String(p2.Corrections)).toContain("wrong player");
    expect(summary.find(([k]) => k === "No-shows")?.[1]).toBe(1);
  });

  it("neutralizes spreadsheet formula injection", () => {
    expect(escapeFormula("=1+1")).toBe("'=1+1");
    expect(escapeFormula("+cmd")).toBe("'+cmd");
    expect(escapeFormula("@SUM")).toBe("'@SUM");
    expect(escapeFormula("Rosa")).toBe("Rosa");
    const csv = toCsv(buildExport(input).rows);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv.startsWith("\uFEFFTournament,")).toBe(true);
  });

  it("names files predictably", () => {
    expect(exportFilename("Craft Brewery", "Friday Tournament", at(23, 0), "America/New_York", "csv")).toBe("craft-brewery_friday-tournament_2026-10-10_checkins-busts.csv");
  });
});
