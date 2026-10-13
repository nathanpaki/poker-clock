"use client";

import { useState } from "react";
import { undoCheckIn, voidElimination } from "@/actions/roster";
import { saveStructure, setTournamentStatus, updateTournamentSettings } from "@/actions/tournaments";
import { Button, Field, Input, Select } from "@/components/ui";
import { Feedback, useAction } from "@/components/ui/use-action";
import { formatTimeOfDay, ordinal } from "@/lib/format";
import type { LevelInput } from "@/lib/validation";

type Status = "scheduled" | "running" | "completed" | "cancelled";

export function StatusControls({ tournamentId, status }: { tournamentId: string; status: Status }) {
  const { exec, pending, error } = useAction();
  const go = (s: Status, q?: string) => (!q || confirm(q)) && exec(() => setTournamentStatus({ tournamentId, status: s }));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "scheduled" && <Button variant="primary" disabled={pending} onClick={() => go("running")}>Open tournament</Button>}
      {status === "running" && <Button disabled={pending} onClick={() => go("completed", "Close this tournament? The clock stops and it moves to history. You can reopen it later.")}>Close tournament</Button>}
      {(status === "completed" || status === "cancelled") && <Button disabled={pending} onClick={() => go("running", "Reopen this tournament for corrections?")}>Reopen</Button>}
      {status === "scheduled" && <Button variant="ghost" disabled={pending} onClick={() => go("cancelled", "Cancel this tournament? Its records stay in history.")}>Cancel tournament</Button>}
      <Feedback error={error} />
    </div>
  );
}

export function SettingsForm({
  t,
}: {
  t: { id: string; name: string; scheduledAt: string; maxEntrants: number | null; startingStack: number | null; anteEnabled: boolean; showEliminationsPublic: boolean; breakAlertsEnabled: boolean };
}) {
  const { exec, pending, error, message } = useAction();
  const [f, setF] = useState({ ...t, maxEntrants: t.maxEntrants?.toString() ?? "", startingStack: t.startingStack?.toString() ?? "" });
  const chk = (k: "anteEnabled" | "showEliminationsPublic" | "breakAlertsEnabled", label: string) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} className="h-4 w-4 accent-amber" />{label}</label>
  );
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        exec(
          () =>
            updateTournamentSettings({
              tournamentId: t.id,
              name: f.name,
              scheduledAt: f.scheduledAt,
              maxEntrants: f.maxEntrants ? Number(f.maxEntrants) : null,
              startingStack: f.startingStack ? Number(f.startingStack) : null,
              anteEnabled: f.anteEnabled,
              showEliminationsPublic: f.showEliminationsPublic,
              breakAlertsEnabled: f.breakAlertsEnabled,
            }),
          { success: "Saved." },
        );
      }}
    >
      <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
      <Field label="Date and start time"><Input type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} required /></Field>
      <Field label="Max entrants"><Input type="number" min={2} value={f.maxEntrants} onChange={(e) => setF({ ...f, maxEntrants: e.target.value })} /></Field>
      <Field label="Starting stack"><Input type="number" min={1} value={f.startingStack} onChange={(e) => setF({ ...f, startingStack: e.target.value })} /></Field>
      <div className="flex flex-col gap-2">
        {chk("anteEnabled", "Show antes")}
        {chk("showEliminationsPublic", "Show eliminations on the public clock")}
        {chk("breakAlertsEnabled", "Play break alerts")}
      </div>
      <div className="flex items-end justify-end"><Button variant="primary" disabled={pending}>Save settings</Button></div>
      <div className="sm:col-span-2"><Feedback error={error} message={message} /></div>
    </form>
  );
}

