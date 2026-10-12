/**
 * Applies the SQL migrations in ./drizzle and shows exactly what happened.
 * Uses the same tracking table as `drizzle-kit migrate` (drizzle.__drizzle_migrations),
 * so you can switch between the two freely. Never drops or deletes anything.
 *
 *   npm run db:migrate:verbose
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED / DATABASE_URL is not set in .env");
  const u = new URL(url);
  console.log(`→ Database: ${u.username}@${u.host}${u.pathname}`);
  if (u.username === "user" || u.host.includes("ep-xxx")) throw new Error("That's the placeholder URL from .env.example. Paste your real Neon connection string.");
  if (!existsSync("./drizzle/meta/_journal.json")) throw new Error("No ./drizzle/meta/_journal.json. Run this from the project root, and make sure the drizzle folder was copied.");

  let db: any, migrate: any, close: () => Promise<void>, query: (sql: string) => Promise<{ rows: any[] }>;
  if (/localhost|127\.0\.0\.1/.test(u.host)) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url });
    db = (await import("drizzle-orm/node-postgres")).drizzle(pool);
    migrate = (await import("drizzle-orm/node-postgres/migrator")).migrate;
    close = () => pool.end();
    query = (s) => pool.query(s);
  } else {
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default;
    const pool = new Pool({ connectionString: url });
    db = (await import("drizzle-orm/neon-serverless")).drizzle(pool);
    migrate = (await import("drizzle-orm/neon-serverless/migrator")).migrate;
    close = () => pool.end();
    query = (s) => pool.query(s);
  }

  try {
    const ping = await query("select current_database() as db, current_user as usr");
    console.log(`→ Connected as ${ping.rows[0].usr} to ${ping.rows[0].db}`);
    console.log("→ Applying migrations from ./drizzle …");
    await migrate(db, { migrationsFolder: "./drizzle" });
    const tables = await query("select table_name from information_schema.tables where table_schema = 'public' order by 1");
    const applied = await query("select id, created_at from drizzle.__drizzle_migrations order by id");
    console.log(`✓ Done. ${applied.rows.length} migration(s) recorded, ${tables.rows.length} tables in public:`);
    console.log("  " + tables.rows.map((r) => r.table_name).join(", "));
  } finally {
    await close();
  }
}

main().catch((e) => {
  console.error("\n✗ Migration failed:", e?.cause?.message ?? e?.message ?? e);
  process.exit(1);
});