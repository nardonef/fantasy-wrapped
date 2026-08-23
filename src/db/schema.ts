import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type Provider = "sleeper" | "yahoo" | "espn";
export type SyncStatus = "pending" | "syncing" | "synced" | "error";

/**
 * One fantasy league for one season. A multi-year league is multiple rows
 * (Sleeper links them via previousProviderLeagueId).
 */
export const leagues = pgTable(
  "leagues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").$type<Provider>().notNull(),
    providerLeagueId: text("provider_league_id").notNull(),
    season: integer("season").notNull(),
    name: text("name").notNull(),
    totalTeams: integer("total_teams").notNull(),
    /** Ordered lineup slots, e.g. ["QB","RB","RB","WR","WR","TE","FLEX","K","DEF","BN",...] */
    rosterPositions: jsonb("roster_positions").$type<string[]>().notNull(),
    /** Provider scoring settings, normalized keys where possible. */
    scoringSettings: jsonb("scoring_settings").$type<Record<string, number>>().notNull(),
    /** Playoff structure: first playoff week, number of playoff teams, etc. */
    playoffStartWeek: integer("playoff_start_week"),
    playoffTeams: integer("playoff_teams"),
    lastScoredWeek: integer("last_scored_week"),
    previousProviderLeagueId: text("previous_provider_league_id"),
    syncStatus: text("sync_status").$type<SyncStatus>().notNull().default("pending"),
    syncError: text("sync_error"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    /** Raw provider league payload for reprocessing without re-fetching. */
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("leagues_provider_league_season_ux").on(t.provider, t.providerLeagueId, t.season),
  ],
);

/** One fantasy team (roster) in a league, owned by a manager. */
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    providerRosterId: text("provider_roster_id").notNull(),
    providerUserId: text("provider_user_id"),
    displayName: text("display_name").notNull(),
    teamName: text("team_name"),
    avatarUrl: text("avatar_url"),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    ties: integer("ties").notNull().default(0),
    pointsFor: doublePrecision("points_for").notNull().default(0),
    pointsAgainst: doublePrecision("points_against").notNull().default(0),
    /** Final placement after playoffs, 1 = champion. Null if season incomplete. */
    finalRank: integer("final_rank"),
    playoffSeed: integer("playoff_seed"),
    raw: jsonb("raw"),
  },
  (t) => [uniqueIndex("teams_league_roster_ux").on(t.leagueId, t.providerRosterId)],
);

/**
 * One head-to-head pairing in one week. Stored once per pairing (teamA has the
 * lower providerRosterId). teamB null = bye/median-less week.
 */
export const matchups = pgTable(
  "matchups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    week: integer("week").notNull(),
    teamAId: uuid("team_a_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    teamBId: uuid("team_b_id").references(() => teams.id, { onDelete: "cascade" }),
    teamAScore: doublePrecision("team_a_score").notNull(),
    teamBScore: doublePrecision("team_b_score"),
    isPlayoff: boolean("is_playoff").notNull().default(false),
    /** e.g. "quarterfinal" | "semifinal" | "championship" | "consolation" */
    bracketRound: text("bracket_round"),
  },
  (t) => [
    uniqueIndex("matchups_league_week_team_ux").on(t.leagueId, t.week, t.teamAId),
    index("matchups_league_week_ix").on(t.leagueId, t.week),
  ],
);

/** Global player registry, per provider. */
export const players = pgTable(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").$type<Provider>().notNull(),
    providerPlayerId: text("provider_player_id").notNull(),
    name: text("name").notNull(),
    position: text("position"),
    nflTeam: text("nfl_team"),
  },
  (t) => [uniqueIndex("players_provider_player_ux").on(t.provider, t.providerPlayerId)],
);

/**
 * Per-player, per-week fantasy points on a specific team's roster.
 * The backbone of bench regret: started=false rows are the points left behind.
 */
export const playerScores = pgTable(
  "player_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id),
    week: integer("week").notNull(),
    points: doublePrecision("points").notNull(),
    started: boolean("started").notNull(),
    /** Lineup slot if started (e.g. "QB", "FLEX"), or "BN"/"IR"/"TAXI". */
    slot: text("slot"),
  },
  (t) => [
    uniqueIndex("player_scores_team_week_player_ux").on(t.teamId, t.week, t.playerId),
    index("player_scores_league_week_ix").on(t.leagueId, t.week),
  ],
);

