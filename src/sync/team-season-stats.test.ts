import path from "node:path";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { leagues, teamSeasonStats, teams } from "@/db/schema";
import { computeSeasonFacts, ENGINE_VERSION } from "@/engine";
import { createFixtureSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";
import { computeTeamSeasonStatsRows, upsertTeamSeasonStats } from "./team-season-stats";

const LEAGUE_ID = "1269125082375008256";
const FIXTURE_DIR = path.join(__dirname, "../../fixtures/sleeper", LEAGUE_ID);

describe("computeTeamSeasonStatsRows", () => {
  it("derives rates that match the underlying SeasonFacts", async () => {
    const bundle = await fetchSleeperLeagueBundle(createFixtureSleeperApi(FIXTURE_DIR), LEAGUE_ID);
    const facts = computeSeasonFacts(bundle);
    const rosterId = Object.keys(facts.teams)[0];
    const teamIdByRoster = new Map(Object.keys(facts.teams).map((id) => [id, `fake-team-${id}`]));

    const rows = computeTeamSeasonStatsRows(facts, teamIdByRoster);
    const row = rows.find((r) => r.teamId === `fake-team-${rosterId}`);
    const t = facts.teams[rosterId];

    expect(row).toBeDefined();
    expect(row?.engineVersion).toBe(ENGINE_VERSION);
    expect(row?.benchRegretRate).toBeCloseTo(t.benchRegretTotal / t.pointsFor, 6);
    expect(row?.flippableLossRate).toBeCloseTo(
      t.flippableLosses.length / facts.league.regularSeasonWeeks.length,
      6,
    );
    expect(row?.allPlayWinPct).toBe(t.allPlay.winPct);
    expect(row?.luckDelta).toBe(t.luckDelta);
    expect(row?.longestWinStreak).toBe(t.longestWinStreak?.length ?? 0);
    expect(row?.longestLossStreak).toBe(t.longestLossStreak?.length ?? 0);
    expect(row?.transactionTotal).toBe(t.transactionCounts.total);
  });

  it("skips a rosterId with no matching teamId", async () => {
    const bundle = await fetchSleeperLeagueBundle(createFixtureSleeperApi(FIXTURE_DIR), LEAGUE_ID);
    const facts = computeSeasonFacts(bundle);
    const rows = computeTeamSeasonStatsRows(facts, new Map());
    expect(rows).toHaveLength(0);
  });
});

const testUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (!testUrl.includes("test")) {
  throw new Error(
    "Refusing to run integration tests: TEST_DATABASE_URL/DATABASE_URL must point at a *test* database",
  );
}

describe("upsertTeamSeasonStats (integration)", () => {
  const client = postgres(testUrl, { prepare: false, max: 4 });
  const db = drizzle(client, { schema });
  let teamId: string;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(__dirname, "../../drizzle") });
    const [league] = await db
      .insert(leagues)
      .values({
        provider: "sleeper",
        providerLeagueId: `test-global-${Date.now()}`,
        season: 2025,
        name: "Global Stats Test League",
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
        providerRosterId: "1",
        displayName: "Test Team",
        pointsFor: 1200,
      })
      .returning({ id: teams.id });
    teamId = team.id;
  });

  afterAll(async () => {
    await client.end();
  });

  it("inserts a row, then updates it in place on re-sync", async () => {
    await upsertTeamSeasonStats(db, [
      {
        teamId,
        engineVersion: "test-0.0.0",
        benchRegretRate: 0.1,
        flippableLossRate: 0.2,
        allPlayWinPct: 0.5,
        luckDelta: 0.05,
        longestWinStreak: 3,
        longestLossStreak: 2,
        transactionTotal: 10,
      },
    ]);
    let [row] = await db
      .select()
      .from(teamSeasonStats)
      .where(
        and(eq(teamSeasonStats.teamId, teamId), eq(teamSeasonStats.engineVersion, "test-0.0.0")),
      );
    expect(row.benchRegretRate).toBeCloseTo(0.1);
    expect(row.transactionTotal).toBe(10);

    await upsertTeamSeasonStats(db, [
      {
        teamId,
        engineVersion: "test-0.0.0",
        benchRegretRate: 0.15,
        flippableLossRate: 0.2,
        allPlayWinPct: 0.5,
        luckDelta: 0.05,
        longestWinStreak: 3,
        longestLossStreak: 2,
        transactionTotal: 12,
      },
    ]);
    [row] = await db
      .select()
      .from(teamSeasonStats)
      .where(
        and(eq(teamSeasonStats.teamId, teamId), eq(teamSeasonStats.engineVersion, "test-0.0.0")),
      );
    expect(row.benchRegretRate).toBeCloseTo(0.15);
    expect(row.transactionTotal).toBe(12);
  });

  it("does nothing for an empty rows array", async () => {
    await expect(upsertTeamSeasonStats(db, [])).resolves.toBeUndefined();
  });
});
