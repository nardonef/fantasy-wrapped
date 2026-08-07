import { and, eq, sql } from "drizzle-orm";
import type { db as Database } from "@/db";
import { teamSeasonStats } from "@/db/schema";
import { ENGINE_VERSION as DEFAULT_ENGINE_VERSION, type GlobalStats } from "@/engine";

/** Below this pool size, a stat's percentile isn't meaningful — omit it entirely. */
const MIN_GLOBAL_POOL = 25;

type PoolRow = {
  bench_regret_worse: string;
  flippable_loss_worse: string;
  all_play_worse: string;
  luck_worse: string;
  win_streak_worse: string;
  loss_streak_worse: string;
  transaction_worse: string;
  total: string;
};

/**
 * This team's percentile standing against every team-season the app has ever
 * synced, for the 7 v1 global-comparison stats. Never throws — a DB error
 * degrades to {} (no global cards that generation) rather than failing the
 * whole Wrapped, same fail-open behavior as fallback copy.
 */
export async function getGlobalStats(
  db: typeof Database,
  teamId: string,
  engineVersion: string = DEFAULT_ENGINE_VERSION,
): Promise<GlobalStats> {
  try {
    const [own] = await db
      .select()
      .from(teamSeasonStats)
      .where(
        and(eq(teamSeasonStats.teamId, teamId), eq(teamSeasonStats.engineVersion, engineVersion)),
      );
    if (!own) return {};

    const [row] = (await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE bench_regret_rate > ${own.benchRegretRate}) AS bench_regret_worse,
        count(*) FILTER (WHERE flippable_loss_rate > ${own.flippableLossRate}) AS flippable_loss_worse,
        count(*) FILTER (WHERE all_play_win_pct < ${own.allPlayWinPct}) AS all_play_worse,
        count(*) FILTER (WHERE luck_delta < ${own.luckDelta}) AS luck_worse,
        count(*) FILTER (WHERE longest_win_streak < ${own.longestWinStreak}) AS win_streak_worse,
        count(*) FILTER (WHERE longest_loss_streak < ${own.longestLossStreak}) AS loss_streak_worse,
        count(*) FILTER (WHERE transaction_total < ${own.transactionTotal}) AS transaction_worse,
        count(*) AS total
      FROM team_season_stats
      WHERE engine_version = ${engineVersion}
    `)) as unknown as PoolRow[];

    const total = Number(row.total);
    if (total < MIN_GLOBAL_POOL) return {};

    const pct = (worse: string) => Math.round((Number(worse) / total) * 100);

    return {
      benchRegretRatePercentile: { percentile: pct(row.bench_regret_worse), poolSize: total },
      flippableLossRatePercentile: { percentile: pct(row.flippable_loss_worse), poolSize: total },
      allPlayWinPctPercentile: { percentile: pct(row.all_play_worse), poolSize: total },
      luckDeltaPercentile: { percentile: pct(row.luck_worse), poolSize: total },
      longestWinStreakPercentile: { percentile: pct(row.win_streak_worse), poolSize: total },
      longestLossStreakPercentile: { percentile: pct(row.loss_streak_worse), poolSize: total },
      transactionTotalPercentile: { percentile: pct(row.transaction_worse), poolSize: total },
    };
  } catch (error) {
    console.error("getGlobalStats failed", error);
    return {};
  }
}
