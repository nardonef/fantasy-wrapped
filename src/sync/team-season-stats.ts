import { ENGINE_VERSION, type SeasonFacts } from "@/engine";

export type TeamSeasonStatsRow = {
  teamId: string;
  engineVersion: string;
  benchRegretRate: number;
  flippableLossRate: number;
  allPlayWinPct: number;
  luckDelta: number;
  longestWinStreak: number;
  longestLossStreak: number;
  transactionTotal: number;
};

/** Derive the handful of scale-invariant stats used for global comparisons. */
export function computeTeamSeasonStatsRows(
  facts: SeasonFacts,
  teamIdByRoster: Map<string, string>,
): TeamSeasonStatsRow[] {
  const gamesPlayed = facts.league.regularSeasonWeeks.length;
  const rows: TeamSeasonStatsRow[] = [];
  for (const [rosterId, t] of Object.entries(facts.teams)) {
    const teamId = teamIdByRoster.get(rosterId);
    if (!teamId) continue;
    rows.push({
      teamId,
      engineVersion: ENGINE_VERSION,
      benchRegretRate: t.pointsFor > 0 ? t.benchRegretTotal / t.pointsFor : 0,
      flippableLossRate: gamesPlayed > 0 ? t.flippableLosses.length / gamesPlayed : 0,
      allPlayWinPct: t.allPlay.winPct,
      luckDelta: t.luckDelta,
      longestWinStreak: t.longestWinStreak?.length ?? 0,
      longestLossStreak: t.longestLossStreak?.length ?? 0,
      transactionTotal: t.transactionCounts.total,
    });
  }
  return rows;
}
