import { computeCandidates } from "./insights";
import { formatRecord, ordinal, round1 } from "./insights/helpers";
import type { CandidateInsight, InsightCategory, SeasonFacts, WrappedCard } from "./types";

/** Below this, a card never ships. Boring managers get shorter Wrappeds. */
const NOTABILITY_FLOOR = 45;
const MAX_CARDS = 9;
const CATEGORY_CAPS: Record<InsightCategory, number> = {
  // Three, because regret is where the best material is: a manager who wasted
  // the most points in the league, lost games they had already won, AND
  // benched the difference-maker has three distinct cards, not two. Measured
  // across both fixture leagues: +11 cards over 20 managers, and every card it
  // displaces is replaced by a higher-notability one.
  regret: 3,
  luck: 2,
  people: 3,
  narrative: 2,
  identity: 1, // the opener is already an identity card
};

/** Narrative grammar: the order categories appear in the story. */
const CATEGORY_ORDER: InsightCategory[] = ["identity", "regret", "luck", "people", "narrative"];

function summaryCard(facts: SeasonFacts, rosterId: string): WrappedCard {
  const t = facts.teams[rosterId];
  const finish =
    t.finalRank != null
      ? t.playoffs.champion
        ? "league champion"
        : `${ordinal(t.finalRank)} place`
      : `${ordinal(t.standingsRank)} in the standings`;
  return {
    insightId: "season-summary",
    category: "identity",
    headline: `${formatRecord(t.record)}. ${round1(t.pointsFor)} points. ${finish}.`,
    facts: {
      record: formatRecord(t.record),
      pointsFor: round1(t.pointsFor),
      pointsForRank: t.pointsForRank,
      finish,
      finalRank: t.finalRank,
      standingsRank: t.standingsRank,
      leagueSize: facts.league.totalTeams,
    },
  };
}

/**
 * Cut candidates to the cards that ship, in story order.
 * Dedupe by topic (best wins), floor on notability, cap per category,
 * then order by narrative grammar with the finish card last.
 */
export function selectCards(facts: SeasonFacts, rosterId: string): WrappedCard[] {
  const candidates = computeCandidates(facts, rosterId);

  const byTopic = new Map<string, CandidateInsight>();
  const chosen: CandidateInsight[] = [];
  for (const c of candidates) {
    if (c.notability < NOTABILITY_FLOOR) continue;
    if (c.topic) {
      if (byTopic.has(c.topic)) continue;
      byTopic.set(c.topic, c);
    }
    chosen.push(c);
  }

  const capped: CandidateInsight[] = [];
  const counts: Record<InsightCategory, number> = {
    regret: 0,
    luck: 0,
    people: 0,
    narrative: 0,
    identity: 0,
  };
  for (const c of chosen) {
    if (counts[c.category] >= CATEGORY_CAPS[c.category]) continue;
    counts[c.category]++;
    capped.push(c);
    if (capped.length >= MAX_CARDS) break;
  }

  // Story order: category grammar, notability desc within category,
  // except the season finish (playoff-story) always lands last.
  const finish = capped.filter((c) => c.topic === "finish");
  const rest = capped.filter((c) => c.topic !== "finish");
  const ordered = CATEGORY_ORDER.flatMap((cat) =>
    rest.filter((c) => c.category === cat).sort((a, b) => b.notability - a.notability),
  );

  return [
    summaryCard(facts, rosterId),
    ...[...ordered, ...finish].map((c) => ({
      insightId: c.id,
      category: c.category,
      headline: c.headline,
      facts: c.facts,
      ...(c.refs ? { refs: c.refs } : {}),
    })),
  ];
}
