"use client";

import { useEffect, useState } from "react";
import { ClockDisplay, type Clock } from "@/components/clock/clock-display";
import { advance, describe, type Level } from "@/lib/timer";
import type { PublicSnapshot } from "@/server/tournament-state";

const L = (sb: number, bb: number): Level => ({ kind: "level", smallBlind: sb, bigBlind: bb, ante: 0, durationSec: 1200 });
const levels: Level[] = [L(25, 50), L(50, 100), L(75, 150), { kind: "break", smallBlind: 0, bigBlind: 0, ante: 0, durationSec: 600 }, L(100, 200), L(150, 300), L(200, 400), L(300, 600), L(400, 800), L(500, 1000)];

/** Simulated tournament for checking the TV layout and sounds without a database. */
export function PreviewClient({ qrSvg, winner = false }: { qrSvg: string; winner?: boolean }) {
  const [snap] = useState<PublicSnapshot>(() => {
    const now = Date.now();
    const names = winner ? ["Dev", "Maya", "Jules", "Theo", "Ana"] : ["Hank", "Rosa", "Nia", "Lou", "Omar"];
    const elim = names.map((name, i) => ({ position: (winner ? 2 : 7) + i, name, at: now - (i + 1) * 9 * 60_000 }));
    return {
      tournament: { code: "K7Q4MX", name: "Friday Tournament", venueName: "Craft Brewery", leagueName: "Smokey Mountain Poker League", timezone: "America/New_York", anteEnabled: false, showEliminations: true, breakAlertsEnabled: true, status: winner ? "completed" : "running" },
      levels,
      timer: { status: winner ? "paused" : "running", levelIndex: 7, levelEndsAt: winner ? null : now + (18 * 60 + 12) * 1000, remainingMs: winner ? 412_000 : null, breakEndsAt: null, cycle: 8, version: 1 },
      players: { checkedIn: 14, remaining: winner ? 0 : 6 },
      eliminations: elim,
      eliminationsTotal: winner ? 13 : 8,
      winner: winner ? { name: "Priya", at: now } : null,
      serverNow: now,
    };
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  const effective = advance(snap.timer, snap.levels, now).state;
  const clock: Clock = { snap, effective, view: describe(effective, snap.levels, now), serverNow: now, connected: true, refresh: async () => {} };
  return <ClockDisplay code="PREVIEW" clock={clock} qrSvg={qrSvg} />;
}
