import { formatDuration, formatInZone, slugify } from "./format";

export type ExportCheckIn = { at: Date; by: string | null; voidedAt: Date | null; voidedBy: string | null; reason: string | null };
export type ExportElimination = ExportCheckIn & { position: number | null; levelNumber: number | null };

export type ExportRegistration = {
  playerId: string;
  playerName: string;
  registeredAt: Date;
  checkIns: ExportCheckIn[];
  eliminations: ExportElimination[];
};

export type ExportInput = {
  tournament: { name: string; scheduledAt: Date; startedAt: Date | null; completedAt: Date | null };
  leagueName: string;
  venueName: string;
  timezone: string;
  registrations: ExportRegistration[];
  userNames: Map<string, string>;
  now: Date;
  includeHistory: boolean;
};

export const PLAYER_COLUMNS = [
  "Tournament",
  "Date",
  "League",
  "Venue",
  "Player",
  "Player ID",
  "Registered",
  "Checked in",
  "Check-in time",
  "Checked in by",
  "Status",
  "Finish position",
  "Elimination time",
  "Eliminated by",
  "Level at elimination",
  "Time played",
  "Corrections",
] as const;

export type Row = Record<(typeof PLAYER_COLUMNS)[number], string | number>;

/** Cells starting with these characters can execute as formulas in Excel/Sheets. */
export function escapeFormula(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function buildExport(input: ExportInput) {
  const tz = input.timezone;
  const fmt = (d: Date | null | undefined) => formatInZone(d ?? null, tz);
  const who = (id: string | null) => (id ? input.userNames.get(id) ?? id : "");
  const endOfPlay = input.tournament.completedAt ?? input.now;

  const rows: Row[] = input.registrations.map((r) => {
    const ci = r.checkIns.find((c) => !c.voidedAt) ?? null;
    const el = r.eliminations.find((e) => !e.voidedAt) ?? null;
    const status = !ci ? "No-show" : el ? "Eliminated" : input.tournament.completedAt ? "Finished (not eliminated)" : "Still in";
    const played = ci ? (el ? el.at.getTime() : endOfPlay.getTime()) - ci.at.getTime() : null;
    const corrections = input.includeHistory
      ? [
          ...r.checkIns.filter((c) => c.voidedAt).map((c) => `Check-in ${fmt(c.at)} by ${who(c.by)} undone ${fmt(c.voidedAt)} by ${who(c.voidedBy)}${c.reason ? ` (${c.reason})` : ""}`),
          ...r.eliminations
            .filter((e) => e.voidedAt)
            .map((e) => `Elimination ${fmt(e.at)} by ${who(e.by)}${e.position ? ` as #${e.position}` : ""} undone ${fmt(e.voidedAt)} by ${who(e.voidedBy)}${e.reason ? ` (${e.reason})` : ""}`),
        ].join(" | ")
      : r.checkIns.some((c) => c.voidedAt) || r.eliminations.some((e) => e.voidedAt)
        ? "Corrected (export with history for details)"
        : "";
    return {
      Tournament: input.tournament.name,
      Date: formatInZone(input.tournament.scheduledAt, tz, false).slice(0, 10),
      League: input.leagueName,
      Venue: input.venueName,
      Player: r.playerName,
      "Player ID": r.playerId,
      Registered: fmt(r.registeredAt),
      "Checked in": ci ? "Yes" : "No",
      "Check-in time": fmt(ci?.at),
      "Checked in by": who(ci?.by ?? null),
      Status: status,
      "Finish position": el?.position ?? (ci && !el && input.tournament.completedAt ? 1 : ""),
      "Elimination time": fmt(el?.at),
      "Eliminated by": who(el?.by ?? null),
      "Level at elimination": el?.levelNumber ?? "",
      "Time played": played === null ? "" : formatDuration(played),
      Corrections: corrections,
    };
  });

  // Standings: finishers by position, then still-in, then no-shows.
  const rank = (r: Row) => (r.Status === "No-show" ? 1e9 : typeof r["Finish position"] === "number" ? r["Finish position"] : 0);
  rows.sort((a, b) => rank(a) - rank(b) || String(a.Player).localeCompare(String(b.Player)));

  const checkedIn = rows.filter((r) => r["Checked in"] === "Yes").length;
  const eliminated = rows.filter((r) => r.Status === "Eliminated").length;
  const summary: [string, string | number][] = [
    ["Tournament", input.tournament.name],
    ["League", input.leagueName],
    ["Venue", input.venueName],
    ["Time zone", tz],
    ["Scheduled", fmt(input.tournament.scheduledAt)],
    ["Started", fmt(input.tournament.startedAt)],
    ["Ended", fmt(input.tournament.completedAt) || "In progress"],
    ["Registered", rows.length],
    ["Checked in", checkedIn],
    ["Eliminated", eliminated],
    ["No-shows", rows.length - checkedIn],
    ["Exported", fmt(input.now)],
  ];
  return { rows, summary };
}

export function toCsv(rows: Row[]): string {
  const cell = (v: string | number) => {
    const s = typeof v === "number" ? String(v) : escapeFormula(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [PLAYER_COLUMNS.join(","), ...rows.map((r) => PLAYER_COLUMNS.map((c) => cell(r[c])).join(","))];
  // BOM so Excel opens UTF-8 names correctly.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function exportFilename(venue: string, tournament: string, date: Date, timezone: string, ext: string) {
  const d = formatInZone(date, timezone, false).slice(0, 10);
  return `${slugify(venue)}_${slugify(tournament)}_${d}_checkins-busts.${ext}`;
}
