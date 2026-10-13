/**
 * Duplicate-player protection and merging, against a scratch Postgres database.
 */
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../mocks/db";
import { leagueMemberships, players, tournamentRegistrations } from "@/db/schema";
import { currentUser } from "../mocks/clerk";
import { createLeague, createVenue, setVenueAccess } from "@/actions/leagues";
import { createPlayer, mergePlayers, setPlayerActive, updatePlayer } from "@/actions/players";
import { createTournament } from "@/actions/tournaments";
import { checkIn, checkInExisting, eliminate, quickAddPlayer, registerPlayers } from "@/actions/roster";
import { getRoster } from "@/server/queries";
import { duplicateNameGroups, enforceUniqueNames, uniqueNameRuleActive } from "@/server/name-rule";

const as = (id: string) => (currentUser.id = id);
type R<T> = { ok: true; data?: T } | { ok: false; error: string; conflict?: unknown };
function ok<T>(r: R<T>): T {
  if (!r.ok) throw new Error(`Expected success, got: ${r.error}`);
  return r.data as T;
}
const fail = (r: R<unknown>) => {
  expect(r.ok).toBe(false);
  return r as { ok: false; error: string; conflict?: any };
};
const ids: Record<string, string> = {};
const add = async (displayName: string, leagueId = ids.leagueA) => ok(await createPlayer({ leagueId, displayName }))!.id;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Set TEST_DATABASE_URL to a scratch database.");
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  process.env.PLATFORM_ADMIN_USER_IDS = "platform";
  as("platform");
  ids.leagueA = ok(await createLeague({ name: "League A", timezone: "America/New_York" }))!.leagueId;
  ids.leagueB = ok(await createLeague({ name: "League B", timezone: "America/Chicago" }))!.leagueId;
  await db.insert(leagueMemberships).values([
    { leagueId: ids.leagueA, userId: "adminA", role: "admin" },
    { leagueId: ids.leagueB, userId: "adminB", role: "admin" },
    { leagueId: ids.leagueA, userId: "staffA", role: "staff" },
  ]);
  as("adminA");
  ok(await createVenue({ leagueId: ids.leagueA, name: "Craft Brewery", timezone: "America/New_York" }));
  ids.venue = (await db.query.venues.findFirst({ where: (v, { eq }) => eq(v.leagueId, ids.leagueA) }))!.id;
  // Staff can check in but NOT manage players.
  ok(await setVenueAccess({ leagueId: ids.leagueA, venueId: ids.venue, userId: "staffA", enabled: true, canCheckIn: true, canEliminate: true, canControlClock: false, canManagePlayers: false, canExport: false }));
  ids.t1 = ok(await createTournament({ leagueId: ids.leagueA, venueId: ids.venue, name: "Week 1", scheduledAt: "2026-10-09T19:00" }))!.tournamentId;
  ids.t2 = ok(await createTournament({ leagueId: ids.leagueA, venueId: ids.venue, name: "Week 2", scheduledAt: "2026-10-16T19:00" }))!.tournamentId;
});

