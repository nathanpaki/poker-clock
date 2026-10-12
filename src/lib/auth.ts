import "server-only";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { leagueMemberships, platformAdmins, tournaments, venueMemberships, venues } from "@/db/schema";

/**
 * Every protected read and write goes through these helpers. They take an
 * entity ID, look up the OWNING league/venue in the database, and check the
 * signed-in user's memberships. A client-supplied leagueId is never trusted on
 * its own.
 */

export class AuthzError extends Error {
  constructor(message = "You don't have access to this.") {
    super(message);
  }
}

export type TournamentPermission = "view" | "check_in" | "eliminate" | "clock" | "export" | "manage";

export const requireUserId = cache(async (): Promise<string> => {
  const { userId } = await auth();
  if (!userId) throw new AuthzError("Sign in to continue.");
  return userId;
});

export const isPlatformAdmin = cache(async (userId: string): Promise<boolean> => {
  const boot = (process.env.PLATFORM_ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (boot.includes(userId)) return true;
  const row = await db.query.platformAdmins.findFirst({ where: eq(platformAdmins.userId, userId) });
  return !!row;
});

export async function requirePlatformAdmin(): Promise<string> {
  const userId = await requireUserId();
  if (!(await isPlatformAdmin(userId))) throw new AuthzError();
  return userId;
}

export const getLeagueRole = cache(async (userId: string, leagueId: string): Promise<"platform" | "admin" | "staff" | null> => {
  if (await isPlatformAdmin(userId)) return "platform";
  const m = await db.query.leagueMemberships.findFirst({
    where: and(eq(leagueMemberships.leagueId, leagueId), eq(leagueMemberships.userId, userId)),
  });
  return m?.role ?? null;
});

export async function requireLeagueAdmin(leagueId: string) {
  const userId = await requireUserId();
  const role = await getLeagueRole(userId, leagueId);
  if (role !== "admin" && role !== "platform") throw new AuthzError();
  return { userId, role };
}

export async function requireLeagueMember(leagueId: string) {
  const userId = await requireUserId();
  const role = await getLeagueRole(userId, leagueId);
  if (!role) throw new AuthzError();
  return { userId, role };
}

/** League admins, or staff with "manage players" on any venue in the league. */
export async function requirePlayerManager(leagueId: string) {
  const userId = await requireUserId();
  const role = await getLeagueRole(userId, leagueId);
  if (role === "admin" || role === "platform") return { userId };
  if (role === "staff") {
    const m = await db.query.venueMemberships.findFirst({
      where: and(eq(venueMemberships.leagueId, leagueId), eq(venueMemberships.userId, userId), eq(venueMemberships.canManagePlayers, true)),
    });
    if (m) return { userId };
  }
  throw new AuthzError();
}

/** Staff who can at least see the league's player list (for registering players). */
export async function requireLeaguePlayerReader(leagueId: string) {
  const userId = await requireUserId();
  const role = await getLeagueRole(userId, leagueId);
  if (!role) throw new AuthzError();
  return { userId, role };
}

export type TournamentContext = {
  userId: string;
  tournament: typeof tournaments.$inferSelect;
  venue: typeof venues.$inferSelect;
  isLeagueAdmin: boolean;
  perms: Record<TournamentPermission, boolean>;
};

export async function getTournamentContext(tournamentId: string): Promise<TournamentContext> {
  const userId = await requireUserId();
  const t = await db.query.tournaments.findFirst({ where: eq(tournaments.id, tournamentId) });
  if (!t) throw new AuthzError("Tournament not found.");
  const venue = await db.query.venues.findFirst({ where: and(eq(venues.id, t.venueId), eq(venues.leagueId, t.leagueId)) });
  if (!venue) throw new AuthzError("Tournament not found.");

  const role = await getLeagueRole(userId, t.leagueId);
  const isLeagueAdmin = role === "admin" || role === "platform";
  let perms: Record<TournamentPermission, boolean>;
  if (isLeagueAdmin) {
    perms = { view: true, check_in: true, eliminate: true, clock: true, export: true, manage: true };
  } else if (role === "staff") {
    const vm = await db.query.venueMemberships.findFirst({
      where: and(eq(venueMemberships.venueId, t.venueId), eq(venueMemberships.userId, userId), eq(venueMemberships.leagueId, t.leagueId)),
    });
    perms = {
      view: !!vm,
      check_in: !!vm?.canCheckIn,
      eliminate: !!vm?.canEliminate,
      clock: !!vm?.canControlClock,
      export: !!vm?.canExport,
      manage: false,
    };
  } else {
    perms = { view: false, check_in: false, eliminate: false, clock: false, export: false, manage: false };
  }
  // Same message as "not found" so IDs from other leagues can't be probed.
  if (!perms.view) throw new AuthzError("Tournament not found.");
  return { userId, tournament: t, venue, isLeagueAdmin, perms };
}

export async function requireTournamentPermission(tournamentId: string, perm: TournamentPermission): Promise<TournamentContext> {
  const ctx = await getTournamentContext(tournamentId);
  if (!ctx.perms[perm]) throw new AuthzError("You don't have permission for this action.");
  return ctx;
}

/** Resolve Clerk user IDs to display names (best effort). */
export async function resolveUserNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  try {
    const client = await clerkClient();
    for (let i = 0; i < unique.length; i += 100) {
      const { data } = await client.users.getUserList({ userId: unique.slice(i, i + 100), limit: 100 });
      for (const u of data) {
        const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || u.primaryEmailAddress?.emailAddress || u.id;
        map.set(u.id, name);
      }
    }
  } catch {
    // Fall back to raw IDs if Clerk is unavailable.
  }
  for (const id of unique) if (!map.has(id)) map.set(id, id);
  return map;
}
