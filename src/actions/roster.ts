"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { playerCheckIns, playerEliminations, players, tournamentRegistrations } from "@/db/schema";
import { run, UserError } from "@/lib/action-result";
import { requirePlayerManager, requireTournamentPermission } from "@/lib/auth";
import { describe } from "@/lib/timer";
import { id, name } from "@/lib/validation";
import { audit, isUniqueViolation, loadAdvancedState, lockTournament, playerCounts, recomputePositions } from "@/server/tournament-state";

const assertOpen = (status: string) => {
  if (status === "completed" || status === "cancelled") throw new UserError("This tournament is closed. Reopen it to make changes.");
};

/** Load a registration ONLY if it belongs to this tournament. */
async function getRegistration(tx: Tx, tournamentId: string, registrationId: string) {
  const reg = await tx.query.tournamentRegistrations.findFirst({
    where: and(eq(tournamentRegistrations.id, registrationId), eq(tournamentRegistrations.tournamentId, tournamentId)),
  });
  if (!reg) throw new UserError("That player isn't registered for this tournament.");
  return reg;
}

export async function registerPlayers(input: { tournamentId: string; playerIds: string[]; checkInNow?: boolean }) {
  return run(async () => {
    const v = z.object({ tournamentId: id, playerIds: z.array(id).min(1).max(500), checkInNow: z.boolean().default(false) }).parse(input);
    const ctx = await requireTournamentPermission(v.tournamentId, "check_in");
    assertOpen(ctx.tournament.status);
    const leagueId = ctx.tournament.leagueId;
    const added = await db.transaction(async (tx) => {
      await lockTournament(tx, v.tournamentId);
      // Only active players from THIS league. Composite FKs would also reject others.
      const valid = await tx
        .select({ id: players.id })
        .from(players)
        .where(and(inArray(players.id, v.playerIds), eq(players.leagueId, leagueId), eq(players.active, true)));
      if (valid.length !== v.playerIds.length) throw new UserError("Some players aren't active members of this league.");
      const rows = await tx
        .insert(tournamentRegistrations)
        .values(valid.map((p) => ({ leagueId, tournamentId: v.tournamentId, playerId: p.id, registeredBy: ctx.userId })))
        .onConflictDoNothing({ target: [tournamentRegistrations.tournamentId, tournamentRegistrations.playerId] })
        .returning({ id: tournamentRegistrations.id, playerId: tournamentRegistrations.playerId });
      if (ctx.tournament.maxEntrants) {
        const all = await tx.select({ id: tournamentRegistrations.id }).from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, v.tournamentId));
        if (all.length > ctx.tournament.maxEntrants) throw new UserError(`Registration is full (${ctx.tournament.maxEntrants} max).`);
      }
      if (v.checkInNow && rows.length) {
        await tx.insert(playerCheckIns).values(rows.map((r) => ({ registrationId: r.id, tournamentId: v.tournamentId, checkedInBy: ctx.userId })));
        await recomputePositions(tx, v.tournamentId);
      }
      await audit(tx, { leagueId, tournamentId: v.tournamentId, actorUserId: ctx.userId, action: "registration.add", entityType: "registration", data: { playerIds: rows.map((r) => r.playerId), checkInNow: v.checkInNow } });
      return rows.length;
    });
    revalidatePath(`/admin/tournaments/${v.tournamentId}`);
    return { added };
  });
}

/** Create a league player and register (and optionally check in) in one step. */
export async function quickAddPlayer(input: { tournamentId: string; displayName: string; checkInNow: boolean }) {
  return run(async () => {
    const v = z.object({ tournamentId: id, displayName: name, checkInNow: z.boolean() }).parse(input);
    const ctx = await requireTournamentPermission(v.tournamentId, "check_in");
    assertOpen(ctx.tournament.status);
    // Creating a league player needs the player-manager permission too.
    await requirePlayerManager(ctx.tournament.leagueId);
    const leagueId = ctx.tournament.leagueId;
    await db.transaction(async (tx) => {
      await lockTournament(tx, v.tournamentId);
      const [p] = await tx.insert(players).values({ leagueId, displayName: v.displayName }).returning();
      const [reg] = await tx.insert(tournamentRegistrations).values({ leagueId, tournamentId: v.tournamentId, playerId: p.id, registeredBy: ctx.userId }).returning();
      if (v.checkInNow) {
        await tx.insert(playerCheckIns).values({ registrationId: reg.id, tournamentId: v.tournamentId, checkedInBy: ctx.userId });
        await recomputePositions(tx, v.tournamentId);
      }
      await audit(tx, { leagueId, tournamentId: v.tournamentId, actorUserId: ctx.userId, action: "player.quick_add", entityType: "player", entityId: p.id, data: { displayName: v.displayName } });
    });
    revalidatePath(`/admin/tournaments/${v.tournamentId}`);
  });
}

