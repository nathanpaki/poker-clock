import "server-only";
import ExcelJS from "exceljs";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { leagues, playerCheckIns, playerEliminations, players, tournamentRegistrations, tournaments, venues } from "@/db/schema";
import { resolveUserNames } from "@/lib/auth";
import { buildExport, escapeFormula, exportFilename, PLAYER_COLUMNS, toCsv, type ExportRegistration } from "@/lib/export-format";

export type ExportFormat = "csv" | "xlsx";

/**
 * Builds one session's export. The caller MUST have authorized access to
 * `tournamentId` already; every query below is additionally scoped to the
 * tournament (and its league) so nothing from another session can leak in.
 */
export async function generateTournamentExport(tournamentId: string, format: ExportFormat, includeHistory: boolean) {
  const [t] = await db
    .select({ t: tournaments, venueName: venues.name, timezone: venues.timezone, leagueName: leagues.name })
    .from(tournaments)
    .innerJoin(venues, and(eq(venues.id, tournaments.venueId), eq(venues.leagueId, tournaments.leagueId)))
    .innerJoin(leagues, eq(leagues.id, tournaments.leagueId))
    .where(eq(tournaments.id, tournamentId));
  if (!t) throw new Error("Tournament not found.");

  const regs = await db
    .select({ id: tournamentRegistrations.id, playerId: players.id, playerName: players.displayName, registeredAt: tournamentRegistrations.registeredAt })
    .from(tournamentRegistrations)
    .innerJoin(players, and(eq(players.id, tournamentRegistrations.playerId), eq(players.leagueId, t.t.leagueId)))
    .where(and(eq(tournamentRegistrations.tournamentId, tournamentId), eq(tournamentRegistrations.leagueId, t.t.leagueId)));
  const regIds = regs.map((r) => r.id);
  const [cis, els] = regIds.length
    ? await Promise.all([
        db.select().from(playerCheckIns).where(and(eq(playerCheckIns.tournamentId, tournamentId), inArray(playerCheckIns.registrationId, regIds))).orderBy(asc(playerCheckIns.checkedInAt)),
        db.select().from(playerEliminations).where(and(eq(playerEliminations.tournamentId, tournamentId), inArray(playerEliminations.registrationId, regIds))).orderBy(asc(playerEliminations.eliminatedAt)),
      ])
    : [[], []];

  const userNames = await resolveUserNames([
    ...cis.flatMap((c) => [c.checkedInBy, c.voidedBy]),
    ...els.flatMap((e) => [e.eliminatedBy, e.voidedBy]),
  ]);

  const registrations: ExportRegistration[] = regs.map((r) => ({
    playerId: r.playerId,
    playerName: r.playerName,
    registeredAt: r.registeredAt,
    checkIns: cis.filter((c) => c.registrationId === r.id).map((c) => ({ at: c.checkedInAt, by: c.checkedInBy, voidedAt: c.voidedAt, voidedBy: c.voidedBy, reason: c.voidReason })),
    eliminations: els
      .filter((e) => e.registrationId === r.id)
      .map((e) => ({ at: e.eliminatedAt, by: e.eliminatedBy, voidedAt: e.voidedAt, voidedBy: e.voidedBy, reason: e.voidReason, position: e.finishPosition, levelNumber: e.levelNumber })),
  }));

  const { rows, summary } = buildExport({
    tournament: { name: t.t.name, scheduledAt: t.t.scheduledAt, startedAt: t.t.startedAt, completedAt: t.t.completedAt },
    leagueName: t.leagueName,
    venueName: t.venueName,
    timezone: t.timezone,
    registrations,
    userNames,
    now: new Date(),
    includeHistory,
  });
  const filename = exportFilename(t.venueName, t.t.name, t.t.scheduledAt, t.timezone, format);

  if (format === "csv") {
    return { filename, contentType: "text/csv; charset=utf-8", body: Buffer.from(toCsv(rows), "utf8"), leagueId: t.t.leagueId };
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Poker Clock";
  const s = wb.addWorksheet("Summary");
  s.columns = [{ width: 18 }, { width: 44 }];
  for (const [k, v] of summary) s.addRow([k, typeof v === "string" ? escapeFormula(v) : v]);
  s.getColumn(1).font = { bold: true };

  const p = wb.addWorksheet("Players", { views: [{ state: "frozen", ySplit: 1 }] });
  p.columns = PLAYER_COLUMNS.map((c) => ({ header: c, key: c, width: Math.max(12, Math.min(40, c.length + 6)) }));
  for (const r of rows) p.addRow(Object.fromEntries(PLAYER_COLUMNS.map((c) => [c, typeof r[c] === "string" ? escapeFormula(r[c] as string) : r[c]])));
  p.getRow(1).font = { bold: true };
  p.autoFilter = { from: "A1", to: { row: 1, column: PLAYER_COLUMNS.length } };

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return { filename, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: buf, leagueId: t.t.leagueId };
}
