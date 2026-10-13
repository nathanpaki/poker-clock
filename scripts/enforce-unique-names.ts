/**
 * Turns on the database rule "one player per name per league" once there are
 * no duplicates left. Safe to run any time; it never changes player data.
 *
 *   npx tsx scripts/enforce-unique-names.ts
 */
import { config } from "dotenv";
import { enforceUniqueNames } from "../src/server/name-rule";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set in .env");
  let db: any, close: () => Promise<void>;
  if (/localhost|127\.0\.0\.1/.test(new URL(url).host)) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url });
    db = (await import("drizzle-orm/node-postgres")).drizzle(pool);
    close = () => pool.end();
  } else {
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default;
    const pool = new Pool({ connectionString: url });
    db = (await import("drizzle-orm/neon-serverless")).drizzle(pool);
    close = () => pool.end();
  }
  try {
    const r = await enforceUniqueNames(db);
    if (r.already) console.log("✓ Duplicate-name protection is already on.");
    else if (r.enabled) console.log("✓ Duplicate-name protection is now on. The database will reject a second player with the same name in a league.");
    else {
      console.log(`✗ Not switched on yet. ${r.duplicates.length} name(s) still have duplicates. Merge them on each league's Players page, then run this again:\n`);
      for (const d of r.duplicates) console.log(`  ${d.league}: ${d.names.join(" / ")}`);
      process.exitCode = 2;
    }
  } finally {
    await close();
  }
}

main().catch((e) => {
  console.error("✗", e?.cause?.message ?? e?.message ?? e);
  process.exit(1);
});
