import "server-only";
import { and, asc, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { leagueMemberships, leagues, playerCheckIns, playerEliminations, players, tournamentRegistrations, tournaments, venueMemberships, venues } from "@/db/schema";
import { isPlatformAdmin } from "@/lib/auth";

/** Leagues visible to this user. Platform admins see all. */
export async function leaguesForUser(userId: string) {
  if (await isPlatformAdmin(userId)) {
    const all = await db.select().from(leagues).orderBy(leagues.name);
    return all.map((l) => ({ league: l, role: "platform" as const }));
  }
  const rows = await db
    .select({ league: leagues, role: leagueMemberships.role })
    .from(leagueMemberships)
    .innerJoin(leagues, eq(leagues.id, leagueMemberships.leagueId))
    .where(eq(leagueMemberships.userId, userId))
    .orderBy(leagues.name);
  return rows;
}

/** Tournaments a user may open, limited to one league. Admins see all; staff see assigned venues only. */
export async function tournamentsForUser(userId: string, leagueId: string, isAdmin: boolean) {
  const base = db
    .select({ t: tournaments, venueName: venues.name })
    .from(tournaments)
    .innerJoin(venues, and(eq(venues.id, tournaments.venueId), eq(venues.leagueId, tournaments.leagueId)));
  if (isAdmin) return base.where(eq(tournaments.leagueId, leagueId)).orderBy(desc(tournaments.scheduledAt)).limit(300);
  const vm = await db
    .select({ venueId: venueMemberships.venueId })
    .from(venueMemberships)
    .where(and(eq(venueMemberships.userId, userId), eq(venueMemberships.leagueId, leagueId)));
  if (!vm.length) return [];
  return base
    .where(and(eq(tournaments.leagueId, leagueId), inArray(tournaments.venueId, vm.map((v) => v.venueId))))
    .orderBy(desc(tournaments.scheduledAt))
    .limit(300);
}


export type RosterEntry = {
  registrationId: string;
  playerId: string;
  name: string;
  registeredAt: number;
  checkIn: { at: number; by: string | null } | null;
  elimination: { id: string; at: number; by: string | null; position: number | null; levelNumber: number | null } | null;
};

/** Registrations for ONE tournament (caller must have authorized access). */
export async function getRoster(tournamentId: string, leagueId: string): Promise<RosterEntry[]> {
  const regs = await db
    .select({ id: tournamentRegistrations.id, playerId: players.id, name: players.displayName, registeredAt: tournamentRegistrations.registeredAt })
    .from(tournamentRegistrations)
    .innerJoin(players, and(eq(players.id, tournamentRegistrations.playerId), eq(players.leagueId, leagueId)))
    .where(and(eq(tournamentRegistrations.tournamentId, tournamentId), eq(tournamentRegistrations.leagueId, leagueId)))
    .orderBy(asc(players.displayName));
  const cis = await db.select().from(playerCheckIns).where(and(eq(playerCheckIns.tournamentId, tournamentId), isNull(playerCheckIns.voidedAt)));
  const els = await db.select().from(playerEliminations).where(and(eq(playerEliminations.tournamentId, tournamentId), isNull(playerEliminations.voidedAt)));
  return regs.map((r) => {
    const c = cis.find((x) => x.registrationId === r.id);
    const e = els.find((x) => x.registrationId === r.id);
    return {
      registrationId: r.id,
      playerId: r.playerId,
      name: r.name,
      registeredAt: r.registeredAt.getTime(),
      checkIn: c ? { at: c.checkedInAt.getTime(), by: c.checkedInBy } : null,
      elimination: e ? { id: e.id, at: e.eliminatedAt.getTime(), by: e.eliminatedBy, position: e.finishPosition, levelNumber: e.levelNumber } : null,
    };
  });
}

/** Active league players not yet registered for this tournament. */
export async function unregisteredPlayers(tournamentId: string, leagueId: string) {
  const registered = db.select({ id: tournamentRegistrations.playerId }).from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, tournamentId));
  return db
    .select({ id: players.id, name: players.displayName })
    .from(players)
    .where(and(eq(players.leagueId, leagueId), eq(players.active, true), notInArray(players.id, registered)))
    .orderBy(asc(players.displayName))
    .limit(2000);
}
