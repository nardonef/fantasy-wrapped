import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { leagues, teams, wrappedScripts } from "@/db/schema";
import { ENGINE_VERSION } from "@/engine";

/**
 * The claim is what stands between "two processes race on the same team"
 * and "two processes both pay for a Haiku call". This has to be verified
 * against a real Postgres UPDATE, not a mock — the guarantee is the atomicity
 * of a single row-locked statement, which nothing in-process can fake.
 */

const testUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (!testUrl.includes("test")) {
  throw new Error(
    "Refusing to run integration tests: TEST_DATABASE_URL/DATABASE_URL must point at a *test* database",
  );
}

// src/sync/wrapped.ts imports the app's shared `db` singleton (@/db), which
// binds to DATABASE_URL at module-load time — unlike persistBundle, it isn't
// parameterized for a test connection. Force DATABASE_URL to the test URL
// before that module is ever imported, then import it dynamically below, so
// the function under test and this file's own seeding queries land on the
// same database. (Already true in CI, where DATABASE_URL is the test DB;
// this is what makes it true locally too, where .env points DATABASE_URL at
// dev and only TEST_DATABASE_URL at the test database.)
process.env.DATABASE_URL = testUrl;

const client = postgres(testUrl, { prepare: false, max: 8 });
const db = drizzle(client, { schema });

// Every seeded league, so afterAll can delete them and cascade the teams and
// wrapped_scripts rows with them — otherwise a fresh random providerLeagueId
// per run means repeated local `pnpm test` invocations accumulate junk in
// the test database forever (CI gets a fresh Postgres per run, so it never
// notices; a laptop running this weekly does).
const seededLeagueIds: string[] = [];

async function seedTeam(): Promise<string> {
  const [league] = await db
    .insert(leagues)
    .values({
      provider: "sleeper",
      providerLeagueId: `claim-test-${crypto.randomUUID()}`,
      season: 2025,
      name: "Claim Test League",
      totalTeams: 1,
      rosterPositions: [],
      scoringSettings: {},
      syncStatus: "synced",
    })
    .returning({ id: leagues.id });
  seededLeagueIds.push(league.id);
  const [team] = await db
    .insert(teams)
    .values({
      leagueId: league.id,
      providerRosterId: "1",
      displayName: "Test Team",
    })
    .returning({ id: teams.id });
  return team.id;
}

/**
 * `tryClaimGeneration` matches on the real, running ENGINE_VERSION — it isn't
 * parameterized, since a deployment only ever operates at one version. Seed
 * rows at that same version, or the claim's WHERE clause matches nothing and
 * every assertion reads as "claim refused" for the wrong reason.
 */
async function seedScript(
  teamId: string,
  overrides: Partial<typeof wrappedScripts.$inferInsert> = {},
) {
  await db.insert(wrappedScripts).values({
    teamId,
    engineVersion: ENGINE_VERSION,
    script: {},
    ...overrides,
  });
}

describe("tryClaimGeneration (integration)", () => {
  let tryClaimGeneration: typeof import("@/sync/wrapped").tryClaimGeneration;
  let CLAIM_STALE_MS: number;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(__dirname, "../drizzle") });
    ({ tryClaimGeneration, CLAIM_STALE_MS } = await import("@/sync/wrapped"));
  });

  afterAll(async () => {
    if (seededLeagueIds.length > 0) {
      await db.delete(leagues).where(inArray(leagues.id, seededLeagueIds));
    }
    await client.end();
  });

  let teamId: string;
  beforeEach(async () => {
    teamId = await seedTeam();
  });

  it("lets exactly one of many concurrent claims through", async () => {
    await seedScript(teamId);

    const results = await Promise.all(Array.from({ length: 10 }, () => tryClaimGeneration(teamId)));

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("refuses a second claim while the first is still fresh", async () => {
    await seedScript(teamId);

    expect(await tryClaimGeneration(teamId)).toBe(true);
    expect(await tryClaimGeneration(teamId)).toBe(false);
  });

  it("retries once a claim has gone stale — a crashed generation isn't stuck forever", async () => {
    await seedScript(teamId, {
      copyGenerationClaimedAt: new Date(Date.now() - CLAIM_STALE_MS - 1000),
    });

    expect(await tryClaimGeneration(teamId)).toBe(true);
  });

  it("never claims a team that already has copy", async () => {
    await seedScript(teamId, { copy: { cards: [], archetype: { title: "x", body: "y" } } });

    expect(await tryClaimGeneration(teamId)).toBe(false);
  });

  it("claiming actually records the timestamp, not just a boolean", async () => {
    await seedScript(teamId);
    await tryClaimGeneration(teamId);

    const [row] = await db
      .select({ claimedAt: wrappedScripts.copyGenerationClaimedAt })
      .from(wrappedScripts)
      .where(eq(wrappedScripts.teamId, teamId));
    expect(row.claimedAt).not.toBeNull();
  });
});
