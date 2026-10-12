/**
 * Runs the REAL server actions, authorization helpers and queries against a
 * scratch Postgres database (only Clerk and the DB driver are swapped).
 *
 *   TEST_DATABASE_URL=postgres://... npm run test:integration
 *
 * WARNING: drops and recreates the `public` schema. Never point at production.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../mocks/db";
import { leagueMemberships, players, tournamentTimerState, venueMemberships } from "@/db/schema";
import { currentUser } from "../mocks/clerk";
import { createLeague, createVenue, setVenueAccess } from "@/actions/leagues";
import { createPlayer } from "@/actions/players";
import { createTournament, setTournamentStatus } from "@/actions/tournaments";
import { clockAction } from "@/actions/clock";
import { checkIn, eliminate, registerPlayers, voidElimination } from "@/actions/roster";
import { getRoster, tournamentsForUser } from "@/server/queries";
import { getPublicSnapshot, rowToState } from "@/server/tournament-state";
import { generateTournamentExport } from "@/server/export";
import { requireTournamentPermission } from "@/lib/auth";

const as = (id: string) => (currentUser.id = id);
function ok<T>(r: { ok: true; data?: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(`Expected success, got: ${r.error}`);
  return r.data as T;
}
const fail = (r: { ok: boolean; error?: string }) => {
  expect(r.ok).toBe(false);
  return (r as { error: string }).error;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ids: Record<string, string> = {};

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Set TEST_DATABASE_URL to a scratch database.");
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const sql = readFileSync(path.resolve(__dirname, "../../drizzle/0000_init.sql"), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) await pool.query(stmt);
  process.env.PLATFORM_ADMIN_USER_IDS = "platform";

  as("platform");
  ids.leagueA = ok(await createLeague({ name: "Smokey Mountain Poker League", timezone: "America/New_York" }))!.leagueId;
  ids.leagueB = ok(await createLeague({ name: "Another Poker League", timezone: "America/Chicago" }))!.leagueId;
  await db.insert(leagueMemberships).values([
    { leagueId: ids.leagueA, userId: "adminA", role: "admin" },
    { leagueId: ids.leagueB, userId: "adminB", role: "admin" },
    { leagueId: ids.leagueA, userId: "staffA", role: "staff" },
  ]);

  as("adminA");
  ok(await createVenue({ leagueId: ids.leagueA, name: "Craft Brewery", timezone: "America/New_York" }));
  ok(await createVenue({ leagueId: ids.leagueA, name: "Asia Cafe", timezone: "America/New_York" }));
  const vs = await db.query.venues.findMany({ where: (v, { eq }) => eq(v.leagueId, ids.leagueA) });
  ids.craft = vs.find((v) => v.name === "Craft Brewery")!.id;
  ids.asia = vs.find((v) => v.name === "Asia Cafe")!.id;
  ids.tCraft = ok(await createTournament({ leagueId: ids.leagueA, venueId: ids.craft, name: "Friday Tournament", scheduledAt: "2026-10-09T19:00" }))!.tournamentId;
  ids.tAsia = ok(await createTournament({ leagueId: ids.leagueA, venueId: ids.asia, name: "Tuesday Game", scheduledAt: "2026-10-13T19:00" }))!.tournamentId;
  for (let i = 1; i <= 10; i++) ids[`p${i}`] = ok(await createPlayer({ leagueId: ids.leagueA, displayName: `Player ${i}` }))!.id;
  // Staff at Craft Brewery only: check-in + eliminate, no clock, no export.
  ok(await setVenueAccess({ leagueId: ids.leagueA, venueId: ids.craft, userId: "staffA", enabled: true, canCheckIn: true, canEliminate: true, canControlClock: false, canManagePlayers: false, canExport: false }));

  as("adminB");
  ok(await createVenue({ leagueId: ids.leagueB, name: "Venue D", timezone: "America/Chicago" }));
  ids.venueD = (await db.query.venues.findFirst({ where: (v, { eq }) => eq(v.leagueId, ids.leagueB) }))!.id;
  ids.tB = ok(await createTournament({ leagueId: ids.leagueB, venueId: ids.venueD, name: "League B Night", scheduledAt: "2026-10-10T19:00" }))!.tournamentId;
  ids.pB = ok(await createPlayer({ leagueId: ids.leagueB, displayName: "Rosa" }))!.id;
});

describe("tenant isolation", () => {
  it("1–3: each league has its own players and a player never appears in the other league", async () => {
    const a = await db.select().from(players).where(eq(players.leagueId, ids.leagueA));
    const b = await db.select().from(players).where(eq(players.leagueId, ids.leagueB));
    expect(a.map((p) => p.displayName)).not.toContain("Rosa");
    expect(b.map((p) => p.displayName)).toEqual(["Rosa"]);
  });

  it("12: a league admin cannot read or write another league's tournament by ID", async () => {
    as("adminB");
    await expect(requireTournamentPermission(ids.tCraft, "view")).rejects.toThrow("Tournament not found");
    expect(fail(await registerPlayers({ tournamentId: ids.tCraft, playerIds: [ids.pB] }))).toMatch(/not found/i);
    expect(fail(await clockAction(ids.tCraft, { op: "start" }))).toMatch(/not found/i);
    expect(fail(await createVenue({ leagueId: ids.leagueA, name: "Sneaky", timezone: "UTC" }))).toMatch(/access/i);
    expect(fail(await createPlayer({ leagueId: ids.leagueA, displayName: "Sneaky" }))).toMatch(/access/i);
    expect(await tournamentsForUser("adminB", ids.leagueA, false)).toEqual([]);
  });

  it("12: a league admin cannot register a player from another league into their own tournament", async () => {
    as("adminA");
    expect(fail(await registerPlayers({ tournamentId: ids.tCraft, playerIds: [ids.pB] }))).toMatch(/aren't active members/);
    as("adminB");
    expect(fail(await createTournament({ leagueId: ids.leagueB, venueId: ids.craft, name: "X", scheduledAt: "2026-10-10T19:00" }))).toMatch(/Venue not found/);
  });

  it("2: staff permissions are scoped to assigned venues and actions", async () => {
    as("staffA");
    await expect(requireTournamentPermission(ids.tAsia, "view")).rejects.toThrow(); // not assigned to Asia Cafe
    expect(fail(await clockAction(ids.tCraft, { op: "start" }))).toMatch(/permission/);
    await expect(requireTournamentPermission(ids.tCraft, "export")).rejects.toThrow(/permission/);
    expect((await requireTournamentPermission(ids.tCraft, "check_in")).perms.eliminate).toBe(true);
  });
});

describe("clocks", () => {
  it("4–5: two tournaments run independently; pausing or resetting one does not affect the other", async () => {
    as("adminA");
    ok(await clockAction(ids.tCraft, { op: "start" }));
    ok(await clockAction(ids.tAsia, { op: "start" }));
    ok(await clockAction(ids.tCraft, { op: "next_level" }));
    ok(await clockAction(ids.tCraft, { op: "next_level" }));
    ok(await clockAction(ids.tAsia, { op: "adjust", minutes: -10 }));
    ok(await clockAction(ids.tAsia, { op: "pause" }));

    const craft = rowToState(await db.query.tournamentTimerState.findFirst({ where: eq(tournamentTimerState.tournamentId, ids.tCraft) }));
    const asia = rowToState(await db.query.tournamentTimerState.findFirst({ where: eq(tournamentTimerState.tournamentId, ids.tAsia) }));
    expect(craft.status).toBe("running");
    expect(craft.levelIndex).toBe(2);
    expect(asia.status).toBe("paused");
    expect(asia.levelIndex).toBe(0);
    expect(asia.remainingMs).toBeLessThan(10 * 60_000 + 1000);

    ok(await clockAction(ids.tAsia, { op: "reset_level" }));
    const craft2 = rowToState(await db.query.tournamentTimerState.findFirst({ where: eq(tournamentTimerState.tournamentId, ids.tCraft) }));
    expect(craft2.levelIndex).toBe(2);
    expect(craft2.levelEndsAt).toBe(craft.levelEndsAt);
  });

  it("8/13: the public snapshot is consistent across reads and refreshes never reset the clock", async () => {
    const code = (await db.query.tournaments.findFirst({ where: (t, { eq }) => eq(t.id, ids.tCraft) }))!.publicCode;
    const a = await getPublicSnapshot(code);
    await sleep(50);
    const b = await getPublicSnapshot(code);
    expect(a!.timer.levelEndsAt).toBe(b!.timer.levelEndsAt);
    expect(b!.timer.status).toBe("running");
    expect(b!.levels[b!.timer.levelIndex].kind).toBeDefined();
    expect(JSON.stringify(b)).not.toContain(ids.tCraft); // public payload leaks no internal IDs
  });

  it("rejects restart without explicit confirmation", async () => {
    as("adminA");
    // @ts-expect-error — deliberately missing confirm
    expect(fail(await clockAction(ids.tCraft, { op: "restart" }))).toBeTruthy();
  });
});

describe("check-in and elimination", () => {
  it("9/13: duplicate concurrent check-ins create exactly one record", async () => {
    as("staffA");
    ok(await registerPlayers({ tournamentId: ids.tCraft, playerIds: Array.from({ length: 10 }, (_, i) => ids[`p${i + 1}`]) }));
    ok(await registerPlayers({ tournamentId: ids.tCraft, playerIds: [ids.p1] })); // re-register is a no-op
    const roster = await getRoster(ids.tCraft, ids.leagueA);
    expect(roster).toHaveLength(10);
    const reg1 = roster.find((r) => r.name === "Player 1")!.registrationId;
    const results = await Promise.all(Array.from({ length: 5 }, () => checkIn({ tournamentId: ids.tCraft, registrationId: reg1 })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => (r as { error: string }).error === "Already checked in.")).toBe(true);
    for (const r of roster.filter((r) => r.name !== "Player 1")) ok(await checkIn({ tournamentId: ids.tCraft, registrationId: r.registrationId }));
  });

  it("10: concurrent eliminations produce unique positions and a correct count", async () => {
    as("staffA");
    const roster = await getRoster(ids.tCraft, ids.leagueA);
    const victims = roster.slice(0, 9);
    const results = await Promise.all(victims.map((r) => eliminate({ tournamentId: ids.tCraft, registrationId: r.registrationId })));
    expect(results.every((r) => r.ok)).toBe(true);
    const after = await getRoster(ids.tCraft, ids.leagueA);
    const positions = after.filter((r) => r.elimination).map((r) => r.elimination!.position).sort((a, b) => a! - b!);
    expect(positions).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(after.every((r) => !r.elimination || r.elimination.levelNumber === 3)).toBe(true);
    const last = after.find((r) => !r.elimination)!;
    expect(fail(await eliminate({ tournamentId: ids.tCraft, registrationId: last.registrationId }))).toMatch(/last player/);
    expect(fail(await eliminate({ tournamentId: ids.tCraft, registrationId: victims[0].registrationId }))).toMatch(/Already eliminated/);
    const code = (await db.query.tournaments.findFirst({ where: (t, { eq }) => eq(t.id, ids.tCraft) }))!.publicCode;
    const snap = (await getPublicSnapshot(code))!;
    expect(snap.players).toEqual({ checkedIn: 10, remaining: 1 });
    expect(snap.eliminations).toHaveLength(5);
    expect(snap.eliminationsTotal).toBe(9);
  });

  it("correcting an accidental elimination recomputes positions and is audited", async () => {
    as("staffA");
    const before = await getRoster(ids.tCraft, ids.leagueA);
    const tenth = before.find((r) => r.elimination?.position === 10)!;
    ok(await voidElimination({ tournamentId: ids.tCraft, eliminationId: tenth.elimination!.id, reason: "wrong player" }));
    const after = await getRoster(ids.tCraft, ids.leagueA);
    const positions = after.filter((r) => r.elimination).map((r) => r.elimination!.position).sort((a, b) => a! - b!);
    expect(positions).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    const log = await db.query.auditLogs.findFirst({ where: (a, { eq }) => eq(a.action, "elimination.void") });
    expect(log?.actorUserId).toBe("staffA");
  });

  it("an elimination in one tournament never touches another tournament's records", async () => {
    const asia = await getRoster(ids.tAsia, ids.leagueA);
    expect(asia).toHaveLength(0);
  });
});

describe("export and history", () => {
  it("exports only this session's players, with times in the venue zone", async () => {
    const f = await generateTournamentExport(ids.tCraft, "csv", true);
    const csv = f.body.toString("utf8");
    expect(f.filename).toBe("craft-brewery_friday-tournament_2026-10-09_checkins-busts.csv");
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(11); // header + 10 players
    expect(csv).not.toContain("Rosa");
    expect(csv).toContain("wrong player");
    const xlsx = await generateTournamentExport(ids.tCraft, "xlsx", false);
    expect(xlsx.body.subarray(0, 2).toString()).toBe("PK");
  });

  it("14: closing and creating new tournaments keeps history", async () => {
    as("adminA");
    ok(await setTournamentStatus({ tournamentId: ids.tCraft, status: "completed" }));
    ok(await createTournament({ leagueId: ids.leagueA, venueId: ids.craft, name: "Friday Tournament", scheduledAt: "2026-10-16T19:00", copyStructureFrom: ids.tCraft }));
    const list = await tournamentsForUser("adminA", ids.leagueA, true);
    expect(list.filter((r) => r.t.name === "Friday Tournament")).toHaveLength(2);
    expect(await getRoster(ids.tCraft, ids.leagueA)).toHaveLength(10);
    as("staffA");
    expect(fail(await checkIn({ tournamentId: ids.tCraft, registrationId: (await getRoster(ids.tCraft, ids.leagueA))[0].registrationId }))).toMatch(/closed/);
  });

  it("removing a staff member removes their venue access", async () => {
    await db.delete(leagueMemberships).where(and(eq(leagueMemberships.leagueId, ids.leagueA), eq(leagueMemberships.userId, "staffA")));
    expect(await db.select().from(venueMemberships).where(eq(venueMemberships.userId, "staffA"))).toHaveLength(0);
  });
});
