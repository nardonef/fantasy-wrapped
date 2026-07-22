import type { WrappedCard } from "@/engine";

/**
 * The LLM writes the sentence; it may never alter the stats.
 * A card's copy must contain, verbatim, every meaningful number from its
 * facts — same decimal representation the engine produced.
 */

/** Numbers the copy must reproduce. 0/1 are usually flags or trivia; skip. */
function requiredNumbers(facts: WrappedCard["facts"]): string[] {
  const required: string[] = [];
  for (const value of Object.values(facts)) {
    if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) >= 2) {
      required.push(String(value));
    }
    // Records like "4-10" or "10-4-1" must survive verbatim.
    if (typeof value === "string" && /^\d+-\d+(-\d+)?$/.test(value)) {
      required.push(value);
    }
  }
  return required;
}

/** True when `text` contains `num` as a standalone number (not inside another). */
function containsNumber(text: string, num: string): boolean {
  const escaped = num.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Reject when embedded in a longer number: preceded by a digit/decimal, or
  // followed by a digit or a decimal fraction ("24" must not match "124",
  // "24.5", or "3.24" — but "24." ending a sentence is fine).
  return new RegExp(`(?<![\\d.])${escaped}(?!\\d|\\.\\d)`).test(text);
}

export function validateCardCopy(
  card: WrappedCard,
  copy: { title: string; body: string },
): { valid: boolean; missing: string[] } {
  const text = `${copy.title} ${copy.body}`;
  const missing = requiredNumbers(card.facts).filter((num) => !containsNumber(text, num));
  return { valid: missing.length === 0, missing };
}
