"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { players } from "@/db/schema";
import { run, UserError } from "@/lib/action-result";
import { requirePlayerManager } from "@/lib/auth";
import { id, name } from "@/lib/validation";
import { audit } from "@/server/tournament-state";

const optional = z.string().trim().max(200).optional().transform((s) => (s ? s : null));
const playerFields = z.object({
  leagueId: id,
  displayName: name,
  email: z.string().trim().email("Enter a valid email or leave it blank.").optional().or(z.literal("")).transform((s) => (s ? s : null)),
  phone: optional,
  notes: optional,
});

export async function createPlayer(input: z.input<typeof playerFields>) {
  return run(async () => {
    const v = playerFields.parse(input);
    const { userId } = await requirePlayerManager(v.leagueId);
    const player = await db.transaction(async (tx) => {
      const [p] = await tx.insert(players).values(v).returning();
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
      const res = await tx
        .update(players)
        .set({ displayName: v.displayName, email: v.email, phone: v.phone, notes: v.notes, updatedAt: new Date() })
        .where(and(eq(players.id, v.playerId), eq(players.leagueId, v.leagueId)))
        .returning({ id: players.id });
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
