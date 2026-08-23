/**
 * One-off backfill: populate team_season_stats for every already-synced league.
 *
 * Needed once, at deploy time for the global-comparisons feature: team_season_stats
 * is only written going forward, on new syncs, so without this the global comparison
 * pool starts empty and every league synced before this feature shipped never
 * contributes to it — permanently, since a team's Wrapped script is frozen in
 * wrapped_scripts at first generation. Run this once, before or right after deploying
 * the engine version that ships global comparisons.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-team-season-stats.ts
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leagues, teams } from "@/db/schema";
import { loadBundle } from "@/sync/load";
import { writeTeamSeasonStats } from "@/sync/team-season-stats";

async function main(): Promise<void> {
  const syncedLeagues = await db
    .select({ id: leagues.id, name: leagues.name, season: leagues.season })
    .from(leagues)
    .where(eq(leagues.syncStatus, "synced"));

  console.log(`Found ${syncedLeagues.length} synced league(s) to backfill.`);

  let ok = 0;
  let skipped = 0;
  for (const league of syncedLeagues) {
    const bundle = await loadBundle(league.id);
    if (!bundle) {
      console.warn(`  skip ${league.name} (${league.season}): loadBundle returned null`);
      skipped++;
      continue;
    }

    const teamRows = await db
      .select({ id: teams.id, providerRosterId: teams.providerRosterId })
      .from(teams)
      .where(eq(teams.leagueId, league.id));
    const teamIdByRoster = new Map(teamRows.map((t) => [t.providerRosterId, t.id]));

    await writeTeamSeasonStats(db, bundle, teamIdByRoster);
    console.log(`  ok   ${league.name} (${league.season}): ${teamRows.length} teams`);
    ok++;
  }

  console.log(`Done: ${ok} backfilled, ${skipped} skipped.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
