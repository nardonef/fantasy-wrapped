import { z } from "zod";

/**
 * Zod schemas for the Sleeper API payloads we consume.
 * Deliberately loose (`.loose()`) — Sleeper adds fields freely; we validate
 * only what we read and fail loudly if those are missing or misshaped.
 */

export const sleeperLeagueSchema = z
  .object({
    league_id: z.string(),
    name: z.string(),
    season: z.string(),
    status: z.string(),
    total_rosters: z.number(),
    roster_positions: z.array(z.string()),
    scoring_settings: z.record(z.string(), z.number()),
    previous_league_id: z.string().nullish(),
    settings: z
      .object({
        playoff_week_start: z.number().nullish(),
        playoff_teams: z.number().nullish(),
        last_scored_leg: z.number().nullish(),
        leg: z.number().nullish(),
        type: z.number().nullish(),
      })
      .loose(),
  })
  .loose();
export type SleeperLeague = z.infer<typeof sleeperLeagueSchema>;

export const sleeperUserSchema = z
  .object({
    user_id: z.string(),
    display_name: z.string().nullish(),
    avatar: z.string().nullish(),
    metadata: z.object({ team_name: z.string().nullish() }).loose().nullish(),
  })
  .loose();
export type SleeperUser = z.infer<typeof sleeperUserSchema>;
export const sleeperUsersSchema = z.array(sleeperUserSchema);

export const sleeperRosterSchema = z
  .object({
    roster_id: z.number(),
    owner_id: z.string().nullish(),
    players: z.array(z.string()).nullish(),
    settings: z
      .object({
        wins: z.number().nullish(),
        losses: z.number().nullish(),
        ties: z.number().nullish(),
        fpts: z.number().nullish(),
        fpts_decimal: z.number().nullish(),
        fpts_against: z.number().nullish(),
        fpts_against_decimal: z.number().nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();
export type SleeperRoster = z.infer<typeof sleeperRosterSchema>;
export const sleeperRostersSchema = z.array(sleeperRosterSchema);

export const sleeperMatchupSchema = z
  .object({
    roster_id: z.number(),
    matchup_id: z.number().nullish(),
    points: z.number().nullish(),
    players: z.array(z.string()).nullish(),
    starters: z.array(z.string()).nullish(),
    players_points: z.record(z.string(), z.number()).nullish(),
  })
  .loose();
export type SleeperMatchup = z.infer<typeof sleeperMatchupSchema>;
export const sleeperMatchupsSchema = z.array(sleeperMatchupSchema);

export const sleeperTransactionSchema = z
  .object({
    transaction_id: z.string(),
    type: z.string(),
    status: z.string(),
    leg: z.number(),
    roster_ids: z.array(z.number()).nullish(),
    adds: z.record(z.string(), z.number()).nullish(),
    drops: z.record(z.string(), z.number()).nullish(),
    draft_picks: z
      .array(
        z
          .object({
            season: z.string(),
            round: z.number(),
            previous_owner_id: z.number().nullish(),
            owner_id: z.number().nullish(),
          })
          .loose(),
      )
      .nullish(),
    settings: z.object({ waiver_bid: z.number().nullish() }).loose().nullish(),
    status_updated: z.number().nullish(),
  })
  .loose();
export type SleeperTransaction = z.infer<typeof sleeperTransactionSchema>;
export const sleeperTransactionsSchema = z.array(sleeperTransactionSchema);

/** Bracket team refs can be unresolved objects ({w: matchNo}) mid-season; completed seasons resolve to numbers. */
const bracketTeamRef = z.union([z.number(), z.object({}).loose(), z.null()]);

export const sleeperBracketMatchSchema = z
  .object({
    r: z.number(),
    m: z.number(),
    t1: bracketTeamRef.nullish(),
    t2: bracketTeamRef.nullish(),
    w: z.number().nullish(),
    l: z.number().nullish(),
    p: z.number().nullish(),
  })
  .loose();
export type SleeperBracketMatch = z.infer<typeof sleeperBracketMatchSchema>;
export const sleeperBracketSchema = z.array(sleeperBracketMatchSchema);

export const sleeperDraftSchema = z
  .object({
    draft_id: z.string(),
    type: z.string().nullish(),
    status: z.string().nullish(),
  })
  .loose();
export type SleeperDraft = z.infer<typeof sleeperDraftSchema>;
export const sleeperDraftsSchema = z.array(sleeperDraftSchema);

export const sleeperDraftPickSchema = z
  .object({
    round: z.number(),
    pick_no: z.number(),
    roster_id: z.number().nullish(),
    player_id: z.string().nullish(),
    is_keeper: z.boolean().nullish(),
    metadata: z.object({ amount: z.string().nullish() }).loose().nullish(),
  })
  .loose();
export type SleeperDraftPick = z.infer<typeof sleeperDraftPickSchema>;
export const sleeperDraftPicksSchema = z.array(sleeperDraftPickSchema);

export const sleeperPlayerSchema = z
  .object({
    player_id: z.string().optional(),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    full_name: z.string().nullish(),
    position: z.string().nullish(),
    team: z.string().nullish(),
  })
  .loose();
export type SleeperPlayer = z.infer<typeof sleeperPlayerSchema>;
export const sleeperPlayersSchema = z.record(z.string(), sleeperPlayerSchema);
