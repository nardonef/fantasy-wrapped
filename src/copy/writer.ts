import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { CardScript } from "@/engine";
import { fallbackCopy } from "./fallback";
import { type WrappedCopy, wrappedCopySchema } from "./schema";
import { validateCardCopy } from "./validate";

const COPY_MODEL = process.env.COPY_MODEL ?? "claude-opus-4-8";

/** Generation is injectable so tests never touch the network. */
export type GenerateFn = (prompt: string) => Promise<WrappedCopy>;

let cachedToneGuide: string | null = null;
function toneGuide(): string {
  if (cachedToneGuide === null) {
    cachedToneGuide = fs.readFileSync(path.join(process.cwd(), "docs/tone.md"), "utf8");
  }
  return cachedToneGuide;
}

export function buildPrompt(script: CardScript, feedback?: string): string {
  const cardsJson = JSON.stringify(
    {
      manager: script.managerName,
      teamName: script.teamName,
      league: script.leagueName,
      season: script.season,
      cards: script.cards,
      archetype: script.archetype,
    },
    null,
    2,
  );
  return [
    "You are writing the copy for one manager's Fantasy Football Wrapped — a tap-through story of their season, ending in an archetype card built to be screenshotted into the group chat.",
    "",
    "Follow this tone guide exactly:",
    "",
    toneGuide(),
    "",
    "Here is the manager's card script. Each card's `facts` object contains the only numbers and names you may use — reproduce every number verbatim (same decimals). The `headline` is a working draft for orientation, not copy to reuse.",
    "",
    cardsJson,
    "",
    "Write copy for every card (same order, keyed by insightId) and for the archetype finale. The archetype title should be its name; the body is the accusation, built from its evidence.",
    ...(feedback ? ["", `Previous attempt failed validation: ${feedback}. Fix exactly this.`] : []),
  ].join("\n");
}

export function createClaudeGenerate(): GenerateFn {
  const client = new Anthropic();
  return async (prompt: string): Promise<WrappedCopy> => {
    const response = await client.messages.parse({
      model: COPY_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(wrappedCopySchema) },
      messages: [{ role: "user", content: prompt }],
    });
    if (!response.parsed_output) {
      throw new Error(
        `Copy generation returned no parseable output (stop: ${response.stop_reason})`,
      );
    }
    return response.parsed_output;
  };
}

/**
 * Generate copy for one manager's Wrapped, validate number fidelity per card,
 * retry once with targeted feedback, and fall back to deterministic copy for
 * any card that still fails. Never throws on content problems — the fallback
 * guarantees shippable copy.
 */
export async function writeCopy(
  script: CardScript,
  generate: GenerateFn = createClaudeGenerate(),
): Promise<{ copy: WrappedCopy; usedFallback: boolean; model: string }> {
  const fallback = fallbackCopy(script);

  let generated: WrappedCopy | null = null;
  let feedback: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let candidate: WrappedCopy;
    try {
      candidate = await generate(buildPrompt(script, feedback));
    } catch {
      break;
    }

    const failures: string[] = [];
    for (const card of script.cards) {
      const copy = candidate.cards.find((c) => c.insightId === card.insightId);
      if (!copy) {
        failures.push(`missing copy for ${card.insightId}`);
        continue;
      }
      const { valid, missing } = validateCardCopy(card, copy);
      if (!valid) {
        failures.push(`${card.insightId} is missing the exact numbers: ${missing.join(", ")}`);
      }
    }

    if (failures.length === 0) {
      generated = candidate;
      break;
    }
    feedback = failures.join("; ");
    generated = candidate; // keep best effort; per-card fallback below
  }

  if (!generated) {
    return { copy: fallback, usedFallback: true, model: "fallback" };
  }

  // Per-card salvage: keep valid generated cards, fall back only where broken.
  let usedFallback = false;
  const cards = script.cards.map((card) => {
    const copy = generated.cards.find((c) => c.insightId === card.insightId);
    if (copy && validateCardCopy(card, copy).valid) return copy;
    usedFallback = true;
    const fb = fallback.cards.find((c) => c.insightId === card.insightId);
    return fb ?? { insightId: card.insightId, title: "Your season", body: card.headline };
  });

  return {
    copy: { cards, archetype: generated.archetype },
    usedFallback,
    model: usedFallback ? `${COPY_MODEL}+fallback` : COPY_MODEL,
  };
}
