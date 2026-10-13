import "server-only";
import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  auditLogs,
  blindLevels,
  leagues,
  playerCheckIns,
  playerEliminations,
  players,
  tournamentRegistrations,
  tournaments,
  tournamentTimerState,
  venues,
  type TimerStateRow,
} from "@/db/schema";
import { advance, describe, initialTimerState, type Level, type TimerState } from "@/lib/timer";

type Q = Tx | typeof db;

export const rowToState = (r: TimerStateRow | undefined | null): TimerState =>
  r
    ? {
        status: r.status,
        levelIndex: r.levelIndex,
        levelEndsAt: r.levelEndsAt?.getTime() ?? null,
        remainingMs: r.remainingMs,
        breakEndsAt: r.breakEndsAt?.getTime() ?? null,
        cycle: r.cycle,
        version: r.version,
      }
    : initialTimerState();

export async function loadLevels(q: Q, tournamentId: string): Promise<Level[]> {
  const rows = await q.select().from(blindLevels).where(eq(blindLevels.tournamentId, tournamentId)).orderBy(asc(blindLevels.position));
  return rows.map((r) => ({ kind: r.kind, smallBlind: r.smallBlind, bigBlind: r.bigBlind, ante: r.ante, durationSec: r.durationSec }));
}

/** Persist a state, bumping version. Caller must hold the tournament row lock. */
export async function writeState(tx: Tx, tournamentId: string, s: TimerState): Promise<TimerState> {
  const next = { ...s, version: s.version + 1 };
  const values = {
    status: next.status,
    levelIndex: next.levelIndex,
    levelEndsAt: next.levelEndsAt ? new Date(next.levelEndsAt) : null,
    remainingMs: next.remainingMs === null ? null : Math.round(next.remainingMs),
    breakEndsAt: next.breakEndsAt ? new Date(next.breakEndsAt) : null,
    cycle: next.cycle,
    version: next.version,
    updatedAt: new Date(),
  };
  await tx
    .insert(tournamentTimerState)
    .values({ tournamentId, ...values })
    .onConflictDoUpdate({ target: tournamentTimerState.tournamentId, set: values });
  return next;
}

/** Serializes all mutations for one tournament. Other tournaments are never blocked. */
export async function lockTournament(tx: Tx, tournamentId: string) {
  const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, tournamentId)).for("update");
  if (!t) throw new Error("Tournament not found.");
  return t;
}

/** Load state, apply elapsed transitions, and persist them (inside a locked tx). */
export async function loadAdvancedState(tx: Tx, tournamentId: string, now: number) {
  const [row] = await tx.select().from(tournamentTimerState).where(eq(tournamentTimerState.tournamentId, tournamentId));
  const levels = await loadLevels(tx, tournamentId);
  const { state, changed } = advance(rowToState(row), levels, now);
  const persisted = changed ? await writeState(tx, tournamentId, state) : state;
  return { state: persisted, levels };
}

/**
 * Materialize auto-advance on reads without taking the row lock: an optimistic
 * version check means concurrent readers can't double-apply a transition.
 */
async function materializeOnRead(tournamentId: string, row: TimerStateRow | undefined, levels: Level[], now: number) {
  const current = rowToState(row);
  const { state, changed } = advance(current, levels, now);
  if (!changed || !row) return state;
  const next = { ...state, version: state.version + 1 };
  await db
    .update(tournamentTimerState)
    .set({
      status: next.status,
      levelIndex: next.levelIndex,
      levelEndsAt: next.levelEndsAt ? new Date(next.levelEndsAt) : null,
      remainingMs: next.remainingMs === null ? null : Math.round(next.remainingMs),
      breakEndsAt: next.breakEndsAt ? new Date(next.breakEndsAt) : null,
      cycle: next.cycle,
      version: next.version,
      updatedAt: new Date(),
    })
    .where(and(eq(tournamentTimerState.tournamentId, tournamentId), eq(tournamentTimerState.version, current.version)));
  // Whether we won the race or not, `next` equals what the winner wrote (advance is deterministic).
  return next;
}

export async function playerCounts(q: Q, tournamentId: string) {
  const [ci] = await q
    .select({ n: count() })
    .from(playerCheckIns)
    .where(and(eq(playerCheckIns.tournamentId, tournamentId), isNull(playerCheckIns.voidedAt)));
  const [el] = await q
    .select({ n: count() })
    .from(playerEliminations)
    .where(and(eq(playerEliminations.tournamentId, tournamentId), isNull(playerEliminations.voidedAt)));
  return { checkedIn: Number(ci.n), eliminated: Number(el.n), remaining: Number(ci.n) - Number(el.n) };
}

/**
 * Finishing positions are derived, never typed in: active eliminations ordered by
 * time get positions field, field-1, ... Re-run after any check-in/elimination
 * change (including corrections) so the order is always consistent.
 */
