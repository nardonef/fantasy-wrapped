import type { NormalizedLeagueBundle } from "@/providers/types";
import type { YahooApi } from "./client";
import { extractStandingsTeams, normalizeYahooLeague, type YahooLeaguePayloads } from "./normalize";
import { cleanYahoo } from "./yahoo-json";

export { createFixtureYahooApi, createHttpYahooApi } from "./client";
export { normalizeYahooLeague } from "./normalize";

/** Fetch every payload needed to reconstruct one league-season. First fetches the league
 * (to learn num_teams and current_week), then fans out scoreboard-per-week and
 * roster-per-team-per-week calls in parallel — mirrors sleeper/index.ts's shape, just with
 * a bigger fan-out since Yahoo has no single "all matchups for the league" call. */
export async function fetchYahooPayloads(api: YahooApi, leagueKey: string): Promise<YahooLeaguePayloads> {
  const league = await api.getLeague(leagueKey);
  const cleaned = cleanYahoo(league) as {
    fantasy_content?: { league?: { current_week?: string | number; standings?: unknown } };
  };
  const leagueData = cleaned.fantasy_content?.league;
  const lastWeek = leagueData?.current_week != null ? Number(leagueData.current_week) : 17;
  const weeks = Array.from({ length: lastWeek }, (_, i) => i + 1);
  const teamKeys = extractStandingsTeams(leagueData?.standings).map((t) => (t as { team_key: string }).team_key);

  const [scoreboards, rosters, transactions, draftResults] = await Promise.all([
    Promise.all(weeks.map((w) => api.getScoreboard(leagueKey, w))),
    Promise.all(
      teamKeys.flatMap((teamKey) => weeks.map((w) => api.getRoster(teamKey, w).then((r) => [teamKey, w, r] as const))),
    ),
    api.getTransactions(leagueKey),
    api.getDraftResults(leagueKey),
  ]);

  return {
    league,
    scoreboardByWeek: Object.fromEntries(weeks.map((w, i) => [w, scoreboards[i]])),
    rosterByTeamWeek: Object.fromEntries(rosters.map(([teamKey, w, r]) => [`${teamKey}:${w}`, r])),
    transactions,
    draftResults,
  };
}

export async function fetchYahooLeagueBundle(
  api: YahooApi,
  leagueKey: string,
): Promise<NormalizedLeagueBundle> {
  return normalizeYahooLeague(await fetchYahooPayloads(api, leagueKey));
}
