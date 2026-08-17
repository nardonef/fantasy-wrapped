import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptCookieValue, YAHOO_TOKEN_COOKIE } from "@/lib/yahoo-cookies";
import * as yahooClient from "@/providers/yahoo/client";
import { GET } from "./route";

function requestWithToken(token?: string): NextRequest {
  const headers = new Headers();
  if (token) headers.set("cookie", `${YAHOO_TOKEN_COOKIE}=${encryptCookieValue(token)}`);
  return new NextRequest("https://example.vercel.app/api/yahoo/leagues", { headers });
}

const RAW_DISCOVERY_RESPONSE = {
  fantasy_content: {
    users: [
      {
        user: [
          [{ guid: "GUID-1" }, { nickname: "Frank" }],
          {
            games: [
              {
                game: [
                  [{ game_key: "423" }, { code: "nfl" }],
                  {
                    leagues: {
                      "0": {
                        league: [
                          { league_key: "423.l.1" },
                          { name: "My League" },
                          { season: "2025" },
                          { num_teams: 10 },
                        ],
                      },
                      count: 1,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

describe("GET /api/yahoo/leagues", () => {
  beforeEach(() => {
    process.env.YAHOO_COOKIE_SECRET = Buffer.alloc(32, 7).toString("base64");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("401s when there's no token cookie", async () => {
    const response = await GET(requestWithToken());
    expect(response.status).toBe(401);
  });

  it("returns the user's guid and league list", async () => {
    vi.spyOn(yahooClient, "createHttpYahooApi").mockReturnValue({
      getUser: () => Promise.resolve(RAW_DISCOVERY_RESPONSE),
      getUserLeagues: () => Promise.resolve(RAW_DISCOVERY_RESPONSE),
      getLeague: () => Promise.reject(new Error("unused")),
      getScoreboard: () => Promise.reject(new Error("unused")),
      getRoster: () => Promise.reject(new Error("unused")),
      getTransactions: () => Promise.reject(new Error("unused")),
      getDraftResults: () => Promise.reject(new Error("unused")),
    });

    const response = await GET(requestWithToken("real-token"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.guid).toBe("GUID-1");
    expect(data.leagues).toEqual([
      { leagueKey: "423.l.1", name: "My League", season: 2025, teams: 10 },
    ]);
  });
});
