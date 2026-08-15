import type { TransactionAssets, TransactionType } from "@/db/schema";
import type {
  NormalizedDraftPick,
  NormalizedLeagueBundle,
  NormalizedMatchup,
  NormalizedPlayer,
  NormalizedPlayerWeek,
  NormalizedTeam,
  NormalizedTransaction,
} from "@/providers/types";
import {
  type YahooScoreboardMatchup,
  yahooDraftResultsSchema,
  yahooLeagueSchema,
  yahooRosterSchema,
  yahooScoreboardSchema,
  yahooTeamSchema,
  yahooTransactionsSchema,
} from "./schemas";
import { cleanYahoo } from "./yahoo-json";

/** Everything fetched for one league-season, still Yahoo-shaped (raw fantasy_content JSON). */
export type YahooLeaguePayloads = {
  league: unknown;
  scoreboardByWeek: Record<number, unknown>;
  /** Keyed by `${teamKey}:${week}`. */
  rosterByTeamWeek: Record<string, unknown>;
  transactions: unknown;
  draftResults: unknown;
};

const NON_STARTING_POSITIONS = new Set(["BN", "IR", "IR+"]);

function unwrapLeague(raw: unknown): unknown {
  const cleaned = cleanYahoo(raw) as { fantasy_content?: { league?: unknown } };
  return cleaned.fantasy_content?.league;
}

/**
 * cleanYahoo's generic rules can't disambiguate "a wrapper around one
 * sub-resource" from "a list of one item" when that sub-resource's own
 * cleaned content has exactly one key — which is exactly what `standings`
 * is ({teams: [...]}, nothing else). Depending on how many teams clean up
 * alongside it, the same raw response can come out as either {teams: [...]}
 * or [[...]] (an array whose one element is the teams array). Handle both
 * rather than trying to make cleanYahoo itself resolve an ambiguity that
 * genuinely isn't resolvable from shape alone. See yahoo-json.ts's module
 * comment for the general version of this caveat.
 */
export function extractStandingsTeams(standings: unknown): unknown[] {
  if (Array.isArray(standings) && Array.isArray(standings[0])) return standings[0] as unknown[];
  if (standings && typeof standings === "object" && "teams" in standings) {
    return (standings as { teams: unknown[] }).teams;
  }
  return [];
}

function toInt(value: string | number): number {
  return typeof value === "number" ? Math.trunc(value) : Number.parseInt(value, 10);
}

function toFloat(value: string | number): number {
  return typeof value === "number" ? value : Number.parseFloat(value);
}

function normalizeTransactionType(type: string): TransactionType {
  if (type === "trade" || type === "waiver" || type === "add")
    return type === "add" ? "free_agent" : type;
  return "commissioner";
}

