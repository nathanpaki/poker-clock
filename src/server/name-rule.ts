import { sql } from "drizzle-orm";

type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };
const rows = (r: unknown) => ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as Record<string, unknown>[];

/** Is the database-level "one name per league" rule switched on? */
export async function uniqueNameRuleActive(db: Exec): Promise<boolean> {
  const r = rows(await db.execute(sql`select 1 from pg_indexes where indexname = 'players_name_key_uq' limit 1`));
  return r.length > 0;
}

/** Groups of players sharing a name in the same league. */
export async function duplicateNameGroups(db: Exec, leagueId?: string) {
  return rows(
    await db.execute(sql`
      select l.name as league, p.league_id as "leagueId", p.name_key as "nameKey", count(*)::int as copies,
             array_agg(p.display_name order by p.created_at) as names
      from players p join leagues l on l.id = p.league_id
      ${leagueId ? sql`where p.league_id = ${leagueId}` : sql``}
      group by l.name, p.league_id, p.name_key
      having count(*) > 1
      order by l.name, p.name_key`),
  ) as { league: string; leagueId: string; nameKey: string; copies: number; names: string[] }[];
}

/** Switch the rule on if no duplicates remain. Never deletes or changes data. */
export async function enforceUniqueNames(db: Exec): Promise<{ enabled: boolean; already: boolean; duplicates: Awaited<ReturnType<typeof duplicateNameGroups>> }> {
  if (await uniqueNameRuleActive(db)) return { enabled: true, already: true, duplicates: [] };
  const duplicates = await duplicateNameGroups(db);
  if (duplicates.length) return { enabled: false, already: false, duplicates };
  await db.execute(sql`create unique index if not exists "players_name_key_uq" on "players" using btree ("league_id","name_key")`);
  return { enabled: true, already: false, duplicates: [] };
}
