CREATE TYPE "public"."league_role" AS ENUM('admin', 'staff');--> statement-breakpoint
CREATE TYPE "public"."level_kind" AS ENUM('level', 'break');--> statement-breakpoint
CREATE TYPE "public"."timer_status" AS ENUM('not_started', 'running', 'paused', 'break', 'finished');--> statement-breakpoint
CREATE TYPE "public"."tournament_status" AS ENUM('scheduled', 'running', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid,
	"tournament_id" uuid,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blind_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "level_kind" DEFAULT 'level' NOT NULL,
	"small_blind" integer DEFAULT 0 NOT NULL,
	"big_blind" integer DEFAULT 0 NOT NULL,
	"ante" integer DEFAULT 0 NOT NULL,
	"duration_sec" integer NOT NULL,
	CONSTRAINT "blind_levels_position_uq" UNIQUE("tournament_id","position"),
	CONSTRAINT "blind_levels_duration_ck" CHECK ("blind_levels"."duration_sec" > 0),
	CONSTRAINT "blind_levels_blinds_ck" CHECK ("blind_levels"."small_blind" >= 0 AND "blind_levels"."big_blind" >= "blind_levels"."small_blind" AND "blind_levels"."ante" >= 0)
);
--> statement-breakpoint
CREATE TABLE "league_memberships" (
	"league_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "league_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_memberships_league_id_user_id_pk" PRIMARY KEY("league_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(64) NOT NULL,
	"allow_cross_venue_players" boolean DEFAULT true NOT NULL,
	"default_timezone" text DEFAULT 'America/New_York' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leagues_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"user_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_in_by" text,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text
);
--> statement-breakpoint
CREATE TABLE "player_eliminations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"eliminated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"eliminated_by" text,
	"finish_position" integer,
	"level_number" integer,
	"level_index" integer,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"phone" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_id_league_uq" UNIQUE("id","league_id")
);
--> statement-breakpoint
CREATE TABLE "timer_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"op" text NOT NULL,
	"detail" jsonb,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registered_by" text,
	CONSTRAINT "registrations_player_uq" UNIQUE("tournament_id","player_id"),
	CONSTRAINT "registrations_id_tournament_uq" UNIQUE("id","tournament_id")
);
--> statement-breakpoint
CREATE TABLE "tournament_timer_state" (
	"tournament_id" uuid PRIMARY KEY NOT NULL,
	"status" timer_status DEFAULT 'not_started' NOT NULL,
	"level_index" integer DEFAULT 0 NOT NULL,
	"level_ends_at" timestamp with time zone,
	"remaining_ms" integer,
	"break_ends_at" timestamp with time zone,
	"cycle" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "tournament_status" DEFAULT 'scheduled' NOT NULL,
	"public_code" varchar(8) NOT NULL,
	"ante_enabled" boolean DEFAULT false NOT NULL,
	"show_eliminations_public" boolean DEFAULT true NOT NULL,
	"max_entrants" integer,
	"starting_stack" integer,
	"break_alerts_enabled" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournaments_public_code_unique" UNIQUE("public_code"),
	CONSTRAINT "tournaments_id_league_uq" UNIQUE("id","league_id")
);
--> statement-breakpoint
CREATE TABLE "venue_memberships" (
	"league_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"can_check_in" boolean DEFAULT true NOT NULL,
	"can_eliminate" boolean DEFAULT true NOT NULL,
	"can_control_clock" boolean DEFAULT false NOT NULL,
	"can_manage_players" boolean DEFAULT false NOT NULL,
	"can_export" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_memberships_venue_id_user_id_pk" PRIMARY KEY("venue_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_id_league_uq" UNIQUE("id","league_id")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blind_levels" ADD CONSTRAINT "blind_levels_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_memberships" ADD CONSTRAINT "league_memberships_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_check_ins" ADD CONSTRAINT "check_ins_registration_fk" FOREIGN KEY ("registration_id","tournament_id") REFERENCES "public"."tournament_registrations"("id","tournament_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_eliminations" ADD CONSTRAINT "eliminations_registration_fk" FOREIGN KEY ("registration_id","tournament_id") REFERENCES "public"."tournament_registrations"("id","tournament_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_adjustments" ADD CONSTRAINT "timer_adjustments_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "registrations_tournament_fk" FOREIGN KEY ("tournament_id","league_id") REFERENCES "public"."tournaments"("id","league_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "registrations_player_fk" FOREIGN KEY ("player_id","league_id") REFERENCES "public"."players"("id","league_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_timer_state" ADD CONSTRAINT "tournament_timer_state_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_venue_fk" FOREIGN KEY ("venue_id","league_id") REFERENCES "public"."venues"("id","league_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_memberships" ADD CONSTRAINT "venue_memberships_venue_fk" FOREIGN KEY ("venue_id","league_id") REFERENCES "public"."venues"("id","league_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_memberships" ADD CONSTRAINT "venue_memberships_league_member_fk" FOREIGN KEY ("league_id","user_id") REFERENCES "public"."league_memberships"("league_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_league_idx" ON "audit_logs" USING btree ("league_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_tournament_idx" ON "audit_logs" USING btree ("tournament_id","created_at");--> statement-breakpoint
CREATE INDEX "league_memberships_user_idx" ON "league_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "check_ins_active_uq" ON "player_check_ins" USING btree ("registration_id") WHERE "player_check_ins"."voided_at" IS NULL;--> statement-breakpoint
CREATE INDEX "check_ins_tournament_idx" ON "player_check_ins" USING btree ("tournament_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eliminations_active_uq" ON "player_eliminations" USING btree ("registration_id") WHERE "player_eliminations"."voided_at" IS NULL;--> statement-breakpoint
CREATE INDEX "eliminations_tournament_idx" ON "player_eliminations" USING btree ("tournament_id","eliminated_at");--> statement-breakpoint
CREATE INDEX "players_league_name_idx" ON "players" USING btree ("league_id","display_name");--> statement-breakpoint
CREATE INDEX "timer_adjustments_tournament_idx" ON "timer_adjustments" USING btree ("tournament_id","created_at");--> statement-breakpoint
CREATE INDEX "registrations_league_idx" ON "tournament_registrations" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "tournaments_league_idx" ON "tournaments" USING btree ("league_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "tournaments_venue_idx" ON "tournaments" USING btree ("venue_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "venue_memberships_user_idx" ON "venue_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "venues_league_idx" ON "venues" USING btree ("league_id");