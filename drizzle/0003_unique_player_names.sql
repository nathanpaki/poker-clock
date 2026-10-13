-- Matching key for player names, computed by Postgres (see lib/names.ts normalizeName).
ALTER TABLE "players" ADD COLUMN "name_key" text GENERATED ALWAYS AS (btrim(regexp_replace(regexp_replace(lower(display_name), '[^[:alnum:][:space:]]+', '', 'g'), '[[:space:]]+', ' ', 'g'))) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "players_league_name_key_idx" ON "players" USING btree ("league_id","name_key");--> statement-breakpoint
-- Enforce one player per name per league ONLY if the data already allows it.
-- If duplicates exist this migration still succeeds; merge them on the Players
-- page, then run `npx tsx scripts/enforce-unique-names.ts` to switch the rule on.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "players" GROUP BY "league_id", "name_key" HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "players_name_key_uq" ON "players" USING btree ("league_id","name_key");
  ELSE
    RAISE NOTICE 'Duplicate player names exist; unique rule not enabled yet. Merge duplicates, then run scripts/enforce-unique-names.ts';
  END IF;
END $$;
