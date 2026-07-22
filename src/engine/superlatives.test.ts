import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createFixtureSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";
import { computeSeasonFacts } from "./facts";
import { computeSuperlatives, type Superlative } from "./superlatives";
import type { SeasonFacts } from "./types";

const LEAGUE_ID = "1269125082375008256";

describe("computeSuperlatives (Lonely Fans 2025)", () => {
  let facts: SeasonFacts;
  let awards: Superlative[];

  beforeAll(async () => {
    const bundle = await fetchSleeperLeagueBundle(
      createFixtureSleeperApi(path.join(__dirname, "../../fixtures/sleeper", LEAGUE_ID)),
      LEAGUE_ID,
    );
    facts = computeSeasonFacts(bundle);
    awards = computeSuperlatives(facts);
  });

  it("produces a substantial ballot with unique award ids", () => {
    expect(awards.length).toBeGreaterThanOrEqual(7);
    expect(new Set(awards.map((a) => a.id)).size).toBe(awards.length);
  });

  it("always crowns the champion first", () => {
    expect(awards[0].id).toBe("champion");
    expect(facts.teams[awards[0].rosterId].playoffs.champion).toBe(true);
  });

  it("every winner is a real team with a detail line", () => {
    for (const award of awards) {
      expect(facts.teams[award.rosterId]).toBeDefined();
      expect(award.winner).toBeTruthy();
      expect(award.detail.length).toBeGreaterThan(10);
    }
  });

  it("is deterministic", () => {
    expect(computeSuperlatives(facts)).toEqual(awards);
  });
});
