"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { clockAction, type ClockInput } from "@/actions/clock";
import { checkIn, checkInExisting, declareWinner, eliminate, quickAddPlayer, registerPlayers } from "@/actions/roster";
import { ClockDisplay } from "@/components/clock/clock-display";
import { useTournamentClock } from "@/components/clock/use-tournament-clock";
import { Button, Input } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { Feedback, useAction } from "@/components/ui/use-action";
import { ordinal } from "@/lib/format";
import type { PublicSnapshot } from "@/server/tournament-state";
import { FinishingOrder } from "./finishing-order";
import { HoldButton } from "./hold-button";

type Entry = {
  registrationId: string;
  name: string;
  checkedInAt: number | null;
  eliminated: boolean;
  elimination: { id: string; position: number | null; at: number; isWinner: boolean } | null;
};
type Perms = { clock: boolean; check_in: boolean; eliminate: boolean; managePlayers: boolean };
type Sheet = null | "checkin" | "out" | "clock";

/**
 * Staff screen for a tablet: the full clock, with Check in / I'm out buttons
 * in the top-right corner. Each opens a pop-up; finishing the action closes it
 * and shows a short confirmation on the clock.
 */
export function StaffConsole({
  tournamentId,
  code,
  initial,
  qrSvg,
  perms,
  roster,
  unregistered,
  timezone,
  closed,
}: {
  tournamentId: string;
  code: string;
  initial: PublicSnapshot;
  qrSvg: string | null;
  perms: Perms;
  roster: Entry[];
  unregistered: { id: string; name: string }[];
  timezone: string;
  closed: boolean;
}) {
  const clock = useTournamentClock(code, initial);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState<string | null>(null);
  const close = useCallback(() => setSheet(null), []);
  const done = useCallback(
    (msg: string) => {
      setSheet(null);
      setToast(msg);
      void clock.refresh();
    },
    [clock],
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const stillIn = roster.filter((r) => r.checkedInAt && !r.eliminated).length;
  const waiting = roster.filter((r) => !r.checkedInAt).length;
  const big = "inline-flex min-h-14 items-center justify-center whitespace-nowrap rounded-xl px-6 font-display text-2xl font-semibold shadow-lg transition active:scale-[0.97]";

  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Link href={`/admin/tournaments/${tournamentId}`} className="px-2 py-3 text-sm text-mist underline-offset-4 hover:text-snow hover:underline">
        Exit
      </Link>
      {perms.clock && (
        <button type="button" onClick={() => setSheet("clock")} className={`${big} border border-line bg-bar px-4 text-snow`} aria-label="Clock controls">
          Clock
        </button>
      )}
      {perms.check_in && (
        <button type="button" onClick={() => setSheet("checkin")} disabled={closed} className={`${big} bg-amber text-ink disabled:opacity-40`}>
          Check in{waiting > 0 && <span className="ml-2 rounded-md bg-ink/20 px-1.5 text-lg">{waiting}</span>}
        </button>
      )}
      {perms.eliminate && (
        <button type="button" onClick={() => setSheet("out")} className={`${big} bg-danger text-white`}>
          I&rsquo;m out{stillIn > 0 && !closed && <span className="ml-2 rounded-md bg-black/20 px-1.5 text-lg">{stillIn}</span>}
        </button>
      )}
    </div>
  );

  return (
    // Covers the admin header so the clock gets the whole tablet screen.
    <div className="fixed inset-0 z-40 overflow-y-auto bg-ink lg:p-[1.2vh]">
      <ClockDisplay code={code} clock={clock} qrSvg={qrSvg} headerActions={actions} playsAudio />
      {closed && (
        <p className="fixed left-1/2 top-24 z-40 -translate-x-1/2 rounded-lg border border-amber/60 bg-ink px-4 py-2 text-sm text-amber">
          Tournament closed. Reopen it from the details page to make changes.
        </p>
      )}
      {toast && (
        <div role="status" className="fixed left-1/2 top-24 z-50 -translate-x-1/2 rounded-xl border border-emerald-500/50 bg-ink px-6 py-3 font-display text-2xl text-emerald-300 shadow-2xl motion-safe:animate-[pc-pop_180ms_ease-out]">
          {toast}
        </div>
      )}

      <Modal open={sheet === "checkin"} onClose={close} title="Check in">
        <CheckInSheet tournamentId={tournamentId} roster={roster} unregistered={unregistered} canQuickAdd={perms.managePlayers} onDone={done} />
      </Modal>
      <OutSheet open={sheet === "out"} onClose={close} tournamentId={tournamentId} roster={roster} timezone={timezone} closed={closed} onDone={done} refresh={clock.refresh} />
      <Modal open={sheet === "clock"} onClose={close} title="Clock">
        <ClockControls tournamentId={tournamentId} status={clock.effective.status} onBreak={clock.view.onBreak} onDone={done} />
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ Check in */

function CheckInSheet({
  tournamentId,
  roster,
  unregistered,
  canQuickAdd,
  onDone,
}: {
  tournamentId: string;
  roster: Entry[];
  unregistered: { id: string; name: string }[];
  canQuickAdd: boolean;
  onDone: (msg: string) => void;
}) {
  const { exec, pending, error, conflict, clear } = useAction();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const term = q.trim().toLowerCase();
  const match = (n: string) => n.toLowerCase().includes(term);
  const waiting = roster.filter((r) => !r.checkedInAt && match(r.name));
  const others = term ? unregistered.filter((p) => match(p.name)).slice(0, 12) : [];
  const exact = [...roster.map((r) => r.name), ...unregistered.map((p) => p.name)].some((n) => n.toLowerCase() === term);
  const checkedIn = roster.filter((r) => r.checkedInAt).length;

  function go<T>(key: string, fn: () => Promise<{ ok: true; data?: T } | { ok: false; error: string }>, msg: string) {
    setBusy(key);
    exec(fn, { onSuccess: () => onDone(msg) });
  }
  const nameBtn = "flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-line bg-ink px-4 text-left text-xl hover:border-amber disabled:opacity-50";

  return (
    <div className="flex flex-col gap-4">
      <Input
        data-autofocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (conflict) clear();
        }}
        placeholder="Type a name"
        className="min-h-14 text-xl"
        aria-label="Search players"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {conflict ? (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber/60 bg-amber/5 p-4">
          <p className="text-lg">{error}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(conflict.kind === "exact" ? [conflict.player] : conflict.players).map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={pending}
                className="min-h-14 rounded-xl bg-amber px-4 text-left font-display text-xl font-semibold text-ink disabled:opacity-50"
                onClick={() => go(p.id, () => checkInExisting({ tournamentId, playerId: p.id }), `${p.name} checked in`)}
              >
                {p.active ? `Check in ${p.name}` : `Reactivate and check in ${p.name}`}
              </button>
            ))}
            {conflict.kind === "similar" && (
              <button
                type="button"
                disabled={pending}
                className="min-h-14 rounded-xl border border-line px-4 text-left text-lg disabled:opacity-50"
                onClick={() => go("new", () => quickAddPlayer({ tournamentId, displayName: q.trim(), checkInNow: true, allowSimilar: true }), `${q.trim()} added and checked in`)}
              >
                No, add &ldquo;{q.trim()}&rdquo; as a different person
              </button>
            )}
          </div>
        </div>
      ) : (
        <Feedback error={error} />
      )}

      <section>
        <h3 className="mb-2 text-sm text-mist">Registered, not checked in yet · tap to check in</h3>
        {waiting.length ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {waiting.map((r) => (
              <li key={r.registrationId}>
                <button type="button" disabled={pending} className={nameBtn} onClick={() => go(r.registrationId, () => checkIn({ tournamentId, registrationId: r.registrationId }), `${r.name} checked in`)}>
                  <span className="truncate">{r.name}</span>
                  <span className="shrink-0 text-base text-amber">{busy === r.registrationId && pending ? "Saving…" : "Check in"}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-line p-4 text-mist">{term ? "No registered player matches." : "Everyone registered is checked in."}</p>
        )}
      </section>

      {others.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm text-mist">Other league players · tap to register and check in</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {others.map((p) => (
              <li key={p.id}>
                <button type="button" disabled={pending} className={nameBtn} onClick={() => go(p.id, () => registerPlayers({ tournamentId, playerIds: [p.id], checkInNow: true }), `${p.name} registered and checked in`)}>
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 text-base text-mist">{busy === p.id && pending ? "Saving…" : "Register"}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canQuickAdd && term.length > 1 && !exact && (
        <button
          type="button"
          disabled={pending}
          className="min-h-14 rounded-xl border border-dashed border-amber/70 px-4 text-left text-lg text-amber disabled:opacity-50"
          onClick={() => go("new", () => quickAddPlayer({ tournamentId, displayName: q.trim(), checkInNow: true }), `${q.trim()} added and checked in`)}
        >
          + Add &ldquo;{q.trim()}&rdquo; as a new player and check in
        </button>
      )}
      <p className="text-sm text-mist">{checkedIn} checked in so far.</p>
    </div>
  );
}

