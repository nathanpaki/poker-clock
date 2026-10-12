import { describe as d, expect, it } from "vitest";
import { advance, applyOp, describe, formatClock, initialTimerState, type Level } from "@/lib/timer";

const L = (sb: number, bb: number, min = 20): Level => ({ kind: "level", smallBlind: sb, bigBlind: bb, ante: 0, durationSec: min * 60 });
const B = (min = 10): Level => ({ kind: "break", smallBlind: 0, bigBlind: 0, ante: 0, durationSec: min * 60 });
const levels = [L(100, 200), L(200, 400), B(), L(300, 600)];
const T0 = 1_700_000_000_000;
const MIN = 60_000;

d("timer engine", () => {
  it("starts at level 1 with full time", () => {
    const s = applyOp(initialTimerState(), levels, { op: "start" }, T0);
    expect(s.status).toBe("running");
    expect(s.levelEndsAt).toBe(T0 + 20 * MIN);
    expect(describe(s, levels, T0).levelNumber).toBe(1);
  });

  it("auto-advances through levels and breaks deterministically", () => {
    const s = applyOp(initialTimerState(), levels, { op: "start" }, T0);
    const a = advance(s, levels, T0 + 45 * MIN).state; // 20 + 20 + 5 into break
    expect(a.levelIndex).toBe(2);
    expect(describe(a, levels, T0 + 45 * MIN).onBreak).toBe(true);
    expect(a.levelEndsAt).toBe(T0 + 50 * MIN);
    // Same input → same output (server and every display agree)
    expect(advance(s, levels, T0 + 45 * MIN).state).toEqual(a);
  });

  it("stops at an explicit end-of-structure state instead of wrapping", () => {
    const s = applyOp(initialTimerState(), levels, { op: "start" }, T0);
    const a = advance(s, levels, T0 + 999 * MIN).state;
    expect(a.status).toBe("finished");
    expect(a.levelIndex).toBe(3);
  });

  it("pause freezes remaining time; resume continues from it", () => {
    let s = applyOp(initialTimerState(), levels, { op: "start" }, T0);
    s = applyOp(s, levels, { op: "pause" }, T0 + 5 * MIN);
    expect(s.remainingMs).toBe(15 * MIN);
    expect(advance(s, levels, T0 + 500 * MIN).state).toEqual(s); // paused clocks never advance
    s = applyOp(s, levels, { op: "resume" }, T0 + 60 * MIN);
    expect(s.levelEndsAt).toBe(T0 + 75 * MIN);
  });

  it("adjust adds and deducts without going below one second", () => {
    let s = applyOp(initialTimerState(), levels, { op: "start" }, T0);
    s = applyOp(s, levels, { op: "adjust", deltaMs: 5 * MIN }, T0);
    expect(s.levelEndsAt).toBe(T0 + 25 * MIN);
    s = applyOp(s, levels, { op: "adjust", deltaMs: -60 * MIN }, T0);
    expect(s.levelEndsAt).toBe(T0 + 1000);
  });

  it("reset and level changes start a new alert cycle; adjust does not", () => {
    let s = applyOp(initialTimerState(), levels, { op: "start" }, T0);
    const c = s.cycle;
    s = applyOp(s, levels, { op: "adjust", deltaMs: MIN }, T0);
    expect(s.cycle).toBe(c);
    s = applyOp(s, levels, { op: "reset_level" }, T0);
    expect(s.cycle).toBe(c + 1);
    s = applyOp(s, levels, { op: "next_level" }, T0);
    expect(s.cycle).toBe(c + 2);
    expect(s.levelIndex).toBe(1);
  });

  it("ad-hoc break banks the level time and resumes it", () => {
    let s = applyOp(initialTimerState(), levels, { op: "start" }, T0);
    s = applyOp(s, levels, { op: "start_break", minutes: 10 }, T0 + 5 * MIN);
    expect(s.status).toBe("break");
    expect(s.remainingMs).toBe(15 * MIN);
    const after = advance(s, levels, T0 + 16 * MIN).state; // break auto-ends at +15
    expect(after.status).toBe("running");
    expect(after.levelEndsAt).toBe(T0 + 30 * MIN);
  });

  it("restart returns to not-started at level 1", () => {
    let s = applyOp(initialTimerState(), levels, { op: "start" }, T0);
    s = applyOp(s, levels, { op: "next_level" }, T0);
    s = applyOp(s, levels, { op: "restart" }, T0);
    expect(s.status).toBe("not_started");
    expect(s.levelIndex).toBe(0);
  });

  it("two tournaments are independent states", () => {
    const a = applyOp(initialTimerState(), levels, { op: "start" }, T0);
    const b = applyOp(applyOp(initialTimerState(), levels, { op: "start" }, T0), levels, { op: "pause" }, T0 + MIN);
    const a2 = applyOp(a, levels, { op: "next_level" }, T0 + 2 * MIN);
    expect(b.status).toBe("paused");
    expect(b.levelIndex).toBe(0);
    expect(a2.levelIndex).toBe(1);
  });

  it("reports next break and next blinds", () => {
    const s = applyOp(initialTimerState(), levels, { op: "start" }, T0);
    const v = describe(s, levels, T0 + 2 * MIN);
    expect(v.nextLevel?.bigBlind).toBe(400);
    expect(v.nextBreakInMs).toBe(38 * MIN);
    const late = describe(advance(s, levels, T0 + 51 * MIN).state, levels, T0 + 51 * MIN);
    expect(late.nextBreakInMs).toBeNull();
  });

  it("formats the clock", () => {
    expect(formatClock(18 * MIN + 12_000)).toBe("18:12");
    expect(formatClock(500)).toBe("00:01");
    expect(formatClock(75 * MIN)).toBe("1:15:00");
  });
});
