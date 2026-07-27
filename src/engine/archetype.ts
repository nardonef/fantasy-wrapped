import { formatRecord, isLast, rankIn, round1 } from "./insights/helpers";
import type { Archetype, SeasonFacts, TeamSeasonFacts } from "./types";

type ArchetypeRule = {
  id: string;
  name: string;
  matches: (facts: SeasonFacts, t: TeamSeasonFacts) => boolean;
  /**
   * Authored as an object literal for readability; declaration order is the
   * evidence order and is preserved into the ordered array on Archetype.
   */
  evidence: (facts: SeasonFacts, t: TeamSeasonFacts) => Record<string, string | number>;
  /** When several teams match, the highest strength claims the archetype. */
  strength?: (facts: SeasonFacts, t: TeamSeasonFacts) => number;
};

/**
 * First matching rule wins — ordered from most specific/extreme to fallback.
 * Every archetype is an accusation backed by this season's numbers.
 */
const RULES: ArchetypeRule[] = [
  {
    id: "the-inevitable",
    name: "The Inevitable",
    matches: (facts, t) =>
      t.playoffs.champion && rankIn(facts.rankings.allPlayWinPct, t.rosterId) <= 2,
    evidence: (_f, t) => ({
      finish: "champion",
      record: formatRecord(t.record),
      allPlay: `${t.allPlay.wins}-${t.allPlay.losses}`,
      pointsForRank: t.pointsForRank,
    }),
  },
  {
    id: "the-heist",
    name: "The Heist",
    matches: (facts, t) =>
      t.playoffs.champion &&
      (rankIn(facts.rankings.luck, t.rosterId) <= 3 ||
        rankIn(facts.rankings.allPlayWinPct, t.rosterId) > Math.ceil(facts.league.totalTeams / 2)),
    evidence: (facts, t) => ({
      finish: "champion",
      deservedWins: round1(t.expectedWins),
      actualWins: t.record.wins,
      allPlayRank: rankIn(facts.rankings.allPlayWinPct, t.rosterId),
    }),
  },
  {
    id: "the-closer",
    name: "The Closer",
    matches: (_f, t) => t.playoffs.champion,
    evidence: (_f, t) => ({
      finish: "champion",
      record: formatRecord(t.record),
      pointsForRank: t.pointsForRank,
    }),
  },
  {
    id: "the-almost",
    name: "The Almost",
    matches: (_f, t) => t.playoffs.runnerUp,
    evidence: (_f, t) => {
      const final = t.weeks.find((w) => w.bracketRound === "championship");
      return {
        finish: "runner-up",
        finalMargin: final?.margin != null ? round1(Math.abs(final.margin)) : "—",
        record: formatRecord(t.record),
      };
    },
  },
  {
    id: "the-saboteur",
    name: "The Saboteur",
    matches: (facts, t) =>
      rankIn(facts.rankings.benchRegret, t.rosterId) === 1 && t.flippableLosses.length >= 3,
    evidence: (_f, t) => ({
      benchPointsWasted: round1(t.benchRegretTotal),
      lossesYouCouldHaveWon: t.flippableLosses.length,
      actualRecord: formatRecord(t.record),
      optimalRecord: formatRecord(t.optimalRecord),
    }),
  },
  {
    id: "the-what-if",
    name: "The What-If",
    matches: (_f, t) => !t.playoffs.made && t.flippableLosses.length >= 4,
    strength: (_f, t) => t.flippableLosses.length,
    evidence: (_f, t) => ({
      lossesYouCouldHaveWon: t.flippableLosses.length,
      actualRecord: formatRecord(t.record),
      optimalRecord: formatRecord(t.optimalRecord),
      finish: "missed playoffs",
    }),
  },
  {
    id: "the-schedule-victim",
    name: "The Schedule Victim",
    matches: (facts, t) =>
      !t.playoffs.made &&
      isLast(facts.rankings.luck, t.rosterId, facts) &&
      rankIn(facts.rankings.allPlayWinPct, t.rosterId) <= 3,
    evidence: (facts, t) => ({
      allPlayRank: rankIn(facts.rankings.allPlayWinPct, t.rosterId),
      deservedWins: round1(t.expectedWins),
      actualWins: t.record.wins,
      finish: "missed playoffs",
    }),
  },
  {
    id: "the-punching-bag",
    name: "The Punching Bag",
    matches: (_f, t) => t.pointsAgainstRank === 1 && !t.playoffs.champion && !t.playoffs.runnerUp,
    evidence: (_f, t) => ({
      pointsAgainst: round1(t.pointsAgainst),
      pointsAgainstRank: 1,
      record: formatRecord(t.record),
      finish: t.playoffs.made ? "playoff exit" : "missed playoffs",
    }),
  },
  {
    id: "the-lottery-winner",
    name: "The Lottery Winner",
    matches: (facts, t) =>
      t.playoffs.made &&
      rankIn(facts.rankings.luck, t.rosterId) === 1 &&
      t.pointsForRank > facts.league.totalTeams / 2,
    evidence: (_f, t) => ({
      actualWins: t.record.wins,
      deservedWins: round1(t.expectedWins),
      pointsForRank: t.pointsForRank,
      finish: "made playoffs",
    }),
  },
  {
    id: "the-regular-season-merchant",
    name: "The Regular-Season Merchant",
    matches: (_f, t) => t.standingsRank === 1 && !t.playoffs.champion,
    evidence: (_f, t) => ({
      regularSeason: formatRecord(t.record),
      seed: 1,
      finish: t.playoffs.exitRound ?? "playoff exit",
    }),
  },
  {
    id: "the-first-one-out",
    name: "The First One Out",
    matches: (facts, t) => {
      const playoffSpots = Object.values(facts.teams).filter((x) => x.playoffs.made).length;
      return !t.playoffs.made && playoffSpots > 0 && t.standingsRank === playoffSpots + 1;
    },
    evidence: (facts, t) => ({
      record: formatRecord(t.record),
      standingsRank: t.standingsRank,
      playoffSpots: Object.values(facts.teams).filter((x) => x.playoffs.made).length,
    }),
  },
  {
    id: "the-heartbreak-kid",
    name: "The Heartbreak Kid",
    matches: (_f, t) => t.closeGames.losses >= 3 && t.closeGames.wins === 0,
    evidence: (_f, t) => ({
      closeLosses: t.closeGames.losses,
      closeWins: t.closeGames.wins,
      marginThreshold: t.closeGames.threshold,
      record: formatRecord(t.record),
    }),
  },
  {
    id: "the-doormat",
    name: "The Doormat",
    matches: (facts, t) =>
      t.standingsRank === facts.league.totalTeams &&
      isLast(facts.rankings.pointsFor, t.rosterId, facts),
    evidence: (_f, t) => ({
      record: formatRecord(t.record),
      pointsFor: round1(t.pointsFor),
      finish: "last place",
    }),
  },
  {
    id: "the-empire-of-nothing",
    name: "The Empire of Nothing",
    matches: (_f, t) => t.pointsForRank === 1 && !t.playoffs.champion,
    evidence: (_f, t) => ({
      pointsFor: round1(t.pointsFor),
      pointsForRank: 1,
      finish: t.playoffs.made ? (t.playoffs.exitRound ?? "playoff exit") : "missed playoffs",
    }),
  },
  {
    id: "the-regifter",
    name: "The Regifter",
    matches: (_f, t) => t.drops.some((d) => d.pointsAfterDrop >= 200),
    strength: (_f, t) => Math.max(...t.drops.map((d) => d.pointsAfterDrop), 0),
    evidence: (_f, t) => {
      const worst = [...t.drops].sort((a, b) => b.pointsAfterDrop - a.pointsAfterDrop)[0];
      return {
        dropped: worst.player.name,
        droppedWeek: worst.week,
        pointsAfterDrop: round1(worst.pointsAfterDrop),
        record: formatRecord(t.record),
      };
    },
  },
  {
    id: "the-career-maker",
    name: "The Career Maker",
    matches: (_f, t) =>
      t.opponentSeasonHighs.filter((h) => t.weeks.find((w) => w.week === h.week)?.result === "L")
        .length >= 3,
    evidence: (facts, t) => {
      const painful = t.opponentSeasonHighs.filter(
        (h) => t.weeks.find((w) => w.week === h.week)?.result === "L",
      );
      return {
        careersMade: painful.length,
        victims: painful
          .map((h) => facts.teams[h.opponentRosterId]?.displayName ?? h.opponentRosterId)
          .join(", "),
        record: formatRecord(t.record),
      };
    },
  },
  {
    id: "the-front-runner",
    name: "The Front Runner",
    matches: (_f, t) => {
      const regular = t.weeks.filter((w) => !w.isPlayoff && w.result !== null);
      if (regular.length < 8) return false;
      const half = Math.floor(regular.length / 2);
      const w1 = regular.slice(0, half).filter((w) => w.result === "W").length;
      const w2 = regular.slice(half).filter((w) => w.result === "W").length;
      return w1 - w2 >= 3 && !t.playoffs.champion;
    },
    evidence: (_f, t) => {
      const regular = t.weeks.filter((w) => !w.isPlayoff && w.result !== null);
      const half = Math.floor(regular.length / 2);
      const w1 = regular.slice(0, half).filter((w) => w.result === "W").length;
      const w2 = regular.slice(half).filter((w) => w.result === "W").length;
      return {
        firstHalf: `${w1}-${half - w1}`,
        secondHalf: `${w2}-${regular.length - half - w2}`,
        finish: t.finalRank ?? t.standingsRank,
      };
    },
  },
  {
    id: "the-late-bloomer",
    name: "The Late Bloomer",
    matches: (_f, t) => {
      const regular = t.weeks.filter((w) => !w.isPlayoff && w.result !== null);
      if (regular.length < 8) return false;
      const half = Math.floor(regular.length / 2);
      const w1 = regular.slice(0, half).filter((w) => w.result === "W").length;
      const w2 = regular.slice(half).filter((w) => w.result === "W").length;
      return w2 - w1 >= 3 && t.playoffs.made;
    },
    evidence: (_f, t) => {
      const regular = t.weeks.filter((w) => !w.isPlayoff && w.result !== null);
      const half = Math.floor(regular.length / 2);
      const w1 = regular.slice(0, half).filter((w) => w.result === "W").length;
      const w2 = regular.slice(half).filter((w) => w.result === "W").length;
      return {
        firstHalf: `${w1}-${half - w1}`,
        secondHalf: `${w2}-${regular.length - half - w2}`,
        finish: t.finalRank ?? t.standingsRank,
      };
    },
  },
  {
    id: "the-scavenger",
    name: "The Scavenger",
    matches: (_f, t) =>
      t.pickups.some(
        (p) =>
          p.restOfSeasonStartedPoints >= 180 &&
          p.player.position != null &&
          !["DEF", "K"].includes(p.player.position),
      ),
    strength: (_f, t) => Math.max(...t.pickups.map((p) => p.restOfSeasonStartedPoints), 0),
    evidence: (_f, t) => {
      const best = [...t.pickups]
        .filter((p) => p.player.position && !["DEF", "K"].includes(p.player.position))
        .sort((a, b) => b.restOfSeasonStartedPoints - a.restOfSeasonStartedPoints)[0];
      return {
        pickup: best.player.name,
        week: best.week,
        pointsAfterPickup: round1(best.restOfSeasonStartedPoints),
        faab: best.faab ?? 0,
      };
    },
  },
  {
    id: "the-coin-flipper",
    name: "The Coin Flipper",
    matches: (_f, t) => t.closeGames.wins + t.closeGames.losses >= 5,
    evidence: (_f, t) => ({
      closeGames: t.closeGames.wins + t.closeGames.losses,
      closeRecord: `${t.closeGames.wins}-${t.closeGames.losses}`,
      marginThreshold: t.closeGames.threshold,
      record: formatRecord(t.record),
    }),
  },
  {
    id: "the-day-trader",
    name: "The Day Trader",
    matches: (facts, t) =>
      rankIn(facts.rankings.transactionVolume, t.rosterId) === 1 && t.transactionCounts.total >= 30,
    evidence: (_f, t) => ({
      totalMoves: t.transactionCounts.total,
      waivers: t.transactionCounts.waivers,
      trades: t.transactionCounts.trades,
      finish: t.finalRank ?? t.standingsRank,
    }),
  },
  {
    id: "the-ghost",
    name: "The Ghost",
    matches: (facts, t) =>
      isLast(facts.rankings.transactionVolume, t.rosterId, facts) && t.transactionCounts.total <= 5,
    evidence: (_f, t) => ({
      totalMoves: t.transactionCounts.total,
      record: formatRecord(t.record),
      finish: t.finalRank ?? t.standingsRank,
    }),
  },
  {
    id: "the-rollercoaster",
    name: "The Rollercoaster",
    matches: (facts, t) =>
      rankIn(facts.rankings.volatility, t.rosterId) === 1 &&
      (t.weeklyCrowns >= 1 || t.weeklyStinkers >= 1),
    evidence: (_f, t) => ({
      bestWeek: round1(t.highWeek.score),
      worstWeek: round1(t.lowWeek.score),
      topScoreWeeks: t.weeklyCrowns,
      worstScoreWeeks: t.weeklyStinkers,
    }),
  },
  {
    id: "the-bench-warmer",
    name: "The Bench Warmer",
    matches: (facts, t) => rankIn(facts.rankings.benchRegret, t.rosterId) === 1,
    evidence: (_f, t) => ({
      benchPointsWasted: round1(t.benchRegretTotal),
      optimalRecord: formatRecord(t.optimalRecord),
      actualRecord: formatRecord(t.record),
    }),
  },
  {
    id: "the-middle-manager",
    name: "The Middle Manager",
    matches: () => true,
    evidence: (facts, t) => ({
      record: formatRecord(t.record),
      standingsRank: t.standingsRank,
      leagueSize: facts.league.totalTeams,
      pointsForRank: t.pointsForRank,
    }),
  },
];

