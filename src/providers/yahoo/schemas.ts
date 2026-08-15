import { z } from "zod";

const numericString = z.union([z.string(), z.number()]);

export const yahooManagerSchema = z.object({ guid: z.string(), nickname: z.string().nullish() }).loose();
export type YahooManager = z.infer<typeof yahooManagerSchema>;

export const yahooTeamSchema = z
  .object({
    team_key: z.string(),
    team_id: numericString,
    name: z.string(),
    managers: z.array(yahooManagerSchema).nullish(),
    team_standings: z
      .object({
        rank: numericString.nullish(),
        outcome_totals: z
          .object({
            wins: numericString,
            losses: numericString,
            ties: numericString.nullish(),
          })
          .loose()
          .nullish(),
        points_for: numericString.nullish(),
        points_against: numericString.nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();
export type YahooTeam = z.infer<typeof yahooTeamSchema>;

export const yahooRosterPositionSchema = z.object({ position: z.string(), count: numericString.nullish() }).loose();

export const yahooLeagueSettingsSchema = z
  .object({
    playoff_start_week: numericString.nullish(),
    num_playoff_teams: numericString.nullish(),
    roster_positions: z.array(yahooRosterPositionSchema).nullish(),
  })
  .loose();
export type YahooLeagueSettings = z.infer<typeof yahooLeagueSettingsSchema>;

export const yahooLeagueSchema = z
  .object({
    league_key: z.string(),
    league_id: z.string(),
    name: z.string(),
    season: numericString,
    num_teams: numericString,
    current_week: numericString.nullish(),
    end_week: numericString.nullish(),
    settings: yahooLeagueSettingsSchema.nullish(),
    // Deliberately unknown, not {teams: [...]} — see normalize.ts's
    // extractStandingsTeams for why this one field can't be validated
    // directly against a fixed shape.
    standings: z.unknown().nullish(),
  })
  .loose();
export type YahooLeague = z.infer<typeof yahooLeagueSchema>;

export const yahooScoreboardMatchupSchema = z
  .object({
    week: numericString,
    is_playoffs: numericString.nullish(),
    is_consolation: numericString.nullish(),
    teams: z.array(
      z
        .object({
          team_key: z.string(),
          team_points: z.object({ total: numericString }).loose().nullish(),
        })
        .loose(),
    ),
  })
  .loose();
export type YahooScoreboardMatchup = z.infer<typeof yahooScoreboardMatchupSchema>;

export const yahooScoreboardSchema = z
  .object({
    week: numericString,
    matchups: z.array(yahooScoreboardMatchupSchema),
  })
  .loose();
export type YahooScoreboard = z.infer<typeof yahooScoreboardSchema>;

export const yahooRosterPlayerSchema = z
  .object({
    player_key: z.string(),
    player_id: numericString,
    name: z.object({ full: z.string() }).loose(),
    display_position: z.string().nullish(),
    editorial_team_abbr: z.string().nullish(),
    selected_position: z.object({ position: z.string() }).loose().nullish(),
    player_points: z.object({ total: numericString }).loose().nullish(),
  })
  .loose();
export type YahooRosterPlayer = z.infer<typeof yahooRosterPlayerSchema>;

export const yahooRosterSchema = z
  .object({
    roster: z.object({
      week: numericString.nullish(),
      players: z.array(yahooRosterPlayerSchema).nullish(),
    }).loose(),
  })
  .loose();
export type YahooRoster = z.infer<typeof yahooRosterSchema>;

export const yahooTransactionSchema = z
  .object({
    transaction_key: z.string(),
    type: z.string(),
    status: z.string(),
    timestamp: numericString.nullish(),
    faab_bid: numericString.nullish(),
    players: z
      .array(
        z
          .object({
            player_key: z.string(),
            transaction_data: z
              .object({
                type: z.string(),
                source_team_key: z.string().nullish(),
                destination_team_key: z.string().nullish(),
              })
              .loose()
              .nullish(),
          })
          .loose(),
      )
      .nullish(),
  })
  .loose();
export type YahooTransaction = z.infer<typeof yahooTransactionSchema>;
export const yahooTransactionsSchema = z.array(yahooTransactionSchema);

export const yahooDraftResultSchema = z
  .object({
    pick: numericString,
    round: numericString,
    team_key: z.string(),
    player_key: z.string().nullish(),
    cost: numericString.nullish(),
  })
  .loose();
export type YahooDraftResult = z.infer<typeof yahooDraftResultSchema>;
export const yahooDraftResultsSchema = z.array(yahooDraftResultSchema);

export const yahooUserLeagueSchema = z
  .object({
    league_key: z.string(),
    name: z.string(),
    season: numericString,
    num_teams: numericString,
  })
  .loose();
export type YahooUserLeague = z.infer<typeof yahooUserLeagueSchema>;

export const yahooUserSchema = z
  .object({
    guid: z.string(),
    games: z.array(z.object({ leagues: z.array(yahooUserLeagueSchema).nullish() }).loose()).nullish(),
  })
  .loose();
export type YahooUser = z.infer<typeof yahooUserSchema>;
export const yahooUsersSchema = z.array(yahooUserSchema);
