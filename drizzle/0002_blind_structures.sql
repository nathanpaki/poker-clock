CREATE TABLE "blind_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"levels" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blind_structures_name_uq" UNIQUE("league_id","name")
);
--> statement-breakpoint
ALTER TABLE "blind_structures" ADD CONSTRAINT "blind_structures_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blind_structures_default_uq" ON "blind_structures" USING btree ("league_id") WHERE "blind_structures"."is_default";--> statement-breakpoint
CREATE INDEX "blind_structures_league_idx" ON "blind_structures" USING btree ("league_id");