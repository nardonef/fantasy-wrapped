import type { CardScript } from "@/engine";
import type { WrappedCopy } from "./schema";

/**
 * Deterministic fallback when generation fails or a card flunks validation:
 * the engine's working headlines are already factual and reasonably sharp,
 * so ship them as copy rather than shipping nothing.
 */
export function fallbackCopy(script: CardScript): WrappedCopy {
  return {
    cards: script.cards.map((card) => ({
      insightId: card.insightId,
      title:
        card.insightId === "season-summary"
          ? "The season on paper"
          : titleFor(card.category, card.insightId),
      body: card.headline,
    })),
    archetype: {
      title: script.archetype.name,
      body: script.archetype.evidence
        .map((e) => `${humanize(e.key)}: ${e.value}`)
        .join(". "),
    },
  };
}

/** Varied per insight so consecutive fallback cards never share a title. */
const FALLBACK_TITLES: Record<string, string> = {
  "bench-points-total": "Dead points society",
  "flippable-losses": "The wins were right there",
  "record-if-optimal": "On paper, a contender",
  "worst-benching": "The one you want back",
  "dropped-league-winner": "You let him walk",
  "zero-hero": "Started a ghost",
  "schedule-luck": "The schedule had opinions",
  "opponent-season-highs": "The career maker",
  "close-game-record": "Coin-flip season",
  "combined-loss-margin": "Death by paper cuts",
  "points-against-extreme": "Everyone brought their best",
  "robbed-week": "Robbed in daylight",
  "daylight-robbery-win": "You stole one",
  "beat-the-champ": "You owned the champ",
  nemesis: "Your nemesis",
  victim: "Your favorite opponent",
  mvp: "The franchise player",
  "draft-bust": "The draft-day mistake",
  "waiver-steal": "The heist",
  "trade-verdict": "The trade",
  "punching-bag": "Big-game hunter",
  "peak-week": "The ceiling",
  "collapse-week": "The floor",
  streak: "The streak",
  "season-arc": "A season in two acts",
  "draft-steal": "The late-round gem",
  "playoff-story": "How it ended",
  "transaction-extreme": "The activity log",
  "faab-story": "The budget",
  volatility: "The variance",
  "crowns-and-stinkers": "No in-between",
  "points-machine": "The scoreboard",
};

function titleFor(category: string, insightId: string): string {
  const specific = FALLBACK_TITLES[insightId];
  if (specific) return specific;
  switch (category) {
    case "regret":
      return "The one you want back";
    case "luck":
      return "The football gods";
    case "people":
      return "Personnel file";
    case "narrative":
      return "How it went";
    default:
      return "For the record";
  }
}

function humanize(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}
