import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

const LEAGUE_ID = "1269125082375008256";
const FIXTURE_DIR = path.join(__dirname, "../fixtures/sleeper", LEAGUE_ID);

const testUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (!testUrl.includes("test")) {
  throw new Error(
    "Refusing to run integration tests: TEST_DATABASE_URL/DATABASE_URL must point at a *test* database",
  );
}

// `src/app/api/sync/route.ts` imports the `db` singleton from `@/db`, which
// reads DATABASE_URL at module load time (not through the TEST_DATABASE_URL
// guard clause the other integration tests use). Point it at the already-
// validated test database before the route module — and its `@/db` import —
// is ever evaluated below, and restore it afterward so this doesn't leak
// into other test files sharing the same worker process.
const originalDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = testUrl;

// The route calls createHttpSleeperApi(), which hits the real Sleeper API.
// Swap it for the fixture-backed implementation so this test never touches
// the network, while leaving the rest of the module (fetchSleeperLeagueBundle,
// etc.) real.
vi.mock("@/providers/sleeper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/sleeper")>();
  return {
    ...actual,
    createHttpSleeperApi: () => actual.createFixtureSleeperApi(FIXTURE_DIR),
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

describe("POST /api/sync fail-open behavior (integration)", () => {
  let POST: typeof import("@/app/api/sync/route").POST;

  beforeAll(async () => {
    await migrate(migrationDb, { migrationsFolder: path.join(__dirname, "../drizzle") });
    ({ POST } = await import("@/app/api/sync/route"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await migrationClient.end();
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("still returns 200 with the normal sync payload when the team_season_stats upsert throws", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const request = new Request("http://localhost/api/sync", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "test-sync-fail-open", // distinct from other tests/real traffic so the in-memory rate limiter never collides
      },
      body: JSON.stringify({ leagueId: LEAGUE_ID }),
    });

    const response = await POST(request);

    // The assertion that actually proves fail-open: a thrown stats upsert
    // must not surface as the route's 502 error response.
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.leagueId).toBe(LEAGUE_ID);
    expect(Array.isArray(body.teams)).toBe(true);
    expect(body.teams.length).toBeGreaterThan(0);

    // The failure was still logged, not silently dropped.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "team_season_stats upsert failed",
      expect.any(Error),
    );
  });
});
