"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { leagueMemberships, leagues, venueMemberships, venues } from "@/db/schema";
import { run, UserError } from "@/lib/action-result";
import { requireLeagueAdmin, requirePlatformAdmin } from "@/lib/auth";
import { slugify } from "@/lib/format";
import { id, name, timezone } from "@/lib/validation";
import { audit, isUniqueViolation } from "@/server/tournament-state";

async function findUserIdByEmail(email: string): Promise<string> {
  const client = await clerkClient();
  const { data } = await client.users.getUserList({ emailAddress: [email], limit: 1 });
  if (!data[0]) throw new UserError(`No account uses ${email}. Ask them to sign up first, then add them again.`);
  return data[0].id;
}

export async function createLeague(input: { name: string; timezone: string; adminEmail?: string }) {
  return run(async () => {
    const actor = await requirePlatformAdmin();
    const v = z.object({ name, timezone, adminEmail: z.string().email().optional().or(z.literal("")) }).parse(input);
    const adminId = v.adminEmail ? await findUserIdByEmail(v.adminEmail) : null;
    const leagueId = await db.transaction(async (tx) => {
      let slug = slugify(v.name);
      const exists = await tx.query.leagues.findFirst({ where: eq(leagues.slug, slug) });
      if (exists) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
      const [l] = await tx.insert(leagues).values({ name: v.name, slug, defaultTimezone: v.timezone }).returning();
      if (adminId) await tx.insert(leagueMemberships).values({ leagueId: l.id, userId: adminId, role: "admin" });
      await audit(tx, { leagueId: l.id, actorUserId: actor, action: "league.create", entityType: "league", entityId: l.id, data: { name: v.name, adminId } });
      return l.id;
    });
    revalidatePath("/admin");
    return { leagueId };
  });
}

export async function updateLeagueSettings(input: { leagueId: string; name: string; timezone: string; allowCrossVenuePlayers: boolean }) {
  return run(async () => {
    const v = z.object({ leagueId: id, name, timezone, allowCrossVenuePlayers: z.boolean() }).parse(input);
    const { userId } = await requireLeagueAdmin(v.leagueId);
    await db.transaction(async (tx) => {
      await tx.update(leagues).set({ name: v.name, defaultTimezone: v.timezone, allowCrossVenuePlayers: v.allowCrossVenuePlayers }).where(eq(leagues.id, v.leagueId));
      await audit(tx, { leagueId: v.leagueId, actorUserId: userId, action: "league.update", entityType: "league", entityId: v.leagueId, data: v });
    });
    revalidatePath(`/admin/leagues/${v.leagueId}`);
  });
}

export async function createVenue(input: { leagueId: string; name: string; timezone: string }) {
  return run(async () => {
    const v = z.object({ leagueId: id, name, timezone }).parse(input);
    const { userId } = await requireLeagueAdmin(v.leagueId);
    await db.transaction(async (tx) => {
      const [venue] = await tx.insert(venues).values(v).returning();
      await audit(tx, { leagueId: v.leagueId, actorUserId: userId, action: "venue.create", entityType: "venue", entityId: venue.id, data: v });
    });
    revalidatePath(`/admin/leagues/${v.leagueId}`);
  });
}

export async function updateVenue(input: { leagueId: string; venueId: string; name: string; timezone: string; active: boolean }) {
  return run(async () => {
    const v = z.object({ leagueId: id, venueId: id, name, timezone, active: z.boolean() }).parse(input);
    const { userId } = await requireLeagueAdmin(v.leagueId);
    await db.transaction(async (tx) => {
      // Scoped by BOTH ids: a venue from another league matches zero rows.
      const res = await tx
        .update(venues)
        .set({ name: v.name, timezone: v.timezone, active: v.active })
        .where(and(eq(venues.id, v.venueId), eq(venues.leagueId, v.leagueId)))
        .returning({ id: venues.id });
      if (!res.length) throw new UserError("Venue not found.");
      await audit(tx, { leagueId: v.leagueId, actorUserId: userId, action: "venue.update", entityType: "venue", entityId: v.venueId, data: v });
    });
    revalidatePath(`/admin/leagues/${v.leagueId}`);
  });
}

