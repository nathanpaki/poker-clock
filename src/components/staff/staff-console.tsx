"use client";

import { useMemo, useState } from "react";
import { clockAction, type ClockInput } from "@/actions/clock";
import { checkIn, eliminate, quickAddPlayer, registerPlayers } from "@/actions/roster";
import { ClockDisplay } from "@/components/clock/clock-display";
import { useTournamentClock } from "@/components/clock/use-tournament-clock";
import { Button, Input } from "@/components/ui";
import { Feedback, useAction } from "@/components/ui/use-action";
import { formatTimeOfDay, ordinal } from "@/lib/format";
import type { PublicSnapshot } from "@/server/tournament-state";
import { HoldButton } from "./hold-button";

type Entry = { registrationId: string; name: string; checkedInAt: number | null; eliminated: boolean };
type Perms = { clock: boolean; check_in: boolean; eliminate: boolean; managePlayers: boolean };

export function StaffConsole({
  tournamentId,
  code,
  initial,
  perms,
  roster,
  unregistered,
  timezone,
  closed,
}: {
  tournamentId: string;
  code: string;
  initial: PublicSnapshot;
  perms: Perms;
  roster: Entry[];
  unregistered: { id: string; name: string }[];
  timezone: string;
  closed: boolean;
}) {
  const clock = useTournamentClock(code, initial);
  const tabs = [perms.clock && "Clock", perms.check_in && "Check in", perms.eliminate && "I'm out"].filter(Boolean) as string[];
  const [tab, setTab] = useState(tabs[0] ?? "Clock");

  return (
    <div className="flex flex-col gap-4">
      <ClockDisplay code={code} clock={clock} qrSvg={null} compact />
      {closed && <p className="rounded-lg border border-amber/60 p-3 text-sm text-amber">This tournament is closed. Reopen it from the tournament page to make changes.</p>}
      <div role="tablist" className="sticky top-[57px] z-10 grid gap-1 rounded-xl border border-line bg-ink/95 p-1 backdrop-blur" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0,1fr))` }}>
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-lg py-3 font-display text-xl ${tab === t ? (t === "I'm out" ? "bg-danger text-white" : "bg-amber text-ink") : "text-mist"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Clock" && perms.clock && <ClockControls tournamentId={tournamentId} status={clock.effective.status} onBreak={clock.view.onBreak} refresh={clock.refresh} />}
      {tab === "Check in" && perms.check_in && (
        <CheckInPanel tournamentId={tournamentId} roster={roster} unregistered={unregistered} timezone={timezone} canQuickAdd={perms.managePlayers} refresh={clock.refresh} />
      )}
      {tab === "I'm out" && perms.eliminate && <EliminationPanel tournamentId={tournamentId} roster={roster} refresh={clock.refresh} />}
    </div>
  );
}

function ClockControls({ tournamentId, status, onBreak, refresh }: { tournamentId: string; status: string; onBreak: boolean; refresh: () => Promise<void> }) {
  const { exec, pending, error } = useAction();
  const [step, setStep] = useState(1);
  const [breakMin, setBreakMin] = useState(10);
  const send = (input: ClockInput) => exec(() => clockAction(tournamentId, input), { onSuccess: () => void refresh(), refresh: false });
  const big = "min-h-16 text-lg font-display";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {status === "not_started" && <Button variant="primary" className={`${big} col-span-2`} disabled={pending} onClick={() => send({ op: "start" })}>Start clock</Button>}
        {status === "running" && <Button variant="primary" className={`${big} col-span-2`} disabled={pending} onClick={() => send({ op: "pause" })}>Pause</Button>}
        {status === "paused" && <Button variant="primary" className={`${big} col-span-2`} disabled={pending} onClick={() => send({ op: "resume" })}>Resume</Button>}
        {status === "break" && <Button variant="primary" className={`${big} col-span-2`} disabled={pending} onClick={() => send({ op: "end_break" })}>End break</Button>}
        {status === "finished" && <div className="col-span-2 grid place-items-center rounded-lg border border-amber/60 text-amber">End of structure</div>}
        <Button className={big} disabled={pending} onClick={() => send({ op: "previous_level" })}>Previous level</Button>
        <Button className={big} disabled={pending} onClick={() => send({ op: "next_level" })}>Next level</Button>
      </div>

      <div className="rounded-xl border border-line bg-panel p-3">
        <div className="mb-2 flex items-center justify-between text-sm text-mist">
          <span>Adjust time</span>
          <span className="flex gap-1" role="radiogroup" aria-label="Minutes">
            {[1, 5, 10].map((m) => (
              <button key={m} role="radio" aria-checked={step === m} onClick={() => setStep(m)} className={`rounded-md px-3 py-1 ${step === m ? "bg-amber text-ink" : "border border-line"}`}>
                {m} min
              </button>
            ))}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button className={big} disabled={pending} onClick={() => send({ op: "adjust", minutes: -step })}>− {step} min</Button>
          <Button className={big} disabled={pending} onClick={() => send({ op: "adjust", minutes: step })}>+ {step} min</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {onBreak && status !== "break" ? (
          <Button className={big} disabled={pending} onClick={() => send({ op: "end_break" })}>End scheduled break</Button>
        ) : (
          <div className="flex gap-2">
            <Input type="number" min={1} max={120} value={breakMin} onChange={(e) => setBreakMin(Number(e.target.value))} className="w-20" aria-label="Break minutes" />
            <Button className={`${big} flex-1`} disabled={pending || status === "break"} onClick={() => send({ op: "start_break", minutes: breakMin })}>Start break</Button>
          </div>
        )}
        <Button className={big} disabled={pending} onClick={() => confirm("Reset this level to its full time?") && send({ op: "reset_level" })}>Reset level</Button>
      </div>

      <Button
        variant="ghost"
        className="self-start"
        disabled={pending}
        onClick={() => {
          const v = prompt("Restart the clock from level 1? Players and eliminations are kept. Type RESTART to confirm.");
          if (v === "RESTART") send({ op: "restart", confirm: "RESTART" });
        }}
      >
        Restart tournament clock
      </Button>
      <Feedback error={error} />
    </div>
  );
}

function CheckInPanel({
  tournamentId,
  roster,
  unregistered,
  timezone,
  canQuickAdd,
  refresh,
}: {
  tournamentId: string;
  roster: Entry[];
  unregistered: { id: string; name: string }[];
  timezone: string;
  canQuickAdd: boolean;
  refresh: () => Promise<void>;
}) {
  const { exec, pending, error, message } = useAction();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const match = (n: string) => n.toLowerCase().includes(q.trim().toLowerCase());
  const waiting = roster.filter((r) => !r.checkedInAt && match(r.name));
  const inRoom = roster.filter((r) => r.checkedInAt);
  const others = q.trim() ? unregistered.filter((p) => match(p.name)).slice(0, 20) : [];
  const exact = [...roster.map((r) => r.name), ...unregistered.map((p) => p.name)].some((n) => n.toLowerCase() === q.trim().toLowerCase());

  const done = (msg: string) => ({ success: msg, onSuccess: () => { setBusy(null); void refresh(); } });

  return (
    <div className="flex flex-col gap-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players" className="min-h-12 text-lg" autoFocus aria-label="Search players" />
      <Feedback error={error} message={message} />
      <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
        {waiting.length === 0 && <li className="p-4 text-sm text-mist">{q ? "No registered players match." : "Everyone registered is checked in."}</li>}
        {waiting.map((r) => (
          <li key={r.registrationId} className="flex items-center justify-between gap-3 p-3">
            <span className="text-lg">{r.name}</span>
            <Button variant="primary" className="min-h-12 px-6" disabled={pending} onClick={() => { setBusy(r.registrationId); exec(() => checkIn({ tournamentId, registrationId: r.registrationId }), done(`${r.name} is checked in.`)); }}>
              {busy === r.registrationId && pending ? "Saving…" : "Check in"}
            </Button>
          </li>
        ))}
      </ul>

      {others.length > 0 && (
        <>
          <h3 className="mt-2 text-sm text-mist">League players not registered for this tournament</h3>
          <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
            {others.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 p-3">
                <span className="text-lg">{p.name}</span>
                <Button className="min-h-12" disabled={pending} onClick={() => exec(() => registerPlayers({ tournamentId, playerIds: [p.id], checkInNow: true }), done(`${p.name} is registered and checked in.`))}>
                  Register and check in
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {canQuickAdd && q.trim().length > 1 && !exact && (
        <Button className="min-h-12" disabled={pending} onClick={() => exec(() => quickAddPlayer({ tournamentId, displayName: q.trim(), checkInNow: true }), { ...done(`${q.trim()} was added to the league and checked in.`), onSuccess: () => { setQ(""); void refresh(); } })}>
          Add &ldquo;{q.trim()}&rdquo; as a new league player and check in
        </Button>
      )}

      <details className="rounded-xl border border-line bg-panel p-3">
        <summary className="cursor-pointer text-mist">{inRoom.length} checked in</summary>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {inRoom.map((r) => (
            <li key={r.registrationId} className={r.eliminated ? "text-mist line-through" : ""}>
              {r.name} <span className="text-mist">{formatTimeOfDay(r.checkedInAt!, timezone)}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function EliminationPanel({ tournamentId, roster, refresh }: { tournamentId: string; roster: Entry[]; refresh: () => Promise<void> }) {
  const { exec, pending, error, message } = useAction();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Entry | null>(null);
  const alive = useMemo(() => roster.filter((r) => r.checkedInAt && !r.eliminated), [roster]);
  const list = alive.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));

  if (selected)
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-danger/60 bg-panel p-4">
        <p className="text-mist">Eliminate</p>
        <p className="font-display text-4xl font-bold">{selected.name}</p>
        <HoldButton
          label={`Hold to confirm ${selected.name} is out`}
          disabled={pending}
          onConfirm={() =>
            exec(() => eliminate({ tournamentId, registrationId: selected.registrationId }), {
              onSuccess: () => {
                setSelected(null);
                setQ("");
                void refresh();
              },
              success: (d) => `${selected.name} is out${d?.position ? ` in ${ordinal(d.position)}` : ""}.`,
            })
          }
        />
        <Button variant="ghost" onClick={() => setSelected(null)} disabled={pending}>Cancel</Button>
        <Feedback error={error} />
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <Feedback error={error} message={message} />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${alive.length} players still in`} className="min-h-12 text-lg" aria-label="Search players still in" />
      <ul className="grid gap-2 sm:grid-cols-2">
        {list.map((r) => (
          <li key={r.registrationId}>
            <button onClick={() => setSelected(r)} className="w-full rounded-xl border border-line bg-panel p-4 text-left text-lg hover:border-danger focus-visible:outline-2 focus-visible:outline-danger">
              {r.name}
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="p-4 text-sm text-mist">{alive.length ? "No one still in matches that search." : "No checked-in players are still in."}</li>}
      </ul>
    </div>
  );
}

