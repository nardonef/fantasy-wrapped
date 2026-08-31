import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptCookieValue, YAHOO_TOKEN_COOKIE } from "@/lib/yahoo-cookies";
import type { NormalizedLeagueBundle } from "@/providers/types";
import * as yahooProvider from "@/providers/yahoo";
import * as persistModule from "@/sync/persist";
import { POST } from "./route";

function postRequest(body: unknown, token?: string): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("cookie", `${YAHOO_TOKEN_COOKIE}=${encryptCookieValue(token)}`);
  return new NextRequest("https://example.vercel.app/api/yahoo/sync", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const BUNDLE: NormalizedLeagueBundle = {
  league: {
    provider: "yahoo",
    providerLeagueId: "423.l.1",
    season: 2025,
    name: "My League",
    totalTeams: 2,
    rosterPositions: ["QB"],
    scoringSettings: {},
    playoffStartWeek: null,
    playoffTeams: null,
    lastScoredWeek: 17,
    previousProviderLeagueId: null,
    raw: {},
  },
  teams: [
    {
      providerRosterId: "1",
      providerUserId: "GUID-1",
      displayName: "Dynasty Warriors",
      teamName: null,
      avatarUrl: null,
      wins: 10,
      losses: 4,
      ties: 0,
      pointsFor: 1500.5,
      pointsAgainst: 1300.2,
      finalRank: 1,
      playoffSeed: null,
      raw: {},
    },
  ],
  matchups: [
    {
      week: 1,
      teamA: "1",
      teamB: null,
      teamAScore: 100,
      teamBScore: null,
      isPlayoff: false,
      bracketRound: null,
    },
  ],
  playerWeeks: [],
  players: [],
  transactions: [],
  draftPicks: [],
};

describe("POST /api/yahoo/sync", () => {
  beforeEach(() => {
    process.env.YAHOO_COOKIE_SECRET = Buffer.alloc(32, 7).toString("base64");
    vi.spyOn(persistModule, "persistBundle").mockResolvedValue({
      leagueId: "423.l.1",
      teamIdByRoster: new Map([["1", "team-uuid-1"]]),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("401s when there's no token cookie", async () => {
    const response = await POST(postRequest({ leagueKey: "423.l.1" }));
    expect(response.status).toBe(401);
  });

  it("400s when leagueKey is missing", async () => {
    const response = await POST(postRequest({}, "real-token"));
    expect(response.status).toBe(400);
  });

  it("syncs, persists, resolves the caller's own roster by guid, and clears the token cookie", async () => {
    vi.spyOn(yahooProvider, "fetchYahooLeagueBundle").mockResolvedValue(BUNDLE);

    const response = await POST(
      postRequest({ leagueKey: "423.l.1", guid: "GUID-1" }, "real-token"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      provider: "yahoo",
      leagueId: "423.l.1",
      season: 2025,
      name: "My League",
      yourRosterId: "1",
    });
    expect(persistModule.persistBundle).toHaveBeenCalled();
    expect(response.cookies.get(YAHOO_TOKEN_COOKIE)?.value).toBe("");
  });

  it("422s when the league has no scored weeks and clears the token cookie", async () => {
    vi.spyOn(yahooProvider, "fetchYahooLeagueBundle").mockResolvedValue({
      ...BUNDLE,
      matchups: [],
    });
    const response = await POST(postRequest({ leagueKey: "423.l.1" }, "real-token"));
    expect(response.status).toBe(422);
    expect(response.cookies.get(YAHOO_TOKEN_COOKIE)?.value).toBe("");
  });
});
