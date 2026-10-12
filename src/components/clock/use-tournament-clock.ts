"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicSnapshot } from "@/server/tournament-state";
import { advance, describe, type TimerState } from "@/lib/timer";
import { audioEngine, claimAlert, loadAudioSettings, type AlertKind, type AudioSettings } from "./audio";

const POLL_MS = 2000;
const MAX_BACKOFF_MS = 15000;

/**
 * Keeps a display in sync with the server-authoritative timer.
 * - Polls a read-only endpoint (cheap, works on any host, survives sleep/reconnect).
 * - Corrects for device clock skew using serverNow and round-trip time.
 * - Between polls, runs the same pure `advance()` the server uses, so level
 *   changes happen on time even if the network blips.
 */
export function useTournamentClock(code: string, initial: PublicSnapshot) {
  const [snap, setSnap] = useState(initial);
  const [offset, setOffset] = useState(() => initial.serverNow - Date.now());
  const [connected, setConnected] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef(POLL_MS);
  const inflight = useRef(false);

  const fetchState = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    const sent = Date.now();
    try {
      const res = await fetch(`/api/tournament/${code}/state`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data: PublicSnapshot = await res.json();
      const received = Date.now();
      const rtt = received - sent;
      // Only trust samples with a reasonable round trip.
      if (rtt < 3000) setOffset(data.serverNow + rtt / 2 - received);
      setSnap(data);
      setConnected(true);
      backoff.current = POLL_MS;
    } catch {
      setConnected(false);
      backoff.current = Math.min(MAX_BACKOFF_MS, backoff.current * 1.6);
    } finally {
      inflight.current = false;
    }
  }, [code]);

  useEffect(() => {
    let alive = true;
    const loop = async () => {
      await fetchState();
      if (alive) timer.current = setTimeout(loop, document.hidden ? Math.max(backoff.current, 5000) : backoff.current);
    };
    timer.current = setTimeout(loop, POLL_MS);
    const kick = () => {
      if (timer.current) clearTimeout(timer.current);
      backoff.current = POLL_MS;
      void loop();
    };
    const onVis = () => !document.hidden && kick();
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchState]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  const serverNow = now + offset;
  const effective: TimerState = advance(snap.timer, snap.levels, serverNow).state;
  const view = describe(effective, snap.levels, serverNow);

  return { snap, effective, view, serverNow, connected, refresh: fetchState };
}

export type AlertEvent = { kind: AlertKind; key: string; at: number; text?: string };

/**
 * Detects alert moments by watching the effective state change *while this
 * device is watching*. A device that connects after the 60-second mark won't
 * play a stale warning, and claimAlert() dedupes across refreshes and duplicate
 * polls. Keys include the tournament code and cycle, so one tournament's alerts
 * can never fire for another.
 */
export function useClockAlerts(
  code: string,
  snap: PublicSnapshot,
  effective: TimerState,
  remaining: number,
  onVisual: (e: AlertEvent) => void,
  playsAudio = true,
) {
  const seenLocal = useRef(new Set<string>());
  const prev = useRef<{ cycle: number; levelIndex: number; status: TimerState["status"]; remaining: number; wall: number } | null>(null);
  const settings = useRef<AudioSettings | null>(null);

  useEffect(() => {
    settings.current = loadAudioSettings();
    const onStorage = () => (settings.current = loadAudioSettings());
    window.addEventListener("storage", onStorage);
    window.addEventListener("pokerclock:audio-settings", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pokerclock:audio-settings", onStorage);
    };
  }, []);

  useEffect(() => {
    const wall = Date.now();
    const p = prev.current;
    prev.current = { cycle: effective.cycle, levelIndex: effective.levelIndex, status: effective.status, remaining, wall };
    if (!p) return; // first observation: never alert on load
    const fresh = wall - p.wall < 10_000; // the tab wasn't asleep — this transition is happening now
    const events: AlertEvent[] = [];
    const levels = snap.levels;
    const kindAt = (i: number) => levels[i]?.kind ?? "level";

    if (effective.cycle !== p.cycle) {
      const c = effective.cycle;
      if (effective.status === "break" && p.status !== "break") events.push({ kind: "breakStart", key: `${c}:break-start`, at: wall });
      else if (p.status === "break" && effective.status !== "break") events.push({ kind: "breakEnd", key: `${c}:break-end`, at: wall });
      else if (effective.levelIndex !== p.levelIndex && effective.status !== "not_started") {
        if (kindAt(effective.levelIndex) === "break") events.push({ kind: "breakStart", key: `${c}:break-start`, at: wall });
        else {
          if (kindAt(p.levelIndex) === "break") events.push({ kind: "breakEnd", key: `${c}:break-end`, at: wall });
          const l = levels[effective.levelIndex];
          const ante = snap.tournament.anteEnabled && l.ante ? `, ante ${l.ante}` : "";
          events.push({ kind: "levelChange", key: `${c}:level`, at: wall, text: `Blinds are now ${l.smallBlind} / ${l.bigBlind}${ante}` });
        }
      }
    } else if (
      effective.status === "running" &&
      kindAt(effective.levelIndex) === "level" &&
      p.status === "running" &&
      p.remaining > 60_000 &&
      remaining <= 60_000 &&
      remaining > 0
    ) {
      events.push({ kind: "warning", key: `${effective.cycle}:warn60`, at: wall });
    }

    for (const e of events) {
      if (!playsAudio) {
        // Staff screens show visuals only and never claim the alert, so a TV on the same browser still plays it.
        if (seenLocal.current.has(e.key)) continue;
        seenLocal.current.add(e.key);
        onVisual(e);
        continue;
      }
      if (!claimAlert(code, e.key)) continue;
      onVisual(e);
      const s = settings.current;
      if (!fresh || !s?.enabled) continue;
      const isBreak = e.kind === "breakStart" || e.kind === "breakEnd";
      if (isBreak && (!s.breaks || !snap.tournament.breakAlertsEnabled)) continue;
      if (e.kind === "warning" && !s.warning) continue;
      if (e.kind === "levelChange" && !s.levelChange) continue;
      audioEngine.play(e.kind, s.volume);
      if (e.kind === "levelChange" && s.speak && e.text) setTimeout(() => audioEngine.speak(e.text!, s.volume), 1400);
    }
  });
}
