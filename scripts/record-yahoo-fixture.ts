/**
 * Record all Yahoo API payloads for one league into fixtures/yahoo/<leagueKey>/.
 * Needs a live access token (see the implementation plan's Task 15 for how to get
 * one) — tokens expire in ~1 hour, so run this in one sitting.
 *
 * Usage: pnpm tsx scripts/record-yahoo-fixture.ts <leagueKey> <accessToken>
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHttpYahooApi } from "@/providers/yahoo/client";
import { fetchYahooPayloads } from "@/providers/yahoo";

async function main(): Promise<void> {
  const [leagueKey, accessToken] = process.argv.slice(2);
  if (!leagueKey || !accessToken) {
    console.error("Usage: pnpm tsx scripts/record-yahoo-fixture.ts <leagueKey> <accessToken>");
    process.exit(1);
  }

  const api = createHttpYahooApi(accessToken);
  console.log(`Fetching league ${leagueKey}...`);
  const payloads = await fetchYahooPayloads(api, leagueKey);

  const dir = path.join("fixtures", "yahoo", leagueKey);
  await fs.mkdir(dir, { recursive: true });
  const write = (name: string, data: unknown) =>
    fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(data, null, 1));

  await write("league", payloads.league);
  await write("transactions", payloads.transactions);
  await write("draftresults", payloads.draftResults);
  for (const [week, data] of Object.entries(payloads.scoreboardByWeek)) {
    await write(`scoreboard-${week}`, data);
  }
  for (const [key, data] of Object.entries(payloads.rosterByTeamWeek)) {
    const [teamKey, week] = key.split(":");
    await write(`roster-${teamKey}-${week}`, data);
  }

  console.log(`Recorded to ${dir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
