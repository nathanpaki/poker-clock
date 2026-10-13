"use client";

import { useState } from "react";
import { createPlayer, mergePlayers, setPlayerActive, updatePlayer } from "@/actions/players";
import type { NameConflict } from "@/lib/action-result-types";
import { Button, Field, Input } from "@/components/ui";
import { Feedback, useAction } from "@/components/ui/use-action";

type P = { id: string; displayName: string; email: string | null; phone: string | null; notes: string | null; active: boolean };

export function PlayerCreateForm({ leagueId }: { leagueId: string }) {
  const { exec, pending, error, message, conflict, clear } = useAction();
  const blank = { displayName: "", email: "", phone: "" };
  const [f, setF] = useState(blank);
  const submit = (allowSimilar = false) =>
    exec(() => createPlayer({ leagueId, ...f, allowSimilar }), { success: `Added ${f.displayName}.`, onSuccess: () => setF(blank) });
  return (
    <form
      className="grid gap-3 sm:grid-cols-[2fr_2fr_1.4fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Name"><Input value={f.displayName} onChange={(e) => { setF({ ...f, displayName: e.target.value }); if (conflict) clear(); }} required /></Field>
      <Field label="Email (optional)"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Phone (optional)"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Button variant="primary" disabled={pending}>Add player</Button>
      <div className="sm:col-span-4">
        {conflict ? (
          <NameConflictBox
            leagueId={leagueId}
            typed={f.displayName}
            conflict={conflict}
            message={error}
            pending={pending}
            onAddAnyway={() => submit(true)}
            onCancel={() => {
              clear();
              setF(blank);
            }}
          />
        ) : (
          <Feedback error={error} message={message} />
        )}
      </div>
    </form>
  );
}

/** Explains a name clash and offers the sensible next step. */
function NameConflictBox({
  leagueId,
  typed,
  conflict,
  message,
  pending,
  onAddAnyway,
  onCancel,
}: {
  leagueId: string;
  typed: string;
  conflict: NameConflict;
  message: string | null;
  pending: boolean;
  onAddAnyway: () => void;
  onCancel: () => void;
}) {
  const react = useAction();
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber/60 bg-amber/5 p-4">
      <p className="text-snow">{message}</p>
      <div className="flex flex-wrap gap-2">
        {conflict.kind === "exact" && !conflict.player.active && (
          <Button
            variant="primary"
            disabled={react.pending}
            onClick={() => react.exec(() => setPlayerActive({ leagueId, playerId: conflict.player.id, active: true }), { onSuccess: onCancel })}
          >
            Reactivate {conflict.player.name}
          </Button>
        )}
        {conflict.kind === "similar" && (
          <>
            <Button onClick={onCancel}>Same person, don&rsquo;t add</Button>
            <Button variant="primary" disabled={pending} onClick={onAddAnyway}>
              Different person, add &ldquo;{typed.trim()}&rdquo;
            </Button>
          </>
        )}
        {conflict.kind === "exact" && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
      <Feedback error={react.error} />
    </div>
  );
}

type MergeRecord = { id: string; name: string; active: boolean; email: string | null; phone: string | null; tournaments: number; lastPlayed: string | null };

/** One group of possibly-duplicate records: pick the one to keep, merge the rest into it. */
export function MergeGroup({ leagueId, records, label }: { leagueId: string; records: MergeRecord[]; label: string }) {
  const { exec, pending, error, message } = useAction();
  // Default keep: the record with the most tournament history, then active.
  const best = [...records].sort((a, b) => b.tournaments - a.tournaments || Number(b.active) - Number(a.active))[0];
  const [keep, setKeep] = useState(best.id);
  const kept = records.find((r) => r.id === keep)!;
  const others = records.filter((r) => r.id !== keep);
  const merge = () => {
    if (!confirm(`Merge ${others.map((o) => `"${o.name}"`).join(", ")} into "${kept.name}"? Their tournament history moves to "${kept.name}" and the extra record is removed.`)) return;
    exec(async () => {
      for (const o of others) {
        const r = await mergePlayers({ leagueId, keepId: keep, mergeId: o.id });
        if (!r.ok) return r;
      }
      return { ok: true as const };
    }, { success: `Merged into ${kept.name}.` });
  };
  return (
    <li className="rounded-xl border border-line bg-ink p-3">
      <p className="mb-2 text-xs text-mist">{label}</p>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="sr-only">Record to keep</legend>
        {records.map((r) => (
          <label key={r.id} className={`flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 ${keep === r.id ? "border-amber/70 bg-amber/5" : "border-line"}`}>
            <input type="radio" name={`keep-${records[0].id}`} checked={keep === r.id} onChange={() => setKeep(r.id)} className="h-4 w-4 accent-amber" />
            <span className="font-medium">{r.name}</span>
            {!r.active && <span className="text-xs text-mist">inactive</span>}
            <span className="text-xs text-mist">
              {r.tournaments} tournament{r.tournaments === 1 ? "" : "s"}
              {r.lastPlayed ? ` · last ${r.lastPlayed}` : ""}
              {r.email ? ` · ${r.email}` : ""}
              {r.phone ? ` · ${r.phone}` : ""}
            </span>
            {keep === r.id && <span className="ml-auto text-xs text-amber">keep</span>}
          </label>
        ))}
      </fieldset>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={pending} onClick={merge}>
          {pending ? "Merging…" : `Merge into ${kept.name}`}
        </Button>
        <Feedback error={error} message={message} />
      </div>
    </li>
  );
}

export function PlayerRow({ leagueId, player }: { leagueId: string; player: P }) {
  const { exec, pending, error } = useAction();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ displayName: player.displayName, email: player.email ?? "", phone: player.phone ?? "", notes: player.notes ?? "" });
  if (edit)
    return (
      <tr className="border-t border-line">
        <td colSpan={4} className="py-2">
          <div className="grid gap-2 sm:grid-cols-[2fr_2fr_1.4fr_auto_auto]">
            <Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} aria-label="Name" />
            <Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-label="Email" placeholder="Email" />
            <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} aria-label="Phone" placeholder="Phone" />
            <Button variant="primary" disabled={pending} onClick={() => exec(() => updatePlayer({ leagueId, playerId: player.id, ...f }), { onSuccess: () => setEdit(false) })}>Save</Button>
            <Button variant="ghost" onClick={() => setEdit(false)}>Cancel</Button>
          </div>
          <Feedback error={error} />
        </td>
      </tr>
    );
  return (
    <tr className="border-t border-line">
      <td className={`py-2 ${player.active ? "" : "text-mist line-through"}`}>{player.displayName}</td>
      <td className="hidden text-mist sm:table-cell">{player.email}</td>
      <td className="hidden text-mist sm:table-cell">{player.phone}</td>
      <td className="text-right">
        <Button variant="ghost" onClick={() => setEdit(true)}>Edit</Button>
        <Button variant="ghost" disabled={pending} onClick={() => exec(() => setPlayerActive({ leagueId, playerId: player.id, active: !player.active }))}>
          {player.active ? "Deactivate" : "Reactivate"}
        </Button>
        <Feedback error={error} />
      </td>
    </tr>
  );
}
