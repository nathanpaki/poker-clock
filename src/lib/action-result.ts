import "server-only";
import { ZodError } from "zod";
import { AuthzError } from "./auth";
import { ClockError } from "./timer";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export class UserError extends Error {}

/** Converts known failures into user-facing messages; logs and hides everything else. */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    if (e instanceof AuthzError || e instanceof UserError || e instanceof ClockError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues.map((i) => i.message).join("; ") };
    console.error(e);
    return { ok: false, error: "Something went wrong saving that. Nothing was changed — try again." };
  }
}
