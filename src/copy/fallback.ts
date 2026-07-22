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
      title: card.category === "identity" ? "Your season" : titleFor(card.category),
      body: card.headline,
    })),
    archetype: {
      title: script.archetype.name,
      body: Object.entries(script.archetype.evidence)
        .map(([k, v]) => `${humanize(k)}: ${v}`)
        .join(". "),
    },
  };
}

function titleFor(category: string): string {
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
      return "Your season";
  }
}

function humanize(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}
