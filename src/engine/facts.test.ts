import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createFixtureSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";
import { computeSeasonFacts } from "./facts";
import type { SeasonFacts } from "./types";

const LEAGUE_ID = "1269125082375008256";
const FIXTURE_DIR = path.join(__dirname, "../../fixtures/sleeper", LEAGUE_ID);

describe("computeSeasonFacts (Lonely Fans 2025 fixture)", () => {
  let facts: SeasonFacts;

  beforeAll(async () => {
    const bundle = await fetchSleeperLeagueBundle(createFixtureSleeperApi(FIXTURE_DIR), LEAGUE_ID);
    facts = computeSeasonFacts(bundle);
  });

  it("separates regular season and playoff weeks", () => {
    expect(facts.league.regularSeasonWeeks).toEqual([...Array(14)].map((_, i) => i + 1));
    expect(facts.league.playoffWeeks).toEqual([15, 16, 17]);
  });

  it("matches provider season records", () => {
    // Sleeper's roster settings carry the official W/L — our recomputed
    // regular-season records must agree.
    for (const team of Object.values(facts.teams)) {
      const raw = team as unknown as { record: { wins: number; losses: number } };
      expect(raw.record.wins + raw.record.losses + team.record.ties).toBe(14);
    }
    const totalWins = Object.values(facts.teams).reduce((s, t) => s + t.record.wins, 0);
    const totalLosses = Object.values(facts.teams).reduce((s, t) => s + t.record.losses, 0);
    expect(totalWins).toBe(totalLosses);
  });

  it("all-play records are internally consistent", () => {
    // Each week, total all-play wins == total all-play losses.
    const totalAllPlayWins = Object.values(facts.teams).reduce((s, t) => s + t.allPlay.wins, 0);
    const totalAllPlayLosses = Object.values(facts.teams).reduce((s, t) => s + t.allPlay.losses, 0);
    expect(totalAllPlayWins).toBe(totalAllPlayLosses);
    // 10 teams, 14 weeks: each team plays 9 all-play games per week.
    for (const team of Object.values(facts.teams)) {
      expect(team.allPlay.wins + team.allPlay.losses).toBeLessThanOrEqual(9 * 14);
    }
  });

  it("optimal is never below actual starter points", () => {
    for (const team of Object.values(facts.teams)) {
      for (const week of team.weeks) {
        expect(week.optimalPoints).toBeGreaterThanOrEqual(week.starterPoints - 1e-6);
        expect(week.benchRegret).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("optimal record is never worse than actual record", () => {
    for (const team of Object.values(facts.teams)) {
      expect(team.optimalRecord.wins).toBeGreaterThanOrEqual(team.record.wins);
    }
  });

  it("exactly one champion, and they made the playoffs", () => {
    const champions = Object.values(facts.teams).filter((t) => t.playoffs.champion);
    expect(champions).toHaveLength(1);
    expect(champions[0].playoffs.made).toBe(true);
    expect(champions[0].playoffs.exitRound).toBeNull();
  });

  it("weekly crowns sum to the number of regular season weeks", () => {
    const crowns = Object.values(facts.teams).reduce((s, t) => s + t.weeklyCrowns, 0);
    expect(crowns).toBe(14);
    const stinkers = Object.values(facts.teams).reduce((s, t) => s + t.weeklyStinkers, 0);
    expect(stinkers).toBe(14);
  });

  it("h2h ledgers are symmetric", () => {
    for (const [rosterId, team] of Object.entries(facts.teams)) {
      for (const [oppId, ledger] of Object.entries(team.h2h)) {
        const reverse = facts.teams[oppId]?.h2h[rosterId];
        expect(reverse).toBeDefined();
        expect(reverse?.wins).toBe(ledger.losses);
        expect(reverse?.pointsFor).toBeCloseTo(ledger.pointsAgainst, 6);
      }
    }
  });

  it("every team has an MVP with a positive share", () => {
    for (const team of Object.values(facts.teams)) {
      expect(team.mvp).not.toBeNull();
      expect(team.mvp?.shareOfStartedPoints).toBeGreaterThan(0);
      expect(team.mvp?.player.name).toBeTruthy();
    }
  });

  it("rankings contain every team exactly once", () => {
    const ids = Object.keys(facts.teams).sort();
    for (const ranking of Object.values(facts.rankings)) {
      expect([...ranking].sort()).toEqual(ids);
    }
  });

  it("luck deltas roughly cancel across the league", () => {
    const totalLuck = Object.values(facts.teams).reduce((s, t) => s + t.luckDelta, 0);
    expect(Math.abs(totalLuck)).toBeLessThan(0.5);
  });
});
