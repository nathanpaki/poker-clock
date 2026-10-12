"use client";

import { useState } from "react";
import { addLeagueMember, createVenue, removeLeagueMember, setVenueAccess, updateLeagueSettings, updateVenue } from "@/actions/leagues";
import { createTournament } from "@/actions/tournaments";
import { Button, Field, Input, Select } from "@/components/ui";
import { Feedback, useAction } from "@/components/ui/use-action";

type VenueLite = { id: string; name: string; timezone: string; active: boolean };

export function LeagueSettingsForm({ league }: { league: { id: string; name: string; defaultTimezone: string; allowCrossVenuePlayers: boolean } }) {
  const { exec, pending, error, message } = useAction();
  const [name, setName] = useState(league.name);
  const [tz, setTz] = useState(league.defaultTimezone);
  const [cross, setCross] = useState(league.allowCrossVenuePlayers);
  return (
    <form
      className="grid gap-3 sm:grid-cols-[2fr_1.4fr_auto_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        exec(() => updateLeagueSettings({ leagueId: league.id, name, timezone: tz, allowCrossVenuePlayers: cross }), { success: "Saved." });
      }}
    >
      <Field label="League name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label="Default time zone"><Input value={tz} onChange={(e) => setTz(e.target.value)} required /></Field>
      <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={cross} onChange={(e) => setCross(e.target.checked)} className="h-4 w-4 accent-amber" />Players can play at any venue</label>
      <Button disabled={pending}>Save settings</Button>
      <div className="sm:col-span-4"><Feedback error={error} message={message} /></div>
    </form>
  );
}

export function VenueCreateForm({ leagueId, defaultTimezone }: { leagueId: string; defaultTimezone: string }) {
  const { exec, pending, error } = useAction();
  const [name, setName] = useState("");
  const [tz, setTz] = useState(defaultTimezone);
  return (
    <form
      className="grid gap-3 sm:grid-cols-[2fr_1.4fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        exec(() => createVenue({ leagueId, name, timezone: tz }), { onSuccess: () => setName("") });
      }}
    >
      <Field label="New venue"><Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Craft Brewery" /></Field>
      <Field label="Time zone"><Input value={tz} onChange={(e) => setTz(e.target.value)} required /></Field>
      <Button variant="primary" disabled={pending}>Add venue</Button>
      <div className="sm:col-span-3"><Feedback error={error} /></div>
    </form>
  );
}

export function VenueRow({ leagueId, venue }: { leagueId: string; venue: VenueLite }) {
  const { exec, pending, error } = useAction();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(venue.name);
  const [tz, setTz] = useState(venue.timezone);
  if (!editing)
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 py-2">
        <span className={venue.active ? "" : "text-mist line-through"}>{venue.name} <span className="text-xs text-mist">{venue.timezone}</span></span>
        <span className="flex gap-2">
          <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          <Button variant="ghost" disabled={pending} onClick={() => exec(() => updateVenue({ leagueId, venueId: venue.id, name: venue.name, timezone: venue.timezone, active: !venue.active }))}>
            {venue.active ? "Deactivate" : "Reactivate"}
          </Button>
        </span>
        <Feedback error={error} />
      </li>
    );
  return (
    <li className="grid gap-2 py-2 sm:grid-cols-[2fr_1.4fr_auto_auto] sm:items-end">
      <Input value={name} onChange={(e) => setName(e.target.value)} />
      <Input value={tz} onChange={(e) => setTz(e.target.value)} />
      <Button variant="primary" disabled={pending} onClick={() => exec(() => updateVenue({ leagueId, venueId: venue.id, name, timezone: tz, active: venue.active }), { onSuccess: () => setEditing(false) })}>Save</Button>
      <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      <Feedback error={error} />
    </li>
  );
}

export function AddMemberForm({ leagueId }: { leagueId: string }) {
  const { exec, pending, error, message } = useAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"staff" | "admin">("staff");
  return (
    <form
      className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        exec(() => addLeagueMember({ leagueId, email, role }), { success: "Added.", onSuccess: () => setEmail("") });
      }}
    >
      <Field label="Email" hint="They need to have signed up already."><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
      <Field label="Role">
        <Select value={role} onChange={(e) => setRole(e.target.value as "staff" | "admin")}>
          <option value="staff">Staff</option>
          <option value="admin">League admin</option>
        </Select>
      </Field>
      <Button variant="primary" disabled={pending}>Add person</Button>
      <div className="sm:col-span-3"><Feedback error={error} message={message} /></div>
    </form>
  );
}

type Access = { canCheckIn: boolean; canEliminate: boolean; canControlClock: boolean; canManagePlayers: boolean; canExport: boolean };
const PERMS: { key: keyof Access; label: string }[] = [
  { key: "canCheckIn", label: "Check in" },
  { key: "canEliminate", label: "Eliminate" },
  { key: "canControlClock", label: "Clock" },
  { key: "canManagePlayers", label: "Players" },
  { key: "canExport", label: "Export" },
];

