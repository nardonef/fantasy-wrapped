import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { CardScript } from "@/engine";
import { fallbackCopy } from "./fallback";
import { type WrappedCopy, wrappedCopySchema } from "./schema";
import { validateCardCopy } from "./validate";

/**
 * Haiku, deliberately. This task is "write eleven short sentences that reuse
 * numbers you were handed" — the hard part (which cards ship, what they say,
 * every figure on them) is already settled by the engine. Opus was doing it at
 * roughly 25x the output rate for prose a much smaller model writes fine, and
 * validateCardCopy catches the one failure mode that matters either way.
 */
const COPY_MODEL = process.env.COPY_MODEL ?? "claude-haiku-4-5";

/**
 * Per-million-token rates, so telemetry can report a cost rather than a raw
 * token count. Unknown models report null rather than a wrong number — update
 * this when COPY_MODEL changes.
 */
const RATES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-5": { input: 5, output: 25 },
};

export type CopyUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

/** Generation is injectable so tests never touch the network. */
export type GenerateFn = (
  prompt: string,
) => Promise<{ copy: WrappedCopy; usage: CopyUsage | null }>;

/** What one Wrapped's copy cost, for logging and for the wrapped_scripts row. */
export type CopyTelemetry = CopyUsage & {
  model: string;
  /** 1, or 2 when the first attempt failed number validation. */
  attempts: number;
  durationMs: number;
  estimatedCostUsd: number | null;
  /** insightIds that fell back to deterministic copy. */
  fellBack: string[];
  /** Set when generation threw — the reason the LLM path was abandoned. */
  error: string | null;
};

function estimateCostUsd(model: string, usage: CopyUsage): number | null {
  const rate = RATES_USD_PER_MTOK[model];
  if (!rate) return null;
  const billedInput = usage.inputTokens + usage.cacheCreationInputTokens;
  return (
    (billedInput * rate.input) / 1_000_000 +
    (usage.outputTokens * rate.output) / 1_000_000 +
    (usage.cacheReadInputTokens * rate.input * 0.1) / 1_000_000
  );
}

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
  return async (prompt: string) => {
    const response = await client.messages.parse({
      model: COPY_MODEL,
      // The schema caps a card at 60 + 280 chars, so eleven cards plus JSON
      // overhead is well under 2k tokens. This is a guard rail, not a target.
      max_tokens: 4000,
      // No `thinking` and no `effort` on purpose. Both are rejected by Haiku
      // 4.5 — adaptive thinking is 4.6+, and `effort` errors outright — and
      // thinking is the entire reason a generation used to cost what it did.
      output_config: { format: zodOutputFormat(wrappedCopySchema) },
      messages: [{ role: "user", content: prompt }],
    });
    if (!response.parsed_output) {
      throw new Error(
        `Copy generation returned no parseable output (stop: ${response.stop_reason})`,
      );
    }
    return {
      copy: response.parsed_output,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
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
): Promise<{
  copy: WrappedCopy;
  usedFallback: boolean;
  model: string;
  telemetry: CopyTelemetry;
}> {
  const fallback = fallbackCopy(script);
  const startedAt = Date.now();

  const usage: CopyUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
  let attempts = 0;
  let error: string | null = null;

  let generated: WrappedCopy | null = null;
  let feedback: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let candidate: WrappedCopy;
    attempts++;
    try {
      const result = await generate(buildPrompt(script, feedback));
      candidate = result.copy;
      // Accumulate across attempts — a retry is billed too, and a retry rate
      // that creeps up is the signal that the prompt or model needs work.
      if (result.usage) {
        usage.inputTokens += result.usage.inputTokens;
        usage.outputTokens += result.usage.outputTokens;
        usage.cacheReadInputTokens += result.usage.cacheReadInputTokens;
        usage.cacheCreationInputTokens += result.usage.cacheCreationInputTokens;
      }
    } catch (e) {
      // Previously swallowed, which made a bad key or a rejected parameter
      // indistinguishable from having no key at all — the page just quietly
      // served fallback copy and nothing anywhere said why.
      error = e instanceof Error ? e.message : String(e);
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

  const finish = (copy: WrappedCopy, usedFallback: boolean, model: string, fellBack: string[]) => {
    const telemetry: CopyTelemetry = {
      ...usage,
      model,
      attempts,
      durationMs: Date.now() - startedAt,
      estimatedCostUsd: estimateCostUsd(COPY_MODEL, usage),
      fellBack,
      error,
    };
    // One structured line per generation so `vercel logs` can answer "what did
    // this cost, how long did it take, and how often are we falling back".
    console.info(
      JSON.stringify({ event: "copy.generated", rosterId: script.rosterId, ...telemetry }),
    );
    return { copy, usedFallback, model, telemetry };
  };

  if (!generated) {
    return finish(
      fallback,
      true,
      "fallback",
      script.cards.map((c) => c.insightId),
    );
  }

  // Per-card salvage: keep valid generated cards, fall back only where broken.
  const fellBack: string[] = [];
  const cards = script.cards.map((card) => {
    const copy = generated.cards.find((c) => c.insightId === card.insightId);
    if (copy && validateCardCopy(card, copy).valid) return copy;
    fellBack.push(card.insightId);
    const fb = fallback.cards.find((c) => c.insightId === card.insightId);
    return fb ?? { insightId: card.insightId, title: "Your season", body: card.headline };
  });

  const usedFallback = fellBack.length > 0;
  return finish(
    { cards, archetype: generated.archetype },
    usedFallback,
    usedFallback ? `${COPY_MODEL}+fallback` : COPY_MODEL,
    fellBack,
  );
}
