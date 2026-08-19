import path from "node:path";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { teamSeasonStats } from "@/db/schema";
import { computeSeasonFacts, ENGINE_VERSION } from "@/engine";
import { createFixtureSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";
import { persistBundle } from "@/sync/persist";
import { computeTeamSeasonStatsRows, upsertTeamSeasonStats } from "@/sync/team-season-stats";

const LEAGUE_ID = "1269125082375008256";
const FIXTURE_DIR = path.join(__dirname, "../fixtures/sleeper", LEAGUE_ID);

const testUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (!testUrl.includes("test")) {
  throw new Error(
    "Refusing to run integration tests: TEST_DATABASE_URL/DATABASE_URL must point at a *test* database",
  );
}

const client = postgres(testUrl, { prepare: false, max: 4 });
const db = drizzle(client, { schema });

describe("sync writes team_season_stats (integration)", () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(__dirname, "../drizzle") });
  });

  afterAll(async () => {
    await client.end();
  });

  it("computes and upserts a row per team after persistBundle, mirroring the sync route", async () => {
    const bundle = await fetchSleeperLeagueBundle(createFixtureSleeperApi(FIXTURE_DIR), LEAGUE_ID);
    const { teamIdByRoster } = await persistBundle(db, bundle);
    const facts = computeSeasonFacts(bundle);
    const rows = computeTeamSeasonStatsRows(facts, teamIdByRoster);
    await upsertTeamSeasonStats(db, rows);

    const anyTeamId = [...teamIdByRoster.values()][0];
    const [row] = await db
      .select()
      .from(teamSeasonStats)
      .where(
        and(
          eq(teamSeasonStats.teamId, anyTeamId),
          eq(teamSeasonStats.engineVersion, ENGINE_VERSION),
        ),
      );
    expect(row).toBeDefined();
    expect(rows).toHaveLength(teamIdByRoster.size);
  });
});
