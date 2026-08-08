import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createFixtureSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";
import { classifyLeagueArchetypes } from "./archetype";
import { computeSeasonFacts } from "./facts";
import { generateLeagueWrapped } from "./index";
import type { CardScript, GlobalStats, SeasonFacts } from "./types";

const LEAGUES = ["1269125082375008256", "1257059475584471040"];

// A fixed, representative GlobalStats fixture so global-category cards are
// exercised in the golden snapshot for review — not meant to represent any
// real pool, just enough variety to hit both brag and wince branches.
// inversePercentile is queried independently of percentile in production
// (see BidirectionalGlobalStatEntry); 100 - percentile is a fine choice here
// since this fixture only needs to be illustrative, not realistic.
const FIXTURE_GLOBAL_STATS: GlobalStats = {
  benchRegretRatePercentile: { percentile: 84, inversePercentile: 16, poolSize: 340 },
  flippableLossRatePercentile: { percentile: 47, inversePercentile: 53, poolSize: 340 },
  allPlayWinPctPercentile: { percentile: 93, inversePercentile: 7, poolSize: 340 },
  luckDeltaPercentile: { percentile: 9, inversePercentile: 91, poolSize: 340 },
  longestWinStreakPercentile: { percentile: 88, poolSize: 340 },
  longestLossStreakPercentile: { percentile: 31, poolSize: 340 },
  transactionTotalPercentile: { percentile: 96, poolSize: 340 },
};

function fixtureDir(leagueId: string): string {
  return path.join(__dirname, "../../fixtures/sleeper", leagueId);
}

describe.each(LEAGUES)("engine output for league %s", (leagueId) => {
  let scripts: CardScript[];
  let facts: SeasonFacts;

  beforeAll(async () => {
    const bundle = await fetchSleeperLeagueBundle(
      createFixtureSleeperApi(fixtureDir(leagueId)),
      leagueId,
    );
    facts = computeSeasonFacts(bundle);
    const globalStatsByRosterId = Object.fromEntries(
      bundle.teams.map((t) => [t.providerRosterId, FIXTURE_GLOBAL_STATS]),
    );
    scripts = generateLeagueWrapped(bundle, globalStatsByRosterId);
  });

  it("generates a script for every manager", () => {
    expect(scripts).toHaveLength(facts.league.totalTeams);
  });

  it("every script opens with the season summary and ends before the archetype", () => {
    for (const script of scripts) {
      expect(script.cards[0].insightId).toBe("season-summary");
      expect(script.cards.length).toBeGreaterThanOrEqual(4);
      expect(script.cards.length).toBeLessThanOrEqual(10);
      expect(script.archetype.name).toBeTruthy();
      expect(script.archetype.evidence.length).toBeGreaterThan(0);
    }
  });

  it("never ships a card below the notability floor twice for the same topic", () => {
    for (const script of scripts) {
      const ids = script.cards.map((c) => c.insightId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("assigns each non-fallback archetype at most once per league", () => {
    const archetypes = classifyLeagueArchetypes(facts);
    const nonFallback = [...archetypes.values()]
      .map((a) => a.id)
      .filter((id) => id !== "the-middle-manager");
    expect(new Set(nonFallback).size).toBe(nonFallback.length);
  });

  it("matches the golden snapshot (engine output is deterministic)", async () => {
    await expect(JSON.stringify(scripts, null, 2)).toMatchFileSnapshot(
      `__golden__/${leagueId}.json`,
    );
  });
});