/* ------------------------------------------------------------------- I'm out */

function OutSheet({
  open,
  onClose,
  tournamentId,
  roster,
  timezone,
  closed,
  onDone,
  refresh,
}: {
  open: boolean;
  onClose: () => void;
  tournamentId: string;
  roster: Entry[];
  timezone: string;
  closed: boolean;
  onDone: (msg: string) => void;
  refresh: () => Promise<void>;
}) {
  const { exec, pending, error, setError } = useAction();
  const [selected, setSelected] = useState<Entry | null>(null);
  const [view, setView] = useState<"names" | "order">("names");
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!open) {
      setSelected(null);
      setView("names");
      setQ("");
      setError(null);
    }
  }, [open, setError]);

  const alive = useMemo(() => roster.filter((r) => r.checkedInAt && !r.eliminated).sort((a, b) => a.name.localeCompare(b.name)), [roster]);
  const shown = q.trim() ? alive.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase())) : alive;
  const checkedIn = roster.filter((r) => r.checkedInAt).length;
  const winner = roster.find((r) => r.elimination?.isWinner);
  const finishers = roster
    .filter((r) => r.elimination?.position)
    .map((r) => ({ eliminationId: r.elimination!.id, name: r.name, position: r.elimination!.position!, at: r.elimination!.at, isWinner: r.elimination!.isWinner }));

  const title = selected ? "Confirm" : view === "order" ? "Finishing order" : winner ? "Result" : alive.length === 1 ? "Last player" : "Who's out?";
  const toggle =
    !selected && finishers.length > 0 ? (
      <button type="button" onClick={() => setView(view === "order" ? "names" : "order")} className="min-h-12 rounded-xl border border-line px-4 text-base text-mist hover:text-snow">
        {view === "order" ? "Back to names" : "Finishing order"}
      </button>
    ) : null;

  let body;
  if (view === "order") {
    body = (
      <>
        <p className="mb-3 text-sm text-mist">Wrong order? Use ▲ ▼ or Move to. Bust times stay as recorded.</p>
        <FinishingOrder tournamentId={tournamentId} entries={finishers} checkedIn={checkedIn} timezone={timezone} canUndo={!closed} onChanged={() => void refresh()} />
      </>
    );
  } else if (winner) {
    body = (
      <div className="rounded-xl border-2 border-amber p-6 text-center">
        <p className="font-display text-2xl text-amber">Winner</p>
        <p className="font-display text-6xl font-bold">{winner.name}</p>
        <p className="mt-2 text-mist">The tournament is closed and the clock is stopped.</p>
      </div>
    );
  } else if (selected) {
    body = (
      <div className="flex flex-col gap-5 py-2">
        <p className="text-center font-display text-6xl font-bold">{selected.name}</p>
        <p className="text-center text-mist">They finish {ordinal(alive.length)}.</p>
        <HoldButton
          label={`Hold to confirm ${selected.name} is out`}
          disabled={pending}
          onConfirm={() =>
            exec(() => eliminate({ tournamentId, registrationId: selected.registrationId }), {
              onSuccess: (d) => onDone(`${selected.name} is out${d?.position ? ` in ${ordinal(d.position)}` : ""}`),
            })
          }
        />
        <Feedback error={error} />
        <Button className="min-h-14 text-lg" onClick={() => setSelected(null)} disabled={pending}>
          Not them, go back
        </Button>
      </div>
    );
  } else if (alive.length === 1 && !closed) {
    const last = alive[0];
    body = (
      <div className="flex flex-col gap-5 py-2">
        <p className="text-center text-mist">Last player standing</p>
        <p className="text-center font-display text-6xl font-bold">{last.name}</p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            confirm(`Declare ${last.name} the winner? This finishes them 1st, stops the clock and closes the tournament.`) &&
            exec(() => declareWinner({ tournamentId, registrationId: last.registrationId }), { onSuccess: () => onDone(`${last.name} wins!`) })
          }
          className="min-h-16 rounded-xl bg-amber px-6 font-display text-3xl font-bold text-ink disabled:opacity-50"
        >
          {pending ? "Saving…" : `Declare ${last.name} the winner`}
        </button>
        <Feedback error={error} />
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3">
        {alive.length > 12 && (
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${alive.length} players`} className="min-h-12 text-lg" aria-label="Filter players still in" />
        )}
        {shown.length ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {shown.map((r) => (
              <li key={r.registrationId}>
                <button
                  type="button"
                  disabled={closed}
                  onClick={() => setSelected(r)}
                  className="flex min-h-20 w-full items-center justify-center rounded-xl border border-line bg-ink px-3 text-center font-display text-2xl leading-tight hover:border-danger focus-visible:outline-2 focus-visible:outline-danger disabled:opacity-50"
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-line p-4 text-mist">{alive.length ? "No one still in matches." : "No checked-in players are still in."}</p>
        )}
      </div>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={title} tone={selected ? "danger" : "default"} actions={toggle}>
      {body}
    </Modal>
  );
}

/* --------------------------------------------------------------------- Clock */

function ClockControls({ tournamentId, status, onBreak, onDone }: { tournamentId: string; status: string; onBreak: boolean; onDone: (msg: string) => void }) {
  const { exec, pending, error } = useAction();
  const [step, setStep] = useState(1);
  const [breakMin, setBreakMin] = useState(10);
  const send = (input: ClockInput, msg: string) => exec(() => clockAction(tournamentId, input), { onSuccess: () => onDone(msg), refresh: false });
  const big = "min-h-16 text-xl font-display";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {status === "not_started" && <Button variant="primary" className={`${big} col-span-2`} disabled={pending} onClick={() => send({ op: "start" }, "Clock started")}>Start clock</Button>}
        {status === "running" && <Button variant="primary" className={`${big} col-span-2`} disabled={pending} onClick={() => send({ op: "pause" }, "Clock paused")}>Pause</Button>}
        {status === "paused" && <Button variant="primary" className={`${big} col-span-2`} disabled={pending} onClick={() => send({ op: "resume" }, "Clock running")}>Resume</Button>}
        {status === "break" && <Button variant="primary" className={`${big} col-span-2`} disabled={pending} onClick={() => send({ op: "end_break" }, "Break over")}>End break</Button>}
        {status === "finished" && <div className="col-span-2 grid min-h-16 place-items-center rounded-lg border border-amber/60 text-amber">End of structure</div>}
        <Button className={big} disabled={pending} onClick={() => send({ op: "previous_level" }, "Previous level")}>Previous level</Button>
        <Button className={big} disabled={pending} onClick={() => send({ op: "next_level" }, "Next level")}>Next level</Button>
      </div>

      <div className="rounded-xl border border-line bg-ink p-3">
        <div className="mb-2 flex items-center justify-between text-sm text-mist">
          <span>Adjust time</span>
          <span className="flex gap-1" role="radiogroup" aria-label="Minutes">
            {[1, 5, 10].map((m) => (
              <button key={m} role="radio" aria-checked={step === m} onClick={() => setStep(m)} className={`min-h-11 rounded-md px-4 ${step === m ? "bg-amber text-ink" : "border border-line"}`}>
                {m} min
              </button>
            ))}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button className={big} disabled={pending} onClick={() => send({ op: "adjust", minutes: -step }, `${step} min removed`)}>− {step} min</Button>
          <Button className={big} disabled={pending} onClick={() => send({ op: "adjust", minutes: step }, `${step} min added`)}>+ {step} min</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {onBreak && status !== "break" ? (
          <Button className={big} disabled={pending} onClick={() => send({ op: "end_break" }, "Break over")}>End scheduled break</Button>
        ) : (
          <div className="flex gap-2">
            <Input type="number" min={1} max={120} value={breakMin} onChange={(e) => setBreakMin(Number(e.target.value))} className="w-20 text-lg" aria-label="Break minutes" />
            <Button className={`${big} flex-1`} disabled={pending || status === "break"} onClick={() => send({ op: "start_break", minutes: breakMin }, `${breakMin}-minute break started`)}>Start break</Button>
          </div>
        )}
        <Button className={big} disabled={pending} onClick={() => confirm("Reset this level to its full time?") && send({ op: "reset_level" }, "Level reset")}>Reset level</Button>
      </div>

      <Button
        variant="ghost"
        className="self-start"
        disabled={pending}
        onClick={() => {
          const v = prompt("Restart the clock from level 1? Players and eliminations are kept. Type RESTART to confirm.");
          if (v === "RESTART") send({ op: "restart", confirm: "RESTART" }, "Clock restarted");
        }}
      >
        Restart tournament clock
      </Button>
      <Feedback error={error} />
    </div>
  );
}
