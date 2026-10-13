"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { blindLevels, players, tournamentRegistrations, tournaments, venues } from "@/db/schema";
import { run, UserError } from "@/lib/action-result";
import { requireLeagueAdmin, requireTournamentPermission } from "@/lib/auth";
import { zonedLocalToUtc } from "@/lib/format";
import { DEFAULT_STRUCTURE, id, localDateTime, name, optionalId, optionalInt, structureInput } from "@/lib/validation";
import { insertTournament, levelsToRows, resolveStructure, tournamentLevels } from "@/server/tournament-create";
import { audit, loadAdvancedState, lockTournament, writeState } from "@/server/tournament-state";

const createInput = z.object({
  leagueId: id,
  venueId: id,
  name,
  scheduledAt: localDateTime,
  maxEntrants: optionalInt(2, 10_000),
  startingStack: optionalInt(1, 100_000_000),
  anteEnabled: z.boolean().default(false),
  /** A saved league structure… */
  structureId: optionalId,
  /** …or copy the blinds of an earlier tournament. Neither → league default (or standard). */
  copyStructureFrom: optionalId,
  /** Explicitly use the built-in standard structure, even if the league has a default. */
  useStandard: z.boolean().default(false),
});

export async function createTournament(input: z.input<typeof createInput>) {
  return run(async () => {
    const v = createInput.parse(input);
    const { userId } = await requireLeagueAdmin(v.leagueId);

    const tournamentId = await db.transaction(async (tx) => {
      const venue = await tx.query.venues.findFirst({ where: and(eq(venues.id, v.venueId), eq(venues.leagueId, v.leagueId)) });
      if (!venue) throw new UserError("Venue not found in this league.");
      if (!venue.active) throw new UserError("That venue is inactive.");
      const levels = await resolveStructure(tx, v.leagueId, { structureId: v.structureId, copyFromTournamentId: v.copyStructureFrom, useStandard: v.useStandard });
      const created = await insertTournament(
        tx,
        {
          leagueId: v.leagueId,
          venueId: v.venueId,
          name: v.name,
          scheduledAt: zonedLocalToUtc(v.scheduledAt, venue.timezone),
          maxEntrants: v.maxEntrants ?? null,
          startingStack: v.startingStack ?? null,
          anteEnabled: v.anteEnabled,
          createdBy: userId,
        },
        levels,
      );
      await audit(tx, {
        leagueId: v.leagueId,
        tournamentId: created.id,
        actorUserId: userId,
        action: "tournament.create",
        entityType: "tournament",
        entityId: created.id,
        data: { name: v.name, venueId: v.venueId, structureId: v.structureId, copyStructureFrom: v.copyStructureFrom },
      });
      return created.id;
    });
    revalidatePath(`/admin/leagues/${v.leagueId}`);
    return { tournamentId };
  });
}

const duplicateInput = z.object({
  tournamentId: id,
  scheduledAt: localDateTime,
  venueId: optionalId,
  name: name.optional(),
  /** Pre-register everyone who registered last time (active players only). */
  copyPlayers: z.boolean().default(false),
});

/**
 * Weekly repeat: a brand-new tournament with the source's settings and blinds.
 * Nothing about the source changes, and the copy gets its own code and clock.
 */
export async function duplicateTournament(input: z.input<typeof duplicateInput>) {
  return run(async () => {
    const v = duplicateInput.parse(input);
    const ctx = await requireTournamentPermission(v.tournamentId, "manage");
    const src = ctx.tournament;
    const result = await db.transaction(async (tx) => {
      const venueId = v.venueId ?? src.venueId;
      const venue = await tx.query.venues.findFirst({ where: and(eq(venues.id, venueId), eq(venues.leagueId, src.leagueId)) });
      if (!venue) throw new UserError("Venue not found in this league.");
      if (!venue.active) throw new UserError("That venue is inactive.");
      const levels = await tournamentLevels(tx, src.id);
      const created = await insertTournament(
        tx,
        {
          leagueId: src.leagueId,
          venueId,
          name: v.name ?? src.name,
          scheduledAt: zonedLocalToUtc(v.scheduledAt, venue.timezone),
          maxEntrants: src.maxEntrants,
          startingStack: src.startingStack,
          anteEnabled: src.anteEnabled,
          showEliminationsPublic: src.showEliminationsPublic,
          breakAlertsEnabled: src.breakAlertsEnabled,
          createdBy: ctx.userId,
        },
        levels.length ? levels : DEFAULT_STRUCTURE,
      );
      let playersCopied = 0;
      if (v.copyPlayers) {
        const regs = await tx
          .select({ playerId: tournamentRegistrations.playerId })
          .from(tournamentRegistrations)
          .innerJoin(players, and(eq(players.id, tournamentRegistrations.playerId), eq(players.leagueId, src.leagueId)))
          .where(and(eq(tournamentRegistrations.tournamentId, src.id), eq(players.active, true)));
        const capped = src.maxEntrants ? regs.slice(0, src.maxEntrants) : regs;
        if (capped.length)
          await tx.insert(tournamentRegistrations).values(capped.map((r) => ({ leagueId: src.leagueId, tournamentId: created.id, playerId: r.playerId, registeredBy: ctx.userId })));
        playersCopied = capped.length;
      }
      await audit(tx, {
        leagueId: src.leagueId,
        tournamentId: created.id,
        actorUserId: ctx.userId,
        action: "tournament.duplicate",
        entityType: "tournament",
        entityId: created.id,
        data: { sourceTournamentId: src.id, playersCopied },
      });
      return { tournamentId: created.id, playersCopied };
    });
    revalidatePath(`/admin/leagues/${src.leagueId}`);
    return result;
  });
}

