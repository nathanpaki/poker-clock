/**
 * Seeds two demo leagues so you can see isolation and independent clocks.
 *
 *   npm run db:seed                         # uses DATABASE_URL
 *   SEED_ADMIN_USER_ID=user_xxx npm run db:seed   # also makes you admin of both leagues
 *
 * Safe to re-run: leagues that already exist (by slug) are skipped. Refuses to
 * run when NODE_ENV=production unless --force is passed. It never deletes data.
 */
import "dotenv/config";
import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const code = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

async function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (/localhost|127\.0\.0\.1/.test(url)) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: url });
    return { db: drizzle(pool, { schema }), close: () => pool.end() };
  }
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const ws = (await import("ws")).default;
  neonConfig.webSocketConstructor = ws;
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  const pool = new Pool({ connectionString: url });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

const STRUCTURE: [number, number, number][] = [
  [100, 200, 20], [200, 400, 20], [300, 600, 20], [0, 0, 10], [400, 800, 20], [500, 1000, 20], [600, 1200, 20], [0, 0, 10], [800, 1600, 20], [1000, 2000, 20],
];

const LEAGUES = [
  {
    name: "Crafty Brewery Poker",
    slug: "smokey-mountain",
    tz: "America/New_York",
    venues: ["Craft Brewery", "Asia Cafe", "Venue C"],
    players: ["Hank", "Rosa", "Nia", "Lou", "Omar", "Priya", "Dev", "Maya", "Jules", "Theo", "Ana", "Sam", "Kofi", "Ivy"],
  },
  {
    name: "Another Poker League",
    slug: "another-league",
    tz: "America/Chicago",
    venues: ["Venue D", "Venue E"],
    players: ["Beatrix", "Carlos", "Dmitri", "Elena", "Farah", "Gus"],
  },
];

async function main() {
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) throw new Error("Refusing to seed with NODE_ENV=production. Pass --force if you really mean it.");
  const { db, close } = await connect();
  const admin = process.env.SEED_ADMIN_USER_ID;
  try {
    for (const L of LEAGUES) {
      const existing = await db.query.leagues.findFirst({ where: eq(schema.leagues.slug, L.slug) });
      if (existing) {
        console.log(`• ${L.name} already exists — skipped`);
        continue;
      }
      await db.transaction(async (tx) => {
        const [league] = await tx.insert(schema.leagues).values({ name: L.name, slug: L.slug, defaultTimezone: L.tz }).returning();
        if (admin) await tx.insert(schema.leagueMemberships).values({ leagueId: league.id, userId: admin, role: "admin" });
        const venues = await tx.insert(schema.venues).values(L.venues.map((name) => ({ leagueId: league.id, name, timezone: L.tz }))).returning();
        const players = await tx.insert(schema.players).values(L.players.map((displayName) => ({ leagueId: league.id, displayName }))).returning();

        // One tournament per venue, starting tonight at 7pm local-ish.
        for (const [i, venue] of venues.entries()) {
          const [t] = await tx
            .insert(schema.tournaments)
            .values({
              leagueId: league.id,
              venueId: venue.id,
              name: i === 0 ? "Friday Tournament" : `${venue.name} Weekly`,
              scheduledAt: new Date(Date.now() + i * 86_400_000),
              publicCode: code(),
              anteEnabled: i === 1,
              createdBy: admin ?? "seed",
            })
            .returning();
          await tx.insert(schema.blindLevels).values(
            STRUCTURE.map(([sb, bb, min], position) => ({
              tournamentId: t.id,
              position,
              kind: sb === 0 ? ("break" as const) : ("level" as const),
              smallBlind: sb,
              bigBlind: bb,
              ante: i === 1 && sb ? bb / 2 : 0,
              durationSec: min * 60,
            })),
          );
          await tx.insert(schema.tournamentTimerState).values({ tournamentId: t.id });
          // Register everyone at the first venue so check-in can be tried immediately.
          if (i === 0)
            await tx.insert(schema.tournamentRegistrations).values(players.map((p) => ({ leagueId: league.id, tournamentId: t.id, playerId: p.id, registeredBy: admin ?? "seed" })));
          console.log(`  ${venue.name}: ${t.name} → /tournament/${t.publicCode}`);
        }
        console.log(`✓ ${L.name}: ${venues.length} venues, ${players.length} players`);
      });
    }
    if (!admin) console.log("\nTip: set SEED_ADMIN_USER_ID to your Clerk user ID (or add it to PLATFORM_ADMIN_USER_IDS) to manage these leagues.");
  } finally {
    await close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