export type TransactionType = "trade" | "waiver" | "free_agent" | "commissioner";

export type TransactionAssets = {
  /** playerProviderIds gained, keyed by providerRosterId */
  adds: Record<string, string[]>;
  /** playerProviderIds lost, keyed by providerRosterId */
  drops: Record<string, string[]>;
  /** FAAB spent, keyed by providerRosterId */
  faab?: Record<string, number>;
  /** draft picks moved in trades */
  draftPicks?: { season: string; round: number; fromRosterId: string; toRosterId: string }[];
};

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    providerTxId: text("provider_tx_id").notNull(),
    week: integer("week").notNull(),
    type: text("type").$type<TransactionType>().notNull(),
    /** providerRosterIds of every team involved */
    rosterIds: jsonb("roster_ids").$type<string[]>().notNull(),
    assets: jsonb("assets").$type<TransactionAssets>().notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("transactions_league_tx_ux").on(t.leagueId, t.providerTxId),
    index("transactions_league_week_ix").on(t.leagueId, t.week),
  ],
);

export const draftPicks = pgTable(
  "draft_picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    playerId: uuid("player_id").references(() => players.id),
    round: integer("round").notNull(),
    pickNo: integer("pick_no").notNull(),
    isKeeper: boolean("is_keeper").notNull().default(false),
    /** Auction cost; null for snake drafts. */
    amount: integer("amount"),
  },
  (t) => [uniqueIndex("draft_picks_league_pick_ux").on(t.leagueId, t.pickNo)],
);

/**
 * A generated Wrapped for one team-season: the deterministic card script and
 * (later) the LLM-written copy. engineVersion lets us regenerate and compare.
 */
export const wrappedScripts = pgTable(
  "wrapped_scripts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    engineVersion: text("engine_version").notNull(),
    script: jsonb("script").notNull(),
    copy: jsonb("copy"),
    copyModel: text("copy_model"),
    /** Tokens, duration and estimated cost of the generation that produced `copy`. */
    copyUsage: jsonb("copy_usage"),
    /**
     * Set immediately before a generation starts, cleared never — only read.
     * Lets two concurrent page views of the same never-viewed team agree on
     * which one pays for the LLM call: whoever's claim UPDATE actually
     * matches a row wins, the loser serves fallback copy for that one
     * request instead of generating too. A stale claim (crashed before
     * finishing) is retried after `CLAIM_STALE_MS`.
     */
    copyGenerationClaimedAt: timestamp("copy_generation_claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("wrapped_scripts_team_engine_ux").on(t.teamId, t.engineVersion)],
);

/**
 * Derived per-team-season stats used only for cross-league comparison
 * ("global" insight category) — the values powering percentile lookups.
 * Written once per team-season during sync, one row per (team, engineVersion)
 * so a formula change doesn't silently mix definitions in the same pool.
 */
export const teamSeasonStats = pgTable(
  "team_season_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    engineVersion: text("engine_version").notNull(),
    /** benchRegretTotal / pointsFor — lower is better. */
    benchRegretRate: doublePrecision("bench_regret_rate").notNull(),
    /** flippableLosses.length / regularSeasonWeeks.length — lower is better. */
    flippableLossRate: doublePrecision("flippable_loss_rate").notNull(),
    allPlayWinPct: doublePrecision("all_play_win_pct").notNull(),
    /** actual win% − all-play win% — higher is luckier. */
    luckDelta: doublePrecision("luck_delta").notNull(),
    longestWinStreak: integer("longest_win_streak").notNull(),
    longestLossStreak: integer("longest_loss_streak").notNull(),
    transactionTotal: integer("transaction_total").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("team_season_stats_team_engine_ux").on(t.teamId, t.engineVersion),
    // getGlobalStats filters WHERE engine_version = current on every cache-miss
    // Wrapped generation — without this, that's a full table scan.
    index("team_season_stats_engine_version_ix").on(t.engineVersion),
  ],
);
