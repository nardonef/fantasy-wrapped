import { describe, expect, it } from "vitest";
import type { GlobalStats } from "../types";
import { globalInsights } from "./global";

const FACTS = {} as never; // these modules never read `facts`, only `globalStats`
const ROSTER_ID = "1";

function moduleById(id: string) {
  const found = globalInsights.find((m) => m.id === id);
  if (!found) throw new Error(`no global insight module with id ${id}`);
  return found;
}

describe("globalInsights", () => {
  it("returns null when its stat's key is absent from GlobalStats (pool too small)", () => {
    const globalStats: GlobalStats = {};
    for (const module of globalInsights) {
      expect(module.compute(FACTS, ROSTER_ID, globalStats)).toBeNull();
    }
  });

  it("bench-regret-rate: brags at a high percentile", () => {
    const globalStats: GlobalStats = {
      benchRegretRatePercentile: { percentile: 96, poolSize: 300 },
    };
    const insight = moduleById("global-bench-regret-rate").compute(FACTS, ROSTER_ID, globalStats);
    expect(insight?.notability).toBeGreaterThanOrEqual(80);
    expect(insight?.facts.direction).toBe("brag");
    expect(insight?.facts.percentile).toBe(96);
    expect(insight?.facts.poolSize).toBe(300);
  });

  it("bench-regret-rate: winces at a low percentile", () => {
    const globalStats: GlobalStats = {
      benchRegretRatePercentile: { percentile: 4, poolSize: 300 },
    };
    const insight = moduleById("global-bench-regret-rate").compute(FACTS, ROSTER_ID, globalStats);
    expect(insight?.notability).toBeGreaterThanOrEqual(80);
    expect(insight?.facts.direction).toBe("wince");
    expect(insight?.facts.percentile).toBe(96); // 100 - 4, reframed toward the wince
  });

  it("bench-regret-rate: null in the unremarkable middle", () => {
    const globalStats: GlobalStats = {
      benchRegretRatePercentile: { percentile: 55, poolSize: 300 },
    };
    expect(
      moduleById("global-bench-regret-rate").compute(FACTS, ROSTER_ID, globalStats),
    ).toBeNull();
  });

  it("longest-loss-streak: only ever wince-framed, fires at a high percentile", () => {
    const globalStats: GlobalStats = {
      longestLossStreakPercentile: { percentile: 92, poolSize: 300 },
    };
    const insight = moduleById("global-longest-loss-streak").compute(FACTS, ROSTER_ID, globalStats);
    expect(insight?.notability).toBeGreaterThanOrEqual(70);
    expect(insight?.facts.percentile).toBe(92);
    expect(insight?.facts.direction).toBeUndefined();
  });

  it("longest-win-streak: unidirectional, fires at a high percentile", () => {
    const globalStats: GlobalStats = {
      longestWinStreakPercentile: { percentile: 88, poolSize: 300 },
    };
    const insight = moduleById("global-longest-win-streak").compute(FACTS, ROSTER_ID, globalStats);
    expect(insight?.notability).toBeGreaterThanOrEqual(62);
    expect(insight?.facts.percentile).toBe(88);
    expect(insight?.facts.direction).toBeUndefined();
  });

  it("transaction-activity: fires only at a high percentile, null otherwise", () => {
    const module = moduleById("global-transaction-activity");
    expect(
      module.compute(FACTS, ROSTER_ID, {
        transactionTotalPercentile: { percentile: 93, poolSize: 300 },
      })?.notability,
    ).toBeGreaterThanOrEqual(70);
    expect(
      module.compute(FACTS, ROSTER_ID, {
        transactionTotalPercentile: { percentile: 20, poolSize: 300 },
      }),
    ).toBeNull();
  });

  it("every module has category global and a unique id", () => {
    const ids = globalInsights.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of globalInsights) expect(m.category).toBe("global");
  });
});

describe("notabilityFromExtremity thresholds", () => {
  // Test boundary values through a unidirectional module
  const module = moduleById("global-longest-win-streak");

  const boundaryTests = [
    { percentile: 59, expected: null },
    { percentile: 60, expected: 48 },
    { percentile: 79, expected: 48 },
    { percentile: 80, expected: 62 },
    { percentile: 89, expected: 62 },
    { percentile: 90, expected: 78 },
    { percentile: 94, expected: 78 },
    { percentile: 95, expected: 90 },
  ];

  for (const { percentile, expected } of boundaryTests) {
    it(`percentile ${percentile} yields notability ${expected}`, () => {
      const insight = module.compute(FACTS, ROSTER_ID, {
        longestWinStreakPercentile: { percentile, poolSize: 300 },
      });
      if (expected === null) {
        expect(insight).toBeNull();
      } else {
        expect(insight?.notability).toBe(expected);
      }
    });
  }
});
