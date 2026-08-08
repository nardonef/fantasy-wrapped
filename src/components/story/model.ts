import type { WrappedCopy } from "@/copy/schema";
import type { CardScript, PlayerRef, SeasonFacts, TeamSeasonFacts, WrappedCard } from "@/engine";
import { buildView, humanize } from "./view-builder";

/**
 * How a card is drawn. The shipped player had one layout for everything, so a
 * ten-card story read as one card ten times. The archetypes split by what the
 * card's numbers *are*: a season shape wants bars over time, a benching wants
 * two players side by side, an MVP wants a face.
 */
export type LayoutArchetype =
  | "statement"
  | "chart"
  | "versus"
  | "person"
  | "portrait"
  | "ledger"
  | "bars"
  | "verdict";

export type Tone = "light" | "dark";

/** Accent class name, already resolved for the card's surface. */
type Accent = string;

/** The numbers a layout draws. StoryPlayer renders this; it never invents it. */
export type CardView = {
  hero?: string;
  heroLabel?: string;
  heroAccent?: Accent;
  pair?: { label: string; value: string; accent: Accent }[];
  rows?: { label: string; value: string; accent: Accent }[];
  entries?: { label: string; text: string; accent: Accent }[];
  bars?: { week: number; value: number; highlight?: boolean }[];
  compare?: { label: string; value: string; width: string; positive: boolean }[];
  versus?: { label: string; name: string; photo?: string | null; positive: boolean }[];
  person?: { initials: string; name: string; meta: string; positive: boolean };
  player?: { name: string; meta?: string; photo?: string | null };
  foot?: { label: string; value: string; accent: Accent };
};

export type StoryCard = {
  key: string;
  /** Small label above the title, e.g. "REGRET · WEEK 5" */
  kicker: string;
  title: string;
  body: string;
  /** "flag" (blue) or "red" — which accent the kicker takes. */
  accent: "flag" | "red";
  /** Giant ghosted numeral behind the content, jumbotron-style. */
  ghost: string | null;
  layout: LayoutArchetype;
  tone: Tone;
  view: CardView;
  isFinale: boolean;
};

export const CATEGORY_LABEL: Record<string, string> = {
  identity: "Identity",
  regret: "Regret",
  luck: "The football gods",
  people: "Personnel",
  narrative: "The story",
  global: "The whole league of leagues",
};

/** One layout per insight. Anything unmapped falls back to `statement`. */
export const LAYOUT_BY_INSIGHT: Record<string, LayoutArchetype> = {
  "season-summary": "chart",
  "bench-points-total": "statement",
  "flippable-losses": "statement",
  "record-if-optimal": "statement",
  "worst-benching": "versus",
  "dropped-league-winner": "statement",
  "zero-hero": "statement",
  "schedule-luck": "bars",
  "opponent-season-highs": "ledger",
  "close-game-record": "statement",
  "combined-loss-margin": "statement",
  "points-against-extreme": "bars",
  "robbed-week": "statement",
  "daylight-robbery-win": "statement",
  "beat-the-champ": "person",
  nemesis: "person",
  victim: "person",
  mvp: "portrait",
  "draft-bust": "statement",
  "waiver-steal": "statement",
  "trade-verdict": "versus",
  "punching-bag": "statement",
  "peak-week": "statement",
  "collapse-week": "statement",
  streak: "chart",
  "season-arc": "chart",
  "draft-steal": "statement",
  "playoff-story": "statement",
  "transaction-extreme": "ledger",
  "faab-story": "ledger",
  volatility: "statement",
  "crowns-and-stinkers": "statement",
  "points-machine": "statement",
  "global-bench-regret-rate": "statement",
  "global-flippable-loss-rate": "statement",
  "global-all-play-win-pct": "statement",
  "global-luck-delta": "statement",
  "global-longest-win-streak": "statement",
  "global-longest-loss-streak": "statement",
  "global-transaction-activity": "statement",
};