describe("blocking duplicate players", () => {
  it("the database rule is on for a fresh database", async () => {
    expect(await uniqueNameRuleActive(db)).toBe(true);
  });

  it("blocks the same name regardless of case, punctuation and spacing", async () => {
    as("adminA");
    ids.hank = await add("Hank S.");
    for (const n of ["hank s", "HANK  S", "Hank-S."]) {
      const r = fail(await createPlayer({ leagueId: ids.leagueA, displayName: n }));
      if (n === "Hank-S.") expect(r.ok).toBe(false); // "hanks" is similar, not exact
      else expect(r.conflict).toEqual({ kind: "exact", player: { id: ids.hank, name: "Hank S.", active: true } });
    }
  });

  it("an inactive player with the same name is still a conflict, and says to reactivate", async () => {
    as("adminA");
    const lou = await add("Lou");
    ok(await setPlayerActive({ leagueId: ids.leagueA, playerId: lou, active: false }));
    const r = fail(await createPlayer({ leagueId: ids.leagueA, displayName: "lou" }));
    expect(r.conflict).toMatchObject({ kind: "exact", player: { id: lou, active: false } });
    expect(r.error).toMatch(/deactivated. Reactivate/);
  });

  it("asks about similar names, and allows them when confirmed", async () => {
    as("adminA");
    ids.john = await add("John");
    const r = fail(await createPlayer({ leagueId: ids.leagueA, displayName: "Jon" }));
    expect(r.conflict).toEqual({ kind: "similar", players: [{ id: ids.john, name: "John", active: true }] });
    ids.jon = ok(await createPlayer({ leagueId: ids.leagueA, displayName: "Jon", allowSimilar: true }))!.id;
    // Two Mikes told apart by initial: no warning at all.
    await add("Mike R");
    await add("Mike T");
  });

  it("the same name in a different league is fine", async () => {
    as("adminB");
    await add("Hank S.", ids.leagueB);
  });

  it("five people adding the same new name at once create exactly one player", async () => {
    as("adminA");
    const rs = await Promise.all(Array.from({ length: 5 }, () => createPlayer({ leagueId: ids.leagueA, displayName: "Priya" })));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const rows = await db.select().from(players).where(eq(players.nameKey, "priya"));
    expect(rows).toHaveLength(1);
  });

  it("renaming into an existing name is blocked; renaming to tell people apart works", async () => {
    as("adminA");
    expect(fail(await updatePlayer({ leagueId: ids.leagueA, playerId: ids.jon, displayName: "john" })).conflict).toMatchObject({ kind: "exact" });
    ok(await updatePlayer({ leagueId: ids.leagueA, playerId: ids.jon, displayName: "Jon P." }));
    ok(await updatePlayer({ leagueId: ids.leagueA, playerId: ids.jon, displayName: "Jon P." })); // unchanged name isn't a clash with itself
  });

  it("the database itself rejects a duplicate even if app checks were bypassed", async () => {
    await expect(db.insert(players).values({ leagueId: ids.leagueA, displayName: "HANK s" })).rejects.toThrow();
  });
});

describe("check-in pop-up: did you mean…?", () => {
  it("quick add reports the existing player instead of creating a duplicate", async () => {
    as("adminA");
    const r = fail(await quickAddPlayer({ tournamentId: ids.t1, displayName: "hank s", checkInNow: true }));
    expect(r.conflict).toMatchObject({ kind: "exact", player: { id: ids.hank } });
    expect(fail(await quickAddPlayer({ tournamentId: ids.t1, displayName: "Johnn", checkInNow: true })).conflict).toMatchObject({ kind: "similar" });
  });

  it("checks in the existing player: registers if needed, idempotent", async () => {
    as("staffA");
    const r = ok(await checkInExisting({ tournamentId: ids.t1, playerId: ids.hank }))!;
    expect(r).toMatchObject({ name: "Hank S.", alreadyCheckedIn: false });
    expect(ok(await checkInExisting({ tournamentId: ids.t1, playerId: ids.hank }))!.alreadyCheckedIn).toBe(true);
    const roster = await getRoster(ids.t1, ids.leagueA);
    expect(roster.filter((x) => x.playerId === ids.hank)).toHaveLength(1);
    expect(roster.find((x) => x.playerId === ids.hank)?.checkIn).toBeTruthy();
  });

  it("reactivating needs player-management rights", async () => {
    as("adminA");
    const lou = (await db.query.players.findFirst({ where: eq(players.nameKey, "lou") }))!.id;
    as("staffA");
    expect(fail(await checkInExisting({ tournamentId: ids.t1, playerId: lou })).error).toMatch(/access/);
    as("adminA");
    expect(ok(await checkInExisting({ tournamentId: ids.t1, playerId: lou }))!.reactivated).toBe(true);
  });

  it("can't check in another league's player", async () => {
    as("adminB");
    const bHank = (await db.query.players.findFirst({ where: eq(players.leagueId, ids.leagueB) }))!.id;
    as("adminA");
    expect(fail(await checkInExisting({ tournamentId: ids.t1, playerId: bHank })).error).toMatch(/not found in this league/);
  });
});