const FALLBACK_RULE_ID = "the-middle-manager";

/** Freeze the literal's declaration order before it can reach jsonb. */
function toEvidence(record: Record<string, string | number>): Archetype["evidence"] {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

/**
 * Assign archetypes for the whole league at once. Each archetype is claimed
 * at most once per league (the finale is a group-chat comparison — ten
 * identical titles kill the punchline); when several teams match a rule, the
 * strongest claim wins and the rest fall through. Only the fallback repeats.
 */
export function classifyLeagueArchetypes(facts: SeasonFacts): Map<string, Archetype> {
  const assigned = new Map<string, Archetype>();
  const unassigned = new Set(Object.keys(facts.teams));

  for (const rule of RULES) {
    if (rule.id === FALLBACK_RULE_ID) continue;
    const claimants = [...unassigned]
      .map((rosterId) => facts.teams[rosterId])
      .filter((t) => rule.matches(facts, t));
    if (claimants.length === 0) continue;
    const winner = claimants.sort(
      (a, b) =>
        (rule.strength?.(facts, b) ?? -b.standingsRank) -
          (rule.strength?.(facts, a) ?? -a.standingsRank) ||
        Number(a.rosterId) - Number(b.rosterId),
    )[0];
    assigned.set(winner.rosterId, {
      id: rule.id,
      name: rule.name,
      evidence: toEvidence(rule.evidence(facts, winner)),
    });
    unassigned.delete(winner.rosterId);
  }

  const fallback = RULES.find((r) => r.id === FALLBACK_RULE_ID);
  if (!fallback) throw new Error("fallback rule missing");
  for (const rosterId of unassigned) {
    const t = facts.teams[rosterId];
    assigned.set(rosterId, {
      id: fallback.id,
      name: fallback.name,
      evidence: toEvidence(fallback.evidence(facts, t)),
    });
  }
  return assigned;
}

export function classifyArchetype(facts: SeasonFacts, rosterId: string): Archetype {
  const archetype = classifyLeagueArchetypes(facts).get(rosterId);
  if (!archetype) throw new Error(`Unknown rosterId ${rosterId}`);
  return archetype;
}
