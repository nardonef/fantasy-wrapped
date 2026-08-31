/**
 * Discover and sync every other league belonging to a manager who already
 * has at least one team in the DB — grows the global-comparisons pool from
 * people already reachable through leagues we've synced.
 *
 * WARNING — this is NOT a bounded one-hop crawl across repeated runs.
 * "Known users" is recomputed fresh from `teams` each time the script
 * starts, so every league this script syncs adds its managers to the seed
 * set for the *next* run. Running it twice in a row (39 known users -> 56
 * new leagues synced -> re-run sees 1,018 known users) showed this
 * compounds fast — functionally a full graph crawl spread across runs, not
 * the single deliberate hop it looks like from reading this file alone.
 * The app has no way to distinguish "someone who actually used Fantasy
 * Wrapped" from "someone who merely appears as a manager in a league
 * someone else synced," so there's currently no cheap way to re-bound this.
 * Do not re-run this script until that's addressed (e.g. by tracking which
 * userId actually initiated each sync, and seeding future runs only from
 * that set) — re-running it as-is repeats the same uncontrolled expansion,
 * pulling in real people's league data further and further from anyone who
 * ever consented to using this app.
 *
 * Each individual sync inside a run is upsert-safe (already-synced leagues
 * are skipped, persistBundle/upsertTeamSeasonStats are themselves
 * idempotent) — it's the *scope* across runs that isn't bounded, not the
 * safety of any single run.
 *
 * Usage:
 *   pnpm tsx scripts/crawl-known-users-leagues.ts [--season=2025]
 */
import "dotenv/config";
import { eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { leagues, teams } from "@/db/schema";
import { createHttpSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";
import { persistBundle } from "@/sync/persist";
import { writeTeamSeasonStats } from "@/sync/team-season-stats";

const leagueListSchema = z.array(
  z
    .object({
      league_id: z.string(),
      name: z.string(),
      season: z.string(),
      total_rosters: z.number(),
    })
    .loose(),
);

/** Delay between Sleeper API calls — polite pacing, not a hard rate limiter. */
const REQUEST_DELAY_MS = 750;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const seasonArg = process.argv.find((a) => a.startsWith("--season="));
  const season = seasonArg ? Number(seasonArg.split("=")[1]) : 2025;

  const api = createHttpSleeperApi();

  const knownUserRows = await db
    .selectDistinct({ userId: teams.providerUserId })
    .from(teams)
    .where(isNotNull(teams.providerUserId));
  const knownUserIds = knownUserRows.map((r) => r.userId as string);
  console.log(`Known users (already synced at least one league): ${knownUserIds.length}`);

  const existingLeagueRows = await db
    .select({ providerLeagueId: leagues.providerLeagueId, season: leagues.season })
    .from(leagues)
    .where(eq(leagues.provider, "sleeper"));
  const existingKeys = new Set(existingLeagueRows.map((l) => `${l.providerLeagueId}:${l.season}`));

  const discovered = new Map<string, { name: string; totalRosters: number }>();
  for (const userId of knownUserIds) {
    let userLeagues: z.infer<typeof leagueListSchema>;
    try {
      userLeagues = leagueListSchema.parse((await api.getUserLeagues(userId, season)) ?? []);
    } catch (error) {
      console.warn(`  skip user ${userId}: could not fetch leagues (${error})`);
      continue;
    }
    for (const l of userLeagues) {
      const key = `${l.league_id}:${Number(l.season)}`;
      if (existingKeys.has(key)) continue;
      discovered.set(key, { name: l.name, totalRosters: l.total_rosters });
    }
    await sleep(REQUEST_DELAY_MS);
  }
  console.log(`Discovered ${discovered.size} new league(s) to sync.`);

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  for (const [key, meta] of discovered) {
    const leagueId = key.split(":")[0];
    try {
      const bundle = await fetchSleeperLeagueBundle(api, leagueId);
      if (bundle.matchups.length === 0) {
        console.log(`  skip ${meta.name} (${leagueId}): no scored weeks yet`);
        skipped++;
      } else {
        const { teamIdByRoster } = await persistBundle(db, bundle);
        await writeTeamSeasonStats(db, bundle, teamIdByRoster);
        console.log(`  ok   ${meta.name} (${leagueId}): ${meta.totalRosters} teams`);
        synced++;
      }
    } catch (error) {
      console.warn(`  fail ${meta.name} (${leagueId}):`);
      console.warn(error);
      failed++;
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`Done: ${synced} synced, ${skipped} skipped (unplayed), ${failed} failed.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
