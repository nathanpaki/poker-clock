"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Hold for `durationMs` to confirm. Releasing early cancels.
 * Works with mouse, touch and pen (pointer events) and with the keyboard:
 * focus the button and hold Space or Enter.
 */
export function HoldButton({
  label,
  holdingLabel = "Keep holding…",
  durationMs = 2000,
  disabled,
  onConfirm,
}: {
  label: string;
  holdingLabel?: string;
  durationMs?: number;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const start = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const fired = useRef(false);

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    start.current = null;
    if (!fired.current) setProgress(0);
  };

  const begin = () => {
    if (disabled || start.current !== null) return;
    fired.current = false;
    start.current = performance.now();
    const step = (t: number) => {
      if (start.current === null) return;
      const p = Math.min(1, (t - start.current) / durationMs);
      setProgress(p);
      if (p >= 1) {
        fired.current = true;
        start.current = null;
        navigator.vibrate?.(60);
        onConfirm();
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!disabled) {
      fired.current = false;
      setProgress(0);
    }
  }, [disabled]);

  const holding = progress > 0 && progress < 1;
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        begin();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") stop();
      }}
      onBlur={stop}
      aria-describedby="hold-hint"
      className="relative w-full touch-none select-none overflow-hidden rounded-xl bg-danger px-6 py-5 font-display text-2xl font-bold text-white disabled:opacity-50"
    >
      <span className="absolute inset-y-0 left-0 bg-black/30" style={{ width: `${progress * 100}%` }} aria-hidden />
      <span className="relative">{holding ? holdingLabel : label}</span>
      <span id="hold-hint" className="sr-only">Press and hold for two seconds to confirm. With a keyboard, hold Space or Enter.</span>
    </button>
  );
}
