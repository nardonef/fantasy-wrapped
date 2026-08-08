import type { CandidateInsight, GlobalStats } from "../types";
import type { InsightModule } from "./helpers";

/** `pct` is already oriented so 100 = most notable in the caller's direction. */
function notabilityFromExtremity(pct: number): number | null {
  if (pct < 60) return null;
  if (pct >= 95) return 90;
  if (pct >= 90) return 78;
  if (pct >= 80) return 62;
  return 48;
}

function poolPhrase(poolSize: number): string {
  return `${poolSize} team-seasons tracked`;
}

/** The 4 GlobalStats keys notable in either direction — see BidirectionalGlobalStatEntry. */
type BidirectionalStatKey =
  | "benchRegretRatePercentile"
  | "flippableLossRatePercentile"
  | "allPlayWinPctPercentile"
  | "luckDeltaPercentile";

/**
 * A stat where a high percentile is a brag and a low percentile is a wince
 * (e.g. "beats 92%" vs. "worse than 90%"), sharing one GlobalStats entry.
 * Picks whichever direction is more notable; null if neither clears the floor.
 */
function bidirectional(
  id: string,
  key: BidirectionalStatKey,
  bragHeadline: (pct: number, pool: number) => string,
  winceHeadline: (pct: number, pool: number) => string,
): InsightModule {
  return {
    id,
    category: "global",
    compute(_facts, _rosterId, globalStats): CandidateInsight | null {
      const entry = globalStats[key];
      if (!entry) return null;
      const bragNotability = notabilityFromExtremity(entry.percentile);
      // Queried independently, not derived as 100 - percentile — with real
      // tie mass those two numbers diverge (see BidirectionalGlobalStatEntry).
      const wincePct = entry.inversePercentile;
      const winceNotability = notabilityFromExtremity(wincePct);
      if (
        bragNotability !== null &&
        (winceNotability === null || bragNotability >= winceNotability)
      ) {
        return {
          id,
          category: "global",
          notability: bragNotability,
          headline: bragHeadline(entry.percentile, entry.poolSize),
          facts: { percentile: entry.percentile, poolSize: entry.poolSize, direction: "brag" },
        };
      }
      if (winceNotability !== null) {
        return {
          id,
          category: "global",
          notability: winceNotability,
          headline: winceHeadline(wincePct, entry.poolSize),
          facts: { percentile: wincePct, poolSize: entry.poolSize, direction: "wince" },
        };
      }
      return null;
    },
  };
}

/** A stat with only one notable direction (e.g. a long losing streak is only ever a wince). */
function unidirectional(
  id: string,
  key: keyof GlobalStats,
  headline: (pct: number, pool: number) => string,
): InsightModule {
  return {
    id,
    category: "global",
    compute(_facts, _rosterId, globalStats): CandidateInsight | null {
      const entry = globalStats[key];
      if (!entry) return null;
      const notability = notabilityFromExtremity(entry.percentile);
      if (notability === null) return null;
      return {
        id,
        category: "global",
        notability,
        headline: headline(entry.percentile, entry.poolSize),
        facts: { percentile: entry.percentile, poolSize: entry.poolSize },
      };
    },
  };
}

export const globalInsights: InsightModule[] = [
  bidirectional(
    "global-bench-regret-rate",
    "benchRegretRatePercentile",
    (pct, pool) => `Your bench regret rate beats ${pct}% of ${poolPhrase(pool)}`,
    (pct, pool) => `Your bench regret rate is worse than ${pct}% of ${poolPhrase(pool)}`,
  ),
  bidirectional(
    "global-flippable-loss-rate",
    "flippableLossRatePercentile",
    (pct, pool) => `You flip losses into wins better than ${pct}% of ${poolPhrase(pool)}`,
    (pct, pool) => `You leave more losses on the table than ${pct}% of ${poolPhrase(pool)}`,
  ),
  bidirectional(
    "global-all-play-win-pct",
    "allPlayWinPctPercentile",
    (pct, pool) => `Your all-play win rate beats ${pct}% of ${poolPhrase(pool)}`,
    (pct, pool) => `Your all-play win rate trails ${pct}% of ${poolPhrase(pool)}`,
  ),
  bidirectional(
    "global-luck-delta",
    "luckDeltaPercentile",
    (pct, pool) => `You're luckier than ${pct}% of ${poolPhrase(pool)}`,
    (pct, pool) => `You're unluckier than ${pct}% of ${poolPhrase(pool)}`,
  ),
  unidirectional(
    "global-longest-win-streak",
    "longestWinStreakPercentile",
    (pct, pool) => `Your longest win streak beats ${pct}% of ${poolPhrase(pool)}`,
  ),
  unidirectional(
    "global-longest-loss-streak",
    "longestLossStreakPercentile",
    (pct, pool) => `Your longest losing streak is longer than ${pct}% of ${poolPhrase(pool)}`,
  ),
  unidirectional(
    "global-transaction-activity",
    "transactionTotalPercentile",
    (pct, pool) => `You made more moves than ${pct}% of ${poolPhrase(pool)}`,
  ),
];
