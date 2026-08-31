import path from "node:path";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { teamSeasonStats } from "@/db/schema";
import { computeSeasonFacts, ENGINE_VERSION } from "@/engine";
import type { NormalizedLeagueBundle } from "@/providers/types";
import { persistBundle } from "@/sync/persist";
import { computeTeamSeasonStatsRows, upsertTeamSeasonStats } from "@/sync/team-season-stats";

const testUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (!testUrl.includes("test")) {
  throw new Error(
    "Refusing to run integration tests: TEST_DATABASE_URL/DATABASE_URL must point at a *test* database",
  );
}

const client = postgres(testUrl, { prepare: false, max: 4 });
const db = drizzle(client, { schema });

// Hand-built Yahoo bundle fixture, mirroring the pattern used in route.test.ts
// Uses distinct providerLeagueId to avoid collision with sync-route-yahoo-fail-open.test.ts
const BUNDLE: NormalizedLeagueBundle = {
  league: {
    provider: "yahoo",
    providerLeagueId: "423.l.team-stats-happy",
    season: 2025,
    name: "Legends Only League",
    totalTeams: 2,
    rosterPositions: ["QB", "RB", "RB"],
    scoringSettings: {},
    playoffStartWeek: 15,
    playoffTeams: 2,
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
    {
      providerRosterId: "2",
      providerUserId: "GUID-2",
      displayName: "Bench Regret FC",
      teamName: null,
      avatarUrl: null,
      wins: 4,
      losses: 10,
      ties: 0,
      pointsFor: 1300.2,
      pointsAgainst: 1500.5,
      finalRank: 2,
      playoffSeed: null,
      raw: {},
    },
  ],
  matchups: [
    {
      week: 1,
      teamA: "1",
      teamB: "2",
      teamAScore: 120.5,
      teamBScore: 98.2,
      isPlayoff: false,
      bracketRound: null,
    },
  ],
  playerWeeks: [],
  players: [],
  transactions: [],
  draftPicks: [],
};

describe("sync writes team_season_stats for Yahoo (integration)", () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(__dirname, "../drizzle") });
  });

  afterAll(async () => {
    await client.end();
  });

  it("computes and upserts a row per team after persistBundle, mirroring the sync route", async () => {
    const { teamIdByRoster } = await persistBundle(db, BUNDLE);
    const facts = computeSeasonFacts(BUNDLE);
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
