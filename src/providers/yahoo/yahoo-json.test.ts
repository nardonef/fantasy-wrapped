// src/providers/yahoo/yahoo-json.test.ts
import { describe, expect, it } from "vitest";
import { cleanYahoo } from "./yahoo-json";

describe("cleanYahoo", () => {
  it("converts a numbered collection to a plain array, dropping count", () => {
    const input = { "0": "a", "1": "b", count: 2 };
    expect(cleanYahoo(input)).toEqual(["a", "b"]);
  });

  it("merges an array of single-key shards (distinct keys) into one object", () => {
    const input = [{ league_key: "423.l.1" }, { name: "My League" }];
    expect(cleanYahoo(input)).toEqual({ league_key: "423.l.1", name: "My League" });
  });

  it("merges shards that mix single- and multi-key objects, as long as no key repeats", () => {
    const input = [
      [{ team_key: "423.l.1.t.1" }, { name: "Dynasty Warriors" }],
      { team_points: { total: "120.5" } },
    ];
    expect(cleanYahoo(input)).toEqual({
      team_key: "423.l.1.t.1",
      name: "Dynasty Warriors",
      team_points: { total: "120.5" },
    });
  });

  it("unwraps a list of same-key-wrapped items into a plain array, without merging them", () => {
    const input = [
      { roster_position: { position: "QB" } },
      { roster_position: { position: "RB" } },
    ];
    expect(cleanYahoo(input)).toEqual([{ position: "QB" }, { position: "RB" }]);
  });

  it("unwraps even a single same-key-wrapped item (still a list of one)", () => {
    const input = [{ manager: { guid: "ABC123", nickname: "Frank" } }];
    expect(cleanYahoo(input)).toEqual([{ guid: "ABC123", nickname: "Frank" }]);
  });

  it("unwraps a redundant one-element array wrapping a whole sub-resource", () => {
    const input = [{ playoff_start_week: "15", num_playoff_teams: "6" }];
    expect(cleanYahoo(input)).toEqual({ playoff_start_week: "15", num_playoff_teams: "6" });
  });

  it("leaves an unrelated plain array untouched", () => {
    expect(cleanYahoo(["QB", "RB", "WR"])).toEqual(["QB", "RB", "WR"]);
  });

  it("recurses into nested objects and arrays, applying the same-key-unwrap rule at every depth", () => {
    const input = { outer: { "0": { inner: [{ a: 1 }, { b: 2 }] }, count: 1 } };
    expect(cleanYahoo(input)).toEqual({ outer: [{ a: 1, b: 2 }] });
  });

  it("cleans a realistic nested league+scoreboard+matchup+teams shape end to end", () => {
    const rawTeam = (key: string, name: string, points: string) => ({
      team: [[{ team_key: key }, { name }], { team_points: { total: points } }],
    });
    const input = {
      fantasy_content: {
        league: [
          { league_key: "423.l.11184" },
          {
            scoreboard: [
              { week: "5" },
              {
                matchups: {
                  "0": {
                    matchup: [
                      { week: "5" },
                      { is_playoffs: "0" },
                      {
                        teams: {
                          "0": rawTeam("423.l.11184.t.1", "Dynasty Warriors", "120.5"),
                          "1": rawTeam("423.l.11184.t.2", "Bench Regret FC", "98.2"),
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

    const cleaned = cleanYahoo(input) as {
      fantasy_content: {
        league: {
          league_key: string;
          scoreboard: {
            week: string;
            matchups: { week: string; is_playoffs: string; teams: unknown[] }[];
          };
        };
      };
    };

    expect(cleaned.fantasy_content.league.league_key).toBe("423.l.11184");
    const scoreboard = cleaned.fantasy_content.league.scoreboard;
    expect(scoreboard.week).toBe("5");
    expect(scoreboard.matchups).toHaveLength(1);
    expect(scoreboard.matchups[0]).toEqual({
      week: "5",
      is_playoffs: "0",
      teams: [
        { team_key: "423.l.11184.t.1", name: "Dynasty Warriors", team_points: { total: "120.5" } },
        { team_key: "423.l.11184.t.2", name: "Bench Regret FC", team_points: { total: "98.2" } },
      ],
    });
  });
});
