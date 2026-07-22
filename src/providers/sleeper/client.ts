import fs from "node:fs/promises";
import path from "node:path";

/**
 * Data source for Sleeper payloads. Two implementations: live HTTP, and
 * recorded fixtures on disk (used by tests and the eval harness).
 * Both return raw JSON — validation happens in normalize.
 */
export interface SleeperApi {
  getUser(usernameOrId: string): Promise<unknown>;
  getUserLeagues(userId: string, season: number): Promise<unknown>;
  getLeague(leagueId: string): Promise<unknown>;
  getUsers(leagueId: string): Promise<unknown>;
  getRosters(leagueId: string): Promise<unknown>;
  getMatchups(leagueId: string, week: number): Promise<unknown>;
  getTransactions(leagueId: string, round: number): Promise<unknown>;
  getWinnersBracket(leagueId: string): Promise<unknown>;
  getLosersBracket(leagueId: string): Promise<unknown>;
  getDrafts(leagueId: string): Promise<unknown>;
  getDraftPicks(draftId: string): Promise<unknown>;
  getPlayers(): Promise<unknown>;
}

const BASE_URL = "https://api.sleeper.app/v1";
const MAX_ATTEMPTS = 4;

async function fetchJson(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`Sleeper ${res.status} for ${url}`);
      } else if (!res.ok) {
        throw new Error(`Sleeper ${res.status} for ${url}`);
      } else {
        return await res.json();
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}

export function createHttpSleeperApi(): SleeperApi {
  return {
    getUser: (u) => fetchJson(`${BASE_URL}/user/${u}`),
    getUserLeagues: (userId, season) =>
      fetchJson(`${BASE_URL}/user/${userId}/leagues/nfl/${season}`),
    getLeague: (id) => fetchJson(`${BASE_URL}/league/${id}`),
    getUsers: (id) => fetchJson(`${BASE_URL}/league/${id}/users`),
    getRosters: (id) => fetchJson(`${BASE_URL}/league/${id}/rosters`),
    getMatchups: (id, week) => fetchJson(`${BASE_URL}/league/${id}/matchups/${week}`),
    getTransactions: (id, round) => fetchJson(`${BASE_URL}/league/${id}/transactions/${round}`),
    getWinnersBracket: (id) => fetchJson(`${BASE_URL}/league/${id}/winners_bracket`),
    getLosersBracket: (id) => fetchJson(`${BASE_URL}/league/${id}/losers_bracket`),
    getDrafts: (id) => fetchJson(`${BASE_URL}/league/${id}/drafts`),
    getDraftPicks: (draftId) => fetchJson(`${BASE_URL}/draft/${draftId}/picks`),
    getPlayers: () => fetchJson(`${BASE_URL}/players/nfl`),
  };
}

/**
 * Reads payloads recorded by scripts/record-fixtures.ts.
 * File layout: fixtures/sleeper/<leagueId>/{league,users,rosters,...}.json
 */
export function createFixtureSleeperApi(fixtureDir: string): SleeperApi {
  const read = async (name: string): Promise<unknown> => {
    const file = path.join(fixtureDir, `${name}.json`);
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  const unsupported = (what: string) => {
    throw new Error(`${what} is not recorded in fixtures`);
  };
  return {
    getUser: () => unsupported("getUser"),
    getUserLeagues: () => unsupported("getUserLeagues"),
    getLeague: () => read("league"),
    getUsers: () => read("users"),
    getRosters: () => read("rosters"),
    getMatchups: (_id, week) => read(`matchups-${week}`),
    getTransactions: (_id, round) => read(`transactions-${round}`),
    getWinnersBracket: () => read("winners_bracket"),
    getLosersBracket: () => read("losers_bracket"),
    getDrafts: () => read("drafts"),
    getDraftPicks: (draftId) => read(`draft-${draftId}-picks`),
    getPlayers: () => read("players"),
  };
}
