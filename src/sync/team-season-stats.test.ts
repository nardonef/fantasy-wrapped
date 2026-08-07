import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeSeasonFacts, ENGINE_VERSION } from "@/engine";
import { createFixtureSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";
import { computeTeamSeasonStatsRows } from "./team-season-stats";

const LEAGUE_ID = "1269125082375008256";
const FIXTURE_DIR = path.join(__dirname, "../../fixtures/sleeper", LEAGUE_ID);

describe("computeTeamSeasonStatsRows", () => {
  it("derives rates that match the underlying SeasonFacts", async () => {
    const bundle = await fetchSleeperLeagueBundle(createFixtureSleeperApi(FIXTURE_DIR), LEAGUE_ID);
    const facts = computeSeasonFacts(bundle);
    const rosterId = Object.keys(facts.teams)[0];
    const teamIdByRoster = new Map(Object.keys(facts.teams).map((id) => [id, `fake-team-${id}`]));

    const rows = computeTeamSeasonStatsRows(facts, teamIdByRoster);
    const row = rows.find((r) => r.teamId === `fake-team-${rosterId}`);
    const t = facts.teams[rosterId];

    expect(row).toBeDefined();
    expect(row?.engineVersion).toBe(ENGINE_VERSION);
    expect(row?.benchRegretRate).toBeCloseTo(t.benchRegretTotal / t.pointsFor, 6);
    expect(row?.flippableLossRate).toBeCloseTo(
      t.flippableLosses.length / facts.league.regularSeasonWeeks.length,
      6,
    );
    expect(row?.allPlayWinPct).toBe(t.allPlay.winPct);
    expect(row?.luckDelta).toBe(t.luckDelta);
    expect(row?.longestWinStreak).toBe(t.longestWinStreak?.length ?? 0);
    expect(row?.longestLossStreak).toBe(t.longestLossStreak?.length ?? 0);
    expect(row?.transactionTotal).toBe(t.transactionCounts.total);
  });

  it("skips a rosterId with no matching teamId", async () => {
    const bundle = await fetchSleeperLeagueBundle(createFixtureSleeperApi(FIXTURE_DIR), LEAGUE_ID);
    const facts = computeSeasonFacts(bundle);
    const rows = computeTeamSeasonStatsRows(facts, new Map());
    expect(rows).toHaveLength(0);
  });
});
