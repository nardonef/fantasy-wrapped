/**
 * Render every manager's Wrapped card script as markdown for human review.
 * This is the quality loop: read evals/output/ like a group-chat member would.
 * A card that doesn't land as a laugh, wince, or brag gets cut or sharpened.
 *
 * Usage: pnpm eval   (renders every league in fixtures/sleeper/)
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { GlobalStats } from "@/engine";
import { computeCandidates, computeSeasonFacts, generateCardScript } from "@/engine";
import { createFixtureSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";

const FIXTURES_ROOT = path.join("fixtures", "sleeper");
const OUTPUT_ROOT = path.join("evals", "output");

// A few varied GlobalStats profiles, cycled by rosterId, so eval output
// exercises more of the 7 global insight modules across different managers
// than one uniform fixture would. Not meant to represent a real pool.
const GLOBAL_STATS_PROFILES: GlobalStats[] = [
  // Mostly a brag: strong across the board.
  {
    benchRegretRatePercentile: { percentile: 91, inversePercentile: 6, poolSize: 340 },
    flippableLossRatePercentile: { percentile: 12, inversePercentile: 85, poolSize: 340 },
    allPlayWinPctPercentile: { percentile: 88, inversePercentile: 9, poolSize: 340 },
    luckDeltaPercentile: { percentile: 95, inversePercentile: 3, poolSize: 340 },
    longestWinStreakPercentile: { percentile: 93, poolSize: 340 },
    longestLossStreakPercentile: { percentile: 20, poolSize: 340 },
    transactionTotalPercentile: { percentile: 40, poolSize: 340 },
  },
  // Mostly a wince: rough across the board.
  {
    benchRegretRatePercentile: { percentile: 8, inversePercentile: 90, poolSize: 340 },
    flippableLossRatePercentile: { percentile: 95, inversePercentile: 2, poolSize: 340 },
    allPlayWinPctPercentile: { percentile: 15, inversePercentile: 82, poolSize: 340 },
    luckDeltaPercentile: { percentile: 6, inversePercentile: 92, poolSize: 340 },
    longestWinStreakPercentile: { percentile: 35, poolSize: 340 },
    longestLossStreakPercentile: { percentile: 91, poolSize: 340 },
    transactionTotalPercentile: { percentile: 97, poolSize: 340 },
  },
  // Unremarkable middle: mostly below the notability floor.
  {
    benchRegretRatePercentile: { percentile: 55, inversePercentile: 43, poolSize: 340 },
    flippableLossRatePercentile: { percentile: 50, inversePercentile: 48, poolSize: 340 },
    allPlayWinPctPercentile: { percentile: 60, inversePercentile: 38, poolSize: 340 },
    luckDeltaPercentile: { percentile: 45, inversePercentile: 53, poolSize: 340 },
    longestWinStreakPercentile: { percentile: 50, poolSize: 340 },
    longestLossStreakPercentile: { percentile: 50, poolSize: 340 },
    transactionTotalPercentile: { percentile: 65, poolSize: 340 },
  },
];

function globalStatsFor(rosterId: string): GlobalStats {
  return GLOBAL_STATS_PROFILES[Number(rosterId) % GLOBAL_STATS_PROFILES.length] ?? {};
}

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
    const globalStats = globalStatsFor(rosterId);
    const script = generateCardScript(facts, rosterId, globalStats);
    const candidates = computeCandidates(facts, rosterId, globalStats);
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
