import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { venueMemberships } from "@/db/schema";
import { StaffConsole } from "@/components/staff/staff-console";
import { AuthzError, getTournamentContext } from "@/lib/auth";
import { id as idSchema } from "@/lib/validation";
import { getRoster, unregisteredPlayers } from "@/server/queries";
import { getPublicSnapshot } from "@/server/tournament-state";

export const dynamic = "force-dynamic";

export default async function ControlPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  if (!idSchema.safeParse(id).success) notFound();
  let ctx;
  try {
    ctx = await getTournamentContext(id);
  } catch (e) {
    if (e instanceof AuthzError) notFound();
    throw e;
  }
  const { tournament: t, perms } = ctx;
  if (!perms.clock && !perms.check_in && !perms.eliminate) notFound();

  const [snap, roster, unregistered, vm] = await Promise.all([
    getPublicSnapshot(t.publicCode),
    getRoster(t.id, t.leagueId),
    perms.check_in ? unregisteredPlayers(t.id, t.leagueId) : Promise.resolve([]),
    ctx.isLeagueAdmin ? Promise.resolve(null) : db.query.venueMemberships.findFirst({ where: and(eq(venueMemberships.venueId, t.venueId), eq(venueMemberships.userId, ctx.userId)) }),
  ]);
  if (!snap) notFound();
  // The console still needs the clock even when the public view hides eliminations.
  return (
    <>
      <Link href={`/admin/tournaments/${t.id}`} className="text-sm text-mist hover:text-snow">{t.name} details</Link>
      <StaffConsole
        tournamentId={t.id}
        code={t.publicCode}
        initial={snap}
        timezone={ctx.venue.timezone}
        closed={t.status === "completed" || t.status === "cancelled"}
        perms={{ clock: perms.clock, check_in: perms.check_in, eliminate: perms.eliminate, managePlayers: ctx.isLeagueAdmin || !!vm?.canManagePlayers }}
        roster={roster.map((r) => ({
          registrationId: r.registrationId,
          name: r.name,
          checkedInAt: r.checkIn?.at ?? null,
          eliminated: !!r.elimination,
          elimination: r.elimination ? { id: r.elimination.id, position: r.elimination.position, at: r.elimination.at, isWinner: r.elimination.isWinner } : null,
        }))}
        unregistered={unregistered}
      />
    </>
  );
}
