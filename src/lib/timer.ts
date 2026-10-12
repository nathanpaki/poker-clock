/**
 * Pure timer engine. Shared by the server (authoritative writes) and browsers
 * (smooth rendering between syncs). All times are epoch milliseconds.
 *
 * The server persists a TimerState. Anyone can compute the *effective* state
 * for "now" with `advance()` — this is how levels auto-advance without a cron
 * job: the next read or write materializes the elapsed transitions.
 */

export type LevelKind = "level" | "break";
export type Level = { kind: LevelKind; smallBlind: number; bigBlind: number; ante: number; durationSec: number };
export type TimerStatus = "not_started" | "running" | "paused" | "break" | "finished";

export type TimerState = {
  status: TimerStatus;
  levelIndex: number;
  levelEndsAt: number | null; // when running
  remainingMs: number | null; // when paused, or level time banked during an ad-hoc break
  breakEndsAt: number | null; // ad-hoc break only (status === "break")
  cycle: number;
  version: number;
};

export const MIN_REMAINING_MS = 1000;

export const initialTimerState = (): TimerState => ({
  status: "not_started",
  levelIndex: 0,
  levelEndsAt: null,
  remainingMs: null,
  breakEndsAt: null,
  cycle: 0,
  version: 0,
});

const durMs = (levels: Level[], i: number) => (levels[i]?.durationSec ?? 0) * 1000;

/** Apply every transition that should have happened by `now`. */
export function advance(state: TimerState, levels: Level[], now: number): { state: TimerState; changed: boolean } {
  let s = { ...state };
  let changed = false;
  if (levels.length === 0) return { state: s, changed };
  // Guard against corrupted indices after a structure edit.
  if (s.levelIndex > levels.length - 1) {
    s.levelIndex = levels.length - 1;
    changed = true;
  }
  for (let guard = 0; guard < 10_000; guard++) {
    if (s.status === "break" && s.breakEndsAt !== null && s.breakEndsAt <= now) {
      const banked = Math.max(s.remainingMs ?? durMs(levels, s.levelIndex), MIN_REMAINING_MS);
      s = { ...s, status: "running", levelEndsAt: s.breakEndsAt + banked, breakEndsAt: null, remainingMs: null, cycle: s.cycle + 1 };
      changed = true;
      continue;
    }
    if (s.status === "running" && s.levelEndsAt !== null && s.levelEndsAt <= now) {
      if (s.levelIndex + 1 < levels.length) {
        const next = s.levelIndex + 1;
        s = { ...s, levelIndex: next, levelEndsAt: s.levelEndsAt + durMs(levels, next), cycle: s.cycle + 1 };
      } else {
        // Explicit end-of-structure — never wrap back to level 1.
        s = { ...s, status: "finished", levelEndsAt: null, remainingMs: 0, cycle: s.cycle + 1 };
      }
      changed = true;
      continue;
    }
    break;
  }
  return { state: s, changed };
}

/** Milliseconds left on whatever is currently counting down. */
export function remainingMs(s: TimerState, levels: Level[], now: number): number {
  switch (s.status) {
    case "running":
      return Math.max(0, (s.levelEndsAt ?? now) - now);
    case "paused":
      return Math.max(0, s.remainingMs ?? 0);
    case "break":
      return Math.max(0, (s.breakEndsAt ?? now) - now);
    case "not_started":
      return durMs(levels, s.levelIndex);
    case "finished":
      return 0;
  }
}

export type ClockOp =
  | { op: "start" }
  | { op: "pause" }
  | { op: "resume" }
  | { op: "reset_level" }
  | { op: "adjust"; deltaMs: number }
  | { op: "next_level" }
  | { op: "previous_level" }
  | { op: "start_break"; minutes: number }
  | { op: "end_break" }
  | { op: "restart" };

export class ClockError extends Error {}

