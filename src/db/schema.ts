import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Tenant isolation strategy
 * -------------------------
 * Every tenant-owned row carries `league_id`. Child rows reference parents through
 * COMPOSITE foreign keys that include `league_id` (or `tournament_id`), so the
 * database itself refuses to link a League A player to a League B tournament,
 * even if application code has a bug.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const leagueRole = pgEnum("league_role", ["admin", "staff"]);
export const tournamentStatus = pgEnum("tournament_status", ["scheduled", "running", "completed", "cancelled"]);
export const levelKind = pgEnum("level_kind", ["level", "break"]);
export const timerStatus = pgEnum("timer_status", ["not_started", "running", "paused", "break", "finished"]);

export const platformAdmins = pgTable("platform_admins", {
  userId: text("user_id").primaryKey(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const leagues = pgTable("leagues", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  allowCrossVenuePlayers: boolean("allow_cross_venue_players").notNull().default(true),
  defaultTimezone: text("default_timezone").notNull().default("America/New_York"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const leagueMemberships = pgTable(
  "league_memberships",
  {
    leagueId: uuid("league_id").notNull().references(() => leagues.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    role: leagueRole("role").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.userId] }), index("league_memberships_user_idx").on(t.userId)],
);

export const venues = pgTable(
  "venues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id").notNull().references(() => leagues.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("America/New_York"),
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique("venues_id_league_uq").on(t.id, t.leagueId), index("venues_league_idx").on(t.leagueId)],
);

export const venueMemberships = pgTable(
  "venue_memberships",
  {
    leagueId: uuid("league_id").notNull(),
    venueId: uuid("venue_id").notNull(),
    userId: text("user_id").notNull(),
    canCheckIn: boolean("can_check_in").notNull().default(true),
    canEliminate: boolean("can_eliminate").notNull().default(true),
    canControlClock: boolean("can_control_clock").notNull().default(false),
    canManagePlayers: boolean("can_manage_players").notNull().default(false),
    canExport: boolean("can_export").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.venueId, t.userId] }),
    foreignKey({ columns: [t.venueId, t.leagueId], foreignColumns: [venues.id, venues.leagueId], name: "venue_memberships_venue_fk" }),
    // Venue staff must also be a member of the venue's league.
    foreignKey({
      columns: [t.leagueId, t.userId],
      foreignColumns: [leagueMemberships.leagueId, leagueMemberships.userId],
      name: "venue_memberships_league_member_fk",
    }).onDelete("cascade"),
    index("venue_memberships_user_idx").on(t.userId),
  ],
);

export const players = pgTable(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id").notNull().references(() => leagues.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    /**
     * Matching key, computed by Postgres (keep in step with normalizeName in
     * lib/names.ts): "Hank S.", "hank s" and "HANK  S" all become "hank s".
     */
    nameKey: text("name_key")
      .notNull()
      .generatedAlwaysAs(
        sql`btrim(regexp_replace(regexp_replace(lower(display_name), '[^[:alnum:][:space:]]+', '', 'g'), '[[:space:]]+', ' ', 'g'))`,
      ),
    email: text("email"),
    phone: text("phone"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("players_id_league_uq").on(t.id, t.leagueId),
    index("players_league_name_idx").on(t.leagueId, t.displayName),
    index("players_league_name_key_idx").on(t.leagueId, t.nameKey),
    // One player per name per league (including inactive players). The migration
    // only creates this once existing duplicates are merged; see scripts/enforce-unique-names.ts.
    uniqueIndex("players_name_key_uq").on(t.leagueId, t.nameKey),
  ],
);

export const tournaments = pgTable(
  "tournaments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id").notNull(),
    venueId: uuid("venue_id").notNull(),
    name: text("name").notNull(),
    scheduledAt: ts("scheduled_at").notNull(),
    status: tournamentStatus("status").notNull().default("scheduled"),
    publicCode: varchar("public_code", { length: 8 }).notNull().unique(),
    anteEnabled: boolean("ante_enabled").notNull().default(false),
    showEliminationsPublic: boolean("show_eliminations_public").notNull().default(true),
    maxEntrants: integer("max_entrants"),
    startingStack: integer("starting_stack"),
    // Break alerts are an admin-level setting; per-device sound toggles live in the browser.
    breakAlertsEnabled: boolean("break_alerts_enabled").notNull().default(true),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("tournaments_id_league_uq").on(t.id, t.leagueId),
    foreignKey({ columns: [t.venueId, t.leagueId], foreignColumns: [venues.id, venues.leagueId], name: "tournaments_venue_fk" }),
    index("tournaments_league_idx").on(t.leagueId, t.scheduledAt),
    index("tournaments_venue_idx").on(t.venueId, t.scheduledAt),
  ],
);

export const blindLevels = pgTable(
  "blind_levels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: levelKind("kind").notNull().default("level"),
    smallBlind: integer("small_blind").notNull().default(0),
    bigBlind: integer("big_blind").notNull().default(0),
    ante: integer("ante").notNull().default(0),
    durationSec: integer("duration_sec").notNull(),
  },
  (t) => [
    unique("blind_levels_position_uq").on(t.tournamentId, t.position),
    check("blind_levels_duration_ck", sql`${t.durationSec} > 0`),
    check("blind_levels_blinds_ck", sql`${t.smallBlind} >= 0 AND ${t.bigBlind} >= ${t.smallBlind} AND ${t.ante} >= 0`),
  ],
);

