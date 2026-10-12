import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LiveClockDisplay } from "@/components/clock/clock-display";
import { normalizeCode } from "@/lib/code";
import { tournamentQrSvg } from "@/server/qr";
import { getPublicSnapshot } from "@/server/tournament-state";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const code = normalizeCode((await params).code);
  const snap = code ? await getPublicSnapshot(code) : null;
  return { title: snap ? `${snap.tournament.name} · ${snap.tournament.venueName}` : "Tournament clock" };
}

/** Public, read-only clock. Doubles as the TV display. */
export default async function PublicTournamentPage({ params }: Params) {
  const raw = (await params).code;
  const code = normalizeCode(raw);
  if (!code) notFound();
  if (code !== raw) redirect(`/tournament/${code}`);
  const snap = await getPublicSnapshot(code);
  if (!snap) notFound();
  const qr = await tournamentQrSvg(code);
  return (
    <main className="p-0 lg:p-[1.2vh]">
      <LiveClockDisplay code={code} initial={snap} qrSvg={qr.svg} />
    </main>
  );
}
