"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { blindLevels, tournaments, tournamentTimerState, venues } from "@/db/schema";
import { run, UserError } from "@/lib/action-result";
import { requireLeagueAdmin, requireTournamentPermission } from "@/lib/auth";
import { generatePublicCode } from "@/lib/code";
import { zonedLocalToUtc } from "@/lib/format";
import { DEFAULT_STRUCTURE, id, name, optionalInt, structureInput, type LevelInput } from "@/lib/validation";
import { audit, isUniqueViolation, loadAdvancedState, lockTournament, writeState } from "@/server/tournament-state";

const toRows = (tournamentId: string, levels: LevelInput[]) =>
  levels.map((l, i) => ({
    tournamentId,
    position: i,
    kind: l.kind,
    smallBlind: l.kind === "break" ? 0 : l.smallBlind,
    bigBlind: l.kind === "break" ? 0 : l.bigBlind,
    ante: l.kind === "break" ? 0 : l.ante,
    durationSec: Math.round(l.durationMin * 60),
  }));

const createInput = z.object({
  leagueId: id,
  venueId: id,
  name,
  scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Pick a date and time."),
  maxEntrants: optionalInt(2, 10_000),
  startingStack: optionalInt(1, 100_000_000),
  anteEnabled: z.boolean().default(false),
  copyStructureFrom: id.optional().or(z.literal("").transform(() => undefined)),
});

export async function createTournament(input: z.input<typeof createInput>) {
  return run(async () => {
    const v = createInput.parse(input);
    const { userId } = await requireLeagueAdmin(v.leagueId);

    const tournamentId = await db.transaction(async (tx) => {
      const venue = await tx.query.venues.findFirst({ where: and(eq(venues.id, v.venueId), eq(venues.leagueId, v.leagueId)) });
      if (!venue) throw new UserError("Venue not found in this league.");
      if (!venue.active) throw new UserError("That venue is inactive.");

      let structure: LevelInput[] = DEFAULT_STRUCTURE;
      if (v.copyStructureFrom) {
        // Source must be in the SAME league.
        const src = await tx.query.tournaments.findFirst({ where: and(eq(tournaments.id, v.copyStructureFrom), eq(tournaments.leagueId, v.leagueId)) });
        if (!src) throw new UserError("Structure source not found.");
        const rows = await tx.query.blindLevels.findMany({ where: eq(blindLevels.tournamentId, src.id), orderBy: (b, { asc }) => asc(b.position) });
        if (rows.length) structure = rows.map((r) => ({ kind: r.kind, smallBlind: r.smallBlind, bigBlind: r.bigBlind, ante: r.ante, durationMin: r.durationSec / 60 }));
      }

      // Retry on the (unlikely) unique-code collision. Savepoints keep the outer tx alive.
      let created: typeof tournaments.$inferSelect | undefined;
      for (let attempt = 0; attempt < 6 && !created; attempt++) {
        try {
          created = await tx.transaction(async (sp) => {
            const [t] = await sp
              .insert(tournaments)
              .values({
                leagueId: v.leagueId,
                venueId: v.venueId,
                name: v.name,
                scheduledAt: zonedLocalToUtc(v.scheduledAt, venue.timezone),
                maxEntrants: v.maxEntrants ?? null,
                startingStack: v.startingStack ?? null,
                anteEnabled: v.anteEnabled,
                publicCode: generatePublicCode(),
                createdBy: userId,
              })
              .returning();
            return t;
          });
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
        }
      }
      if (!created) throw new Error("Could not allocate a tournament code.");
      await tx.insert(blindLevels).values(toRows(created.id, structure));
      await tx.insert(tournamentTimerState).values({ tournamentId: created.id });
      await audit(tx, { leagueId: v.leagueId, tournamentId: created.id, actorUserId: userId, action: "tournament.create", entityType: "tournament", entityId: created.id, data: { name: v.name, venueId: v.venueId } });
      return created.id;
    });
    revalidatePath(`/admin/leagues/${v.leagueId}`);
    return { tournamentId };
  });
}

const settingsInput = z.object({
  tournamentId: id,
  name,
  scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Pick a date and time."),
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
      await tx.insert(blindLevels).values(toRows(tournamentId, levels));
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
