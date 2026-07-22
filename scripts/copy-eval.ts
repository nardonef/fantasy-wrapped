/**
 * Generate LLM copy for every manager in a fixture league and render it as
 * markdown for tone review. Requires ANTHROPIC_API_KEY (or an `ant auth login`
 * profile). Costs ~one model call per manager.
 *
 * Usage: pnpm tsx scripts/copy-eval.ts <leagueId> [--limit N]
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { writeCopy } from "@/copy/writer";
import { generateLeagueWrapped } from "@/engine";
import { createFixtureSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const leagueId = args[0];
  if (!leagueId) {
    console.error("Usage: pnpm tsx scripts/copy-eval.ts <leagueId> [--limit N]");
    process.exit(1);
  }
  const limitIndex = args.indexOf("--limit");
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Number.POSITIVE_INFINITY;

  const api = createFixtureSleeperApi(path.join("fixtures", "sleeper", leagueId));
  const bundle = await fetchSleeperLeagueBundle(api, leagueId);
  const scripts = generateLeagueWrapped(bundle).slice(0, limit);

  const outDir = path.join("evals", "output", "copy", leagueId);
  await fs.mkdir(outDir, { recursive: true });

  for (const script of scripts) {
    console.log(`Writing copy for ${script.managerName}...`);
    const { copy, usedFallback, model } = await writeCopy(script);
    const lines: string[] = [
      `# ${script.managerName} — final copy`,
      "",
      `_model: ${model}${usedFallback ? " (some cards fell back)" : ""}_`,
      "",
    ];
    for (const card of copy.cards) {
      lines.push(`### ${card.title}`);
      lines.push("");
      lines.push(card.body);
      lines.push("");
    }
    lines.push(`## FINALE — ${copy.archetype.title}`);
    lines.push("");
    lines.push(copy.archetype.body);
    lines.push("");
    const slug = script.managerName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await fs.writeFile(path.join(outDir, `${slug}.md`), lines.join("\n"));
  }
  console.log(`Rendered copy for ${scripts.length} managers → ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