export function StructureEditor({ tournamentId, initial, currentIndex }: { tournamentId: string; initial: LevelInput[]; currentIndex: number }) {
  const { exec, pending, error, message } = useAction();
  const [levels, setLevels] = useState<LevelInput[]>(initial);
  const up = (i: number, patch: Partial<LevelInput>) => setLevels(levels.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= levels.length) return;
    const next = [...levels];
    [next[i], next[j]] = [next[j], next[i]];
    setLevels(next);
  };
  const addLevel = () => {
    const last = [...levels].reverse().find((l) => l.kind === "level");
    setLevels([...levels, { kind: "level", smallBlind: (last?.smallBlind ?? 50) * 2, bigBlind: (last?.bigBlind ?? 100) * 2, ante: 0, durationMin: last?.durationMin ?? 20 }]);
  };
  let n = 0;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="text-left text-xs text-mist">
            <tr><th className="py-1 font-normal">#</th><th className="font-normal">Type</th><th className="font-normal">Small blind</th><th className="font-normal">Big blind</th><th className="font-normal">Ante</th><th className="font-normal">Minutes</th><th /></tr>
          </thead>
          <tbody>
            {levels.map((l, i) => {
              const label = l.kind === "level" ? String(++n) : "Break";
              return (
                <tr key={i} className={`border-t border-line ${i === currentIndex ? "bg-amber/10" : ""}`}>
                  <td className="py-1.5 pr-2 font-display text-lg">{label}</td>
                  <td className="pr-2">
                    <Select value={l.kind} onChange={(e) => up(i, { kind: e.target.value as LevelInput["kind"] })} aria-label="Type">
                      <option value="level">Level</option>
                      <option value="break">Break</option>
                    </Select>
                  </td>
                  {(["smallBlind", "bigBlind", "ante"] as const).map((k) => (
                    <td key={k} className="pr-2">
                      <Input type="number" min={0} disabled={l.kind === "break"} value={l.kind === "break" ? "" : l[k]} onChange={(e) => up(i, { [k]: Number(e.target.value) })} aria-label={k} />
                    </td>
                  ))}
                  <td className="pr-2"><Input type="number" min={0.5} step={0.5} value={l.durationMin} onChange={(e) => up(i, { durationMin: Number(e.target.value) })} aria-label="Minutes" /></td>
                  <td className="whitespace-nowrap">
                    <Button variant="ghost" onClick={() => move(i, -1)} aria-label="Move up">↑</Button>
                    <Button variant="ghost" onClick={() => move(i, 1)} aria-label="Move down">↓</Button>
                    <Button variant="ghost" onClick={() => setLevels(levels.filter((_, j) => j !== i))} aria-label="Remove">✕</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={addLevel}>Add level</Button>
        <Button onClick={() => setLevels([...levels, { kind: "break", smallBlind: 0, bigBlind: 0, ante: 0, durationMin: 10 }])}>Add break</Button>
        <span className="flex-1" />
        <Button variant="primary" disabled={pending} onClick={() => exec(() => saveStructure({ tournamentId, levels }), { success: "Structure saved. Displays update within a few seconds." })}>Save structure</Button>
      </div>
      <div className="mt-2"><Feedback error={error} message={message} /></div>
    </div>
  );
}

export type RosterRow = {
  registrationId: string;
  name: string;
  checkIn: { at: number; byName: string } | null;
  elimination: { id: string; at: number; byName: string; position: number | null; levelNumber: number | null; isWinner: boolean } | null;
};

export function RosterTable({ tournamentId, rows, timezone, canCorrect, canUndoCheckIn }: { tournamentId: string; rows: RosterRow[]; timezone: string; canCorrect: boolean; canUndoCheckIn: boolean }) {
  const { exec, pending, error } = useAction();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs text-mist">
          <tr><th className="py-1 font-normal">Player</th><th className="font-normal">Checked in</th><th className="font-normal">Out</th><th className="font-normal">Finish</th><th className="font-normal">Level</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.registrationId} className="border-t border-line">
              <td className="py-2">{r.name}</td>
              <td className="text-mist">{r.checkIn ? <>{formatTimeOfDay(r.checkIn.at, timezone)} <span className="text-xs">by {r.checkIn.byName}</span></> : "—"}</td>
              <td className="text-mist">
                {r.elimination?.isWinner ? <span className="text-amber">Winner</span> : r.elimination ? <>{formatTimeOfDay(r.elimination.at, timezone)} <span className="text-xs">by {r.elimination.byName}</span></> : r.checkIn ? "Still in" : ""}
              </td>
              <td className="font-display text-lg text-amber">{r.elimination?.position ? ordinal(r.elimination.position) : ""}</td>
              <td className="text-mist">{r.elimination?.levelNumber ?? ""}</td>
              <td className="whitespace-nowrap text-right">
                {r.elimination && canCorrect && (
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      const reason = prompt(`Undo ${r.name}'s elimination? Enter a reason for the audit log:`);
                      if (reason) exec(() => voidElimination({ tournamentId, eliminationId: r.elimination!.id, reason }));
                    }}
                  >
                    {r.elimination.isWinner ? "Undo winner" : "Undo out"}
                  </Button>
                )}
                {r.checkIn && !r.elimination && canUndoCheckIn && (
                  <Button variant="ghost" disabled={pending} onClick={() => confirm(`Undo ${r.name}'s check-in?`) && exec(() => undoCheckIn({ tournamentId, registrationId: r.registrationId }))}>
                    Undo check-in
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Feedback error={error} />
    </div>
  );
}