export async function unregister(input: { tournamentId: string; registrationId: string }) {
  return run(async () => {
    const v = z.object({ tournamentId: id, registrationId: id }).parse(input);
    const ctx = await requireTournamentPermission(v.tournamentId, "check_in");
    assertOpen(ctx.tournament.status);
    await db.transaction(async (tx) => {
      await lockTournament(tx, v.tournamentId);
      const reg = await getRegistration(tx, v.tournamentId, v.registrationId);
      const any = await tx.query.playerCheckIns.findFirst({ where: eq(playerCheckIns.registrationId, reg.id) });
      if (any) throw new UserError("This player has check-in history. Undo the check-in instead of removing the registration.");
      await tx.delete(tournamentRegistrations).where(eq(tournamentRegistrations.id, reg.id));
      await audit(tx, { leagueId: ctx.tournament.leagueId, tournamentId: v.tournamentId, actorUserId: ctx.userId, action: "registration.remove", entityType: "registration", entityId: reg.id, data: { playerId: reg.playerId } });
    });
    revalidatePath(`/admin/tournaments/${v.tournamentId}`);
  });
}

export async function checkIn(input: { tournamentId: string; registrationId: string }) {
  return run(async () => {
    const v = z.object({ tournamentId: id, registrationId: id }).parse(input);
    const ctx = await requireTournamentPermission(v.tournamentId, "check_in");
    assertOpen(ctx.tournament.status);
    const at = await db.transaction(async (tx) => {
      await lockTournament(tx, v.tournamentId);
      const reg = await getRegistration(tx, v.tournamentId, v.registrationId);
      let row;
      try {
        [row] = await tx.insert(playerCheckIns).values({ registrationId: reg.id, tournamentId: v.tournamentId, checkedInBy: ctx.userId }).returning();
      } catch (e) {
        if (isUniqueViolation(e)) throw new UserError("Already checked in.");
        throw e;
      }
      await recomputePositions(tx, v.tournamentId);
      await audit(tx, { leagueId: ctx.tournament.leagueId, tournamentId: v.tournamentId, actorUserId: ctx.userId, action: "checkin.create", entityType: "check_in", entityId: row.id, data: { registrationId: reg.id } });
      return row.checkedInAt.getTime();
    });
    revalidatePath(`/admin/tournaments/${v.tournamentId}`);
    return { checkedInAt: at };
  });
}

export async function undoCheckIn(input: { tournamentId: string; registrationId: string; reason?: string }) {
  return run(async () => {
    const v = z.object({ tournamentId: id, registrationId: id, reason: z.string().trim().max(300).optional() }).parse(input);
    const ctx = await requireTournamentPermission(v.tournamentId, "check_in");
    assertOpen(ctx.tournament.status);
    await db.transaction(async (tx) => {
      await lockTournament(tx, v.tournamentId);
      const reg = await getRegistration(tx, v.tournamentId, v.registrationId);
      const elim = await tx.query.playerEliminations.findFirst({ where: and(eq(playerEliminations.registrationId, reg.id), isNull(playerEliminations.voidedAt)) });
      if (elim) throw new UserError("Undo the elimination first.");
      const res = await tx
        .update(playerCheckIns)
        .set({ voidedAt: new Date(), voidedBy: ctx.userId, voidReason: v.reason ?? null })
        .where(and(eq(playerCheckIns.registrationId, reg.id), isNull(playerCheckIns.voidedAt)))
        .returning({ id: playerCheckIns.id });
      if (!res.length) throw new UserError("This player isn't checked in.");
      await recomputePositions(tx, v.tournamentId);
      await audit(tx, { leagueId: ctx.tournament.leagueId, tournamentId: v.tournamentId, actorUserId: ctx.userId, action: "checkin.void", entityType: "check_in", entityId: res[0].id, data: { reason: v.reason } });
    });
    revalidatePath(`/admin/tournaments/${v.tournamentId}`);
  });
}

