import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, count, eq, ilike, max } from "drizzle-orm";
import { db } from "@/db";
import { leagues, players, tournamentRegistrations, tournaments } from "@/db/schema";
import { MergeGroup, PlayerCreateForm, PlayerRow } from "@/components/admin/player-forms";
import { Empty, Input, Section } from "@/components/ui";
import { AuthzError, getLeagueRole, requirePlayerManager } from "@/lib/auth";
import { formatInZone } from "@/lib/format";
import { namesAreSimilar } from "@/lib/names";
import { uniqueNameRuleActive } from "@/server/name-rule";
import { id as idSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export default async function PlayersPage({ params, searchParams }: { params: Promise<{ leagueId: string }>; searchParams: Promise<{ q?: string; inactive?: string }> }) {
  const { leagueId } = await params;
  const { q = "", inactive } = await searchParams;
  if (!idSchema.safeParse(leagueId).success) notFound();
  let isAdmin = false;
  try {
    const { userId } = await requirePlayerManager(leagueId);
    const role = await getLeagueRole(userId, leagueId);
    isAdmin = role === "admin" || role === "platform";
  } catch (e) {
    if (e instanceof AuthzError) notFound();
    throw e;
  }
  const league = await db.query.leagues.findFirst({ where: eq(leagues.id, leagueId) });
  if (!league) notFound();
  const term = q.trim().slice(0, 80).replace(/[%_\\]/g, (m) => `\\${m}`);
  // Always scoped to this league — there is no global player directory.
  const rows = await db
    .select()
    .from(players)
    .where(and(eq(players.leagueId, leagueId), inactive ? undefined : eq(players.active, true), term ? ilike(players.displayName, `%${term}%`) : undefined))
    .orderBy(asc(players.displayName))
    .limit(500);

  // Possible duplicates (league admins merge them). All players incl. inactive.
  let groups: { label: string; records: Parameters<typeof MergeGroup>[0]["records"] }[] = [];
  let ruleOn = true;
  if (isAdmin) {
    const [all, stats, on] = await Promise.all([
      db.select().from(players).where(eq(players.leagueId, leagueId)).orderBy(asc(players.createdAt)).limit(3000),
      db
        .select({ playerId: tournamentRegistrations.playerId, n: count(), last: max(tournaments.scheduledAt) })
        .from(tournamentRegistrations)
        .innerJoin(tournaments, and(eq(tournaments.id, tournamentRegistrations.tournamentId), eq(tournaments.leagueId, tournamentRegistrations.leagueId)))
        .where(eq(tournamentRegistrations.leagueId, leagueId))
        .groupBy(tournamentRegistrations.playerId),
      uniqueNameRuleActive(db),
    ]);
    ruleOn = on;
    const rec = (p: (typeof all)[number]) => {
      const st = stats.find((x) => x.playerId === p.id);
      return { id: p.id, name: p.displayName, active: p.active, email: p.email, phone: p.phone, tournaments: Number(st?.n ?? 0), lastPlayed: st?.last ? formatInZone(st.last, league.defaultTimezone, false).slice(0, 10) : null };
    };
    const byKey = new Map<string, typeof all>();
    for (const p of all) byKey.set(p.nameKey, [...(byKey.get(p.nameKey) ?? []), p]);
    for (const list of byKey.values()) if (list.length > 1) groups.push({ label: "Same name: these must be merged before duplicate protection can be switched on", records: list.map(rec) });
    const keys = [...byKey.keys()];
    const pairs: string[][] = [];
    for (let i = 0; i < keys.length && pairs.length < 30; i++)
      for (let j = i + 1; j < keys.length && pairs.length < 30; j++) if (namesAreSimilar(keys[i], keys[j])) pairs.push([keys[i], keys[j]]);
    for (const [a, b] of pairs) groups.push({ label: "Similar names: merge only if this is the same person", records: [...byKey.get(a)!, ...byKey.get(b)!].map(rec) });
  }
  const exactGroups = groups.filter((g) => g.label.startsWith("Same name")).length;

  return (
    <>
      <div>
        <Link href={`/admin/leagues/${leagueId}`} className="text-sm text-mist hover:text-snow">{league.name}</Link>
        <h1 className="font-display text-4xl font-bold">Players</h1>
      </div>
      <Section title="Add a player"><PlayerCreateForm leagueId={leagueId} /></Section>
      {isAdmin && (groups.length > 0 || !ruleOn) && (
        <Section title="Possible duplicates">
          <p className={`mb-3 text-sm ${ruleOn ? "text-mist" : "text-amber"}`}>
            {ruleOn
              ? "Duplicate protection is on: the database won't accept two players with the same name in this league. Similar names below are allowed but worth checking."
              : exactGroups
                ? `Duplicate protection is waiting on ${exactGroups} name${exactGroups === 1 ? "" : "s"} below. Merge them (in every league), then run: npx tsx scripts/enforce-unique-names.ts`
                : "No same-name duplicates left in this league. Once every league is clear, run: npx tsx scripts/enforce-unique-names.ts"}
          </p>
          {groups.length ? (
            <ul className="flex flex-col gap-3">
              {groups.map((g) => (
                <MergeGroup key={g.records.map((r) => r.id).join()} leagueId={leagueId} records={g.records} label={g.label} />
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-xs text-mist">Merging moves every tournament, check-in and result to the record you keep, fills in missing contact details, and removes the extra record. It&rsquo;s logged, and it&rsquo;s refused if both records played the same tournament.</p>
        </Section>
      )}
      <Section title={`${rows.length} player${rows.length === 1 ? "" : "s"}`}>
        <form className="mb-4 flex flex-wrap items-center gap-3">
          <Input name="q" defaultValue={q} placeholder="Search by name" className="max-w-xs" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="inactive" value="1" defaultChecked={!!inactive} className="h-4 w-4 accent-amber" />Show inactive</label>
          <button className="rounded-lg border border-line px-4 py-2 text-sm">Search</button>
        </form>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-mist"><tr><th className="py-1 font-normal">Name</th><th className="hidden font-normal sm:table-cell">Email</th><th className="hidden font-normal sm:table-cell">Phone</th><th /></tr></thead>
              <tbody>{rows.map((p) => <PlayerRow key={p.id} leagueId={leagueId} player={p} />)}</tbody>
            </table>
          </div>
        ) : (
          <Empty>{q ? "No players match that search." : "No players yet. Add the first one above."}</Empty>
        )}
      </Section>
    </>
  );
}
