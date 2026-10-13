"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { PublicSnapshot } from "@/server/tournament-state";
import { formatChips, formatClock } from "@/lib/timer";
import { formatTimeOfDay, ordinal } from "@/lib/format";
import { useClockAlerts, useTournamentClock, type AlertEvent } from "./use-tournament-clock";
import { AudioControls } from "./audio-controls";

export type Clock = ReturnType<typeof useTournamentClock>;

/** Full-screen public/TV display: owns its sync loop and plays audio. */
export function LiveClockDisplay({ code, initial, qrSvg }: { code: string; initial: PublicSnapshot; qrSvg: string | null }) {
  const clock = useTournamentClock(code, initial);
  return <ClockDisplay code={code} clock={clock} qrSvg={qrSvg} />;
}

type Props = {
  code: string;
  clock: Clock;
  qrSvg: string | null;
  /** Compact mode: no bottom bar, no audio. */
  compact?: boolean;
  /** Buttons shown in the top-right corner (staff screen). */
  headerActions?: ReactNode;
  /** Whether this screen plays alert sounds. Defaults to !compact. */
  playsAudio?: boolean;
};

export function ClockDisplay({ code, clock, qrSvg, compact = false, headerActions, playsAudio = !compact }: Props) {
  const { snap, effective, view, connected } = clock;
  const [banner, setBanner] = useState<AlertEvent | null>(null);

  const onVisual = useCallback((e: AlertEvent) => {
    if (e.kind === "warning") return; // the warning badge is driven by remaining time directly
    setBanner(e);
    setTimeout(() => setBanner((b) => (b?.key === e.key ? null : b)), 8000);
  }, []);
  useClockAlerts(code, snap, effective, view.remaining, onVisual, playsAudio);

  const t = snap.tournament;
  const level = view.level;
  const onBreak = view.onBreak;
  const status = effective.status;
  const gameOver = t.status === "completed" || !!snap.winner;
  const oneMinute = !gameOver && status === "running" && level?.kind === "level" && view.remaining <= 60_000 && view.remaining > 0;
  const blindText = level && level.kind === "level" ? `${formatChips(level.smallBlind)} / ${formatChips(level.bigBlind)}` : "";
  const next = view.nextLevel;

  const statusNote = gameOver
    ? "Tournament over"
    : status === "not_started"
      ? "Waiting to start"
      : status === "paused"
        ? "Paused"
        : status === "finished"
          ? "End of structure"
          : null;

  const breakNote =
    status === "finished"
      ? ""
      : onBreak
        ? "On break"
        : view.nextBreakInMs === null
          ? "No more breaks"
          : `Next break in ${formatClock(view.nextBreakInMs)}`;

  // Font sizes scale with the panel (container query units) and are capped by viewport height.
  const blindLen = Math.max(blindText.length, 7);
  const blindSize = `min(${(100 / (blindLen * 0.42)).toFixed(1)}cqw, ${compact ? "16vh" : "30vh"})`;
  const timerSize = compact ? "min(40cqw, 18vh)" : "min(44cqw, 40vh)";

  return (
    <div
      className={`relative flex w-full flex-col gap-[1.6vh] overflow-hidden rounded-2xl border border-line bg-ink p-[1.6vh] text-snow ${
        compact ? "" : "min-h-dvh lg:h-dvh"
      }`}
    >
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-[0.6vh]">
        <div className="shrink-0 whitespace-nowrap font-display text-amber text-[clamp(1.25rem,4.2vh,3.5rem)] font-semibold leading-none tracking-wide">
          {onBreak ? "Break" : `Level ${view.levelNumber || 1}`}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-right">
          {!connected && <span className="rounded-md border border-amber/50 px-2 py-0.5 text-sm text-amber">Reconnecting…</span>}
          <span className="font-display text-mist text-[clamp(0.95rem,3vh,2.4rem)] leading-tight">
            {t.venueName} <span className="text-line-strong">•</span> {t.name}
          </span>
          {!compact && <AudioControls inline={!!headerActions} />}
          {headerActions}
        </div>
      </header>

      {/* Clock + blinds */}
      <section className="grid min-h-0 flex-1 grid-cols-1 gap-[1.6vh] lg:grid-cols-2">
        <div className="@container flex min-h-[24vh] flex-col justify-center rounded-xl border border-line bg-panel px-[4cqw] py-[3vh]">
          <div className="flex items-center justify-between font-display text-[clamp(0.95rem,2.6vh,2rem)] text-mist">
            <span>{onBreak ? (status === "break" ? "Unscheduled break" : "Scheduled break") : level ? `${Math.round(level.durationSec / 60)} minute level` : ""}</span>
            {oneMinute && <span className="rounded-md bg-amber px-[0.6em] py-[0.1em] font-semibold text-ink">1 minute left</span>}
            {statusNote && !oneMinute && <span className="rounded-md border border-amber/60 px-[0.6em] py-[0.1em] text-amber">{statusNote}</span>}
          </div>
          <div
            className={`font-display font-bold leading-[0.85] tabular-nums tracking-tight ${onBreak ? "text-amber" : "text-snow"} ${status === "paused" ? "opacity-60" : ""}`}
            style={{ fontSize: timerSize }}
            aria-live="off"
          >
            {formatClock(view.remaining)}
          </div>
          <div className="mt-[2.4vh] h-[1.1vh] min-h-[6px] w-full overflow-hidden rounded-full bg-track" role="progressbar" aria-valuenow={Math.round(view.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-amber transition-[width] duration-200 ease-linear" style={{ width: `${view.progress * 100}%` }} />
          </div>
          <div className="mt-[1.6vh] flex justify-between font-display text-[clamp(0.95rem,2.6vh,2rem)] text-mist">
            <span>{breakNote}</span>
            {view.totalMs ? <span className="tabular-nums">{formatClock(view.totalMs - view.remaining)} played</span> : <span />}
          </div>
        </div>

        <div className="@container flex min-h-[20vh] flex-col justify-center rounded-xl border border-line bg-panel px-[4cqw] py-[3vh]">
          {onBreak ? (
            <>
              <div className="font-display font-bold leading-none text-amber" style={{ fontSize: "min(30cqw, 24vh)" }}>
                BREAK
              </div>
              {next && (
                <div className="mt-[2vh] font-display text-[clamp(1.1rem,4vh,3.2rem)] text-mist">
                  Up next <span className="text-snow">{formatChips(next.smallBlind)}</span>
                  <span className="text-line-strong"> / </span>
                  <span className="text-snow">{formatChips(next.bigBlind)}</span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="font-display text-[clamp(0.95rem,2.6vh,2rem)] text-mist">Blinds</div>
              <div className="font-display font-bold leading-[0.9] tabular-nums text-snow" style={{ fontSize: blindSize }}>
                {level ? (
                  <>
                    {formatChips(level.smallBlind)}
                    <span className="text-line-strong font-medium"> / </span>
                    {formatChips(level.bigBlind)}
                  </>
                ) : (
                  "—"
                )}
              </div>
              {t.anteEnabled && level && level.ante > 0 && (
                <div className="mt-[1vh] font-display text-[clamp(1rem,3.6vh,2.8rem)] text-snow">
                  <span className="text-mist">Ante</span> {formatChips(level.ante)}
                </div>
              )}
              <div className="mt-[2vh] font-display text-[clamp(1.1rem,4vh,3.2rem)] text-mist">
                {next ? (
                  <>
                    Next {formatChips(next.smallBlind)}
                    <span className="text-line-strong"> / </span>
                    {formatChips(next.bigBlind)}
                    {t.anteEnabled && next.ante > 0 && <span className="text-[0.7em]"> ante {formatChips(next.ante)}</span>}
                  </>
                ) : (
                  "Final level"
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Bottom bar */}
      {!compact && (
        <footer className="grid grid-cols-1 items-center gap-[1.6vh] rounded-xl border border-line bg-bar px-[2.4vh] py-[1.8vh] md:grid-cols-[auto_1fr_auto]">
          {snap.winner ? (
            <div className="font-display leading-none">
              <span className="block text-[clamp(0.9rem,2.4vh,1.8rem)] text-amber">Winner</span>
              <span className="text-[clamp(1.6rem,6vh,4.5rem)] font-bold text-snow">{snap.winner.name}</span>
            </div>
          ) : (
            <div className="font-display leading-none">
              <span className="text-[clamp(1.6rem,6vh,4.5rem)] font-bold tabular-nums text-snow">{snap.players.remaining}</span>
              <span className="text-[clamp(1rem,3vh,2.2rem)] text-mist"> of {snap.players.checkedIn} still in</span>
            </div>
          )}
          <ol className="flex min-w-0 flex-wrap items-baseline gap-x-[2.2vh] gap-y-1 font-display text-[clamp(0.95rem,2.6vh,2rem)] md:justify-center" aria-label="Recent eliminations">
            {t.showEliminations &&
              snap.eliminations.map((e, i) => (
                <li key={`${e.name}-${e.at}`} className={`whitespace-nowrap ${i === 0 ? "text-snow" : "text-mist"}`}>
                  {e.position ? <span className="text-amber">{ordinal(e.position)}</span> : null} {e.name}
                  <span className="ml-1.5 text-[0.75em] text-mist/70">{formatTimeOfDay(e.at, t.timezone)}</span>
                </li>
              ))}
            {t.showEliminations && snap.eliminationsTotal > snap.eliminations.length && (
              <li className="text-[0.85em] text-mist/70">+{snap.eliminationsTotal - snap.eliminations.length} more</li>
            )}
          </ol>
          <div className="flex items-center gap-[1.6vh] justify-self-start md:justify-self-end">
            {qrSvg ? (
              <div className="h-[clamp(72px,13vh,150px)] w-[clamp(72px,13vh,150px)] overflow-hidden rounded-md bg-white p-1 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            ) : null}
            <p className="max-w-[16ch] font-display text-[clamp(0.9rem,2.3vh,1.7rem)] leading-tight text-mist">
              Scan to check in, or enter <span className="font-semibold tracking-wider text-snow">{t.code}</span>
            </p>
          </div>
        </footer>
      )}

      {/* Level change / break banner */}
      {banner && (
        <div className="pointer-events-none absolute inset-x-[4%] top-[18%] z-20 rounded-2xl border-2 border-amber bg-ink/95 px-[4vh] py-[3vh] text-center shadow-2xl motion-safe:animate-[pc-pop_300ms_ease-out]" role="status">
          <div className="font-display text-[clamp(1.2rem,5vh,4rem)] text-amber">
            {banner.kind === "levelChange" ? `Level ${view.levelNumber}` : banner.kind === "breakStart" ? "Break time" : "Break is over"}
          </div>
          {banner.kind !== "breakStart" && level?.kind === "level" && (
            <div className="font-display font-bold text-[clamp(2.5rem,16vh,12rem)] leading-none tabular-nums">
              {formatChips(level.smallBlind)}
              <span className="text-line-strong"> / </span>
              {formatChips(level.bigBlind)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
