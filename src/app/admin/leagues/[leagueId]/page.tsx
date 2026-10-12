import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leagueMemberships, leagues, venueMemberships, venues } from "@/db/schema";
import { AddMemberForm, BulkExportForm, CreateTournamentForm, LeagueSettingsForm, MemberAccess, VenueCreateForm, VenueRow } from "@/components/admin/league-forms";
import { Badge, Empty, Section } from "@/components/ui";
import { getLeagueRole, requireUserId, resolveUserNames } from "@/lib/auth";
import { formatInZone } from "@/lib/format";
import { id as idSchema } from "@/lib/validation";
import { tournamentsForUser } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function LeaguePage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  if (!idSchema.safeParse(leagueId).success) notFound();
  const userId = await requireUserId();
  const role = await getLeagueRole(userId, leagueId);
  if (!role) notFound(); // same response as a missing league — no probing other leagues
  const isAdmin = role === "admin" || role === "platform";

  const league = await db.query.leagues.findFirst({ where: eq(leagues.id, leagueId) });
  if (!league) notFound();
  const venueRows = await db.select().from(venues).where(eq(venues.leagueId, leagueId)).orderBy(asc(venues.name));
  const tlist = await tournamentsForUser(userId, leagueId, isAdmin);
  const active = tlist.filter((r) => r.t.status === "scheduled" || r.t.status === "running");
  const done = tlist.filter((r) => r.t.status === "completed" || r.t.status === "cancelled");
  const myVenueAccess = isAdmin
    ? null
    : await db.select().from(venueMemberships).where(and(eq(venueMemberships.leagueId, leagueId), eq(venueMemberships.userId, userId)));
  const canManagePlayers = isAdmin || !!myVenueAccess?.some((v) => v.canManagePlayers);

  let members: { userId: string; role: "admin" | "staff"; name: string }[] = [];
  let accessByUser: Record<string, Record<string, (typeof venueMemberships.$inferSelect) | undefined>> = {};
  if (isAdmin) {
    const ms = await db.select().from(leagueMemberships).where(eq(leagueMemberships.leagueId, leagueId));
    const names = await resolveUserNames(ms.map((m) => m.userId));
    members = ms.map((m) => ({ userId: m.userId, role: m.role, name: names.get(m.userId) ?? m.userId }));
    const vms = await db.select().from(venueMemberships).where(eq(venueMemberships.leagueId, leagueId));
    accessByUser = {};
    for (const vm of vms) (accessByUser[vm.userId] ??= {})[vm.venueId] = vm;
  }

  const row = (r: (typeof tlist)[number]) => {
    const tz = venueRows.find((v) => v.id === r.t.venueId)?.timezone ?? league.defaultTimezone;
    return (
      <li key={r.t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
        <Link href={`/admin/tournaments/${r.t.id}`} className="hover:text-amber">
          <span className="font-medium">{r.t.name}</span> <span className="text-mist">at {r.venueName}</span>
        </Link>
        <span className="flex items-center gap-2 text-sm text-mist">
          {formatInZone(r.t.scheduledAt, tz, false)}
          <Badge tone={r.t.status === "running" ? "amber" : r.t.status === "completed" ? "ok" : "muted"}>{r.t.status}</Badge>
        </span>
      </li>
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-4xl font-bold">{league.name}</h1>
        {canManagePlayers && <Link href={`/admin/leagues/${leagueId}/players`} className="rounded-lg border border-line px-4 py-2 text-sm hover:border-line-strong">Player list</Link>}
      </div>

      <Section title="Current and upcoming">{active.length ? <ul className="divide-y divide-line">{active.map(row)}</ul> : <Empty>No upcoming tournaments{isAdmin ? ". Create one below." : " at your venues."}</Empty>}</Section>

      {isAdmin && (
        <>
          <Section title="New tournament">
            {venueRows.some((v) => v.active) ? (
              <CreateTournamentForm
                leagueId={leagueId}
                venues={venueRows}
                past={tlist.slice(0, 25).map((r) => ({ id: r.t.id, label: `${r.t.name} (${formatInZone(r.t.scheduledAt, league.defaultTimezone, false).slice(0, 10)})` }))}
              />
            ) : (
              <Empty>Add a venue first.</Empty>
            )}
          </Section>
          <Section title="Venues">
            <ul className="mb-4 divide-y divide-line">{venueRows.map((v) => <VenueRow key={v.id} leagueId={leagueId} venue={v} />)}</ul>
            <VenueCreateForm leagueId={leagueId} defaultTimezone={league.defaultTimezone} />
          </Section>
          <Section title="Staff and permissions">
            <ul className="mb-4 divide-y divide-line">
              {members.map((m) => <MemberAccess key={m.userId} leagueId={leagueId} member={m} venues={venueRows.filter((v) => v.active)} access={accessByUser[m.userId] ?? {}} />)}
            </ul>
            <AddMemberForm leagueId={leagueId} />
          </Section>
          <Section title="Export check-ins and bust-outs">
            <p className="mb-3 text-sm text-mist">Downloads one file per tournament in the date range, bundled as a ZIP.</p>
            <BulkExportForm leagueId={leagueId} />
          </Section>
          <Section title="League settings"><LeagueSettingsForm league={league} /></Section>
        </>
      )}

      <Section title="History">{done.length ? <ul className="divide-y divide-line">{done.map(row)}</ul> : <Empty>Completed tournaments will appear here.</Empty>}</Section>
    </>
  );
}

