import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { blindLevels, blindStructures, tournaments, tournamentTimerState } from "@/db/schema";
import { UserError } from "@/lib/action-result";
import { generatePublicCode } from "@/lib/code";
import { DEFAULT_STRUCTURE, structureInput, type LevelInput } from "@/lib/validation";
import { isUniqueViolation } from "./tournament-state";

export const levelsToRows = (tournamentId: string, levels: LevelInput[]) =>
  levels.map((l, i) => ({
    tournamentId,
    position: i,
    kind: l.kind,
    smallBlind: l.kind === "break" ? 0 : l.smallBlind,
    bigBlind: l.kind === "break" ? 0 : l.bigBlind,
    ante: l.kind === "break" ? 0 : l.ante,
    durationSec: Math.round(l.durationMin * 60),
  }));

/** A tournament's levels in editor/file form. */
export async function tournamentLevels(q: Tx, tournamentId: string): Promise<LevelInput[]> {
  const rows = await q.select().from(blindLevels).where(eq(blindLevels.tournamentId, tournamentId)).orderBy(asc(blindLevels.position));
  return rows.map((r) => ({ kind: r.kind, smallBlind: r.smallBlind, bigBlind: r.bigBlind, ante: r.ante, durationMin: r.durationSec / 60 }));
}

/**
 * Resolve where a new tournament's blinds come from. Every source is looked up
 * WITHIN the given league, so another league's structure or tournament can't be used.
 */
export async function resolveStructure(
  tx: Tx,
  leagueId: string,
  src: { structureId?: string; copyFromTournamentId?: string; useStandard?: boolean },
): Promise<LevelInput[]> {
  if (src.useStandard) return DEFAULT_STRUCTURE;
  if (src.structureId) {
    const s = await tx.query.blindStructures.findFirst({ where: and(eq(blindStructures.id, src.structureId), eq(blindStructures.leagueId, leagueId)) });
    if (!s) throw new UserError("That saved blind structure wasn't found in this league.");
    return structureInput.parse(s.levels);
  }
  if (src.copyFromTournamentId) {
    const t = await tx.query.tournaments.findFirst({ where: and(eq(tournaments.id, src.copyFromTournamentId), eq(tournaments.leagueId, leagueId)) });
    if (!t) throw new UserError("Structure source not found.");
    const levels = await tournamentLevels(tx, t.id);
    if (levels.length) return levels;
  }
  // No choice made: use the league's default saved structure, if it has one.
  const def = await tx.query.blindStructures.findFirst({ where: and(eq(blindStructures.leagueId, leagueId), eq(blindStructures.isDefault, true)) });
  return def ? structureInput.parse(def.levels) : DEFAULT_STRUCTURE;
}

/** Insert tournament + levels + its own timer row. Retries the (rare) public-code collision. */
export async function insertTournament(
  tx: Tx,
  values: Omit<typeof tournaments.$inferInsert, "id" | "publicCode" | "status">,
  levels: LevelInput[],
) {
  let created: typeof tournaments.$inferSelect | undefined;
  for (let attempt = 0; attempt < 6 && !created; attempt++) {
    try {
      created = await tx.transaction(async (sp) => {
        const [t] = await sp.insert(tournaments).values({ ...values, publicCode: generatePublicCode() }).returning();
        return t;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  if (!created) throw new Error("Could not allocate a tournament code.");
  await tx.insert(blindLevels).values(levelsToRows(created.id, levels));
  await tx.insert(tournamentTimerState).values({ tournamentId: created.id });
  return created;
}