export function MemberAccess({
  leagueId,
  member,
  venues,
  access,
}: {
  leagueId: string;
  member: { userId: string; name: string; role: "admin" | "staff" };
  venues: VenueLite[];
  access: Record<string, Access | undefined>;
}) {
  const { exec, pending, error } = useAction();
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{member.name} <span className="text-xs text-mist">{member.role === "admin" ? "League admin — full access" : "Staff"}</span></span>
        <Button variant="ghost" disabled={pending} onClick={() => confirm(`Remove ${member.name} from this league?`) && exec(() => removeLeagueMember({ leagueId, userId: member.userId }))}>Remove</Button>
      </div>
      {member.role === "staff" && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-mist">
              <tr><th className="py-1 font-normal">Venue</th><th className="font-normal">Assigned</th>{PERMS.map((p) => <th key={p.key} className="font-normal">{p.label}</th>)}</tr>
            </thead>
            <tbody>
              {venues.map((v) => {
                const a = access[v.id];
                const save = (patch: Partial<Access> & { enabled?: boolean }) => {
                  const base: Access = a ?? { canCheckIn: true, canEliminate: true, canControlClock: false, canManagePlayers: false, canExport: false };
                  exec(() => setVenueAccess({ leagueId, venueId: v.id, userId: member.userId, enabled: patch.enabled ?? true, ...base, ...patch }));
                };
                return (
                  <tr key={v.id} className="border-t border-line">
                    <td className="py-1.5">{v.name}</td>
                    <td><input type="checkbox" className="h-4 w-4 accent-amber" checked={!!a} disabled={pending} onChange={(e) => save({ enabled: e.target.checked })} aria-label={`Assign to ${v.name}`} /></td>
                    {PERMS.map((p) => (
                      <td key={p.key}>
                        <input type="checkbox" className="h-4 w-4 accent-amber" disabled={!a || pending} checked={!!a?.[p.key]} onChange={(e) => save({ [p.key]: e.target.checked })} aria-label={`${p.label} at ${v.name}`} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Feedback error={error} />
    </li>
  );
}

export function CreateTournamentForm({ leagueId, venues, past }: { leagueId: string; venues: VenueLite[]; past: { id: string; label: string }[] }) {
  const { exec, pending, error } = useAction();
  const [f, setF] = useState({ venueId: venues.find((v) => v.active)?.id ?? "", name: "", scheduledAt: "", maxEntrants: "", startingStack: "", anteEnabled: false, copyStructureFrom: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        exec(() => createTournament({ leagueId, ...f, scheduledAt: f.scheduledAt }), {
          onSuccess: (d) => d && (window.location.href = `/admin/tournaments/${d.tournamentId}`),
          refresh: false,
        });
      }}
    >
      <Field label="Venue">
        <Select value={f.venueId} onChange={set("venueId")} required>
          {venues.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
      </Field>
      <Field label="Tournament name"><Input value={f.name} onChange={set("name")} required placeholder="Friday Tournament" /></Field>
      <Field label="Date and start time"><Input type="datetime-local" value={f.scheduledAt} onChange={set("scheduledAt")} required /></Field>
      <Field label="Max entrants (optional)"><Input type="number" min={2} value={f.maxEntrants} onChange={set("maxEntrants")} /></Field>
      <Field label="Starting stack (optional)"><Input type="number" min={1} value={f.startingStack} onChange={set("startingStack")} /></Field>
      <Field label="Blind structure">
        <Select value={f.copyStructureFrom} onChange={set("copyStructureFrom")}>
          <option value="">Standard structure</option>
          {past.map((p) => <option key={p.id} value={p.id}>Copy from {p.label}</option>)}
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.anteEnabled} onChange={set("anteEnabled")} className="h-4 w-4 accent-amber" />Use antes</label>
      <div className="sm:col-span-2 sm:text-right"><Button variant="primary" disabled={pending || !f.venueId}>{pending ? "Creating…" : "Create tournament"}</Button></div>
      <div className="sm:col-span-3"><Feedback error={error} /></div>
    </form>
  );
}

export function BulkExportForm({ leagueId }: { leagueId: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [format, setFormat] = useState("xlsx");
  const [history, setHistory] = useState(false);
  const qs = new URLSearchParams({ format, history: history ? "1" : "0", ...(from && { from }), ...(to && { to }) });
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto_auto] sm:items-end">
      <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <Field label="Format">
        <Select value={format} onChange={(e) => setFormat(e.target.value)}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option></Select>
      </Field>
      <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} className="h-4 w-4 accent-amber" />Include corrections</label>
      <a href={`/api/exports/league/${leagueId}?${qs}`} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-amber px-4 text-sm font-semibold text-ink">Download ZIP</a>
    </div>
  );
}
