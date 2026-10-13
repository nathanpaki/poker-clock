"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Full-height sheet sized for a tablet: big close target, Escape closes,
 * background scroll locked, focus moves into the sheet and back out on close.
 */
export function Modal({
  open,
  onClose,
  title,
  tone = "default",
  actions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  tone?: "default" | "danger";
  actions?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // Focus the first input if there is one (opens the iPad keyboard for search), else the panel.
    requestAnimationFrame(() => (panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current)?.focus());
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-start sm:px-6 sm:pt-[6vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[92dvh] w-full max-w-3xl sm:max-h-[86dvh] flex-col overflow-hidden rounded-t-2xl border bg-panel shadow-2xl outline-none motion-safe:animate-[pc-pop_180ms_ease-out] sm:rounded-2xl ${
          tone === "danger" ? "border-danger/60" : "border-line"
        }`}
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <h2 id={titleId} className={`font-display text-3xl font-semibold ${tone === "danger" ? "text-danger" : "text-amber"}`}>
            {title}
          </h2>
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-12 w-12 place-items-center rounded-xl border border-line text-2xl text-mist hover:text-snow focus-visible:outline-2 focus-visible:outline-amber"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
      </div>
    </div>
  );
}
