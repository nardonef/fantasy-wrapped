import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createFixtureSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";
import { classifyLeagueArchetypes } from "./archetype";
import { computeSeasonFacts } from "./facts";
import { generateLeagueWrapped } from "./index";
import type { CardScript, SeasonFacts } from "./types";

const LEAGUES = ["1269125082375008256", "1257059475584471040"];

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
    scripts = generateLeagueWrapped(bundle, {});
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