describe("merging duplicates that already exist", () => {
  it("simulate a legacy database: rule off, duplicates present", async () => {
    await db.execute(sql`drop index players_name_key_uq`);
    expect(await uniqueNameRuleActive(db)).toBe(false);
    const [a] = await db.insert(players).values({ leagueId: ids.leagueA, displayName: "Rosa", email: null, phone: "555-0100" }).returning();
    const [b] = await db.insert(players).values({ leagueId: ids.leagueA, displayName: "rosa ", email: "rosa@example.com", active: false }).returning();
    ids.rosa1 = a.id;
    ids.rosa2 = b.id;
    as("adminA");
    ok(await registerPlayers({ tournamentId: ids.t1, playerIds: [a.id] }));
    await db.update(players).set({ active: true }).where(eq(players.id, b.id));
    ok(await registerPlayers({ tournamentId: ids.t2, playerIds: [b.id] }));
    const roster = await getRoster(ids.t2, ids.leagueA);
    ok(await checkIn({ tournamentId: ids.t2, registrationId: roster.find((r) => r.playerId === b.id)!.registrationId }));
    const r = await enforceUniqueNames(db);
    expect(r.enabled).toBe(false);
    expect(r.duplicates.map((d) => d.nameKey)).toEqual(["rosa"]);
  });

  it("only league admins can merge, and only within their league", async () => {
    as("staffA");
    expect(fail(await mergePlayers({ leagueId: ids.leagueA, keepId: ids.rosa1, mergeId: ids.rosa2 })).error).toMatch(/access/);
    as("adminB");
    expect(fail(await mergePlayers({ leagueId: ids.leagueA, keepId: ids.rosa1, mergeId: ids.rosa2 })).error).toMatch(/access/);
    expect(fail(await mergePlayers({ leagueId: ids.leagueB, keepId: ids.rosa1, mergeId: ids.rosa2 })).error).toMatch(/isn't in this league/);
    as("adminA");
    const bHank = (await db.query.players.findFirst({ where: eq(players.leagueId, ids.leagueB) }))!.id;
    expect(fail(await mergePlayers({ leagueId: ids.leagueA, keepId: ids.rosa1, mergeId: bHank })).error).toMatch(/isn't in this league/);
  });

  it("moves history (with check-ins) onto the kept record, copies details, removes the duplicate", async () => {
    as("adminA");
    const res = ok(await mergePlayers({ leagueId: ids.leagueA, keepId: ids.rosa1, mergeId: ids.rosa2 }))!;
    expect(res).toEqual({ kept: "Rosa", removed: "rosa ", registrationsMoved: 1 });
    const kept = await db.query.players.findFirst({ where: eq(players.id, ids.rosa1) });
    expect(kept).toMatchObject({ email: "rosa@example.com", phone: "555-0100", active: true });
    expect(await db.query.players.findFirst({ where: eq(players.id, ids.rosa2) })).toBeUndefined();
    const week2 = await getRoster(ids.t2, ids.leagueA);
    expect(week2.find((r) => r.playerId === ids.rosa1)?.checkIn).toBeTruthy(); // check-in came along
    const log = await db.query.auditLogs.findFirst({ where: (a, { eq }) => eq(a.action, "player.merge") });
    expect((log?.data as any).removed.email).toBe("rosa@example.com");
  });

  it("refuses when both records played the same tournament", async () => {
    as("adminA");
    const sam1 = await add("Sam");
    const sam2 = ok(await createPlayer({ leagueId: ids.leagueA, displayName: "Sammy", allowSimilar: true }))!.id;
    ok(await registerPlayers({ tournamentId: ids.t1, playerIds: [sam1, sam2] }));
    expect(fail(await mergePlayers({ leagueId: ids.leagueA, keepId: sam1, mergeId: sam2 })).error).toMatch(/Both records were registered for "Week 1"/);
    expect(await db.select().from(tournamentRegistrations).where(eq(tournamentRegistrations.playerId, sam2))).toHaveLength(1); // nothing changed
  });

  it("once duplicates are merged the rule can be switched on", async () => {
    expect(await duplicateNameGroups(db)).toEqual([]);
    expect(await enforceUniqueNames(db)).toMatchObject({ enabled: true, already: false });
    expect(await uniqueNameRuleActive(db)).toBe(true);
  });

  it("eliminations survive a merge", async () => {
    as("adminA");
    const a = await add("Theo");
    const b = ok(await createPlayer({ leagueId: ids.leagueA, displayName: "Teo", allowSimilar: true }))!.id;
    ok(await checkInExisting({ tournamentId: ids.t2, playerId: b }));
    ok(await checkInExisting({ tournamentId: ids.t2, playerId: ids.hank }));
    const reg = (await getRoster(ids.t2, ids.leagueA)).find((r) => r.playerId === b)!;
    const elim = ok(await eliminate({ tournamentId: ids.t2, registrationId: reg.registrationId }))!;
    ok(await mergePlayers({ leagueId: ids.leagueA, keepId: a, mergeId: b }));
    const after = (await getRoster(ids.t2, ids.leagueA)).find((r) => r.playerId === a)!;
    expect(after.elimination?.position).toBe(elim.position);
    expect(after.name).toBe("Theo");
  });
});
