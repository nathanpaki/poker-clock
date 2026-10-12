import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { leagues, players } from "@/db/schema";
import { PlayerCreateForm, PlayerRow } from "@/components/admin/player-forms";
import { Empty, Input, Section } from "@/components/ui";
import { AuthzError, requirePlayerManager } from "@/lib/auth";
import { id as idSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export default async function PlayersPage({ params, searchParams }: { params: Promise<{ leagueId: string }>; searchParams: Promise<{ q?: string; inactive?: string }> }) {
  const { leagueId } = await params;
  const { q = "", inactive } = await searchParams;
  if (!idSchema.safeParse(leagueId).success) notFound();
  try {
    await requirePlayerManager(leagueId);
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

  return (
    <>
      <div>
        <Link href={`/admin/leagues/${leagueId}`} className="text-sm text-mist hover:text-snow">{league.name}</Link>
        <h1 className="font-display text-4xl font-bold">Players</h1>
      </div>
      <Section title="Add a player"><PlayerCreateForm leagueId={leagueId} /></Section>
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
