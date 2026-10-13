import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { blindStructures, leagues } from "@/db/schema";
import { StructureRowActions } from "@/components/admin/structure-forms";
import { Badge, Empty, Section } from "@/components/ui";
import { AuthzError, requireLeagueAdmin } from "@/lib/auth";
import { summarizeStructure } from "@/lib/blind-file";
import { id as idSchema, structureInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

export default async function StructuresPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  if (!idSchema.safeParse(leagueId).success) notFound();
  try {
    await requireLeagueAdmin(leagueId);
  } catch (e) {
    if (e instanceof AuthzError) notFound();
    throw e;
  }
  const league = await db.query.leagues.findFirst({ where: eq(leagues.id, leagueId) });
  if (!league) notFound();
  const rows = await db.select().from(blindStructures).where(eq(blindStructures.leagueId, leagueId)).orderBy(asc(blindStructures.name));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/admin/leagues/${leagueId}`} className="text-sm text-mist hover:text-snow">{league.name}</Link>
          <h1 className="font-display text-4xl font-bold">Blind structures</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/leagues/${leagueId}/structures/new`} className="rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-ink">New structure</Link>
          <Link href={`/admin/leagues/${leagueId}/structures/new?start=blank`} className="rounded-lg border border-line px-4 py-2 text-sm hover:border-line-strong">Import from file</Link>
        </div>
      </div>
      <p className="text-mist">
        Saved structures are offered when you create a tournament, and the default is picked automatically. Each tournament keeps its own copy, so editing or deleting a structure here never changes past tournaments.
      </p>
      <Section title={`${rows.length} saved`}>
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const parsed = structureInput.safeParse(r.levels);
              const levels = parsed.success ? parsed.data : [];
              return (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link href={`/admin/leagues/${leagueId}/structures/${r.id}`} className="font-display text-2xl hover:text-amber">{r.name}</Link>{" "}
                    {r.isDefault && <Badge tone="amber">Default</Badge>}
                    <p className="text-sm text-mist">{summarizeStructure(levels)}{r.description ? ` · ${r.description}` : ""}</p>
                  </div>
                  <StructureRowActions leagueId={leagueId} structure={{ id: r.id, name: r.name, description: r.description, isDefault: r.isDefault, levels }} />
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>No saved structures yet. Create one, import a CSV, or open any tournament and use &ldquo;Save as structure&rdquo;.</Empty>
        )}
      </Section>
    </>
  );
}
