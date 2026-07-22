/**
 * Sync a Sleeper league into Postgres from the live API or from fixtures.
 *
 * Usage:
 *   pnpm tsx scripts/sync-league.ts <leagueId>             # live API
 *   pnpm tsx scripts/sync-league.ts --fixtures <leagueId>  # recorded fixtures
 */
import "dotenv/config";
import path from "node:path";
import { db } from "@/db";
import {
  createFixtureSleeperApi,
  createHttpSleeperApi,
  fetchSleeperLeagueBundle,
} from "@/providers/sleeper";
import { persistBundle } from "@/sync/persist";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useFixtures = args.includes("--fixtures");
  const leagueId = args.filter((a) => a !== "--fixtures")[0];
  if (!leagueId) {
    console.error("Usage: pnpm tsx scripts/sync-league.ts [--fixtures] <leagueId>");
    process.exit(1);
  }

  const api = useFixtures
    ? createFixtureSleeperApi(path.join("fixtures", "sleeper", leagueId))
    : createHttpSleeperApi();

  const bundle = await fetchSleeperLeagueBundle(api, leagueId);
  const { leagueId: dbId } = await persistBundle(db, bundle);
  console.log(
    `Synced ${bundle.league.name} (${bundle.league.season}) → leagues.id=${dbId}: ` +
      `${bundle.teams.length} teams, ${bundle.matchups.length} matchups, ` +
      `${bundle.playerWeeks.length} player-weeks, ${bundle.transactions.length} transactions`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