/**
 * Cards whose numbers are a brag get the light surface. Surface follows
 * sentiment, not category — a winning streak inverts to paper, a losing streak
 * stays near-black. Ids that can go either way are read from their own facts.
 */
const ALWAYS_LIGHT = new Set([
  "peak-week",
  "mvp",
  "waiver-steal",
  "victim",
  "draft-steal",
  "beat-the-champ",
  "daylight-robbery-win",
  "punching-bag",
  "faab-story",
  // A long win streak is unambiguously good — unidirectional, only ever fires
  // as a brag. (global-longest-loss-streak is the wince mirror and is left
  // out of this set on purpose: dark via the default case is already correct.)
  "global-longest-win-streak",
  // "Most active manager" is framed as fun in this app's voice, not a moral
  // judgment — same treatment as waiver-steal/draft-steal above.
  "global-transaction-activity",
]);

export function toneFor(card: WrappedCard): Tone {
  const f = card.facts;
  if (card.category === "regret") return "dark";
  switch (card.insightId) {
    case "streak":
      return f.streakType === "winning" ? "light" : "dark";
    case "season-arc":
      return f.collapse ? "dark" : "light";
    case "trade-verdict":
      return f.wonTheTrade ? "light" : "dark";
    case "playoff-story":
      return f.finish === "champion" || f.finish === "runner-up" ? "light" : "dark";
    case "crowns-and-stinkers":
      // Crowns with no stinkers is a brag; any stinkers at all is a wince.
      return f.worstScoreWeeks == null ? "light" : "dark";
    case "transaction-extreme":
      return "dark";
    case "global-bench-regret-rate":
    case "global-flippable-loss-rate":
    case "global-all-play-win-pct":
    case "global-luck-delta":
      // bidirectional() in the engine is the only thing that ever sets
      // facts.direction, and it only ever sets "brag" or "wince".
      return f.direction === "brag" ? "light" : "dark";
    default:
      return ALWAYS_LIGHT.has(card.insightId) ? "light" : "dark";
  }
}

/**
 * Headshot URL from a PlayerRef. Returns null whenever the engine didn't carry
 * one, and every layout has a no-photo state, so a missing ref degrades to an
 * empty portrait rather than a broken image.
 */
export function headshot(ref?: PlayerRef, thumb = false): string | null {
  if (!ref?.providerPlayerId) return null;
  return `https://sleepercdn.com/content/nfl/players/${thumb ? "thumb/" : ""}${ref.providerPlayerId}.jpg`;
}

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

export function buildStoryCards(
  script: CardScript,
  copy: WrappedCopy,
  team: TeamSeasonFacts,
  facts: SeasonFacts,
): StoryCard[] {
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
    const layout = LAYOUT_BY_INSIGHT[card.insightId] ?? "statement";
    const tone = toneFor(card);
    const ghost = ghostFor(card.facts);
    return {
      key: `${i}-${card.insightId}`,
      kicker: kickerParts.join(" · "),
      title: c?.title ?? card.headline,
      body: c?.body ?? "",
      accent: card.category === "regret" ? "red" : "flag",
      ghost,
      layout,
      tone,
      view: buildView({ card, layout, tone, ghost, team, facts }),
      isFinale: false,
    };
  });

  // The finale is the archetype verdict: the accusation plus the evidence that
  // convicts, on the light surface. Its rows come from archetype.evidence, not
  // from a card's facts.
  cards.push({
    key: "finale",
    kicker: `${script.season} · Final verdict`,
    title: copy.archetype.title,
    body: copy.archetype.body,
    accent: "flag",
    ghost: null,
    layout: "verdict",
    tone: "light",
    view: {
      rows: script.archetype.evidence.slice(0, 3).map((e, i) => ({
        label: humanize(e.key),
        value: String(e.value),
        accent: i === 0 ? "text-flag-ink" : "text-paper-ink",
      })),
    },
    isFinale: true,
  });

  return cards;
}
