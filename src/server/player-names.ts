import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { players } from "@/db/schema";
import { ConflictError, UserError, type NameConflictPlayer } from "@/lib/action-result";
import { findNameMatches, hasNameContent } from "@/lib/names";

/**
 * Serializes player creation/renaming within ONE league, so two staff adding
 * "Hank" at the same moment can't both succeed even before the database
 * unique rule is switched on. Other leagues are never blocked.
 */
export async function lockLeaguePlayers(tx: Tx, leagueId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"players:" + leagueId}))`);
}

const lite = (p: { id: string; displayName: string; active: boolean }): NameConflictPlayer => ({ id: p.id, name: p.displayName, active: p.active });

/**
 * Throws a ConflictError the UI can act on:
 *  - exact: same name (ignoring case, punctuation and spacing), active or not → always blocked
 *  - similar: likely the same person ("Jon" vs "John") → blocked unless allowSimilar
 * Call inside a transaction AFTER lockLeaguePlayers.
 */
export async function assertNameAvailable(tx: Tx, leagueId: string, name: string, opts: { excludeId?: string; allowSimilar?: boolean } = {}) {
  if (!hasNameContent(name)) throw new UserError("A name needs at least one letter or number.");
  const existing = await tx
    .select({ id: players.id, displayName: players.displayName, active: players.active, nameKey: players.nameKey })
    .from(players)
    .where(eq(players.leagueId, leagueId));
  const m = findNameMatches(name, existing, opts.excludeId);
  if (m.exact) {
    const p = m.exact;
    throw new ConflictError(
      p.active
        ? `${p.displayName} is already a player in this league. If this is a different person, add a last name or initial to tell them apart (for example "${p.displayName.trim().split(/\s+/)[0]} R.").`
        : `${p.displayName} is already in this league but deactivated. Reactivate them instead of adding a new player.`,
      { kind: "exact", player: lite(p) },
    );
  }
  if (m.similar.length && !opts.allowSimilar) {
    throw new ConflictError(`Similar name${m.similar.length > 1 ? "s" : ""} already in this league: ${m.similar.map((p) => p.displayName).join(", ")}. Is this the same person?`, {
      kind: "similar",
      players: m.similar.map(lite),
    });
  }
}
