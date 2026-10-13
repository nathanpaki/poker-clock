"use client";

import { useRouter } from "next/navigation";
import { createElement, useState, useTransition } from "react";

import type { NameConflict } from "@/lib/action-result-types";

type Result<T> = { ok: true; data?: T } | { ok: false; error: string; conflict?: NameConflict };

/** Runs a server action, tracks pending state, shows errors, and refreshes server components on success. */
export function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Set when the server says a name matches an existing player. */
  const [conflict, setConflict] = useState<NameConflict | null>(null);

  function exec<T>(fn: () => Promise<Result<T>>, opts: { success?: string | ((data?: T) => string); onSuccess?: (data?: T) => void; refresh?: boolean } = {}) {
    setError(null);
    setMessage(null);
    setConflict(null);
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) {
          setConflict(r.conflict ?? null);
          return setError(r.error);
        }
        if (opts.success) setMessage(typeof opts.success === "function" ? opts.success(r.data) : opts.success);
        opts.onSuccess?.(r.data);
        if (opts.refresh !== false) router.refresh();
      } catch {
        setError("Couldn't reach the server. Check the connection and try again.");
      }
    });
  }
  const clear = () => {
    setError(null);
    setMessage(null);
    setConflict(null);
  };
  return { exec, pending, error, message, setError, conflict, clear };
}

export function Feedback({ error, message }: { error: string | null; message?: string | null }) {
  if (error) return createElement("p", { role: "alert", className: "text-sm text-danger" }, error);
  if (message) return createElement("p", { role: "status", className: "text-sm text-emerald-400" }, message);
  return null;
}