export async function recomputePositions(tx: Tx, tournamentId: string) {
  const { checkedIn } = await playerCounts(tx, tournamentId);
  const elims = await activeEliminationsInOrder(tx, tournamentId);
  for (let i = 0; i < elims.length; i++) {
    const pos = checkedIn - i;
    if (elims[i].pos !== pos) await tx.update(playerEliminations).set({ finishPosition: pos }).where(eq(playerEliminations.id, elims[i].id));
  }
}

/** Active eliminations from worst finish to best. The declared winner is always last (1st place). */
export async function activeEliminationsInOrder(q: Q, tournamentId: string) {
  return q
    .select({ id: playerEliminations.id, pos: playerEliminations.finishPosition, orderKey: playerEliminations.orderKey, isWinner: playerEliminations.isWinner })
    .from(playerEliminations)
    .where(and(eq(playerEliminations.tournamentId, tournamentId), isNull(playerEliminations.voidedAt)))
    .orderBy(asc(playerEliminations.isWinner), asc(playerEliminations.orderKey), asc(playerEliminations.id));
}

export async function audit(
  q: Q,
  entry: { leagueId: string | null; tournamentId?: string | null; actorUserId: string; action: string; entityType: string; entityId?: string | null; data?: unknown },
) {
  await q.insert(auditLogs).values({
    leagueId: entry.leagueId,
    tournamentId: entry.tournamentId ?? null,
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    data: (entry.data ?? null) as never,
  });
}

/** Public, read-only snapshot. Contains no IDs that grant anything. */
export type PublicSnapshot = {
  tournament: {
    code: string;
    name: string;
    venueName: string;
    leagueName: string;
    timezone: string;
    anteEnabled: boolean;
    showEliminations: boolean;
    breakAlertsEnabled: boolean;
    status: string;
  };
  levels: Level[];
  timer: TimerState;
  players: { checkedIn: number; remaining: number };
  eliminations: { position: number | null; name: string; at: number }[];
  eliminationsTotal: number;
  winner: { name: string; at: number } | null;
  serverNow: number;
};

export async function getPublicSnapshot(code: string): Promise<PublicSnapshot | null> {
  const [t] = await db
    .select({ t: tournaments, venueName: venues.name, timezone: venues.timezone, leagueName: leagues.name })
    .from(tournaments)
    .innerJoin(venues, and(eq(venues.id, tournaments.venueId), eq(venues.leagueId, tournaments.leagueId)))
    .innerJoin(leagues, eq(leagues.id, tournaments.leagueId))
    .where(eq(tournaments.publicCode, code));
  if (!t || t.t.status === "cancelled") return null;

  const now = Date.now();
  const [[row], levels, counts] = await Promise.all([
    db.select().from(tournamentTimerState).where(eq(tournamentTimerState.tournamentId, t.t.id)),
    loadLevels(db, t.t.id),
    playerCounts(db, t.t.id),
  ]);
  const timer = await materializeOnRead(t.t.id, row, levels, now);

  const elimBase = () =>
    db
      .select({ position: playerEliminations.finishPosition, name: players.displayName, at: playerEliminations.eliminatedAt })
      .from(playerEliminations)
      .innerJoin(
        tournamentRegistrations,
        and(eq(tournamentRegistrations.id, playerEliminations.registrationId), eq(tournamentRegistrations.tournamentId, playerEliminations.tournamentId)),
      )
      .innerJoin(players, and(eq(players.id, tournamentRegistrations.playerId), eq(players.leagueId, tournamentRegistrations.leagueId)));
  const active = and(eq(playerEliminations.tournamentId, t.t.id), isNull(playerEliminations.voidedAt));
  const [winnerRow] = await elimBase().where(and(active, eq(playerEliminations.isWinner, true))).limit(1);
  let elims: PublicSnapshot["eliminations"] = [];
  if (t.t.showEliminationsPublic) {
    // Most recent busts by finishing order (worst-placed busts are oldest), excluding the winner.
    const rows = await elimBase()
      .where(and(active, eq(playerEliminations.isWinner, false)))
      .orderBy(asc(playerEliminations.finishPosition))
      .limit(5);
    elims = rows.map((r) => ({ position: r.position, name: r.name, at: r.at.getTime() }));
  }

  return {
    tournament: {
      code: t.t.publicCode,
      name: t.t.name,
      venueName: t.venueName,
      leagueName: t.leagueName,
      timezone: t.timezone,
      anteEnabled: t.t.anteEnabled,
      showEliminations: t.t.showEliminationsPublic,
      breakAlertsEnabled: t.t.breakAlertsEnabled,
      status: t.t.status,
    },
    levels,
    timer,
    players: { checkedIn: counts.checkedIn, remaining: counts.remaining },
    eliminations: elims,
    eliminationsTotal: counts.eliminated - (winnerRow ? 1 : 0),
    winner: winnerRow ? { name: winnerRow.name, at: winnerRow.at.getTime() } : null,
    serverNow: Date.now(),
  };
}

/** Current blind level number for recording on an elimination. */
export function currentLevelNumber(state: TimerState, levels: Level[], now: number) {
  return describe(state, levels, now).levelNumber;
}

export const isUniqueViolation = (e: unknown) =>
  typeof e === "object" && e !== null && ((e as { code?: string }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505");

export { sql };
