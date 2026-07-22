import type { WrappedCopy } from "@/copy/schema";
import type { CardScript } from "@/engine";

export type StoryCard = {
  key: string;
  /** Small label above the title, e.g. "REGRET · WEEK 5" */
  kicker: string;
  title: string;
  body: string;
  /** "flag" (yellow) or "red" — the referee card system. */
  accent: "flag" | "red";
  /** Giant ghosted numeral behind the content, jumbotron-style. */
  ghost: string | null;
  isFinale: boolean;
};

const CATEGORY_LABEL: Record<string, string> = {
  identity: "Identity",
  regret: "Regret",
  luck: "The football gods",
  people: "Personnel",
  narrative: "The story",
};

/** Largest meaningful number in the card's facts — the jumbotron numeral. */
function ghostFor(facts: Record<string, string | number | boolean | null>): string | null {
  let best: number | null = null;
  for (const value of Object.values(facts)) {
    if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) >= 2) {
      if (best === null || Math.abs(value) > Math.abs(best)) best = value;
    }
  }
  if (best === null) return null;
  return Number.isInteger(best) ? String(best) : best.toFixed(1);
}

export function buildStoryCards(script: CardScript, copy: WrappedCopy): StoryCard[] {
  const copyById = new Map(copy.cards.map((c) => [c.insightId, c]));
  const cards: StoryCard[] = script.cards.map((card, i) => {
    const c = copyById.get(card.insightId);
    const week = card.facts.week;
    const kickerParts = [
      card.insightId === "season-summary"
        ? "The record"
        : (CATEGORY_LABEL[card.category] ?? card.category),
    ];
    if (typeof week === "number") kickerParts.push(`Week ${week}`);
    return {
      key: `${i}-${card.insightId}`,
      kicker: kickerParts.join(" · "),
      title: c?.title ?? card.headline,
      body: c?.body ?? "",
      accent: card.category === "regret" ? "red" : "flag",
      ghost: ghostFor(card.facts),
      isFinale: false,
    };
  });

  cards.push({
    key: "finale",
    kicker: `${script.season} · Final verdict`,
    title: copy.archetype.title,
    body: copy.archetype.body,
    accent: "flag",
    ghost: null,
    isFinale: true,
  });

  return cards;
}
