import path from "node:path";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createFixtureSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";
import type { NormalizedLeagueBundle } from "@/providers/types";
import { persistBundle } from "@/sync/persist";

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

describe("persistBundle (integration)", () => {
  let bundle: NormalizedLeagueBundle;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(__dirname, "../drizzle") });
    bundle = await fetchSleeperLeagueBundle(createFixtureSleeperApi(FIXTURE_DIR), LEAGUE_ID);
  });

  afterAll(async () => {
    await client.end();
  });

  it("persists a full bundle and is idempotent across re-syncs", async () => {
    const { leagueId } = await persistBundle(db, bundle);

    const [teamCount] = await db
      .select({ n: count() })
      .from(schema.teams)
      .where(eq(schema.teams.leagueId, leagueId));
    expect(teamCount.n).toBe(bundle.teams.length);

    const [matchupCount] = await db
      .select({ n: count() })
      .from(schema.matchups)
      .where(eq(schema.matchups.leagueId, leagueId));
    expect(matchupCount.n).toBe(bundle.matchups.length);

    const [scoreCount] = await db
      .select({ n: count() })
      .from(schema.playerScores)
      .where(eq(schema.playerScores.leagueId, leagueId));
    expect(scoreCount.n).toBe(bundle.playerWeeks.length);

    const [txCount] = await db
      .select({ n: count() })
      .from(schema.transactions)
      .where(eq(schema.transactions.leagueId, leagueId));
    expect(txCount.n).toBe(bundle.transactions.length);

    const [pickCount] = await db
      .select({ n: count() })
      .from(schema.draftPicks)
      .where(eq(schema.draftPicks.leagueId, leagueId));
    expect(pickCount.n).toBe(bundle.draftPicks.length);

    const teamIdsBefore = (
      await db
        .select({ id: schema.teams.id })
        .from(schema.teams)
        .where(eq(schema.teams.leagueId, leagueId))
    )
      .map((t) => t.id)
      .sort();

    // Re-sync: same league row, same team ids (wrapped_scripts must survive),
    // same derived-row counts.
    const second = await persistBundle(db, bundle);
    expect(second.leagueId).toBe(leagueId);

    const teamIdsAfter = (
      await db
        .select({ id: schema.teams.id })
        .from(schema.teams)
        .where(eq(schema.teams.leagueId, leagueId))
    )
      .map((t) => t.id)
      .sort();
    expect(teamIdsAfter).toEqual(teamIdsBefore);

    const [scoreCountAfter] = await db
      .select({ n: count() })
      .from(schema.playerScores)
      .where(eq(schema.playerScores.leagueId, leagueId));
    expect(scoreCountAfter.n).toBe(bundle.playerWeeks.length);
  });
});
