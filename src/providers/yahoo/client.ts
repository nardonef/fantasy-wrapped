import fs from "node:fs/promises";
import path from "node:path";

/** Data source for Yahoo payloads. Two implementations: live HTTP (with a caller-supplied
 * OAuth access token — never persisted, see docs/superpowers/specs/2026-08-11-yahoo-integration-design.md),
 * and recorded fixtures on disk. Both return raw JSON — cleaning/validation happens in normalize. */
export interface YahooApi {
  getUser(): Promise<unknown>;
  getUserLeagues(): Promise<unknown>;
  getLeague(leagueKey: string): Promise<unknown>;
  getScoreboard(leagueKey: string, week: number): Promise<unknown>;
  getRoster(teamKey: string, week: number): Promise<unknown>;
  getTransactions(leagueKey: string): Promise<unknown>;
  getDraftResults(leagueKey: string): Promise<unknown>;
}

const BASE_URL = "https://fantasysports.yahooapis.com/fantasy/v2";
const MAX_ATTEMPTS = 4;

async function fetchJson(url: string, accessToken: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      });
      if (res.status === 429 || res.status >= 500) {
        const body = await res.text().catch(() => "");
        const bodyPreview = body.slice(0, 500);
        lastError = new Error(
          `Yahoo ${res.status} for ${url}${bodyPreview ? `: ${bodyPreview}` : ""}`,
        );
      } else if (!res.ok) {
        const body = await res.text().catch(() => "");
        const bodyPreview = body.slice(0, 500);
        throw new Error(`Yahoo ${res.status} for ${url}${bodyPreview ? `: ${bodyPreview}` : ""}`);
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

export function createHttpYahooApi(accessToken: string): YahooApi {
  const get = (url: string) => fetchJson(url, accessToken);
  return {
    getUser: () => get(`${BASE_URL}/users;use_login=1?format=json`),
    getUserLeagues: () =>
      get(`${BASE_URL}/users;use_login=1/games;game_codes=nfl/leagues?format=json`),
    getLeague: (leagueKey) =>
      get(`${BASE_URL}/league/${leagueKey};out=settings,standings?format=json`),
    getScoreboard: (leagueKey, week) =>
      get(`${BASE_URL}/league/${leagueKey}/scoreboard;week=${week}?format=json`),
    getRoster: (teamKey, week) =>
      get(`${BASE_URL}/team/${teamKey}/roster;week=${week}/players;out=stats?format=json`),
    getTransactions: (leagueKey) => get(`${BASE_URL}/league/${leagueKey}/transactions?format=json`),
    getDraftResults: (leagueKey) => get(`${BASE_URL}/league/${leagueKey}/draftresults?format=json`),
  };
}

/** Reads payloads recorded by scripts/record-yahoo-fixture.ts.
 * File layout: fixtures/yahoo/<leagueKey>/{league,transactions,draftresults,
 * scoreboard-<week>,roster-<teamKey>-<week>}.json */
export function createFixtureYahooApi(fixtureDir: string): YahooApi {
  const read = async (name: string): Promise<unknown> => {
    const file = path.join(fixtureDir, `${name}.json`);
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  const unsupported = (what: string): Promise<never> => {
    return Promise.reject(new Error(`${what} is not recorded in fixtures`));
  };
  return {
    getUser: () => unsupported("getUser"),
    getUserLeagues: () => unsupported("getUserLeagues"),
    getLeague: () => read("league"),
    getScoreboard: (_leagueKey, week) => read(`scoreboard-${week}`),
    getRoster: (teamKey, week) => read(`roster-${teamKey}-${week}`),
    getTransactions: () => read("transactions"),
    getDraftResults: () => read("draftresults"),
  };
}
