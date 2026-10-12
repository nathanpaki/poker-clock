"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { timerAdjustments, tournaments } from "@/db/schema";
import { run, UserError } from "@/lib/action-result";
import { requireTournamentPermission } from "@/lib/auth";
import { applyOp, type ClockOp } from "@/lib/timer";
import { id } from "@/lib/validation";
import { audit, loadAdvancedState, lockTournament, writeState } from "@/server/tournament-state";

const clockInput = z.discriminatedUnion("op", [
  z.object({ op: z.literal("start") }),
  z.object({ op: z.literal("pause") }),
  z.object({ op: z.literal("resume") }),
  z.object({ op: z.literal("reset_level") }),
  z.object({ op: z.literal("adjust"), minutes: z.number().refine((m) => m !== 0 && Math.abs(m) <= 60, "Adjust by 1–60 minutes.") }),
  z.object({ op: z.literal("next_level") }),
  z.object({ op: z.literal("previous_level") }),
  z.object({ op: z.literal("start_break"), minutes: z.number().int().min(1).max(120) }),
  z.object({ op: z.literal("end_break") }),
  z.object({ op: z.literal("restart"), confirm: z.literal("RESTART", { errorMap: () => ({ message: "Type RESTART to confirm." }) }) }),
]);

export type ClockInput = z.input<typeof clockInput>;

/**
 * The only way the timer changes. Locks this tournament's row, materializes any
 * elapsed auto-advance, applies the op, and bumps the version. Other
 * tournaments' rows are untouched, so their clocks are unaffected.
 */
export async function clockAction(tournamentId: string, input: ClockInput) {
  return run(async () => {
    const tid = id.parse(tournamentId);
    const v = clockInput.parse(input);
    const ctx = await requireTournamentPermission(tid, "clock");
    if (ctx.tournament.status === "completed" || ctx.tournament.status === "cancelled")
      throw new UserError("This tournament is closed. Reopen it to use the clock.");

    return db.transaction(async (tx) => {
      const t = await lockTournament(tx, tid);
      const now = Date.now();
      const { state, levels } = await loadAdvancedState(tx, tid, now);
      const op: ClockOp = v.op === "adjust" ? { op: "adjust", deltaMs: v.minutes * 60_000 } : v.op === "start_break" ? { op: "start_break", minutes: v.minutes } : { op: v.op };
      const next = applyOp(state, levels, op, now);
      const saved = await writeState(tx, tid, next);
      if (v.op === "start" && t.status === "scheduled") await tx.update(tournaments).set({ status: "running", startedAt: new Date(now) }).where(eq(tournaments.id, tid));
      await tx.insert(timerAdjustments).values({ tournamentId: tid, op: v.op, detail: { input: v, from: state, to: saved }, actorUserId: ctx.userId });
      if (v.op === "restart" || v.op === "previous_level" || v.op === "next_level" || v.op === "reset_level")
        await audit(tx, { leagueId: t.leagueId, tournamentId: tid, actorUserId: ctx.userId, action: `clock.${v.op}`, entityType: "timer", entityId: tid, data: { levelIndex: saved.levelIndex } });
      return { version: saved.version };
    });
  });
}