export function normalizeYahooLeague(payloads: YahooLeaguePayloads): NormalizedLeagueBundle {
  const league = yahooLeagueSchema.parse(unwrapLeague(payloads.league));
  const rawTeams = yahooTeamSchema.array().parse(extractStandingsTeams(league.standings));
  const teams: NormalizedTeam[] = rawTeams.map((team) => {
    const manager = team.managers?.[0];
    const outcome = team.team_standings?.outcome_totals;
    return {
      providerRosterId: String(team.team_id),
      providerUserId: manager?.guid ?? null,
      displayName: team.name,
      teamName: null,
      avatarUrl: null,
      wins: outcome ? toInt(outcome.wins) : 0,
      losses: outcome ? toInt(outcome.losses) : 0,
      ties: outcome?.ties != null ? toInt(outcome.ties) : 0,
      pointsFor:
        team.team_standings?.points_for != null ? toFloat(team.team_standings.points_for) : 0,
      pointsAgainst:
        team.team_standings?.points_against != null
          ? toFloat(team.team_standings.points_against)
          : 0,
      finalRank: team.team_standings?.rank != null ? toInt(team.team_standings.rank) : null,
      playoffSeed: null,
      raw: team,
    };
  });

  const rosterPositions = (league.settings?.roster_positions ?? []).flatMap((rp) =>
    Array(rp.count != null ? toInt(rp.count) : 1).fill(rp.position),
  );
  const playoffStartWeek =
    league.settings?.playoff_start_week != null ? toInt(league.settings.playoff_start_week) : null;
  const playoffTeams =
    league.settings?.num_playoff_teams != null ? toInt(league.settings.num_playoff_teams) : null;

  const matchups: NormalizedMatchup[] = [];
  const playerWeeks: NormalizedPlayerWeek[] = [];
  const referencedPlayerIds = new Set<string>();

  const weekNumbers = Object.keys(payloads.scoreboardByWeek)
    .map(Number)
    .sort((a, b) => a - b);

  for (const week of weekNumbers) {
    const cleaned = cleanYahoo(payloads.scoreboardByWeek[week]) as {
      fantasy_content?: { league?: { scoreboard?: unknown } };
    };
    const scoreboard = yahooScoreboardSchema.parse(cleaned.fantasy_content?.league?.scoreboard);
    for (const matchup of scoreboard.matchups as YahooScoreboardMatchup[]) {
      const [teamA, teamB] = matchup.teams;
      if (!teamA) continue;
      matchups.push({
        week,
        teamA: teamA.team_key.split(".t.")[1],
        teamB: teamB ? teamB.team_key.split(".t.")[1] : null,
        teamAScore: teamA.team_points?.total != null ? toFloat(teamA.team_points.total) : 0,
        teamBScore: teamB?.team_points?.total != null ? toFloat(teamB.team_points.total) : null,
        isPlayoff: matchup.is_playoffs != null && toInt(matchup.is_playoffs) === 1,
        bracketRound: null,
      });
    }
  }

  for (const [key, rawRoster] of Object.entries(payloads.rosterByTeamWeek)) {
    const [teamKey, weekStr] = key.split(":");
    const rosterTeamId = teamKey.split(".t.")[1];
    const week = Number(weekStr);
    const cleaned = cleanYahoo(rawRoster) as { fantasy_content?: { team?: unknown } };
    const parsed = yahooRosterSchema.parse({
      roster: (cleaned.fantasy_content?.team as { roster?: unknown })?.roster,
    });
    for (const player of parsed.roster.players ?? []) {
      referencedPlayerIds.add(String(player.player_id));
      const slot = player.selected_position?.position ?? "BN";
      playerWeeks.push({
        providerRosterId: rosterTeamId,
        week,
        providerPlayerId: String(player.player_id),
        points: player.player_points?.total != null ? toFloat(player.player_points.total) : 0,
        started: !NON_STARTING_POSITIONS.has(slot),
        slot,
      });
    }
  }

  const players: NormalizedPlayer[] = [];
  {
    const seen = new Set<string>();
    for (const [, rawRoster] of Object.entries(payloads.rosterByTeamWeek)) {
      const cleaned = cleanYahoo(rawRoster) as { fantasy_content?: { team?: unknown } };
      const parsed = yahooRosterSchema.parse({
        roster: (cleaned.fantasy_content?.team as { roster?: unknown })?.roster,
      });
      for (const player of parsed.roster.players ?? []) {
        const id = String(player.player_id);
        if (seen.has(id)) continue;
        seen.add(id);
        players.push({
          providerPlayerId: id,
          name: player.name.full,
          position: player.display_position ?? null,
          nflTeam: player.editorial_team_abbr ?? null,
        });
      }
    }
  }

  const transactionsCleaned = cleanYahoo(payloads.transactions) as {
    fantasy_content?: { league?: { transactions?: unknown } };
  };
  const rawTransactions = yahooTransactionsSchema.parse(
    transactionsCleaned.fantasy_content?.league?.transactions ?? [],
  );
  const transactions: NormalizedTransaction[] = rawTransactions
    .filter((tx) => tx.status === "successful")
    .map((tx) => {
      const adds: Record<string, string[]> = {};
      const drops: Record<string, string[]> = {};
      for (const p of tx.players ?? []) {
        const data = p.transaction_data;
        if (!data) continue;
        referencedPlayerIds.add(p.player_key);
        if (data.destination_team_key) {
          const rosterId = data.destination_team_key.split(".t.")[1];
          adds[rosterId] ??= [];
          adds[rosterId].push(p.player_key);
        }
        if (data.source_team_key) {
          const rosterId = data.source_team_key.split(".t.")[1];
          drops[rosterId] ??= [];
          drops[rosterId].push(p.player_key);
        }
      }
      const assets: TransactionAssets = { adds, drops };
      if (tx.faab_bid != null) {
        const firstRoster = Object.keys(adds)[0];
        if (firstRoster) assets.faab = { [firstRoster]: toInt(tx.faab_bid) };
      }
      return {
        providerTxId: tx.transaction_key,
        week: 0,
        type: normalizeTransactionType(tx.type),
        rosterIds: [...new Set([...Object.keys(adds), ...Object.keys(drops)])],
        assets,
        executedAt: tx.timestamp != null ? new Date(toInt(tx.timestamp) * 1000) : null,
      };
    });

  const draftResultsCleaned = cleanYahoo(payloads.draftResults) as {
    fantasy_content?: { league?: { draft_results?: unknown } };
  };
  const rawDraftResults = yahooDraftResultsSchema.parse(
    draftResultsCleaned.fantasy_content?.league?.draft_results ?? [],
  );
  const draftPicks: NormalizedDraftPick[] = rawDraftResults.map((pick) => {
    if (pick.player_key) referencedPlayerIds.add(pick.player_key);
    return {
      round: toInt(pick.round),
      pickNo: toInt(pick.pick),
      providerRosterId: pick.team_key.split(".t.")[1] ?? null,
      providerPlayerId: pick.player_key ?? null,
      isKeeper: false,
      amount: pick.cost != null ? toInt(pick.cost) : null,
    };
  });

  return {
    league: {
      provider: "yahoo",
      providerLeagueId: league.league_key,
      season: toInt(league.season),
      name: league.name,
      totalTeams: toInt(league.num_teams),
      rosterPositions,
      scoringSettings: {},
      playoffStartWeek,
      playoffTeams,
      lastScoredWeek:
        league.current_week != null ? toInt(league.current_week) : (weekNumbers.at(-1) ?? null),
      previousProviderLeagueId: null,
      raw: payloads.league,
    },
    teams,
    matchups,
    playerWeeks,
    players,
    transactions,
    draftPicks,
  };
}
