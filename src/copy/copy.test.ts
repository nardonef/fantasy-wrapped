import { describe, expect, it } from "vitest";
import type { CardScript, WrappedCard } from "@/engine";
import { fallbackCopy } from "./fallback";
import type { WrappedCopy } from "./schema";
import { validateCardCopy } from "./validate";
import { buildPrompt, writeCopy } from "./writer";

const card = (facts: WrappedCard["facts"]): WrappedCard => ({
  insightId: "test-card",
  category: "regret",
  headline: "working headline",
  facts,
});

describe("validateCardCopy", () => {
  it("passes when all numbers appear verbatim", () => {
    const c = card({ totalBenchPoints: 504.6, perWeek: 36, leagueRank: 1 });
    const result = validateCardCopy(c, {
      title: "504.6 points, wasted",
      body: "That is 36 a week you left sitting there.",
    });
    expect(result.valid).toBe(true);
  });

  it("fails when a number is rounded or missing", () => {
    const c = card({ totalBenchPoints: 504.6 });
    const result = validateCardCopy(c, { title: "505 points wasted", body: "Roughly." });
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(["504.6"]);
  });

  it("does not accept a number embedded in a longer number", () => {
    const c = card({ margin: 24 });
    expect(validateCardCopy(c, { title: "Lost by 124", body: "" }).valid).toBe(false);
    expect(validateCardCopy(c, { title: "Lost by 24.5", body: "" }).valid).toBe(false);
    expect(validateCardCopy(c, { title: "Lost by 24", body: "" }).valid).toBe(true);
  });

  it("requires records verbatim and ignores flags and small numbers", () => {
    const c = card({ actualRecord: "4-10", costTheGame: true, week: 1 });
    expect(validateCardCopy(c, { title: "You went 4-10", body: "" }).valid).toBe(true);
    expect(validateCardCopy(c, { title: "You went 10-4", body: "" }).valid).toBe(false);
  });
});

const script: CardScript = {
  engineVersion: "0.1.0",
  leagueName: "Test League",
  season: 2025,
  rosterId: "1",
  managerName: "TestManager",
  teamName: null,
  cards: [
    {
      insightId: "season-summary",
      category: "identity",
      headline: "4-10. 1394.4 points. 10th place.",
      facts: { record: "4-10", pointsFor: 1394.4 },
    },
    {
      insightId: "flippable-losses",
      category: "regret",
      headline: "6 of your losses were already wins",
      facts: { flippableLosses: 6, actualRecord: "4-10" },
    },
  ],
  archetype: {
    id: "the-saboteur",
    name: "The Saboteur",
    evidence: { benchPointsWasted: 504.6, actualRecord: "4-10" },
  },
};

const goodCopy: WrappedCopy = {
  cards: [
    {
      insightId: "season-summary",
      title: "The season on paper",
      body: "4-10 with 1394.4 points. The paper was not kind.",
    },
    {
      insightId: "flippable-losses",
      title: "Six wins, still on your bench",
      body: "6 of your losses were wins with the right lineup. You went 4-10 anyway.",
    },
  ],
  archetype: { title: "The Saboteur", body: "504.6 points dead on the bench. 4-10." },
};

describe("writeCopy", () => {
  it("returns generated copy when validation passes", async () => {
    const result = await writeCopy(script, async () => goodCopy);
    expect(result.usedFallback).toBe(false);
    expect(result.copy.cards[1].title).toBe("Six wins, still on your bench");
  });

  it("retries with feedback, then salvages per-card with fallback", async () => {
    const badCopy: WrappedCopy = {
      ...goodCopy,
      cards: [
        goodCopy.cards[0],
        {
          insightId: "flippable-losses",
          title: "Some losses were winnable",
          body: "You went 4-10.", // missing the "6"
        },
      ],
    };
    const prompts: string[] = [];
    const result = await writeCopy(script, async (prompt) => {
      prompts.push(prompt);
      return badCopy;
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("missing the exact numbers: 6");
    expect(result.usedFallback).toBe(true);
    // Valid card kept from generation; broken card fell back to the headline.
    expect(result.copy.cards[0].title).toBe("The season on paper");
    expect(result.copy.cards[1].body).toBe("6 of your losses were already wins");
  });

  it("falls back entirely when generation throws", async () => {
    const result = await writeCopy(script, async () => {
      throw new Error("api down");
    });
    expect(result.usedFallback).toBe(true);
    expect(result.model).toBe("fallback");
    expect(result.copy.cards).toHaveLength(2);
  });

  it("builds a prompt embedding the tone guide and exact facts", () => {
    const prompt = buildPrompt(script);
    expect(prompt).toContain("Tone Guide");
    expect(prompt).toContain("504.6");
    expect(prompt).toContain("TestManager");
  });
});

describe("fallbackCopy", () => {
  it("ships headlines as bodies with archetype evidence", () => {
    const fb = fallbackCopy(script);
    expect(fb.cards[1].body).toBe("6 of your losses were already wins");
    expect(fb.archetype.title).toBe("The Saboteur");
    expect(fb.archetype.body).toContain("504.6");
  });
});
