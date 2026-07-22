import type { NormalizedLeagueBundle } from "@/providers/types";
import type { SleeperApi } from "./client";
import { normalizeSleeperLeague, type SleeperLeaguePayloads } from "./normalize";
import { sleeperDraftsSchema, sleeperLeagueSchema } from "./schemas";

export { createFixtureSleeperApi, createHttpSleeperApi } from "./client";
export { normalizeSleeperLeague } from "./normalize";

/**
 * Fetch every payload needed to reconstruct one league-season.
 * Used both by live sync and by the fixture recorder (which persists the
 * payloads to disk so tests and evals never touch the network).
 */
export async function fetchSleeperPayloads(
  api: SleeperApi,
  leagueId: string,
): Promise<SleeperLeaguePayloads> {
  const [league, users, rosters, winnersBracket, losersBracket, drafts, players] =
    await Promise.all([
      api.getLeague(leagueId),
      api.getUsers(leagueId),
      api.getRosters(leagueId),
      api.getWinnersBracket(leagueId),
      api.getLosersBracket(leagueId),
      api.getDrafts(leagueId),
      api.getPlayers(),
    ]);

  const parsedLeague = sleeperLeagueSchema.parse(league);
  const lastWeek = parsedLeague.settings.last_scored_leg ?? parsedLeague.settings.leg ?? 18;
  const weeks = Array.from({ length: lastWeek }, (_, i) => i + 1);

  const [matchupsList, transactionsList] = await Promise.all([
    Promise.all(weeks.map((w) => api.getMatchups(leagueId, w))),
    Promise.all(weeks.map((w) => api.getTransactions(leagueId, w))),
  ]);

  const draftPicksByDraft: Record<string, unknown> = {};
  for (const draft of sleeperDraftsSchema.parse(drafts ?? [])) {
    draftPicksByDraft[draft.draft_id] = await api.getDraftPicks(draft.draft_id);
  }

  return {
    league,
    users,
    rosters,
    matchupsByWeek: Object.fromEntries(weeks.map((w, i) => [w, matchupsList[i]])),
    transactionsByRound: Object.fromEntries(weeks.map((w, i) => [w, transactionsList[i]])),
    winnersBracket,
    losersBracket,
    drafts,
    draftPicksByDraft,
    players,
  };
}

export async function fetchSleeperLeagueBundle(
  api: SleeperApi,
  leagueId: string,
): Promise<NormalizedLeagueBundle> {
  return normalizeSleeperLeague(await fetchSleeperPayloads(api, leagueId));
}
