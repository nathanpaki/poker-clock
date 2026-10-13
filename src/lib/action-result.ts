import "server-only";
import { ZodError } from "zod";
import { AuthzError } from "./auth";
import { ClockError } from "./timer";

import type { NameConflict } from "./action-result-types";
export type { NameConflict, NameConflictPlayer } from "./action-result-types";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string; conflict?: NameConflict };

export class UserError extends Error {}

export class ConflictError extends UserError {
  constructor(
    message: string,
    public conflict: NameConflict,
  ) {
    super(message);
  }
}

/** Converts known failures into user-facing messages; logs and hides everything else. */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ConflictError) return { ok: false, error: e.message, conflict: e.conflict };
    if (e instanceof AuthzError || e instanceof UserError || e instanceof ClockError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues.map((i) => i.message).join("; ") };
    console.error(e);
    return { ok: false, error: "Something went wrong saving that. Nothing was changed — try again." };
  }
}
