import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { fallbackCopy } from "@/copy/fallback";
import type { CardScript, SeasonFacts, WrappedCard } from "@/engine";
import { computeSeasonFacts, generateCardScript } from "@/engine";
import { allInsights } from "@/engine/insights";
import { createFixtureSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";
import { buildStoryCards, headshot, LAYOUT_BY_INSIGHT, toneFor } from "./model";

const LEAGUES = ["1269125082375008256", "1257059475584471040"];

function card(insightId: string, over: Partial<WrappedCard> = {}): WrappedCard {
  return { insightId, category: "narrative", headline: "", facts: {}, ...over };
}

describe("LAYOUT_BY_INSIGHT", () => {
  it("maps every insight the engine can ship, plus the opener", () => {
    const mapped = new Set(Object.keys(LAYOUT_BY_INSIGHT));
    const shippable = ["season-summary", ...allInsights.map((m) => m.id)];
    // A new insight module with no layout would silently render as `statement`.
    expect([...shippable].filter((id) => !mapped.has(id))).toEqual([]);
  });

  it("maps nothing the engine cannot produce", () => {
    const shippable = new Set(["season-summary", ...allInsights.map((m) => m.id)]);
    expect(Object.keys(LAYOUT_BY_INSIGHT).filter((id) => !shippable.has(id))).toEqual([]);
  });
});

describe("toneFor", () => {
  it("keeps every regret card on the dark surface", () => {
    expect(toneFor(card("peak-week", { category: "regret" }))).toBe("dark");
  });

  it("reads sentiment off the facts where one id goes both ways", () => {
    expect(toneFor(card("streak", { facts: { streakType: "winning" } }))).toBe("light");
    expect(toneFor(card("streak", { facts: { streakType: "losing" } }))).toBe("dark");
    expect(toneFor(card("season-arc", { facts: { collapse: true } }))).toBe("dark");
    expect(toneFor(card("season-arc", { facts: { collapse: false } }))).toBe("light");
    expect(toneFor(card("trade-verdict", { facts: { wonTheTrade: true } }))).toBe("light");
    expect(toneFor(card("trade-verdict", { facts: { wonTheTrade: false } }))).toBe("dark");
    expect(toneFor(card("playoff-story", { facts: { finish: "champion" } }))).toBe("light");
    expect(toneFor(card("playoff-story", { facts: { finish: "last" } }))).toBe("dark");
  });

  it("inverts the surface for a brag and keeps the rest dark", () => {
    expect(toneFor(card("mvp"))).toBe("light");
    expect(toneFor(card("nemesis"))).toBe("dark");
  });
});

describe("headshot", () => {
  it("returns null without a ref, so layouts fall back to the empty slot", () => {
    expect(headshot(undefined)).toBeNull();
  });

  it("builds the thumb and full URLs off the provider id", () => {
    const ref = { providerPlayerId: "4046", name: "Patrick Mahomes", position: "QB" };
    expect(headshot(ref)).toBe("https://sleepercdn.com/content/nfl/players/4046.jpg");
    expect(headshot(ref, true)).toBe("https://sleepercdn.com/content/nfl/players/thumb/4046.jpg");
  });
});

describe.each(LEAGUES)("buildStoryCards over real fixture data (league %s)", (leagueId) => {
  let facts: SeasonFacts;
  let scripts: { rosterId: string; script: CardScript }[];

  beforeAll(async () => {
    const bundle = await fetchSleeperLeagueBundle(
      createFixtureSleeperApi(path.join(__dirname, "../../../fixtures/sleeper", leagueId)),
      leagueId,
    );
    facts = computeSeasonFacts(bundle);
    scripts = Object.keys(facts.teams)
      .sort((a, b) => Number(a) - Number(b))
      .map((rosterId) => ({ rosterId, script: generateCardScript(facts, rosterId) }));
  });

  it("builds a view for every card of every manager without throwing", () => {
    for (const { rosterId, script } of scripts) {
      const cards = buildStoryCards(script, fallbackCopy(script), facts.teams[rosterId], facts);
      expect(cards.length).toBe(script.cards.length + 1);
      for (const c of cards) {
        expect(c.layout).toBeTruthy();
        expect(["light", "dark"]).toContain(c.tone);
        expect(c.view).toBeTruthy();
      }
    }
  });

  it("never renders an undefined or NaN into a view value", () => {
    for (const { rosterId, script } of scripts) {
      const cards = buildStoryCards(script, fallbackCopy(script), facts.teams[rosterId], facts);
      for (const c of cards) {
        const strings = [
          c.view.hero,
          c.view.heroLabel,
          ...(c.view.pair ?? []).flatMap((p) => [p.label, p.value]),
          ...(c.view.rows ?? []).flatMap((r) => [r.label, r.value]),
          ...(c.view.entries ?? []).flatMap((e) => [e.label, e.text]),
          ...(c.view.versus ?? []).flatMap((s) => [s.label, s.name]),
          ...(c.view.compare ?? []).flatMap((x) => [x.label, x.value, x.width]),
          c.view.person?.name,
          c.view.person?.initials,
          c.view.player?.name,
          c.view.player?.meta,
          c.view.foot?.value,
        ].filter((s): s is string => typeof s === "string");
        for (const s of strings) {
          expect(s, `${c.key} in ${rosterId}`).not.toMatch(/undefined|NaN|null/);
        }
      }
    }
  });

  it("ends on the archetype verdict, on the light surface, with its evidence", () => {
    for (const { rosterId, script } of scripts) {
      const cards = buildStoryCards(script, fallbackCopy(script), facts.teams[rosterId], facts);
      const finale = cards[cards.length - 1];
      expect(finale.isFinale).toBe(true);
      expect(finale.layout).toBe("verdict");
      expect(finale.tone).toBe("light");
      expect(finale.view.rows?.length).toBeGreaterThan(0);
      expect(finale.view.rows?.length).toBeLessThanOrEqual(3);
    }
  });

  it("attaches a headshot wherever the engine carried a ref", () => {
    for (const { rosterId, script } of scripts) {
      const cards = buildStoryCards(script, fallbackCopy(script), facts.teams[rosterId], facts);
      for (const [i, source] of script.cards.entries()) {
        if (!source.refs?.player) continue;
        const built = cards[i];
        const photo = built.view.player?.photo ?? built.view.versus?.[0]?.photo;
        expect(photo, `${source.insightId} in ${rosterId}`).toContain("sleepercdn.com");
      }
    }
  });
});
