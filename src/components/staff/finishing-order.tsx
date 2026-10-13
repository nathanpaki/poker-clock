"use client";

import { moveElimination, voidElimination } from "@/actions/roster";
import { Button, Select } from "@/components/ui";
import { Feedback, useAction } from "@/components/ui/use-action";
import { formatTimeOfDay, ordinal } from "@/lib/format";

export type FinishEntry = { eliminationId: string; name: string; position: number; at: number; isWinner: boolean };

/**
 * Lists finishers from 1st down. Staff can nudge a busted player up or down, or
 * jump them to a position. Positions better than the busted range belong to
 * players still in (or the winner), so they aren't offered.
 */
export function FinishingOrder({
  tournamentId,
  entries,
  checkedIn,
  timezone,
  canUndo,
  onChanged,
}: {
  tournamentId: string;
  entries: FinishEntry[];
  checkedIn: number;
  timezone: string;
  canUndo: boolean;
  onChanged?: () => void;
}) {
  const { exec, pending, error, message } = useAction();
  const busted = entries.filter((e) => !e.isWinner);
  const best = checkedIn - (busted.length - 1); // best position a busted player can hold
  const sorted = [...entries].sort((a, b) => a.position - b.position);
  const move = (e: FinishEntry, to: number) =>
    exec(() => moveElimination({ tournamentId, eliminationId: e.eliminationId, toPosition: to }), {
      success: `${e.name} moved to ${ordinal(to)}.`,
      onSuccess: onChanged,
    });

  if (!entries.length) return <p className="text-sm text-mist">No one has busted yet.</p>;

  return (
    <div className="flex flex-col gap-2">
      <ol className="divide-y divide-line rounded-xl border border-line bg-panel">
        {sorted.map((e) => (
          <li key={e.eliminationId} className="flex flex-col gap-2 p-2.5 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className={`w-12 shrink-0 font-display text-2xl ${e.isWinner ? "text-amber" : "text-snow"}`}>{ordinal(e.position)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base">{e.name}</span>
                <span className="text-xs text-mist">{e.isWinner ? "Winner" : `Out at ${formatTimeOfDay(e.at, timezone)}`}</span>
              </span>
              {canUndo && (
                <Button
                  variant="ghost"
                  className="min-h-11 shrink-0 sm:order-last"
                  disabled={pending}
                  onClick={() => {
                    const reason = prompt(e.isWinner ? `Undo ${e.name} as winner? Enter a reason:` : `Put ${e.name} back in the game? Enter a reason:`);
                    if (reason) exec(() => voidElimination({ tournamentId, eliminationId: e.eliminationId, reason }), { onSuccess: onChanged });
                  }}
                >
                  Undo
                </Button>
              )}
            </div>
            {!e.isWinner && (
              <div className="flex items-center gap-1 pl-14 sm:pl-0">
                <Button
                  variant="secondary"
                  className="min-h-11 min-w-11 px-0"
                  disabled={pending || e.position <= best}
                  onClick={() => move(e, e.position - 1)}
                  aria-label={`Move ${e.name} up to ${ordinal(e.position - 1)}`}
                >
                  ▲
                </Button>
                <Button
                  variant="secondary"
                  className="min-h-11 min-w-11 px-0"
                  disabled={pending || e.position >= checkedIn}
                  onClick={() => move(e, e.position + 1)}
                  aria-label={`Move ${e.name} down to ${ordinal(e.position + 1)}`}
                >
                  ▼
                </Button>
                <Select
                  className="min-h-11 w-28"
                  value=""
                  disabled={pending || busted.length < 2}
                  onChange={(ev) => ev.target.value && move(e, Number(ev.target.value))}
                  aria-label={`Move ${e.name} to position`}
                >
                  <option value="">Move to…</option>
                  {Array.from({ length: checkedIn - best + 1 }, (_, i) => best + i)
                    .filter((p) => p !== e.position)
                    .map((p) => (
                      <option key={p} value={p}>
                        {ordinal(p)}
                      </option>
                    ))}
                </Select>
              </div>
            )}
          </li>
        ))}
      </ol>
      <Feedback error={error} message={message} />
      {best > 1 && busted.length > 0 && <p className="text-xs text-mist">Positions 1st to {ordinal(best - 1)} are for players still in.</p>}
    </div>
  );
}
