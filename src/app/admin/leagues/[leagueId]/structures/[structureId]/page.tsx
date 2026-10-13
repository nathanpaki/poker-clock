import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { blindStructures } from "@/db/schema";
import { SavedStructureForm } from "@/components/admin/structure-forms";
import { Badge, Section } from "@/components/ui";
import { AuthzError, requireLeagueAdmin } from "@/lib/auth";
import { id as idSchema, structureInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

export default async function EditStructurePage({ params }: { params: Promise<{ leagueId: string; structureId: string }> }) {
  const { leagueId, structureId } = await params;
  if (!idSchema.safeParse(leagueId).success || !idSchema.safeParse(structureId).success) notFound();
  try {
    await requireLeagueAdmin(leagueId);
  } catch (e) {
    if (e instanceof AuthzError) notFound();
    throw e;
  }
  // Scoped by league: another league's structure id is simply "not found".
  const s = await db.query.blindStructures.findFirst({ where: and(eq(blindStructures.id, structureId), eq(blindStructures.leagueId, leagueId)) });
  if (!s) notFound();
  const parsed = structureInput.safeParse(s.levels);
  return (
    <>
      <div>
        <Link href={`/admin/leagues/${leagueId}/structures`} className="text-sm text-mist hover:text-snow">Blind structures</Link>
        <h1 className="font-display text-4xl font-bold">
          {s.name} {s.isDefault && <Badge tone="amber">Default</Badge>}
        </h1>
      </div>
      <Section title="Levels">
        <SavedStructureForm
          leagueId={leagueId}
          structure={{ id: s.id, name: s.name, description: s.description, isDefault: s.isDefault }}
          initialLevels={parsed.success ? parsed.data : []}
        />
      </Section>
    </>
  );
}
