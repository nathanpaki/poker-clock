"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { playerCheckIns, playerEliminations, players, tournamentRegistrations, tournaments } from "@/db/schema";
import { run, UserError } from "@/lib/action-result";
import { requirePlayerManager, requireTournamentPermission } from "@/lib/auth";
import { describe } from "@/lib/timer";
import { id, name } from "@/lib/validation";
import { assertNameAvailable, lockLeaguePlayers } from "@/server/player-names";
import { activeEliminationsInOrder, audit, isUniqueViolation, loadAdvancedState, lockTournament, playerCounts, recomputePositions, writeState } from "@/server/tournament-state";

const assertOpen = (status: string) => {
  if (status === "completed" || status === "cancelled") throw new UserError("This tournament is closed. Reopen it to make changes.");
};

/** New busts sort after every existing one, even after manual reordering. */
async function nextOrderKey(tx: Tx, tournamentId: string, now: number) {
  const elims = await activeEliminationsInOrder(tx, tournamentId);
  const maxKey = elims.reduce((m, e) => Math.max(m, e.orderKey), 0);
  return Math.max(now, maxKey + 1);
}

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
export async function quickAddPlayer(input: { tournamentId: string; displayName: string; checkInNow: boolean; allowSimilar?: boolean }) {
  return run(async () => {
    const v = z.object({ tournamentId: id, displayName: name, checkInNow: z.boolean(), allowSimilar: z.boolean().default(false) }).parse(input);
    const ctx = await requireTournamentPermission(v.tournamentId, "check_in");
    assertOpen(ctx.tournament.status);
    // Creating a league player needs the player-manager permission too.
    await requirePlayerManager(ctx.tournament.leagueId);
    const leagueId = ctx.tournament.leagueId;
    await db.transaction(async (tx) => {
      await lockTournament(tx, v.tournamentId);
      await lockLeaguePlayers(tx, leagueId);
      await assertNameAvailable(tx, leagueId, v.displayName, { allowSimilar: v.allowSimilar });
      const [p] = await tx
        .insert(players)
        .values({ leagueId, displayName: v.displayName })
        .returning()
        .catch((e) => {
          throw isUniqueViolation(e) ? new UserError("A player with that name already exists in this league.") : e;
        });
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
      if (counts.remaining <= 1) throw new UserError("Only one player is left. Declare them the winner instead.");
      const now = Date.now();
      const { state, levels } = await loadAdvancedState(tx, v.tournamentId, now);
      const d = describe(state, levels, now);
      let row;
      try {
        [row] = await tx
          .insert(playerEliminations)
          .values({ registrationId: reg.id, tournamentId: v.tournamentId, eliminatedAt: new Date(now), eliminatedBy: ctx.userId, levelNumber: d.levelNumber || null, levelIndex: state.levelIndex, orderKey: await nextOrderKey(tx, v.tournamentId, now) })
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

/**
 * Ends the game: the last player standing finishes 1st. Records a winner row
 * (so positions and exports are complete), pauses the clock, and closes the
 * tournament. To fix a mistake, reopen the tournament and undo the winner.
 */
export async function declareWinner(input: { tournamentId: string; registrationId: string }) {
  return run(async () => {
    const v = z.object({ tournamentId: id, registrationId: id }).parse(input);
    const ctx = await requireTournamentPermission(v.tournamentId, "eliminate");
    assertOpen(ctx.tournament.status);
    const result = await db.transaction(async (tx) => {
      await lockTournament(tx, v.tournamentId);
      const reg = await getRegistration(tx, v.tournamentId, v.registrationId);
      const ci = await tx.query.playerCheckIns.findFirst({ where: and(eq(playerCheckIns.registrationId, reg.id), isNull(playerCheckIns.voidedAt)) });
      if (!ci) throw new UserError("Only a checked-in player can win.");
      const already = await tx.query.playerEliminations.findFirst({ where: and(eq(playerEliminations.registrationId, reg.id), isNull(playerEliminations.voidedAt)) });
      if (already) throw new UserError("That player is already out.");
      const counts = await playerCounts(tx, v.tournamentId);
      if (counts.remaining !== 1) throw new UserError(`There are still ${counts.remaining} players in. Eliminate the others first.`);

      const now = Date.now();
      const { state, levels } = await loadAdvancedState(tx, v.tournamentId, now);
      const d = describe(state, levels, now);
      try {
        await tx.insert(playerEliminations).values({
          registrationId: reg.id,
          tournamentId: v.tournamentId,
          eliminatedAt: new Date(now),
          eliminatedBy: ctx.userId,
          levelNumber: d.levelNumber || null,
          levelIndex: state.levelIndex,
          orderKey: await nextOrderKey(tx, v.tournamentId, now),
          isWinner: true,
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new UserError("A winner has already been declared.");
        throw e;
      }
      await recomputePositions(tx, v.tournamentId);

      // Stop the clock and close the tournament.
      if (state.status === "running" || state.status === "break")
        await writeState(tx, v.tournamentId, { ...state, status: "paused", remainingMs: Math.max(0, d.remaining), levelEndsAt: null, breakEndsAt: null });
      await tx.update(tournaments).set({ status: "completed", completedAt: new Date(now) }).where(eq(tournaments.id, v.tournamentId));

      const player = await tx.query.players.findFirst({ where: and(eq(players.id, reg.playerId), eq(players.leagueId, ctx.tournament.leagueId)) });
      await audit(tx, { leagueId: ctx.tournament.leagueId, tournamentId: v.tournamentId, actorUserId: ctx.userId, action: "tournament.winner", entityType: "registration", entityId: reg.id, data: { playerId: reg.playerId } });
      return { name: player?.displayName ?? "Winner" };
    });
    revalidatePath(`/admin/tournaments/${v.tournamentId}`);
    return result;
  });
}

/**
 * Change a busted player's finishing position (e.g. two players busted on the
 * same hand were recorded in the wrong order). Recorded bust times are not
 * changed; only the finishing order. Allowed on closed tournaments too, since
 * results are usually checked after the game, and every move is audited.
 */
export async function moveElimination(input: { tournamentId: string; eliminationId: string; toPosition: number }) {
  return run(async () => {
    const v = z.object({ tournamentId: id, eliminationId: id, toPosition: z.number().int().min(1).max(10_000) }).parse(input);
    const ctx = await requireTournamentPermission(v.tournamentId, "eliminate");
    if (ctx.tournament.status === "cancelled") throw new UserError("This tournament was cancelled.");
    await db.transaction(async (tx) => {
      await lockTournament(tx, v.tournamentId);
      const { checkedIn } = await playerCounts(tx, v.tournamentId);
      const all = await activeEliminationsInOrder(tx, v.tournamentId);
      const target = all.find((e) => e.id === v.eliminationId);
      if (!target) throw new UserError("That elimination was corrected or doesn't exist. Refresh and try again.");
      if (target.isWinner) throw new UserError("The winner always finishes 1st. Undo the winner first if this is wrong.");

      // Busted players occupy positions checkedIn (first out) down to checkedIn - (n - 1).
      const movable = all.filter((e) => !e.isWinner);
      const best = checkedIn - (movable.length - 1);
      if (v.toPosition < best || v.toPosition > checkedIn)
        throw new UserError(`Busted players can be placed from ${best} to ${checkedIn}.${best > 1 ? " Better positions belong to players still in, or the winner." : ""}`);
      const from = checkedIn - movable.findIndex((e) => e.id === target.id);
      if (from === v.toPosition) return;

      // Reorder, then hand out the existing keys in the new order (strictly increasing).
      const keys = movable.map((e) => e.orderKey);
      for (let i = 1; i < keys.length; i++) if (keys[i] <= keys[i - 1]) keys[i] = keys[i - 1] + 1;
      const order = movable.filter((e) => e.id !== target.id);
      order.splice(checkedIn - v.toPosition, 0, target);
      for (let i = 0; i < order.length; i++)
        if (order[i].orderKey !== keys[i]) await tx.update(playerEliminations).set({ orderKey: keys[i] }).where(eq(playerEliminations.id, order[i].id));
      await recomputePositions(tx, v.tournamentId);
      await audit(tx, {
        leagueId: ctx.tournament.leagueId,
        tournamentId: v.tournamentId,
        actorUserId: ctx.userId,
        action: "elimination.reorder",
        entityType: "elimination",
        entityId: target.id,
        data: { fromPosition: from, toPosition: v.toPosition },
      });
    });
    revalidatePath(`/admin/tournaments/${v.tournamentId}`);
  });
}

/**
 * "Did you mean John?" → check in the EXISTING league player: reactivates them
 * if needed (player-manager permission), registers them if needed, and checks
 * them in. Idempotent: an already checked-in player is just reported.
 */
export async function checkInExisting(input: { tournamentId: string; playerId: string }) {
  return run(async () => {
    const v = z.object({ tournamentId: id, playerId: id }).parse(input);
    const ctx = await requireTournamentPermission(v.tournamentId, "check_in");
    assertOpen(ctx.tournament.status);
    const leagueId = ctx.tournament.leagueId;
    const result = await db.transaction(async (tx) => {
      await lockTournament(tx, v.tournamentId);
      const p = await tx.query.players.findFirst({ where: and(eq(players.id, v.playerId), eq(players.leagueId, leagueId)) });
      if (!p) throw new UserError("Player not found in this league.");
      if (!p.active) {
        await requirePlayerManager(leagueId); // reactivating needs player-management rights
        await tx.update(players).set({ active: true, updatedAt: new Date() }).where(eq(players.id, p.id));
        await audit(tx, { leagueId, tournamentId: v.tournamentId, actorUserId: ctx.userId, action: "player.reactivate", entityType: "player", entityId: p.id });
      }
      let reg = await tx.query.tournamentRegistrations.findFirst({
        where: and(eq(tournamentRegistrations.tournamentId, v.tournamentId), eq(tournamentRegistrations.playerId, p.id)),
      });
      if (!reg) {
        if (ctx.tournament.maxEntrants) {
          const n = await tx.select({ id: tournamentRegistrations.id }).from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, v.tournamentId));
          if (n.length >= ctx.tournament.maxEntrants) throw new UserError(`Registration is full (${ctx.tournament.maxEntrants} max).`);
        }
        [reg] = await tx.insert(tournamentRegistrations).values({ leagueId, tournamentId: v.tournamentId, playerId: p.id, registeredBy: ctx.userId }).returning();
      }
      const already = await tx.query.playerCheckIns.findFirst({ where: and(eq(playerCheckIns.registrationId, reg.id), isNull(playerCheckIns.voidedAt)) });
      if (!already) {
        await tx.insert(playerCheckIns).values({ registrationId: reg.id, tournamentId: v.tournamentId, checkedInBy: ctx.userId });
        await recomputePositions(tx, v.tournamentId);
        await audit(tx, { leagueId, tournamentId: v.tournamentId, actorUserId: ctx.userId, action: "checkin.create", entityType: "registration", entityId: reg.id, data: { existingPlayer: p.id } });
      }
      return { name: p.displayName, alreadyCheckedIn: !!already, reactivated: !p.active };
    });
    revalidatePath(`/admin/tournaments/${v.tournamentId}`);
    return result;
  });
}
