import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { leagues, teamSeasonStats, teams } from "@/db/schema";
import { getGlobalStats } from "./global-stats";

const testUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (!testUrl.includes("test")) {
  throw new Error(
    "Refusing to run integration tests: TEST_DATABASE_URL/DATABASE_URL must point at a *test* database",
  );
}

describe("getGlobalStats (integration)", () => {
  const client = postgres(testUrl, { prepare: false, max: 4 });
  const db = drizzle(client, { schema });

  // Each test gets its own engine-version string so the tests never share a
  // pool — there's no truncation between tests in this file (matching
  // tests/persist.test.ts's existing pattern), so sharing a version would
  // make later assertions depend on execution order.
  async function seedTeam(
    engineVersion: string,
    overrides: Partial<typeof teamSeasonStats.$inferInsert> = {},
  ) {
    const [league] = await db
      .insert(leagues)
      .values({
        provider: "sleeper",
        providerLeagueId: `test-global-stats-${Math.random()}`,
        season: 2025,
        name: "Seed League",
        totalTeams: 1,
        rosterPositions: ["QB"],
        scoringSettings: {},
        syncStatus: "synced",
      })
      .returning({ id: leagues.id });
    const [team] = await db
      .insert(teams)
      .values({
        leagueId: league.id,
        providerRosterId: String(Math.random()),
        displayName: "Seed Team",
        pointsFor: 1000,
      })
      .returning({ id: teams.id });
    await db.insert(teamSeasonStats).values({
      teamId: team.id,
      engineVersion,
      benchRegretRate: 0.1,
      flippableLossRate: 0.1,
      allPlayWinPct: 0.5,
      luckDelta: 0,
      longestWinStreak: 3,
      longestLossStreak: 2,
      transactionTotal: 10,
      ...overrides,
    });
    return team.id;
  }

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(__dirname, "../../drizzle") });
  });

  afterAll(async () => {
    await client.end();
  });

  it("returns {} when the pool is below the minimum size", async () => {
    const engineVersion = `test-below-floor-${Math.random()}`;
    const teamId = await seedTeam(engineVersion, { benchRegretRate: 0.3 });
    // Only 1 row exists for this engineVersion — well below the 25-row floor.
    const stats = await getGlobalStats(db, teamId, engineVersion);
    expect(stats).toEqual({});
  });

  it("computes a percentile once the pool clears the minimum size", async () => {
    const engineVersion = `test-at-floor-${Math.random()}`;
    // Seed 24 teams worse than "own" on every stat, then a 25th (own) — 25
    // total, meets the floor, and own should be at the top of this pool.
    let ownTeamId = "";
    for (let i = 0; i < 25; i++) {
      const isOwn = i === 24;
      const teamId = await seedTeam(engineVersion, {
        benchRegretRate: isOwn ? 0.01 : 0.5, // lower is better
        allPlayWinPct: isOwn ? 0.9 : 0.3, // higher is better
      });
      if (isOwn) ownTeamId = teamId;
    }
    const stats = await getGlobalStats(db, ownTeamId, engineVersion);
    expect(stats.benchRegretRatePercentile?.poolSize).toBe(25);
    // "Worse than" is a strict inequality, so a team can never be worse than
    // itself — the ceiling with 25 total rows is round(24/25 * 100) = 96, not 100.
    expect(stats.benchRegretRatePercentile?.percentile).toBe(96);
    expect(stats.allPlayWinPctPercentile?.percentile).toBe(96);
    // "own" is strictly best on both stats among these 25 rows — nobody else
    // is strictly better, so the independently-queried inverse percentile
    // should read low (0), not the naive (and, with ties, wrong) 100 - 96 = 4.
    expect(stats.benchRegretRatePercentile?.inversePercentile).toBe(0);
    expect(stats.allPlayWinPctPercentile?.inversePercentile).toBe(0);
  });

  it("keeps inversePercentile sane under real tie mass, not a naive 100 - percentile", async () => {
    const engineVersion = `test-ties-${Math.random()}`;
    // All 25 rows -- including "own" -- share the same flippableLossRate.
    // Nobody is strictly worse and nobody is strictly better than "own", so
    // both directions must read 0. The pre-fix code derived the wince
    // direction as `100 - percentile`, which would have reported this
    // tied-best team's inversePercentile as 100 -- "you left more losses on
    // the table than 100% of everyone" for a team with the best rate in the
    // pool. That's the exact regression this test guards against.
    let ownTeamId = "";
    for (let i = 0; i < 25; i++) {
      const teamId = await seedTeam(engineVersion, { flippableLossRate: 0 });
      if (i === 24) ownTeamId = teamId;
    }
    const stats = await getGlobalStats(db, ownTeamId, engineVersion);
    expect(stats.flippableLossRatePercentile?.poolSize).toBe(25);
    expect(stats.flippableLossRatePercentile?.percentile).toBe(0);
    expect(stats.flippableLossRatePercentile?.inversePercentile).toBe(0);
  });

  it("returns {} for a team with no row for the current engine version", async () => {
    const engineVersion = `test-no-row-${Math.random()}`;
    const stats = await getGlobalStats(db, "00000000-0000-0000-0000-000000000000", engineVersion);
    expect(stats).toEqual({});
  });
});