export async function addLeagueMember(input: { leagueId: string; email: string; role: "admin" | "staff" }) {
  return run(async () => {
    const v = z.object({ leagueId: id, email: z.string().trim().email("Enter a valid email."), role: z.enum(["admin", "staff"]) }).parse(input);
    const { userId } = await requireLeagueAdmin(v.leagueId);
    const memberId = await findUserIdByEmail(v.email);
    await db.transaction(async (tx) => {
      await tx
        .insert(leagueMemberships)
        .values({ leagueId: v.leagueId, userId: memberId, role: v.role })
        .onConflictDoUpdate({ target: [leagueMemberships.leagueId, leagueMemberships.userId], set: { role: v.role } });
      await audit(tx, { leagueId: v.leagueId, actorUserId: userId, action: "member.upsert", entityType: "league_membership", entityId: memberId, data: { role: v.role, email: v.email } });
    });
    revalidatePath(`/admin/leagues/${v.leagueId}`);
  });
}

export async function removeLeagueMember(input: { leagueId: string; userId: string }) {
  return run(async () => {
    const v = z.object({ leagueId: id, userId: z.string().min(1) }).parse(input);
    const { userId } = await requireLeagueAdmin(v.leagueId);
    if (v.userId === userId) throw new UserError("You can't remove yourself.");
    await db.transaction(async (tx) => {
      await tx.delete(venueMemberships).where(and(eq(venueMemberships.leagueId, v.leagueId), eq(venueMemberships.userId, v.userId)));
      await tx.delete(leagueMemberships).where(and(eq(leagueMemberships.leagueId, v.leagueId), eq(leagueMemberships.userId, v.userId)));
      await audit(tx, { leagueId: v.leagueId, actorUserId: userId, action: "member.remove", entityType: "league_membership", entityId: v.userId });
    });
    revalidatePath(`/admin/leagues/${v.leagueId}`);
  });
}

const venueAccess = z.object({
  leagueId: id,
  venueId: id,
  userId: z.string().min(1),
  enabled: z.boolean(),
  canCheckIn: z.boolean(),
  canEliminate: z.boolean(),
  canControlClock: z.boolean(),
  canManagePlayers: z.boolean(),
  canExport: z.boolean(),
});

export async function setVenueAccess(input: z.infer<typeof venueAccess>) {
  return run(async () => {
    const v = venueAccess.parse(input);
    const { userId } = await requireLeagueAdmin(v.leagueId);
    await db.transaction(async (tx) => {
      const venue = await tx.query.venues.findFirst({ where: and(eq(venues.id, v.venueId), eq(venues.leagueId, v.leagueId)) });
      if (!venue) throw new UserError("Venue not found.");
      if (!v.enabled) {
        await tx.delete(venueMemberships).where(and(eq(venueMemberships.venueId, v.venueId), eq(venueMemberships.userId, v.userId)));
      } else {
        const perms = {
          canCheckIn: v.canCheckIn,
          canEliminate: v.canEliminate,
          canControlClock: v.canControlClock,
          canManagePlayers: v.canManagePlayers,
          canExport: v.canExport,
        };
        try {
          await tx
            .insert(venueMemberships)
            .values({ leagueId: v.leagueId, venueId: v.venueId, userId: v.userId, ...perms })
            .onConflictDoUpdate({ target: [venueMemberships.venueId, venueMemberships.userId], set: perms });
        } catch (e) {
          if (isUniqueViolation(e)) throw new UserError("Access already exists.");
          throw new UserError("That person must be a member of this league first.");
        }
      }
      await audit(tx, { leagueId: v.leagueId, actorUserId: userId, action: "venue_access.set", entityType: "venue_membership", entityId: `${v.venueId}:${v.userId}`, data: v });
    });
    revalidatePath(`/admin/leagues/${v.leagueId}`);
  });
}