/** One row per tournament. Server-authoritative; clients only render it. */
export const tournamentTimerState = pgTable("tournament_timer_state", {
  tournamentId: uuid("tournament_id").primaryKey().references(() => tournaments.id, { onDelete: "cascade" }),
  status: timerStatus("status").notNull().default("not_started"),
  levelIndex: integer("level_index").notNull().default(0),
  levelEndsAt: ts("level_ends_at"),
  remainingMs: integer("remaining_ms"),
  breakEndsAt: ts("break_ends_at"),
  /** Increments whenever a new alert cycle starts (new level, reset, break start/end). */
  cycle: integer("cycle").notNull().default(0),
  version: integer("version").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const timerAdjustments = pgTable(
  "timer_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    op: text("op").notNull(),
    detail: jsonb("detail"),
    actorUserId: text("actor_user_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("timer_adjustments_tournament_idx").on(t.tournamentId, t.createdAt)],
);

export const tournamentRegistrations = pgTable(
  "tournament_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id").notNull(),
    tournamentId: uuid("tournament_id").notNull(),
    playerId: uuid("player_id").notNull(),
    registeredAt: ts("registered_at").notNull().defaultNow(),
    registeredBy: text("registered_by"),
  },
  (t) => [
    unique("registrations_player_uq").on(t.tournamentId, t.playerId),
    unique("registrations_id_tournament_uq").on(t.id, t.tournamentId),
    foreignKey({ columns: [t.tournamentId, t.leagueId], foreignColumns: [tournaments.id, tournaments.leagueId], name: "registrations_tournament_fk" }),
    foreignKey({ columns: [t.playerId, t.leagueId], foreignColumns: [players.id, players.leagueId], name: "registrations_player_fk" }),
    index("registrations_league_idx").on(t.leagueId),
  ],
);

export const playerCheckIns = pgTable(
  "player_check_ins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    registrationId: uuid("registration_id").notNull(),
    tournamentId: uuid("tournament_id").notNull(),
    checkedInAt: ts("checked_in_at").notNull().defaultNow(),
    checkedInBy: text("checked_in_by"),
    voidedAt: ts("voided_at"),
    voidedBy: text("voided_by"),
    voidReason: text("void_reason"),
  },
  (t) => [
    foreignKey({
      columns: [t.registrationId, t.tournamentId],
      foreignColumns: [tournamentRegistrations.id, tournamentRegistrations.tournamentId],
      name: "check_ins_registration_fk",
    }),
    // At most one live check-in per registration.
    uniqueIndex("check_ins_active_uq").on(t.registrationId).where(sql`${t.voidedAt} IS NULL`),
    index("check_ins_tournament_idx").on(t.tournamentId),
  ],
);

export const playerEliminations = pgTable(
  "player_eliminations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    registrationId: uuid("registration_id").notNull(),
    tournamentId: uuid("tournament_id").notNull(),
    eliminatedAt: ts("eliminated_at").notNull().defaultNow(),
    eliminatedBy: text("eliminated_by"),
    finishPosition: integer("finish_position"),
    /** Captured from the authoritative timer inside the same transaction. */
    levelNumber: integer("level_number"),
    levelIndex: integer("level_index"),
    /**
     * Finishing order (ascending = busted earlier = worse position). Starts as the
     * bust time in ms; staff can reorder without altering the recorded bust time.
     */
    orderKey: bigint("order_key", { mode: "number" }).notNull(),
    /** The last player standing, declared by staff. Always finishes 1st. */
    isWinner: boolean("is_winner").notNull().default(false),
    voidedAt: ts("voided_at"),
    voidedBy: text("voided_by"),
    voidReason: text("void_reason"),
  },
  (t) => [
    foreignKey({
      columns: [t.registrationId, t.tournamentId],
      foreignColumns: [tournamentRegistrations.id, tournamentRegistrations.tournamentId],
      name: "eliminations_registration_fk",
    }),
    uniqueIndex("eliminations_active_uq").on(t.registrationId).where(sql`${t.voidedAt} IS NULL`),
    // At most one active winner per tournament.
    uniqueIndex("eliminations_winner_uq").on(t.tournamentId).where(sql`${t.isWinner} AND ${t.voidedAt} IS NULL`),
    index("eliminations_tournament_idx").on(t.tournamentId, t.eliminatedAt),
  ],
);

/**
 * Reusable blind structures, owned by a league. Tournaments COPY the levels at
 * creation, so editing a saved structure never rewrites past tournaments.
 */
export type StoredLevel = { kind: "level" | "break"; smallBlind: number; bigBlind: number; ante: number; durationMin: number };

export const blindStructures = pgTable(
  "blind_structures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id").notNull().references(() => leagues.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    levels: jsonb("levels").$type<StoredLevel[]>().notNull(),
    /** Pre-selected when creating a tournament. At most one per league. */
    isDefault: boolean("is_default").notNull().default(false),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("blind_structures_name_uq").on(t.leagueId, t.name),
    uniqueIndex("blind_structures_default_uq").on(t.leagueId).where(sql`${t.isDefault}`),
    index("blind_structures_league_idx").on(t.leagueId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id").references(() => leagues.id),
    tournamentId: uuid("tournament_id").references(() => tournaments.id),
    actorUserId: text("actor_user_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_league_idx").on(t.leagueId, t.createdAt),
    index("audit_logs_tournament_idx").on(t.tournamentId, t.createdAt),
  ],
);

export type League = typeof leagues.$inferSelect;
export type Venue = typeof venues.$inferSelect;
export type Player = typeof players.$inferSelect;
export type Tournament = typeof tournaments.$inferSelect;
export type BlindLevelRow = typeof blindLevels.$inferSelect;
export type TimerStateRow = typeof tournamentTimerState.$inferSelect;
export type VenueMembership = typeof venueMemberships.$inferSelect;
export type BlindStructure = typeof blindStructures.$inferSelect;