export async function eliminate(input: { tournamentId: string; registrationId: string }) {
  return run(async () => {
    const v = z.object({ tournamentId: id, registrationId: id }).parse(input);
    const ctx = await requireTournamentPermission(v.tournamentId, "eliminate");
    assertOpen(ctx.tournament.status);
    const result = await db.transaction(async (tx) => {
      // The row lock serializes concurrent eliminations so positions and counts stay correct.
      await lockTournament(tx, v.tournamentId);
      const reg = await getRegistration(tx, v.tournamentId, v.registrationId);
      const ci = await tx.query.playerCheckIns.findFirst({ where: and(eq(playerCheckIns.registrationId, reg.id), isNull(playerCheckIns.voidedAt)) });
      if (!ci) throw new UserError("Only checked-in players can be eliminated.");
      const already = await tx.query.playerEliminations.findFirst({ where: and(eq(playerEliminations.registrationId, reg.id), isNull(playerEliminations.voidedAt)) });
      if (already) throw new UserError("Already eliminated.");
      const counts = await playerCounts(tx, v.tournamentId);
      if (counts.remaining <= 1) throw new UserError("That's the last player standing — they're the winner.");
      const now = Date.now();
      const { state, levels } = await loadAdvancedState(tx, v.tournamentId, now);
      const d = describe(state, levels, now);
      let row;
      try {
        [row] = await tx
          .insert(playerEliminations)
          .values({ registrationId: reg.id, tournamentId: v.tournamentId, eliminatedAt: new Date(now), eliminatedBy: ctx.userId, levelNumber: d.levelNumber || null, levelIndex: state.levelIndex })
          .returning();
      } catch (e) {
        if (isUniqueViolation(e)) throw new UserError("Already eliminated.");
        throw e;
      }
      await recomputePositions(tx, v.tournamentId);
      const final = await tx.query.playerEliminations.findFirst({ where: eq(playerEliminations.id, row.id) });
      await audit(tx, { leagueId: ctx.tournament.leagueId, tournamentId: v.tournamentId, actorUserId: ctx.userId, action: "elimination.create", entityType: "elimination", entityId: row.id, data: { registrationId: reg.id, levelNumber: d.levelNumber } });
      return { position: final?.finishPosition ?? null, eliminatedAt: now };
    });
    revalidatePath(`/admin/tournaments/${v.tournamentId}`);
    return result;
  });
}

export async function voidElimination(input: { tournamentId: string; eliminationId: string; reason: string }) {
  return run(async () => {
    const v = z.object({ tournamentId: id, eliminationId: id, reason: z.string().trim().min(1, "Add a short reason for the correction.").max(300) }).parse(input);
    const ctx = await requireTournamentPermission(v.tournamentId, "eliminate");
    assertOpen(ctx.tournament.status);
    await db.transaction(async (tx) => {
      await lockTournament(tx, v.tournamentId);
      const res = await tx
        .update(playerEliminations)
        .set({ voidedAt: new Date(), voidedBy: ctx.userId, voidReason: v.reason })
        .where(and(eq(playerEliminations.id, v.eliminationId), eq(playerEliminations.tournamentId, v.tournamentId), isNull(playerEliminations.voidedAt)))
        .returning();
      if (!res.length) throw new UserError("That elimination was already corrected or doesn't exist.");
      await recomputePositions(tx, v.tournamentId);
      await audit(tx, {
        leagueId: ctx.tournament.leagueId,
        tournamentId: v.tournamentId,
        actorUserId: ctx.userId,
        action: "elimination.void",
        entityType: "elimination",
        entityId: v.eliminationId,
        data: { reason: v.reason, original: { eliminatedAt: res[0].eliminatedAt, finishPosition: res[0].finishPosition, eliminatedBy: res[0].eliminatedBy } },
      });
    });
    revalidatePath(`/admin/tournaments/${v.tournamentId}`);
  });
}
