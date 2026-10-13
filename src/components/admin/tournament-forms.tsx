"use client";

import { useState } from "react";
import { undoCheckIn, voidElimination } from "@/actions/roster";
import { saveTournamentAsStructure } from "@/actions/structures";
import { duplicateTournament, saveStructure, setTournamentStatus, updateTournamentSettings } from "@/actions/tournaments";
import { StructureEditor, type SavedStructureLite } from "./structure-editor";
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

export function TournamentStructureEditor({
  tournamentId,
  tournamentName,
  initial,
  currentIndex,
  saved,
}: {
  tournamentId: string;
  tournamentName: string;
  initial: LevelInput[];
  currentIndex: number;
  saved: SavedStructureLite[];
}) {
  const save = useAction();
  const tmpl = useAction();
  const [tmplName, setTmplName] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  return (
    <>
      <StructureEditor
        initial={initial}
        exportName={tournamentName}
        currentIndex={currentIndex}
        saved={saved}
        saving={save.pending}
        onSave={(levels, markSaved) =>
          save.exec(() => saveStructure({ tournamentId, levels }), { success: "Structure saved. Displays update within a few seconds.", onSuccess: markSaved })
        }
      />
      <Feedback error={save.error} message={save.message} />
      <form
        className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          tmpl.exec(() => saveTournamentAsStructure({ tournamentId, name: tmplName, makeDefault }), { success: `Saved "${tmplName}". It's now available when creating tournaments.`, onSuccess: () => setTmplName("") });
        }}
      >
        <Field label="Save these blinds for future tournaments" hint="Saves the version stored for this tournament. Save any edits above first.">
          <Input value={tmplName} onChange={(e) => setTmplName(e.target.value)} placeholder="e.g. Friday 20-minute" required />
        </Field>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} className="h-4 w-4 accent-amber" />Make it the league default</label>
        <Button disabled={tmpl.pending}>{tmpl.pending ? "Saving…" : "Save as structure"}</Button>
        <div className="sm:col-span-3"><Feedback error={tmpl.error} message={tmpl.message} /></div>
      </form>
    </>
  );
}

export function DuplicateTournamentForm({
  tournamentId,
  defaultName,
  defaultWhen,
  venueId,
  venues,
  registeredCount,
}: {
  tournamentId: string;
  defaultName: string;
  defaultWhen: string;
  venueId: string;
  venues: { id: string; name: string }[];
  registeredCount: number;
}) {
  const { exec, pending, error } = useAction();
  const [f, setF] = useState({ name: defaultName, scheduledAt: defaultWhen, venueId, copyPlayers: registeredCount > 0 });
  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        exec(() => duplicateTournament({ tournamentId, ...f }), {
          refresh: false,
          onSuccess: (d) => d && (window.location.href = `/admin/tournaments/${d.tournamentId}`),
        });
      }}
    >
      <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
      <Field label="Date and start time" hint="Defaults to the same time next week."><Input type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} required /></Field>
      <Field label="Venue">
        <Select value={f.venueId} onChange={(e) => setF({ ...f, venueId: e.target.value })}>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={f.copyPlayers} disabled={!registeredCount} onChange={(e) => setF({ ...f, copyPlayers: e.target.checked })} className="h-4 w-4 accent-amber" />
        Also register the same {registeredCount} player{registeredCount === 1 ? "" : "s"} (inactive players are skipped; nobody is checked in)
      </label>
      <div className="sm:text-right"><Button variant="primary" disabled={pending}>{pending ? "Copying…" : "Create copy"}</Button></div>
      <p className="text-xs text-mist sm:col-span-3">Copies the blinds, breaks and settings. The copy gets its own code and clock; this tournament isn&rsquo;t changed.</p>
      <div className="sm:col-span-3"><Feedback error={error} /></div>
    </form>
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
