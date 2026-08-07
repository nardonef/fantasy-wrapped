import path from "node:path";
import { describe, expect, it } from "vitest";
import { fallbackCopy } from "@/copy/fallback";
import { computeSeasonFacts, generateCardScript } from "@/engine";
import { createFixtureSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";
import { buildStoryCards } from "./model";

/**
 * The UI-layer equivalent of the engine's golden files. Any change to the
 * layout mapping, the tone rules or what a layout chooses to show turns up
 * here as a reviewable diff across every manager in both fixture leagues.
 *
 * Copy (title/body) is deliberately excluded — it belongs to the copy layer's
 * own tests, and including it would bury layout changes in prose churn.
 */

const LEAGUES = ["1269125082375008256", "1257059475584471040"];

describe.each(LEAGUES)("story cards for league %s", (leagueId) => {
  it("matches the golden snapshot", async () => {
    const bundle = await fetchSleeperLeagueBundle(
      createFixtureSleeperApi(path.join(__dirname, "../../../fixtures/sleeper", leagueId)),
      leagueId,
    );
    const facts = computeSeasonFacts(bundle);

    const rendered = Object.keys(facts.teams)
      .sort((a, b) => Number(a) - Number(b))
      .map((rosterId) => {
        const script = generateCardScript(facts, rosterId, {});
        const cards = buildStoryCards(script, fallbackCopy(script), facts.teams[rosterId], facts);
        return {
          manager: script.managerName,
          archetype: script.archetype.name,
          cards: cards.map((c) => ({
            key: c.key,
            kicker: c.kicker,
            layout: c.layout,
            tone: c.tone,
            ghost: c.ghost,
            view: c.view,
          })),
        };
      });

    await expect(JSON.stringify(rendered, null, 2)).toMatchFileSnapshot(
      `__golden__/${leagueId}.json`,
    );
  });
});
