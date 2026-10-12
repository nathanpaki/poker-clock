"use client";

import { useState } from "react";
import { createPlayer, setPlayerActive, updatePlayer } from "@/actions/players";
import { Button, Field, Input } from "@/components/ui";
import { Feedback, useAction } from "@/components/ui/use-action";

type P = { id: string; displayName: string; email: string | null; phone: string | null; notes: string | null; active: boolean };

export function PlayerCreateForm({ leagueId }: { leagueId: string }) {
  const { exec, pending, error, message } = useAction();
  const blank = { displayName: "", email: "", phone: "" };
  const [f, setF] = useState(blank);
  return (
    <form
      className="grid gap-3 sm:grid-cols-[2fr_2fr_1.4fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        exec(() => createPlayer({ leagueId, ...f }), { success: `Added ${f.displayName}.`, onSuccess: () => setF(blank) });
      }}
    >
      <Field label="Name"><Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} required /></Field>
      <Field label="Email (optional)"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Phone (optional)"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Button variant="primary" disabled={pending}>Add player</Button>
      <div className="sm:col-span-4"><Feedback error={error} message={message} /></div>
    </form>
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
