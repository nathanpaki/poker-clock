import Link from "next/link";
import { notFound } from "next/navigation";
import { SavedStructureForm } from "@/components/admin/structure-forms";
import { Section } from "@/components/ui";
import { AuthzError, requireLeagueAdmin } from "@/lib/auth";
import { DEFAULT_STRUCTURE, id as idSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export default async function NewStructurePage({ params, searchParams }: { params: Promise<{ leagueId: string }>; searchParams: Promise<{ start?: string }> }) {
  const { leagueId } = await params;
  const { start } = await searchParams;
  if (!idSchema.safeParse(leagueId).success) notFound();
  try {
    await requireLeagueAdmin(leagueId);
  } catch (e) {
    if (e instanceof AuthzError) notFound();
    throw e;
  }
  return (
    <>
      <div>
        <Link href={`/admin/leagues/${leagueId}/structures`} className="text-sm text-mist hover:text-snow">Blind structures</Link>
        <h1 className="font-display text-4xl font-bold">New structure</h1>
      </div>
      <Section title={start === "blank" ? "Import or build" : "Levels"}>
        {start === "blank" && <p className="mb-3 text-sm text-mist">Click <strong>Import file…</strong> to load a CSV or JSON file, or edit the levels below.</p>}
        <SavedStructureForm
          leagueId={leagueId}
          initialLevels={start === "blank" ? [{ kind: "level", smallBlind: 25, bigBlind: 50, ante: 0, durationMin: 20 }] : DEFAULT_STRUCTURE}
        />
      </Section>
    </>
  );
}
