"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { players, tournamentRegistrations, tournaments } from "@/db/schema";
import { run, UserError } from "@/lib/action-result";
import { requireLeagueAdmin, requirePlayerManager } from "@/lib/auth";
import { id, name } from "@/lib/validation";
import { assertNameAvailable, lockLeaguePlayers } from "@/server/player-names";
import { audit, isUniqueViolation } from "@/server/tournament-state";

const optional = z.string().trim().max(200).optional().transform((s) => (s ? s : null));
const playerFields = z.object({
  leagueId: id,
  displayName: name,
  email: z.string().trim().email("Enter a valid email or leave it blank.").optional().or(z.literal("")).transform((s) => (s ? s : null)),
  phone: optional,
  notes: optional,
});

const sameNameError = () => new UserError("A player with that name already exists in this league. Add a last name or initial to tell them apart.");

export async function createPlayer(input: z.input<typeof playerFields> & { allowSimilar?: boolean }) {
  return run(async () => {
    const v = playerFields.extend({ allowSimilar: z.boolean().default(false) }).parse(input);
    const { userId } = await requirePlayerManager(v.leagueId);
    const { allowSimilar, ...values } = v;
    const player = await db.transaction(async (tx) => {
      await lockLeaguePlayers(tx, v.leagueId);
      await assertNameAvailable(tx, v.leagueId, v.displayName, { allowSimilar });
      const [p] = await tx
        .insert(players)
        .values(values)
        .returning()
        .catch((e) => {
          throw isUniqueViolation(e) ? sameNameError() : e;
        });
      await audit(tx, { leagueId: v.leagueId, actorUserId: userId, action: "player.create", entityType: "player", entityId: p.id, data: { displayName: v.displayName } });
      return p;
    });
    revalidatePath(`/admin/leagues/${v.leagueId}/players`);
    return { id: player.id, displayName: player.displayName };
  });
}

export async function updatePlayer(input: z.input<typeof playerFields> & { playerId: string }) {
  return run(async () => {
    const v = playerFields.extend({ playerId: id }).parse(input);
    const { userId } = await requirePlayerManager(v.leagueId);
    await db.transaction(async (tx) => {
      await lockLeaguePlayers(tx, v.leagueId);
      // Renaming is how two same-name players get told apart, so only exact clashes are blocked.
      await assertNameAvailable(tx, v.leagueId, v.displayName, { excludeId: v.playerId, allowSimilar: true });
      const res = await tx
        .update(players)
        .set({ displayName: v.displayName, email: v.email, phone: v.phone, notes: v.notes, updatedAt: new Date() })
        .where(and(eq(players.id, v.playerId), eq(players.leagueId, v.leagueId)))
        .returning({ id: players.id })
        .catch((e) => {
          throw isUniqueViolation(e) ? sameNameError() : e;
        });
      if (!res.length) throw new UserError("Player not found.");
      await audit(tx, { leagueId: v.leagueId, actorUserId: userId, action: "player.update", entityType: "player", entityId: v.playerId, data: v });
    });
    revalidatePath(`/admin/leagues/${v.leagueId}/players`);
  });
}

/** Deactivate instead of delete — history must keep the name. */
export async function setPlayerActive(input: { leagueId: string; playerId: string; active: boolean }) {
  return run(async () => {
    const v = z.object({ leagueId: id, playerId: id, active: z.boolean() }).parse(input);
    const { userId } = await requirePlayerManager(v.leagueId);
    await db.transaction(async (tx) => {
      const res = await tx
        .update(players)
        .set({ active: v.active, updatedAt: new Date() })
        .where(and(eq(players.id, v.playerId), eq(players.leagueId, v.leagueId)))
        .returning({ id: players.id });
      if (!res.length) throw new UserError("Player not found.");
      await audit(tx, { leagueId: v.leagueId, actorUserId: userId, action: v.active ? "player.reactivate" : "player.deactivate", entityType: "player", entityId: v.playerId });
    });
    revalidatePath(`/admin/leagues/${v.leagueId}/players`);
  });
}

/**
 * Merge a duplicate record into the one to keep: every tournament registration
 * (with its check-ins and eliminations) moves to `keepId`, missing contact
 * details are copied over, and the now-empty duplicate is removed. The removed
 * record's details are kept in the audit log. League admins only.
 */
export async function mergePlayers(input: { leagueId: string; keepId: string; mergeId: string }) {
  return run(async () => {
    const v = z.object({ leagueId: id, keepId: id, mergeId: id }).parse(input);
    if (v.keepId === v.mergeId) throw new UserError("Pick two different players.");
    const { userId } = await requireLeagueAdmin(v.leagueId);
    const result = await db.transaction(async (tx) => {
      await lockLeaguePlayers(tx, v.leagueId);
      // Both must belong to THIS league; lock the rows while we work.
      const both = await tx
        .select()
        .from(players)
        .where(and(eq(players.leagueId, v.leagueId), inArray(players.id, [v.keepId, v.mergeId])))
        .for("update");
      const keep = both.find((p) => p.id === v.keepId);
      const merge = both.find((p) => p.id === v.mergeId);
      if (!keep || !merge) throw new UserError("One of those players isn't in this league (or was already merged). Refresh and try again.");

      const regsOf = (playerId: string) =>
        tx
          .select({ tournamentId: tournamentRegistrations.tournamentId, name: tournaments.name, scheduledAt: tournaments.scheduledAt })
          .from(tournamentRegistrations)
          .innerJoin(tournaments, and(eq(tournaments.id, tournamentRegistrations.tournamentId), eq(tournaments.leagueId, tournamentRegistrations.leagueId)))
          .where(and(eq(tournamentRegistrations.playerId, playerId), eq(tournamentRegistrations.leagueId, v.leagueId)));
      const [keepRegs, mergeRegs] = await Promise.all([regsOf(keep.id), regsOf(merge.id)]);
      const clash = mergeRegs.filter((m) => keepRegs.some((k) => k.tournamentId === m.tournamentId));
      if (clash.length)
        throw new UserError(
          `Both records were registered for ${clash.map((c) => `"${c.name}" (${c.scheduledAt.toISOString().slice(0, 10)})`).join(", ")}. ` +
            "That may be two different people. If it's really one person, remove the extra registration from that tournament first, then merge.",
        );

      const moved = await tx
        .update(tournamentRegistrations)
        .set({ playerId: keep.id })
        .where(and(eq(tournamentRegistrations.playerId, merge.id), eq(tournamentRegistrations.leagueId, v.leagueId)))
        .returning({ id: tournamentRegistrations.id });
      await tx.delete(players).where(and(eq(players.id, merge.id), eq(players.leagueId, v.leagueId)));
      await tx
        .update(players)
        .set({
          email: keep.email ?? merge.email,
          phone: keep.phone ?? merge.phone,
          notes: [keep.notes, merge.notes].filter(Boolean).join(" | ") || null,
          active: keep.active || merge.active,
          updatedAt: new Date(),
        })
        .where(eq(players.id, keep.id));
      await audit(tx, {
        leagueId: v.leagueId,
        actorUserId: userId,
        action: "player.merge",
        entityType: "player",
        entityId: keep.id,
        data: { kept: { id: keep.id, displayName: keep.displayName }, removed: merge, registrationsMoved: moved.length },
      });
      return { kept: keep.displayName, removed: merge.displayName, registrationsMoved: moved.length };
    });
    revalidatePath(`/admin/leagues/${v.leagueId}/players`);
    return result;
  });
}
