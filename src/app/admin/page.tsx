import Link from "next/link";
import { CreateLeagueForm } from "@/components/admin/create-league-form";
import { Badge, Empty, Section } from "@/components/ui";
import { isPlatformAdmin, requireUserId } from "@/lib/auth";
import { leaguesForUser } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const userId = await requireUserId();
  const [platform, leagues] = await Promise.all([isPlatformAdmin(userId), leaguesForUser(userId)]);
  return (
    <>
      <h1 className="font-display text-4xl font-bold">Your leagues</h1>
      {leagues.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {leagues.map(({ league, role }) => (
            <li key={league.id}>
              <Link href={`/admin/leagues/${league.id}`} className="flex items-center justify-between rounded-xl border border-line bg-panel p-4 hover:border-line-strong">
                <span className="font-display text-2xl">{league.name}</span>
                <Badge tone={role === "staff" ? "muted" : "amber"}>{role === "platform" ? "Platform admin" : role === "admin" ? "League admin" : "Staff"}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>You aren&rsquo;t on any league yet. Ask a league administrator to add your email.</Empty>
      )}
      {platform && (
        <Section title="Create a league">
          <CreateLeagueForm />
        </Section>
      )}
    </>
  );
}
