/**
 * Render every manager's Wrapped card script as markdown for human review.
 * This is the quality loop: read evals/output/ like a group-chat member would.
 * A card that doesn't land as a laugh, wince, or brag gets cut or sharpened.
 *
 * Usage: pnpm eval   (renders every league in fixtures/sleeper/)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { computeCandidates, computeSeasonFacts, generateCardScript } from "@/engine";
import { createFixtureSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";

const FIXTURES_ROOT = path.join("fixtures", "sleeper");
const OUTPUT_ROOT = path.join("evals", "output");

async function renderLeague(leagueId: string): Promise<void> {
  const api = createFixtureSleeperApi(path.join(FIXTURES_ROOT, leagueId));
  const bundle = await fetchSleeperLeagueBundle(api, leagueId);
  const facts = computeSeasonFacts(bundle);

  const leagueDir = path.join(
    OUTPUT_ROOT,
    `${facts.league.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${facts.league.season}`,
  );
  await fs.mkdir(leagueDir, { recursive: true });

  const indexLines: string[] = [
    `# ${facts.league.name} — ${facts.league.season}`,
    "",
    "| Manager | Cards | Archetype | File |",
    "|---|---|---|---|",
  ];

  for (const rosterId of Object.keys(facts.teams).sort((a, b) => Number(a) - Number(b))) {
    const script = generateCardScript(facts, rosterId, {});
    const candidates = computeCandidates(facts, rosterId, {});
    const slug = script.managerName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

    const lines: string[] = [
      `# ${script.managerName}${script.teamName ? ` — “${script.teamName}”` : ""}`,
      "",
      `_${script.leagueName} · ${script.season} · engine ${script.engineVersion}_`,
      "",
      "## The story",
      "",
    ];
    script.cards.forEach((card, i) => {
      lines.push(
        `**${i + 1}. [${card.category}${card.insightId === "season-summary" ? "/opener" : ""}] ${card.headline}**`,
      );
      lines.push("");
    });
    lines.push(`**FINALE — ${script.archetype.name}**`);
    lines.push("");
    for (const e of script.archetype.evidence) {
      lines.push(`- ${e.key}: ${e.value}`);
    }
    lines.push("");
    lines.push("## Cutting-room floor (candidates that didn't ship)");
    lines.push("");
    const shipped = new Set(script.cards.map((c) => c.insightId));
    for (const c of candidates.filter((c) => !shipped.has(c.id))) {
      lines.push(`- (${Math.round(c.notability)}) [${c.category}] ${c.headline}`);
    }
    lines.push("");

    await fs.writeFile(path.join(leagueDir, `${slug}.md`), lines.join("\n"));
    indexLines.push(
      `| ${script.managerName} | ${script.cards.length} | ${script.archetype.name} | [${slug}.md](./${slug}.md) |`,
    );
  }

  await fs.writeFile(path.join(leagueDir, "README.md"), indexLines.join("\n"));
  console.log(`Rendered ${facts.league.name} → ${leagueDir}`);
}

async function main(): Promise<void> {
  const leagueIds = (await fs.readdir(FIXTURES_ROOT, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  for (const leagueId of leagueIds) {
    await renderLeague(leagueId);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