const settingsInput = z.object({
  tournamentId: id,
  name,
  scheduledAt: localDateTime,
  maxEntrants: z.coerce.number().int().min(2).max(10_000).nullable(),
  startingStack: z.coerce.number().int().min(1).nullable(),
  anteEnabled: z.boolean(),
  showEliminationsPublic: z.boolean(),
  breakAlertsEnabled: z.boolean(),
});

export async function updateTournamentSettings(input: z.input<typeof settingsInput>) {
  return run(async () => {
    const v = settingsInput.parse(input);
    const ctx = await requireTournamentPermission(v.tournamentId, "manage");
    await db.transaction(async (tx) => {
      const { tournamentId, scheduledAt, ...other } = v;
      const rest = { ...other, scheduledAt: zonedLocalToUtc(scheduledAt, ctx.venue.timezone) };
      await tx.update(tournaments).set(rest).where(and(eq(tournaments.id, tournamentId), eq(tournaments.leagueId, ctx.tournament.leagueId)));
      await audit(tx, { leagueId: ctx.tournament.leagueId, tournamentId, actorUserId: ctx.userId, action: "tournament.update", entityType: "tournament", entityId: tournamentId, data: rest });
    });
    revalidatePath(`/admin/tournaments/${v.tournamentId}`);
  });
}

export async function saveStructure(input: { tournamentId: string; levels: z.input<typeof structureInput> }) {
  return run(async () => {
    const tournamentId = id.parse(input.tournamentId);
    const levels = structureInput.parse(input.levels);
    if (!levels.some((l) => l.kind === "level")) throw new UserError("Add at least one blind level.");
    const ctx = await requireTournamentPermission(tournamentId, "manage");
    await db.transaction(async (tx) => {
      await lockTournament(tx, tournamentId);
      const now = Date.now();
      const { state } = await loadAdvancedState(tx, tournamentId, now);
      await tx.delete(blindLevels).where(eq(blindLevels.tournamentId, tournamentId));
      await tx.insert(blindLevels).values(levelsToRows(tournamentId, levels));
      // Keep the running level where it is; clamp if the structure got shorter.
      if (state.levelIndex > levels.length - 1) await writeState(tx, tournamentId, { ...state, levelIndex: levels.length - 1, cycle: state.cycle + 1 });
      else await writeState(tx, tournamentId, state); // bump version so clients refetch levels
      await audit(tx, { leagueId: ctx.tournament.leagueId, tournamentId, actorUserId: ctx.userId, action: "structure.save", entityType: "tournament", entityId: tournamentId, data: { levels } });
    });
    revalidatePath(`/admin/tournaments/${tournamentId}`);
  });
}

export async function setTournamentStatus(input: { tournamentId: string; status: "scheduled" | "running" | "completed" | "cancelled" }) {
  return run(async () => {
    const v = z.object({ tournamentId: id, status: z.enum(["scheduled", "running", "completed", "cancelled"]) }).parse(input);
    const ctx = await requireTournamentPermission(v.tournamentId, "manage");
    await db.transaction(async (tx) => {
      const t = await lockTournament(tx, v.tournamentId);
      const now = new Date();
      const patch: Partial<typeof tournaments.$inferInsert> = { status: v.status };
      if (v.status === "running" && !t.startedAt) patch.startedAt = now;
      if (v.status === "completed") {
        patch.completedAt = now;
        const { state } = await loadAdvancedState(tx, v.tournamentId, now.getTime());
        if (state.status === "running" || state.status === "break")
          await writeState(tx, v.tournamentId, { ...state, status: "paused", remainingMs: Math.max(0, (state.levelEndsAt ?? now.getTime()) - now.getTime()), levelEndsAt: null, breakEndsAt: null });
      }
      if (v.status === "running" || v.status === "scheduled") patch.completedAt = null;
      await tx.update(tournaments).set(patch).where(eq(tournaments.id, v.tournamentId));
      await audit(tx, { leagueId: ctx.tournament.leagueId, tournamentId: v.tournamentId, actorUserId: ctx.userId, action: `tournament.${v.status}`, entityType: "tournament", entityId: v.tournamentId });
    });
    revalidatePath(`/admin/tournaments/${v.tournamentId}`);
  });
}
