/**
 * Record all Sleeper API payloads for a league into fixtures/sleeper/<leagueId>/,
 * filtering the ~10MB player dump down to players the league actually touched.
 * Fixtures are committed so tests and evals are hermetic.
 *
 * Usage: pnpm tsx scripts/record-fixtures.ts <leagueId> [leagueId...]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHttpSleeperApi, fetchSleeperPayloads } from "@/providers/sleeper";
import { normalizeSleeperLeague } from "@/providers/sleeper/normalize";
import { sleeperPlayersSchema } from "@/providers/sleeper/schemas";

async function recordLeague(leagueId: string): Promise<void> {
  const api = createHttpSleeperApi();
  console.log(`Fetching league ${leagueId}...`);
  const payloads = await fetchSleeperPayloads(api, leagueId);

  // Normalize once purely to learn which player ids the league references.
  const bundle = normalizeSleeperLeague(payloads);
  const referenced = new Set(bundle.players.map((p) => p.providerPlayerId));
  const fullDump = sleeperPlayersSchema.parse(payloads.players);
  const filteredPlayers = Object.fromEntries(
    Object.entries(fullDump).filter(([id]) => referenced.has(id)),
  );

  const dir = path.join("fixtures", "sleeper", leagueId);
  await fs.mkdir(dir, { recursive: true });
  const write = (name: string, data: unknown) =>
    fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(data, null, 1));

  await write("league", payloads.league);
  await write("users", payloads.users);
  await write("rosters", payloads.rosters);
  await write("winners_bracket", payloads.winnersBracket);
  await write("losers_bracket", payloads.losersBracket);
  await write("drafts", payloads.drafts);
  await write("players", filteredPlayers);
  for (const [week, data] of Object.entries(payloads.matchupsByWeek)) {
    await write(`matchups-${week}`, data);
  }
  for (const [round, data] of Object.entries(payloads.transactionsByRound)) {
    await write(`transactions-${round}`, data);
  }
  for (const [draftId, data] of Object.entries(payloads.draftPicksByDraft)) {
    await write(`draft-${draftId}-picks`, data);
  }

  console.log(
    `Recorded ${bundle.league.name} (${bundle.league.season}): ` +
      `${bundle.teams.length} teams, ${bundle.matchups.length} matchups, ` +
      `${bundle.playerWeeks.length} player-weeks, ${bundle.transactions.length} transactions, ` +
      `${bundle.draftPicks.length} draft picks → ${dir}`,
  );
}

async function main(): Promise<void> {
  const leagueIds = process.argv.slice(2);
  if (leagueIds.length === 0) {
    console.error("Usage: pnpm tsx scripts/record-fixtures.ts <leagueId> [leagueId...]");
    process.exit(1);
  }
  for (const leagueId of leagueIds) {
    await recordLeague(leagueId);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
