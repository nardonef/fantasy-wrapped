import { describe, expect, it } from "vitest";
import { normalizeYahooLeague, type YahooLeaguePayloads } from "./normalize";

const LEAGUE_KEY = "423.l.11184";

function rawTeam(
  id: number,
  name: string,
  guid: string,
  wins: number,
  losses: number,
  pf: string,
  pa: string,
) {
  return {
    team: [
      [
        { team_key: `${LEAGUE_KEY}.t.${id}` },
        { team_id: id },
        { name },
        { managers: [{ manager: { guid, nickname: name } }] },
      ],
      {
        team_standings: {
          rank: id,
          outcome_totals: { wins, losses, ties: 0 },
          points_for: pf,
          points_against: pa,
        },
      },
    ],
  };
}

function buildLeaguePayload() {
  return {
    fantasy_content: {
      league: [
        { league_key: LEAGUE_KEY },
        { league_id: "11184" },
        { name: "Legends Only League" },
        { season: "2025" },
        { num_teams: 2 },
        { current_week: 17 },
        { end_week: "17" },
        {
          settings: [
            {
              playoff_start_week: "15",
              num_playoff_teams: "2",
              roster_positions: [
                { roster_position: { position: "QB", count: "1" } },
                { roster_position: { position: "RB", count: "2" } },
              ],
            },
          ],
        },
        {
          standings: [
            {
              teams: {
                "0": rawTeam(1, "Dynasty Warriors", "GUID-1", 10, 4, "1500.50", "1300.20"),
                "1": rawTeam(2, "Bench Regret FC", "GUID-2", 4, 10, "1300.20", "1500.50"),
                count: 2,
              },
            },
          ],
        },
      ],
    },
  };
}

function buildScoreboardPayload(week: number) {
  return {
    fantasy_content: {
      league: [
        { league_key: LEAGUE_KEY },
        {
          scoreboard: [
            { week: String(week) },
            {
              matchups: {
                "0": {
                  matchup: [
                    { week: String(week) },
                    { is_playoffs: week >= 15 ? "1" : "0" },
                    {
                      teams: {
                        "0": {
                          team: [
                            [{ team_key: `${LEAGUE_KEY}.t.1` }, { name: "Dynasty Warriors" }],
                            { team_points: { total: "120.5" } },
                          ],
                        },
                        "1": {
                          team: [
                            [{ team_key: `${LEAGUE_KEY}.t.2` }, { name: "Bench Regret FC" }],
                            { team_points: { total: "98.2" } },
                          ],
                        },
                        count: 2,
                      },
                    },
                  ],
                },
                count: 1,
              },
            },
          ],
        },
      ],
    },
  };
}

function buildRosterPayload(teamKey: string, week: number) {
  return {
    fantasy_content: {
      team: [
        [{ team_key: teamKey }, { name: "Dynasty Warriors" }],
        {
          roster: [
            { week: String(week) },
            {
              players: {
                "0": {
                  player: [
                    [
                      { player_key: "423.p.1" },
                      { player_id: "1" },
                      { name: { full: "Star Quarterback" } },
                    ],
                    { display_position: "QB" },
                    { editorial_team_abbr: "KC" },
                    { selected_position: [{ coverage_type: "week" }, { position: "QB" }] },
                    { player_points: { total: "24.5" } },
                  ],
                },
                count: 1,
              },
            },
          ],
        },
      ],
    },
  };
}

function buildPayloads(): YahooLeaguePayloads {
  // Only team 1 has a recorded roster this week — keeps the player-weeks
  // assertions below unambiguous (exactly one rostered player, on one team).
  const teamOneKey = `${LEAGUE_KEY}.t.1`;
  return {
    league: buildLeaguePayload(),
    scoreboardByWeek: { 1: buildScoreboardPayload(1) },
    rosterByTeamWeek: { [`${teamOneKey}:1`]: buildRosterPayload(teamOneKey, 1) },
    transactions: {
      fantasy_content: { league: [{ league_key: LEAGUE_KEY }, { transactions: [] }] },
    },
    draftResults: {
      fantasy_content: { league: [{ league_key: LEAGUE_KEY }, { draft_results: [] }] },
    },
  };
}

describe("normalizeYahooLeague (hand-built fixture)", () => {
  it("normalizes league metadata", () => {
    const bundle = normalizeYahooLeague(buildPayloads());
    expect(bundle.league.provider).toBe("yahoo");
    expect(bundle.league.providerLeagueId).toBe(LEAGUE_KEY);
    expect(bundle.league.season).toBe(2025);
    expect(bundle.league.totalTeams).toBe(2);
    expect(bundle.league.playoffStartWeek).toBe(15);
    expect(bundle.league.playoffTeams).toBe(2);
    expect(bundle.league.rosterPositions).toEqual(["QB", "RB", "RB"]);
  });

  it("produces one team per Yahoo team with records and manager guid", () => {
    const bundle = normalizeYahooLeague(buildPayloads());
    expect(bundle.teams).toHaveLength(2);
    const warriors = bundle.teams.find((t) => t.displayName === "Dynasty Warriors");
    expect(warriors?.providerRosterId).toBe("1");
    expect(warriors?.providerUserId).toBe("GUID-1");
    expect(warriors?.wins).toBe(10);
    expect(warriors?.losses).toBe(4);
    expect(warriors?.pointsFor).toBeCloseTo(1500.5);
  });

  it("normalizes one matchup for the recorded week", () => {
    const bundle = normalizeYahooLeague(buildPayloads());
    expect(bundle.matchups).toHaveLength(1);
    expect(bundle.matchups[0]).toMatchObject({
      week: 1,
      teamA: "1",
      teamB: "2",
      teamAScore: 120.5,
      teamBScore: 98.2,
      isPlayoff: false,
    });
  });

  it("normalizes player-weeks from the recorded roster", () => {
    const bundle = normalizeYahooLeague(buildPayloads());
    expect(bundle.playerWeeks).toHaveLength(1);
    expect(bundle.playerWeeks[0]).toMatchObject({
      providerRosterId: "1",
      week: 1,
      providerPlayerId: "1",
      points: 24.5,
      started: true,
      slot: "QB",
    });
    expect(bundle.players).toHaveLength(1);
    expect(bundle.players[0]).toMatchObject({
      providerPlayerId: "1",
      name: "Star Quarterback",
      position: "QB",
    });
  });
});
