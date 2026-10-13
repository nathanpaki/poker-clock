-- Safe on databases that already contain eliminations: add nullable, backfill from bust time, then require it.
ALTER TABLE "player_eliminations" ADD COLUMN "order_key" bigint;--> statement-breakpoint
UPDATE "player_eliminations" SET "order_key" = (extract(epoch from "eliminated_at") * 1000)::bigint WHERE "order_key" IS NULL;--> statement-breakpoint
ALTER TABLE "player_eliminations" ALTER COLUMN "order_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "player_eliminations" ADD COLUMN "is_winner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "eliminations_winner_uq" ON "player_eliminations" USING btree ("tournament_id") WHERE "player_eliminations"."is_winner" AND "player_eliminations"."voided_at" IS NULL;
