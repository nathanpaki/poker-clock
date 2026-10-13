import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, blindLevels, blindStructures, leagues, tournamentTimerState, venues as venuesTable } from "@/db/schema";
import { DuplicateTournamentForm, RosterTable, SettingsForm, StatusControls, TournamentStructureEditor } from "@/components/admin/tournament-forms";
import { DeclareWinnerButton } from "@/components/staff/declare-winner-button";
import { FinishingOrder } from "@/components/staff/finishing-order";
import { Badge, Empty, Section } from "@/components/ui";
import { AuthzError, getTournamentContext, resolveUserNames } from "@/lib/auth";
import { formatInZone, nextWeeklyLocal, toLocalInput } from "@/lib/format";
import { structureInput } from "@/lib/validation";
import { id as idSchema } from "@/lib/validation";
import { getRoster } from "@/server/queries";
import { publicTournamentUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

async function ctxOr404(id: string) {
  if (!idSchema.safeParse(id).success) notFound();
  try {
    return await getTournamentContext(id);
  } catch (e) {
    if (e instanceof AuthzError) notFound();
    throw e;
  }
}


export default async function TournamentAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await ctxOr404((await params).id);
  const { tournament: t, venue, perms } = ctx;
  const league = await db.query.leagues.findFirst({ where: eq(leagues.id, t.leagueId) });
  const [roster, levels, timer, logs] = await Promise.all([
    getRoster(t.id, t.leagueId),
    db.select().from(blindLevels).where(eq(blindLevels.tournamentId, t.id)).orderBy(asc(blindLevels.position)),
    db.query.tournamentTimerState.findFirst({ where: eq(tournamentTimerState.tournamentId, t.id) }),
    perms.manage
      ? db.select().from(auditLogs).where(and(eq(auditLogs.tournamentId, t.id), eq(auditLogs.leagueId, t.leagueId))).orderBy(desc(auditLogs.createdAt)).limit(60)
      : Promise.resolve([]),
  ]);
  const [savedStructures, leagueVenues] = perms.manage
    ? await Promise.all([
        db.select().from(blindStructures).where(eq(blindStructures.leagueId, t.leagueId)).orderBy(asc(blindStructures.name)),
        db.select().from(venuesTable).where(and(eq(venuesTable.leagueId, t.leagueId), eq(venuesTable.active, true))).orderBy(asc(venuesTable.name)),
      ])
    : [[], []];
  const saved = savedStructures.flatMap((x) => {
    const parsed = structureInput.safeParse(x.levels);
    return parsed.success ? [{ id: x.id, name: x.name, levels: parsed.data, isDefault: x.isDefault }] : [];
  });
  const names = await resolveUserNames([...roster.flatMap((r) => [r.checkIn?.by, r.elimination?.by]), ...logs.map((l) => l.actorUserId)]);
  const nm = (id: string | null | undefined) => (id ? names.get(id) ?? "staff" : "—");
  const pub = publicTournamentUrl(t.publicCode);
  const checkedIn = roster.filter((r) => r.checkIn).length;
  const out = roster.filter((r) => r.elimination).length;
  const open = t.status === "scheduled" || t.status === "running";
  const stillIn = roster.filter((r) => r.checkIn && !r.elimination);
  const winner = roster.find((r) => r.elimination?.isWinner);
  const finishers = roster
    .filter((r) => r.elimination?.position)
    .map((r) => ({ eliminationId: r.elimination!.id, name: r.name, position: r.elimination!.position!, at: r.elimination!.at, isWinner: r.elimination!.isWinner }));

  const rosterRows = [...roster]
    .sort((a, b) => (a.elimination?.position ?? 0) - (b.elimination?.position ?? 0) || a.name.localeCompare(b.name))
    .map((r) => ({
      registrationId: r.registrationId,
      name: r.name,
      checkIn: r.checkIn ? { at: r.checkIn.at, byName: nm(r.checkIn.by) } : null,
      elimination: r.elimination ? { ...r.elimination, byName: nm(r.elimination.by) } : null,
    }));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/admin/leagues/${t.leagueId}`} className="text-sm text-mist hover:text-snow">{league?.name}</Link>
          <h1 className="font-display text-4xl font-bold leading-tight">{t.name}</h1>
          <p className="text-mist">
            {venue.name}, {formatInZone(t.scheduledAt, venue.timezone, false)} <Badge tone={t.status === "running" ? "amber" : "muted"}>{t.status}</Badge>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/tournaments/${t.id}/control`} className="rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-ink">Staff controls</Link>
          <a href={`/tournament/${t.publicCode}`} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-4 py-2 text-sm hover:border-line-strong">Open TV display</a>
        </div>
      </div>

      {!pub.ok && (
        <p className="rounded-lg border border-amber/60 p-3 text-sm text-amber">
          The QR code is hidden because NEXT_PUBLIC_APP_URL isn&rsquo;t a public https address. Set it to your production domain so the QR doesn&rsquo;t point to localhost or a preview build.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Code", t.publicCode],
          ["Registered", roster.length],
          ["Checked in", checkedIn],
          winner ? ["Winner", winner.name] : ["Still in", checkedIn - out],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-panel p-4">
            <div className="text-xs text-mist">{k}</div>
            <div className="font-display text-3xl font-semibold tracking-wide">{v}</div>
          </div>
        ))}
      </div>

      {open && perms.eliminate && stillIn.length === 1 && checkedIn > 1 && (
        <DeclareWinnerButton tournamentId={t.id} registrationId={stillIn[0].registrationId} name={stillIn[0].name} />
      )}

      {perms.manage && <Section title="Tournament status"><StatusControls tournamentId={t.id} status={t.status} /></Section>}

      {perms.export && (
        <Section title="Export check-ins and bust-outs">
          <p className="mb-3 text-sm text-mist">Times are in {venue.timezone}. Every download is recorded in the audit log.</p>
          <div className="flex flex-wrap gap-2">
            <a className="rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-ink" href={`/api/exports/tournament/${t.id}?format=xlsx`}>Download Excel</a>
            <a className="rounded-lg border border-line px-4 py-2 text-sm" href={`/api/exports/tournament/${t.id}?format=csv`}>Download CSV</a>
            <a className="rounded-lg border border-line px-4 py-2 text-sm" href={`/api/exports/tournament/${t.id}?format=xlsx&history=1`}>Excel with corrections</a>
          </div>
        </Section>
      )}

      {perms.eliminate && finishers.length > 0 && (
        <Section title="Finishing order">
          <p className="mb-3 text-sm text-mist">
            Fix the order with ▲ ▼ or Move. Recorded bust times don&rsquo;t change, and every move is logged.{!open && " To undo a bust or the winner, reopen the tournament first."}
          </p>
          <FinishingOrder tournamentId={t.id} entries={finishers} checkedIn={checkedIn} timezone={venue.timezone} canUndo={open} />
        </Section>
      )}

      <Section title="Players">
        {rosterRows.length ? (
          <RosterTable tournamentId={t.id} rows={rosterRows} timezone={venue.timezone} canCorrect={perms.eliminate} canUndoCheckIn={perms.check_in} />
        ) : (
          <Empty>No one is registered yet. Use staff controls to register and check players in.</Empty>
        )}
      </Section>

      {perms.manage && (
        <>
          <Section title="Copy for another week">
            <div id="copy" className="scroll-mt-24">
              <DuplicateTournamentForm
                tournamentId={t.id}
                defaultName={t.name}
                defaultWhen={nextWeeklyLocal(t.scheduledAt, venue.timezone)}
                venueId={leagueVenues.some((v) => v.id === t.venueId) ? t.venueId : leagueVenues[0]?.id ?? t.venueId}
                venues={leagueVenues.map((v) => ({ id: v.id, name: v.name }))}
                registeredCount={roster.length}
              />
            </div>
          </Section>
          <Section
            title="Blind structure"
            actions={<Link href={`/admin/leagues/${t.leagueId}/structures`} className="text-sm text-mist hover:text-snow">Saved structures</Link>}
          >
            <TournamentStructureEditor
              tournamentId={t.id}
              tournamentName={t.name}
              saved={saved}
              currentIndex={timer?.status === "not_started" ? -1 : timer?.levelIndex ?? -1}
              initial={levels.map((l) => ({ kind: l.kind, smallBlind: l.smallBlind, bigBlind: l.bigBlind, ante: l.ante, durationMin: l.durationSec / 60 }))}
            />
          </Section>
          <Section title="Settings">
            <SettingsForm
              t={{
                id: t.id,
                name: t.name,
                scheduledAt: toLocalInput(t.scheduledAt, venue.timezone),
                maxEntrants: t.maxEntrants,
                startingStack: t.startingStack,
                anteEnabled: t.anteEnabled,
                showEliminationsPublic: t.showEliminationsPublic,
                breakAlertsEnabled: t.breakAlertsEnabled,
              }}
            />
          </Section>
          <Section title="Activity">
            {logs.length ? (
              <ul className="divide-y divide-line text-sm">
                {logs.map((l) => (
                  <li key={l.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span><span className="text-snow">{l.action}</span> <span className="text-mist">by {nm(l.actorUserId)}</span></span>
                    <span className="text-mist">{formatInZone(l.createdAt, venue.timezone)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No activity yet.</Empty>
            )}
          </Section>
        </>
      )}
    </>
  );
}
