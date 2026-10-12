import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, blindLevels, leagues, tournamentTimerState } from "@/db/schema";
import { RosterTable, SettingsForm, StatusControls, StructureEditor } from "@/components/admin/tournament-forms";
import { Badge, Empty, Section } from "@/components/ui";
import { AuthzError, getTournamentContext, resolveUserNames } from "@/lib/auth";
import { formatInZone } from "@/lib/format";
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

/** "2026-10-09T19:00" for datetime-local inputs, in the venue's zone. */
const toLocalInput = (d: Date, tz: string) => formatInZone(d, tz, false).replace(" ", "T");

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
  const names = await resolveUserNames([...roster.flatMap((r) => [r.checkIn?.by, r.elimination?.by]), ...logs.map((l) => l.actorUserId)]);
  const nm = (id: string | null | undefined) => (id ? names.get(id) ?? "staff" : "—");
  const pub = publicTournamentUrl(t.publicCode);
  const checkedIn = roster.filter((r) => r.checkIn).length;
  const out = roster.filter((r) => r.elimination).length;

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
          ["Still in", checkedIn - out],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-panel p-4">
            <div className="text-xs text-mist">{k}</div>
            <div className="font-display text-3xl font-semibold tracking-wide">{v}</div>
          </div>
        ))}
      </div>

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

      <Section title="Players">
        {rosterRows.length ? (
          <RosterTable tournamentId={t.id} rows={rosterRows} timezone={venue.timezone} canCorrect={perms.eliminate} canUndoCheckIn={perms.check_in} />
        ) : (
          <Empty>No one is registered yet. Use staff controls to register and check players in.</Empty>
        )}
      </Section>

      {perms.manage && (
        <>
          <Section title="Blind structure">
            <StructureEditor
              tournamentId={t.id}
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