/** Apply an operator action to an already-advanced state. Throws ClockError on invalid transitions. */
export function applyOp(state: TimerState, levels: Level[], action: ClockOp, now: number): TimerState {
  if (levels.length === 0) throw new ClockError("This tournament has no blind levels yet.");
  const s = { ...state };
  const cur = remainingMs(s, levels, now);
  const bump = (x: TimerState): TimerState => ({ ...x, cycle: x.cycle + 1 });

  const gotoLevel = (index: number): TimerState => {
    const full = durMs(levels, index);
    const runningLike = s.status === "running" || s.status === "break" || s.status === "finished";
    if (s.status === "not_started") return bump({ ...s, levelIndex: index, levelEndsAt: null, remainingMs: null, breakEndsAt: null });
    if (runningLike) return bump({ ...s, status: "running", levelIndex: index, levelEndsAt: now + full, remainingMs: null, breakEndsAt: null });
    return bump({ ...s, status: "paused", levelIndex: index, levelEndsAt: null, remainingMs: full, breakEndsAt: null });
  };

  switch (action.op) {
    case "start":
      if (s.status !== "not_started") throw new ClockError("The clock has already started.");
      return bump({ ...s, status: "running", levelEndsAt: now + durMs(levels, s.levelIndex), remainingMs: null });
    case "pause":
      if (s.status !== "running") throw new ClockError("The clock is not running.");
      return { ...s, status: "paused", remainingMs: cur, levelEndsAt: null };
    case "resume":
      if (s.status !== "paused") throw new ClockError("The clock is not paused.");
      return { ...s, status: "running", levelEndsAt: now + Math.max(cur, MIN_REMAINING_MS), remainingMs: null };
    case "reset_level": {
      const full = durMs(levels, s.levelIndex);
      if (s.status === "running") return bump({ ...s, levelEndsAt: now + full });
      if (s.status === "paused") return bump({ ...s, remainingMs: full });
      if (s.status === "break") return bump({ ...s, remainingMs: full });
      if (s.status === "finished") return bump({ ...s, status: "paused", remainingMs: full });
      return s;
    }
    case "adjust": {
      const d = action.deltaMs;
      if (s.status === "running") return { ...s, levelEndsAt: Math.max(now + MIN_REMAINING_MS, (s.levelEndsAt ?? now) + d) };
      if (s.status === "paused") return { ...s, remainingMs: Math.max(MIN_REMAINING_MS, (s.remainingMs ?? 0) + d) };
      if (s.status === "break") return { ...s, breakEndsAt: Math.max(now + MIN_REMAINING_MS, (s.breakEndsAt ?? now) + d) };
      throw new ClockError("Start the clock before adjusting time.");
    }
    case "next_level":
      if (s.levelIndex + 1 >= levels.length) return bump({ ...s, status: "finished", levelEndsAt: null, remainingMs: 0, breakEndsAt: null });
      return gotoLevel(s.levelIndex + 1);
    case "previous_level":
      if (s.levelIndex === 0) throw new ClockError("Already at the first level.");
      return gotoLevel(s.levelIndex - 1);
    case "start_break":
      if (s.status !== "running" && s.status !== "paused") throw new ClockError("Breaks can start only while a level is running or paused.");
      return bump({ ...s, status: "break", remainingMs: Math.max(cur, MIN_REMAINING_MS), levelEndsAt: null, breakEndsAt: now + action.minutes * 60_000 });
    case "end_break":
      if (s.status === "break") {
        return bump({ ...s, status: "running", levelEndsAt: now + Math.max(s.remainingMs ?? 0, MIN_REMAINING_MS), remainingMs: null, breakEndsAt: null });
      }
      if (levels[s.levelIndex]?.kind === "break" && s.status !== "not_started") return gotoLevel(Math.min(s.levelIndex + 1, levels.length - 1));
      throw new ClockError("No break is running.");
    case "restart":
      return bump({ ...initialTimerState(), cycle: s.cycle, version: s.version });
  }
}

/** Derived, display-ready information. */
export function describe(s: TimerState, levels: Level[], now: number) {
  const level = levels[s.levelIndex] ?? null;
  const remaining = remainingMs(s, levels, now);
  const onBreak = s.status === "break" || level?.kind === "break";
  // Level numbers count blind levels only; breaks are not numbered.
  const levelNumber = levels.slice(0, s.levelIndex + 1).filter((l) => l.kind === "level").length;
  const nextLevel = levels.slice(s.levelIndex + 1).find((l) => l.kind === "level") ?? null;
  const totalMs = s.status === "break" ? null : durMs(levels, s.levelIndex);
  const progress = totalMs ? Math.min(1, Math.max(0, 1 - remaining / totalMs)) : 0;

  let nextBreakInMs: number | null = null;
  if (s.status !== "finished") {
    // Clock time until the next scheduled break (pauses stop this countdown too).
    let acc = s.status === "break" ? remaining + (s.remainingMs ?? 0) : remaining;
    for (let i = s.levelIndex + 1; i < levels.length; i++) {
      if (levels[i].kind === "break") {
        nextBreakInMs = acc;
        break;
      }
      acc += durMs(levels, i);
    }
  }
  return { level, levelNumber, nextLevel, remaining, totalMs, progress, onBreak, nextBreakInMs };
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm.padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export const formatChips = (n: number) => n.toLocaleString("en-US");
