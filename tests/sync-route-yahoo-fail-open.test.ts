import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { NextRequest } from "next/server";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { encryptCookieValue, YAHOO_TOKEN_COOKIE } from "@/lib/yahoo-cookies";

const LEAGUE_KEY = "423.l.team-stats-fail-open";

const testUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (!testUrl.includes("test")) {
  throw new Error(
    "Refusing to run integration tests: TEST_DATABASE_URL/DATABASE_URL must point at a *test* database",
  );
}

// `src/app/api/yahoo/sync/route.ts` imports the `db` singleton from `@/db`, which
// reads DATABASE_URL at module load time (not through the TEST_DATABASE_URL
// guard clause above). Point it at the already-validated test database before the
// route module — and its `@/db` import — is ever evaluated below, and restore it
// afterward so this doesn't leak into other test files sharing the same worker process.
const originalDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = testUrl;

// The route defers writeTeamSeasonStats via next/server's after(), which
// requires a real Next.js request-scoped context to register its callback —
// calling the exported POST() directly (as this test does, bypassing Next's
// own server runtime) throws "after() was called outside a request scope".
// Mock after() to run its callback immediately instead, collecting the
// resulting promise so the test can await it deterministically before
// asserting on the deferred work's side effects (the console.error below).
const afterCallbacks: Promise<unknown>[] = [];
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (fn: () => unknown) => {
      afterCallbacks.push(Promise.resolve().then(fn));
    },
  };
});

// The route calls fetchYahooLeagueBundle directly. Mock it to return a
// minimal valid bundle so we can test the deferred writeTeamSeasonStats
// fail-open behavior without needing to hit the real network or maintain
// fixture files. The route test already has comprehensive tests of the
// fetch/normalize pipeline.
vi.mock("@/providers/yahoo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/yahoo")>();
  return {
    ...actual,
    fetchYahooLeagueBundle: async () => {
      // Return a minimal valid bundle with at least one matchup so persistBundle succeeds
      return {
        league: {
          provider: "yahoo" as const,
          providerLeagueId: LEAGUE_KEY,
          season: 2025,
          name: "Test League",
          totalTeams: 1,
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
            displayName: "Team One",
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
    },
  };
});

// Force the team_season_stats write to fail so we can prove the route's
// fail-open handling (src/sync/team-season-stats.ts's writeTeamSeasonStats)
// actually contains the failure. Mocking upsertTeamSeasonStats directly
// would NOT work here: writeTeamSeasonStats lives in the same module and
// calls it via a same-module binding, which vi.mock's module-level
// replacement does not intercept (that only affects callers in OTHER
// modules). computeSeasonFacts is imported from a genuinely different
// module (@/engine), so mocking it there is correctly seen by every
// consumer, including writeTeamSeasonStats.
vi.mock("@/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine")>();
  return {
    ...actual,
    computeSeasonFacts: () => {
      throw new Error("simulated team_season_stats computation failure");
    },
  };
});

const migrationClient = postgres(testUrl, { prepare: false, max: 1 });
const migrationDb = drizzle(migrationClient, { schema });

describe("POST /api/yahoo/sync fail-open behavior (integration)", () => {
  let POST: typeof import("@/app/api/yahoo/sync/route").POST;

  beforeAll(async () => {
    await migrate(migrationDb, { migrationsFolder: path.join(__dirname, "../drizzle") });
    ({ POST } = await import("@/app/api/yahoo/sync/route"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await migrationClient.end();
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("still returns 200 with the normal sync payload when the deferred team_season_stats write throws", async () => {
    // Set up the cookie with a valid (fake) token
    process.env.YAHOO_COOKIE_SECRET = Buffer.alloc(32, 7).toString("base64");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    afterCallbacks.length = 0;

    const headers = new Headers({ "content-type": "application/json" });
    headers.set("x-forwarded-for", "test-sync-fail-open");
    headers.set("cookie", `${YAHOO_TOKEN_COOKIE}=${encryptCookieValue("fake-token")}`);
    const request = new NextRequest("http://localhost/api/yahoo/sync", {
      method: "POST",
      headers,
      body: JSON.stringify({ leagueKey: LEAGUE_KEY, guid: "GUID-1" }),
    });

    const response = await POST(request);

    // The stats write now runs via after(), deferred past the response, so
    // the response can never carry its failure — this always returns 200.
    // The real assertion this test exists for is below: the deferred write's
    // own fail-open handling (inside writeTeamSeasonStats) still catches and
    // logs the failure rather than letting it go unhandled.
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.leagueId).toBe(LEAGUE_KEY);
    expect(Array.isArray(body.teams)).toBe(true);
    expect(body.teams.length).toBeGreaterThan(0);

    // Wait for the after()-deferred work this test's mock collected, the way
    // Next.js/Vercel guarantees it runs to completion before the response's
    // handling of this invocation is considered done.
    await Promise.all(afterCallbacks);

    // The failure was still logged, not silently dropped.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "team_season_stats upsert failed",
      expect.any(Error),
    );
  });
});
