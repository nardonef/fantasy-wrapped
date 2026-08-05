# Global Comparisons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `global` insight category that compares one team-season against every
team-season the app has ever synced (e.g. "your bench regret rate beats 92% of every
team-season we've tracked"), on 7 scale-invariant/rate-based stats, gated by a minimum
pool size so a thin early pool never produces a weak card.

**Architecture:** A new `team_season_stats` table (one row per team-season) is written
during `/api/sync`, right after the league's facts are computed. A single query function,
`getGlobalStats(db, teamId)`, computes this team's percentile against that table for all 7
stats in one round trip, gated by a 25-row minimum pool per stat. `src/engine/` stays pure
and I/O-free: `getGlobalStats`'s result is a plain `GlobalStats` object passed in as a third
argument alongside `facts`, exactly like every other input the pure engine already
consumes. Global cards are computed once, at first Wrapped generation, and frozen in the
same `wrapped_scripts` cache as every other card — no separate caching tier.

**Tech Stack:** TypeScript strict, Drizzle ORM (postgres-js driver), Vitest, existing
`src/engine/` insight-module pattern.

## Global Constraints

- `src/engine/` must stay pure, deterministic, and I/O-free — golden tests depend on it.
  `GlobalStats` flows in as a plain data argument, never fetched from inside the engine.
- Minimum pool size per stat: **25** team-seasons. Below it, that stat's key is entirely
  absent from `GlobalStats` (not zero, not a placeholder) and the corresponding insight
  module returns `null`.
- Cards are aggregate-only: a percentile and a pool size, never a reference to another
  specific team, manager, or league.
- v1 stats are restricted to those already scale-invariant or expressed as a rate/percentage
  (no raw point totals, no cross-league normalization math).
- Shipping this feature requires bumping `ENGINE_VERSION` (`src/engine/version.ts`), per the
  existing rule in `docs/engine.md` — golden snapshots must be reviewed and regenerated.
- Every DB write/read in this feature fails open: a failed `team_season_stats` upsert
  during sync must not fail the sync; a failed `getGlobalStats` query must not fail Wrapped
  generation — both degrade to "no global data available" and log the error.
- Spec: `docs/superpowers/specs/2026-08-04-global-comparisons-design.md` — read it first for
  full rationale; this plan implements it verbatim except where a design gap was found and
  resolved during planning (noted inline below).

---

### Task 1: `team_season_stats` schema + migration

**Files:**
- Modify: `src/db/schema.ts`
- Create: (generated) `drizzle/00XX_<name>.sql` and matching snapshot, via `pnpm db:generate`

**Interfaces:**
- Produces: `teamSeasonStats` Drizzle table export, columns: `id`, `teamId`, `engineVersion`,
  `benchRegretRate`, `flippableLossRate`, `allPlayWinPct`, `luckDelta`, `longestWinStreak`,
  `longestLossStreak`, `transactionTotal`, `createdAt`, `updatedAt`. Unique on
  `(teamId, engineVersion)`.

- [ ] **Step 1: Add the table to the schema**

Append to `src/db/schema.ts` (after the `wrappedScripts` table, same file):

```ts
/**
 * Derived per-team-season stats used only for cross-league comparison
 * ("global" insight category) — the values powering percentile lookups.
 * Written once per team-season during sync, one row per (team, engineVersion)
 * so a formula change doesn't silently mix definitions in the same pool.
 */
export const teamSeasonStats = pgTable(
  "team_season_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    engineVersion: text("engine_version").notNull(),
    /** benchRegretTotal / pointsFor — lower is better. */
    benchRegretRate: doublePrecision("bench_regret_rate").notNull(),
    /** flippableLosses.length / regularSeasonWeeks.length — lower is better. */
    flippableLossRate: doublePrecision("flippable_loss_rate").notNull(),
    allPlayWinPct: doublePrecision("all_play_win_pct").notNull(),
    /** actual win% − all-play win% — higher is luckier. */
    luckDelta: doublePrecision("luck_delta").notNull(),
    longestWinStreak: integer("longest_win_streak").notNull(),
    longestLossStreak: integer("longest_loss_streak").notNull(),
    transactionTotal: integer("transaction_total").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("team_season_stats_team_engine_ux").on(t.teamId, t.engineVersion)],
);
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file `drizzle/00XX_<generated-name>.sql` containing a `CREATE TABLE
"team_season_stats"` statement plus its FK and unique index, and a matching
`drizzle/meta/00XX_snapshot.json`. Read the generated SQL to confirm it matches the schema
above — do not hand-edit it.

- [ ] **Step 3: Apply the migration to the local dev and test databases**

Run: `pnpm db:migrate` (applies to `DATABASE_URL`, the local dev DB)
Run: `DATABASE_URL="$TEST_DATABASE_URL" pnpm db:migrate` if `TEST_DATABASE_URL` is set in
`.env`, otherwise the integration tests in later tasks will apply it themselves via
`migrate()` in their `beforeAll` — confirm which by checking `.env` for
`TEST_DATABASE_URL`.
Expected: no errors; `psql fantasy_wrapped -c '\d team_season_stats'` shows the new table.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: add team_season_stats table for global comparisons"
```

---

### Task 2: Engine types for global comparisons

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/engine/version.ts`
- Modify: `src/engine/select.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `GlobalStatEntry`, `GlobalStats` types; `InsightCategory` now includes
  `"global"`. `select.ts`'s `CATEGORY_CAPS`, `counts` initializer, and `CATEGORY_ORDER`
  all account for the new category so `Record<InsightCategory, number>` still type-checks.
  No behavior changes yet (no insight module produces `category: "global"` until Task 7).

- [ ] **Step 1: Add the types**

In `src/engine/types.ts`, change:

```ts
export type InsightCategory = "regret" | "luck" | "people" | "narrative" | "identity";
```

to:

```ts
export type InsightCategory = "regret" | "luck" | "people" | "narrative" | "identity" | "global";

/** One stat's standing against every team-season the app has ever synced. */
export type GlobalStatEntry = { percentile: number; poolSize: number };

/**
 * Cross-league comparison data for one team-season, fetched outside src/engine/
 * (DB I/O) and passed in as a plain argument — a missing key means the pool for
 * that stat was below the minimum size, not that the value was zero.
 */
export type GlobalStats = {
  benchRegretRatePercentile?: GlobalStatEntry;
  flippableLossRatePercentile?: GlobalStatEntry;
  allPlayWinPctPercentile?: GlobalStatEntry;
  luckDeltaPercentile?: GlobalStatEntry;
  longestWinStreakPercentile?: GlobalStatEntry;
  longestLossStreakPercentile?: GlobalStatEntry;
  transactionTotalPercentile?: GlobalStatEntry;
};
```

- [ ] **Step 2: Bump ENGINE_VERSION**

In `src/engine/version.ts`, change `"0.3.0"` to `"0.4.0"`.

- [ ] **Step 3: Update select.ts's category bookkeeping**

In `src/engine/select.ts`, change:

```ts
const CATEGORY_CAPS: Record<InsightCategory, number> = {
  regret: 3,
  luck: 2,
  people: 3,
  narrative: 2,
  identity: 1, // the opener is already an identity card
};
```

to:

```ts
const CATEGORY_CAPS: Record<InsightCategory, number> = {
  regret: 3,
  luck: 2,
  people: 3,
  narrative: 2,
  identity: 1, // the opener is already an identity card
  global: 2,
};
```

Change:

```ts
const CATEGORY_ORDER: InsightCategory[] = ["identity", "regret", "luck", "people", "narrative"];
```

to:

```ts
// "global" lands last, before the finish card — a zoom-out beat right before
// the story ends: how you stack up against everyone, not just your league.
const CATEGORY_ORDER: InsightCategory[] = [
  "identity",
  "regret",
  "luck",
  "people",
  "narrative",
  "global",
];
```

Change:

```ts
  const counts: Record<InsightCategory, number> = {
    regret: 0,
    luck: 0,
    people: 0,
    narrative: 0,
    identity: 0,
  };
```

to:

```ts
  const counts: Record<InsightCategory, number> = {
    regret: 0,
    luck: 0,
    people: 0,
    narrative: 0,
    identity: 0,
    global: 0,
  };
```

- [ ] **Step 4: Run the full test suite to confirm no behavior change**

Run: `./node_modules/.bin/vitest run`
Expected: PASS, identical to before this task — no insight module produces `category:
"global"` yet, so `CATEGORY_CAPS.global`/`CATEGORY_ORDER`'s new entry are inert. (Use the
`./node_modules/.bin/vitest` binary directly, not `pnpm test` — the RTK hook on this
machine has previously mangled `pnpm test`/`pnpm lint` output.)

- [ ] **Step 5: Commit**

```bash
git add src/engine/types.ts src/engine/version.ts src/engine/select.ts
git commit -m "feat: add GlobalStats types and global category bookkeeping"
```

---

### Task 3: Pure derivation — `computeTeamSeasonStatsRows`

**Files:**
- Create: `src/sync/team-season-stats.ts`
- Test: `src/sync/team-season-stats.test.ts`

**Interfaces:**
- Consumes: `SeasonFacts` and `ENGINE_VERSION` from `@/engine` (already exported).
- Produces: `TeamSeasonStatsRow` type and `computeTeamSeasonStatsRows(facts: SeasonFacts,
  teamIdByRoster: Map<string, string>): TeamSeasonStatsRow[]` — pure, no I/O. Task 4 adds
  `upsertTeamSeasonStats` to the same file.

- [ ] **Step 1: Write the failing test**

Create `src/sync/team-season-stats.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeSeasonFacts, ENGINE_VERSION } from "@/engine";
import { createFixtureSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";
import { computeTeamSeasonStatsRows } from "./team-season-stats";

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run src/sync/team-season-stats.test.ts`
Expected: FAIL — `Cannot find module './team-season-stats'`.

- [ ] **Step 3: Implement**

Create `src/sync/team-season-stats.ts`:

```ts
import { ENGINE_VERSION, type SeasonFacts } from "@/engine";

export type TeamSeasonStatsRow = {
  teamId: string;
  engineVersion: string;
  benchRegretRate: number;
  flippableLossRate: number;
  allPlayWinPct: number;
  luckDelta: number;
  longestWinStreak: number;
  longestLossStreak: number;
  transactionTotal: number;
};

/** Derive the handful of scale-invariant stats used for global comparisons. */
export function computeTeamSeasonStatsRows(
  facts: SeasonFacts,
  teamIdByRoster: Map<string, string>,
): TeamSeasonStatsRow[] {
  const gamesPlayed = facts.league.regularSeasonWeeks.length;
  const rows: TeamSeasonStatsRow[] = [];
  for (const [rosterId, t] of Object.entries(facts.teams)) {
    const teamId = teamIdByRoster.get(rosterId);
    if (!teamId) continue;
    rows.push({
      teamId,
      engineVersion: ENGINE_VERSION,
      benchRegretRate: t.pointsFor > 0 ? t.benchRegretTotal / t.pointsFor : 0,
      flippableLossRate: gamesPlayed > 0 ? t.flippableLosses.length / gamesPlayed : 0,
      allPlayWinPct: t.allPlay.winPct,
      luckDelta: t.luckDelta,
      longestWinStreak: t.longestWinStreak?.length ?? 0,
      longestLossStreak: t.longestLossStreak?.length ?? 0,
      transactionTotal: t.transactionCounts.total,
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/sync/team-season-stats.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sync/team-season-stats.ts src/sync/team-season-stats.test.ts
git commit -m "feat: derive per-team-season global comparison stats"
```

---

### Task 4: `upsertTeamSeasonStats` + `persistBundle` returns `teamIdByRoster`

**Files:**
- Modify: `src/sync/team-season-stats.ts`
- Modify: `src/sync/persist.ts`
- Test: `src/sync/team-season-stats.test.ts` (extend)

**Interfaces:**
- Consumes: `teamSeasonStats` table from `@/db/schema` (Task 1); `TeamSeasonStatsRow` (Task 3).
- Produces: `upsertTeamSeasonStats(db: typeof Database, rows: TeamSeasonStatsRow[]):
  Promise<void>`. `persistBundle` now returns `{ leagueId: string; teamIdByRoster: Map<string,
  string> }` (was `{ leagueId: string }`) — the map was already built internally, this only
  changes what's returned.

- [ ] **Step 1: Write the failing integration test**

Append to `src/sync/team-season-stats.test.ts` (same file, new `describe` block, following
the exact DB-guard/migrate/afterAll pattern from `tests/persist.test.ts`):

```ts
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll } from "vitest";
import * as schema from "@/db/schema";
import { teamSeasonStats, teams, leagues } from "@/db/schema";
import { upsertTeamSeasonStats } from "./team-season-stats";

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
      .where(and(eq(teamSeasonStats.teamId, teamId), eq(teamSeasonStats.engineVersion, "test-0.0.0")));
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
      .where(and(eq(teamSeasonStats.teamId, teamId), eq(teamSeasonStats.engineVersion, "test-0.0.0")));
    expect(row.benchRegretRate).toBeCloseTo(0.15);
    expect(row.transactionTotal).toBe(12);
  });

  it("does nothing for an empty rows array", async () => {
    await expect(upsertTeamSeasonStats(db, [])).resolves.toBeUndefined();
  });
});
```

Add `import path from "node:path";` and `import { describe, expect, it } from "vitest";` to
the top of the file if not already present from Task 3 (they are — reuse the same imports).

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run src/sync/team-season-stats.test.ts`
Expected: FAIL — `upsertTeamSeasonStats is not a function` / not exported.

- [ ] **Step 3: Implement `upsertTeamSeasonStats`**

Append to `src/sync/team-season-stats.ts`:

```ts
import { sql } from "drizzle-orm";
import type { db as Database } from "@/db";
import { teamSeasonStats } from "@/db/schema";

export async function upsertTeamSeasonStats(
  db: typeof Database,
  rows: TeamSeasonStatsRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(teamSeasonStats)
    .values(rows)
    .onConflictDoUpdate({
      target: [teamSeasonStats.teamId, teamSeasonStats.engineVersion],
      set: {
        benchRegretRate: sql`excluded.bench_regret_rate`,
        flippableLossRate: sql`excluded.flippable_loss_rate`,
        allPlayWinPct: sql`excluded.all_play_win_pct`,
        luckDelta: sql`excluded.luck_delta`,
        longestWinStreak: sql`excluded.longest_win_streak`,
        longestLossStreak: sql`excluded.longest_loss_streak`,
        transactionTotal: sql`excluded.transaction_total`,
        updatedAt: sql`now()`,
      },
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/sync/team-season-stats.test.ts`
Expected: PASS (4 tests total across both describe blocks).

- [ ] **Step 5: Update `persistBundle` to return `teamIdByRoster`**

In `src/sync/persist.ts`, change the function signature:

```ts
export async function persistBundle(
  db: typeof Database,
  bundle: NormalizedLeagueBundle,
): Promise<{ leagueId: string }> {
```

to:

```ts
export async function persistBundle(
  db: typeof Database,
  bundle: NormalizedLeagueBundle,
): Promise<{ leagueId: string; teamIdByRoster: Map<string, string> }> {
```

And change the final line of the transaction body:

```ts
    return { leagueId };
```

to:

```ts
    return { leagueId, teamIdByRoster };
```

(`teamIdByRoster` is already built at line 111 and stays in scope — no other change needed.)

- [ ] **Step 6: Run the persist integration test to confirm nothing broke**

Run: `./node_modules/.bin/vitest run tests/persist.test.ts`
Expected: PASS — it destructures `{ leagueId }`, which still works against the wider
return type.

- [ ] **Step 7: Commit**

```bash
git add src/sync/team-season-stats.ts src/sync/team-season-stats.test.ts src/sync/persist.ts
git commit -m "feat: upsert team_season_stats and return teamIdByRoster from persistBundle"
```

---

### Task 5: `getGlobalStats` query

**Files:**
- Create: `src/lib/global-stats.ts`
- Test: `src/lib/global-stats.test.ts`

**Interfaces:**
- Consumes: `teamSeasonStats` table (Task 1), `GlobalStats`/`ENGINE_VERSION` from `@/engine`
  (Task 2).
- Produces: `getGlobalStats(db: typeof Database, teamId: string): Promise<GlobalStats>` —
  never throws (fails open to `{}` on any DB error, per the Global Constraints). Isolated
  behind this one function so a future cached-snapshot approach can replace the query
  without touching callers.

- [ ] **Step 1: Write the failing integration test**

Create `src/lib/global-stats.test.ts`:

```ts
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
  });

  it("returns {} for a team with no row for the current engine version", async () => {
    const engineVersion = `test-no-row-${Math.random()}`;
    const stats = await getGlobalStats(db, "00000000-0000-0000-0000-000000000000", engineVersion);
    expect(stats).toEqual({});
  });
});
```

Note: the test passes an explicit `engineVersion` as a third argument (a test-only seam) —
`getGlobalStats`'s real signature defaults it to the engine's real `ENGINE_VERSION` so
production callers never pass it, but tests need to isolate each test's rows into their own
pool within the shared, non-truncated test DB. Implement it as an optional third
parameter, default `ENGINE_VERSION` from `@/engine`.

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run src/lib/global-stats.test.ts`
Expected: FAIL — `Cannot find module './global-stats'`.

- [ ] **Step 3: Implement**

Create `src/lib/global-stats.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import type { db as Database } from "@/db";
import { teamSeasonStats } from "@/db/schema";
import { ENGINE_VERSION as DEFAULT_ENGINE_VERSION, type GlobalStats } from "@/engine";

/** Below this pool size, a stat's percentile isn't meaningful — omit it entirely. */
const MIN_GLOBAL_POOL = 25;

type PoolRow = {
  bench_regret_worse: string;
  flippable_loss_worse: string;
  all_play_worse: string;
  luck_worse: string;
  win_streak_worse: string;
  loss_streak_worse: string;
  transaction_worse: string;
  total: string;
};

/**
 * This team's percentile standing against every team-season the app has ever
 * synced, for the 7 v1 global-comparison stats. Never throws — a DB error
 * degrades to {} (no global cards that generation) rather than failing the
 * whole Wrapped, same fail-open behavior as fallback copy.
 */
export async function getGlobalStats(
  db: typeof Database,
  teamId: string,
  engineVersion: string = DEFAULT_ENGINE_VERSION,
): Promise<GlobalStats> {
  try {
    const [own] = await db
      .select()
      .from(teamSeasonStats)
      .where(
        and(eq(teamSeasonStats.teamId, teamId), eq(teamSeasonStats.engineVersion, engineVersion)),
      );
    if (!own) return {};

    const [row] = (await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE bench_regret_rate > ${own.benchRegretRate}) AS bench_regret_worse,
        count(*) FILTER (WHERE flippable_loss_rate > ${own.flippableLossRate}) AS flippable_loss_worse,
        count(*) FILTER (WHERE all_play_win_pct < ${own.allPlayWinPct}) AS all_play_worse,
        count(*) FILTER (WHERE luck_delta < ${own.luckDelta}) AS luck_worse,
        count(*) FILTER (WHERE longest_win_streak < ${own.longestWinStreak}) AS win_streak_worse,
        count(*) FILTER (WHERE longest_loss_streak < ${own.longestLossStreak}) AS loss_streak_worse,
        count(*) FILTER (WHERE transaction_total < ${own.transactionTotal}) AS transaction_worse,
        count(*) AS total
      FROM team_season_stats
      WHERE engine_version = ${engineVersion}
    `)) as unknown as PoolRow[];

    const total = Number(row.total);
    if (total < MIN_GLOBAL_POOL) return {};

    const pct = (worse: string) => Math.round((Number(worse) / total) * 100);

    return {
      benchRegretRatePercentile: { percentile: pct(row.bench_regret_worse), poolSize: total },
      flippableLossRatePercentile: { percentile: pct(row.flippable_loss_worse), poolSize: total },
      allPlayWinPctPercentile: { percentile: pct(row.all_play_worse), poolSize: total },
      luckDeltaPercentile: { percentile: pct(row.luck_worse), poolSize: total },
      longestWinStreakPercentile: { percentile: pct(row.win_streak_worse), poolSize: total },
      longestLossStreakPercentile: { percentile: pct(row.loss_streak_worse), poolSize: total },
      transactionTotalPercentile: { percentile: pct(row.transaction_worse), poolSize: total },
    };
  } catch (error) {
    console.error("getGlobalStats failed", error);
    return {};
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/lib/global-stats.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/global-stats.ts src/lib/global-stats.test.ts
git commit -m "feat: add getGlobalStats percentile query"
```

---

### Task 6: Thread `globalStats` through the engine

**Files:**
- Modify: `src/engine/insights/helpers.ts`
- Modify: `src/engine/insights/index.ts`
- Modify: `src/engine/select.ts`
- Modify: `src/engine/index.ts`
- Modify: `scripts/eval.ts`
- Modify: `scripts/copy-eval.ts`
- Modify: `src/components/story/model.test.ts`
- Modify: `src/components/story/view-builder.test.ts`
- Modify: `src/engine/engine.test.ts`

**Interfaces:**
- Consumes: `GlobalStats` (Task 2).
- Produces: `InsightModule.compute` now has signature `(facts: SeasonFacts, rosterId:
  string, globalStats: GlobalStats) => CandidateInsight | null` (existing modules with the
  2-arg form remain valid implementations — TypeScript allows a function with fewer
  declared parameters to satisfy a type expecting more). `computeCandidates(facts,
  rosterId, globalStats)`, `selectCards(facts, rosterId, globalStats)`,
  `generateCardScript(facts, rosterId, globalStats)`, and `generateLeagueWrapped(bundle,
  globalStatsByRosterId: Record<string, GlobalStats>)` are the new signatures every caller
  must use. No new insight modules exist yet (Task 7) — every call site in this task
  passes an empty `{}` / `{}`-per-team map, so behavior and golden snapshots are unchanged
  after this task.

- [ ] **Step 1: Update the `InsightModule` type**

In `src/engine/insights/helpers.ts`, change:

```ts
export type InsightModule = {
  id: string;
  category: InsightCategory;
  compute: (facts: SeasonFacts, rosterId: string) => CandidateInsight | null;
};
```

to:

```ts
export type InsightModule = {
  id: string;
  category: InsightCategory;
  compute: (
    facts: SeasonFacts,
    rosterId: string,
    globalStats: GlobalStats,
  ) => CandidateInsight | null;
};
```

Add `GlobalStats` to the existing type-only import at the top of the file:

```ts
import type { CandidateInsight, GlobalStats, InsightCategory, SeasonFacts, TeamSeasonFacts } from "../types";
```

- [ ] **Step 2: Update `computeCandidates`**

In `src/engine/insights/index.ts`, change:

```ts
import type { CandidateInsight, SeasonFacts } from "../types";
```

to:

```ts
import type { CandidateInsight, GlobalStats, SeasonFacts } from "../types";
```

Change:

```ts
export function computeCandidates(facts: SeasonFacts, rosterId: string): CandidateInsight[] {
  const candidates: CandidateInsight[] = [];
  for (const module of allInsights) {
    const insight = module.compute(facts, rosterId);
    if (insight) candidates.push(insight);
  }
  return candidates.sort((a, b) => b.notability - a.notability || a.id.localeCompare(b.id));
}
```

to:

```ts
export function computeCandidates(
  facts: SeasonFacts,
  rosterId: string,
  globalStats: GlobalStats,
): CandidateInsight[] {
  const candidates: CandidateInsight[] = [];
  for (const module of allInsights) {
    const insight = module.compute(facts, rosterId, globalStats);
    if (insight) candidates.push(insight);
  }
  return candidates.sort((a, b) => b.notability - a.notability || a.id.localeCompare(b.id));
}
```

- [ ] **Step 3: Update `selectCards`**

In `src/engine/select.ts`, change:

```ts
export function selectCards(facts: SeasonFacts, rosterId: string): WrappedCard[] {
  const candidates = computeCandidates(facts, rosterId);
```

to:

```ts
export function selectCards(
  facts: SeasonFacts,
  rosterId: string,
  globalStats: GlobalStats,
): WrappedCard[] {
  const candidates = computeCandidates(facts, rosterId, globalStats);
```

Add `GlobalStats` to its type-only import:

```ts
import type { CandidateInsight, GlobalStats, InsightCategory, SeasonFacts, WrappedCard } from "./types";
```

- [ ] **Step 4: Update `generateCardScript` and `generateLeagueWrapped`**

In `src/engine/index.ts`, add `GlobalStats` to the type-only import from `./types`, then
change:

```ts
export function generateCardScript(facts: SeasonFacts, rosterId: string): CardScript {
  const t = facts.teams[rosterId];
  if (!t) throw new Error(`Unknown rosterId ${rosterId}`);
  return {
    engineVersion: ENGINE_VERSION,
    leagueName: facts.league.name,
    season: facts.league.season,
    rosterId,
    managerName: t.displayName,
    teamName: t.teamName,
    cards: selectCards(facts, rosterId),
    archetype: classifyArchetype(facts, rosterId),
  };
}

/** One Wrapped per manager in the league. */
export function generateLeagueWrapped(bundle: NormalizedLeagueBundle): CardScript[] {
  const facts = computeSeasonFacts(bundle);
  return Object.keys(facts.teams)
    .sort((a, b) => Number(a) - Number(b))
    .map((rosterId) => generateCardScript(facts, rosterId));
}
```

to:

```ts
export function generateCardScript(
  facts: SeasonFacts,
  rosterId: string,
  globalStats: GlobalStats,
): CardScript {
  const t = facts.teams[rosterId];
  if (!t) throw new Error(`Unknown rosterId ${rosterId}`);
  return {
    engineVersion: ENGINE_VERSION,
    leagueName: facts.league.name,
    season: facts.league.season,
    rosterId,
    managerName: t.displayName,
    teamName: t.teamName,
    cards: selectCards(facts, rosterId, globalStats),
    archetype: classifyArchetype(facts, rosterId),
  };
}

/** One Wrapped per manager in the league. */
export function generateLeagueWrapped(
  bundle: NormalizedLeagueBundle,
  globalStatsByRosterId: Record<string, GlobalStats>,
): CardScript[] {
  const facts = computeSeasonFacts(bundle);
  return Object.keys(facts.teams)
    .sort((a, b) => Number(a) - Number(b))
    .map((rosterId) =>
      generateCardScript(facts, rosterId, globalStatsByRosterId[rosterId] ?? {}),
    );
}
```

- [ ] **Step 5: Fix every existing call site to compile**

In `scripts/eval.ts`, change line 35 from `generateCardScript(facts, rosterId)` to
`generateCardScript(facts, rosterId, {})`, and line 36 from `computeCandidates(facts,
rosterId)` to `computeCandidates(facts, rosterId, {})`.

In `scripts/copy-eval.ts`, change line 27 from `generateLeagueWrapped(bundle).slice(0,
limit)` to `generateLeagueWrapped(bundle, {}).slice(0, limit)`.

In `src/components/story/model.test.ts`, change line 76 from `generateCardScript(facts,
rosterId)` to `generateCardScript(facts, rosterId, {})`.

In `src/components/story/view-builder.test.ts`, change line 30 from
`generateCardScript(facts, rosterId)` to `generateCardScript(facts, rosterId, {})`.

In `src/engine/engine.test.ts`, change line 25 from `generateLeagueWrapped(bundle)` to
`generateLeagueWrapped(bundle, {})`. (Task 9 replaces this `{}` with a populated fixture
to actually exercise global cards in the golden snapshot — leave it empty here so this
task's diff is a pure signature change with zero behavior change.)

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `pnpm typecheck`
Expected: PASS, no type errors.

Run: `./node_modules/.bin/vitest run`
Expected: PASS, identical results to before this task (golden snapshots unchanged — no
insight module produces `category: "global"` yet).

- [ ] **Step 7: Commit**

```bash
git add src/engine/insights/helpers.ts src/engine/insights/index.ts src/engine/select.ts \
  src/engine/index.ts scripts/eval.ts scripts/copy-eval.ts \
  src/components/story/model.test.ts src/components/story/view-builder.test.ts \
  src/engine/engine.test.ts
git commit -m "refactor: thread GlobalStats through the engine's public entrypoints"
```

---

### Task 7: The 7 global insight modules

**Files:**
- Create: `src/engine/insights/global.ts`
- Test: `src/engine/insights/global.test.ts`
- Modify: `src/engine/insights/index.ts`

**Interfaces:**
- Consumes: `GlobalStats`/`GlobalStatEntry` (Task 2), `InsightModule` (Task 6).
- Produces: `globalInsights: InsightModule[]`, registered into `allInsights` — from this
  task on, a populated `GlobalStats` argument can produce `category: "global"` candidates.

- [ ] **Step 1: Write the failing unit tests**

Create `src/engine/insights/global.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GlobalStats } from "../types";
import { globalInsights } from "./global";

const FACTS = {} as never; // these modules never read `facts`, only `globalStats`
const ROSTER_ID = "1";

function moduleById(id: string) {
  const found = globalInsights.find((m) => m.id === id);
  if (!found) throw new Error(`no global insight module with id ${id}`);
  return found;
}

describe("globalInsights", () => {
  it("returns null when its stat's key is absent from GlobalStats (pool too small)", () => {
    const globalStats: GlobalStats = {};
    for (const module of globalInsights) {
      expect(module.compute(FACTS, ROSTER_ID, globalStats)).toBeNull();
    }
  });

  it("bench-regret-rate: brags at a high percentile", () => {
    const globalStats: GlobalStats = {
      benchRegretRatePercentile: { percentile: 96, poolSize: 300 },
    };
    const insight = moduleById("global-bench-regret-rate").compute(FACTS, ROSTER_ID, globalStats);
    expect(insight?.notability).toBeGreaterThanOrEqual(80);
    expect(insight?.facts.direction).toBe("brag");
    expect(insight?.facts.percentile).toBe(96);
    expect(insight?.facts.poolSize).toBe(300);
  });

  it("bench-regret-rate: winces at a low percentile", () => {
    const globalStats: GlobalStats = {
      benchRegretRatePercentile: { percentile: 4, poolSize: 300 },
    };
    const insight = moduleById("global-bench-regret-rate").compute(FACTS, ROSTER_ID, globalStats);
    expect(insight?.notability).toBeGreaterThanOrEqual(80);
    expect(insight?.facts.direction).toBe("wince");
    expect(insight?.facts.percentile).toBe(96); // 100 - 4, reframed toward the wince
  });

  it("bench-regret-rate: null in the unremarkable middle", () => {
    const globalStats: GlobalStats = {
      benchRegretRatePercentile: { percentile: 55, poolSize: 300 },
    };
    expect(
      moduleById("global-bench-regret-rate").compute(FACTS, ROSTER_ID, globalStats),
    ).toBeNull();
  });

  it("longest-loss-streak: only ever wince-framed, fires at a high percentile", () => {
    const globalStats: GlobalStats = {
      longestLossStreakPercentile: { percentile: 92, poolSize: 300 },
    };
    const insight = moduleById("global-longest-loss-streak").compute(FACTS, ROSTER_ID, globalStats);
    expect(insight?.notability).toBeGreaterThanOrEqual(70);
    expect(insight?.facts.percentile).toBe(92);
  });

  it("transaction-activity: fires only at a high percentile, null otherwise", () => {
    const module = moduleById("global-transaction-activity");
    expect(
      module.compute(FACTS, ROSTER_ID, { transactionTotalPercentile: { percentile: 93, poolSize: 300 } })
        ?.notability,
    ).toBeGreaterThanOrEqual(70);
    expect(
      module.compute(FACTS, ROSTER_ID, { transactionTotalPercentile: { percentile: 20, poolSize: 300 } }),
    ).toBeNull();
  });

  it("every module has category global and a unique id", () => {
    const ids = globalInsights.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of globalInsights) expect(m.category).toBe("global");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run src/engine/insights/global.test.ts`
Expected: FAIL — `Cannot find module './global'`.

- [ ] **Step 3: Implement the modules**

Create `src/engine/insights/global.ts`:

```ts
import type { CandidateInsight, GlobalStats } from "../types";
import type { InsightModule } from "./helpers";

/** `pct` is already oriented so 100 = most notable in the caller's direction. */
function notabilityFromExtremity(pct: number): number | null {
  if (pct < 60) return null;
  if (pct >= 95) return 90;
  if (pct >= 90) return 78;
  if (pct >= 80) return 62;
  return 48;
}

function poolPhrase(poolSize: number): string {
  return `${poolSize} team-seasons tracked`;
}

/**
 * A stat where a high percentile is a brag and a low percentile is a wince
 * (e.g. "beats 92%" vs. "worse than 90%"), sharing one GlobalStats entry.
 * Picks whichever direction is more notable; null if neither clears the floor.
 */
function bidirectional(
  id: string,
  key: keyof GlobalStats,
  bragHeadline: (pct: number, pool: number) => string,
  winceHeadline: (pct: number, pool: number) => string,
): InsightModule {
  return {
    id,
    category: "global",
    compute(_facts, _rosterId, globalStats): CandidateInsight | null {
      const entry = globalStats[key];
      if (!entry) return null;
      const bragNotability = notabilityFromExtremity(entry.percentile);
      const wincePct = 100 - entry.percentile;
      const winceNotability = notabilityFromExtremity(wincePct);
      if (
        bragNotability !== null &&
        (winceNotability === null || bragNotability >= winceNotability)
      ) {
        return {
          id,
          category: "global",
          notability: bragNotability,
          headline: bragHeadline(entry.percentile, entry.poolSize),
          facts: { percentile: entry.percentile, poolSize: entry.poolSize, direction: "brag" },
        };
      }
      if (winceNotability !== null) {
        return {
          id,
          category: "global",
          notability: winceNotability,
          headline: winceHeadline(wincePct, entry.poolSize),
          facts: { percentile: wincePct, poolSize: entry.poolSize, direction: "wince" },
        };
      }
      return null;
    },
  };
}

/** A stat with only one notable direction (e.g. a long losing streak is only ever a wince). */
function unidirectional(
  id: string,
  key: keyof GlobalStats,
  headline: (pct: number, pool: number) => string,
): InsightModule {
  return {
    id,
    category: "global",
    compute(_facts, _rosterId, globalStats): CandidateInsight | null {
      const entry = globalStats[key];
      if (!entry) return null;
      const notability = notabilityFromExtremity(entry.percentile);
      if (notability === null) return null;
      return {
        id,
        category: "global",
        notability,
        headline: headline(entry.percentile, entry.poolSize),
        facts: { percentile: entry.percentile, poolSize: entry.poolSize },
      };
    },
  };
}

export const globalInsights: InsightModule[] = [
  bidirectional(
    "global-bench-regret-rate",
    "benchRegretRatePercentile",
    (pct, pool) => `Your bench regret rate beats ${pct}% of ${poolPhrase(pool)}`,
    (pct, pool) => `Your bench regret rate is worse than ${pct}% of ${poolPhrase(pool)}`,
  ),
  bidirectional(
    "global-flippable-loss-rate",
    "flippableLossRatePercentile",
    (pct, pool) => `You flip losses into wins better than ${pct}% of ${poolPhrase(pool)}`,
    (pct, pool) => `You leave more losses on the table than ${pct}% of ${poolPhrase(pool)}`,
  ),
  bidirectional(
    "global-all-play-win-pct",
    "allPlayWinPctPercentile",
    (pct, pool) => `Your all-play win rate beats ${pct}% of ${poolPhrase(pool)}`,
    (pct, pool) => `Your all-play win rate trails ${pct}% of ${poolPhrase(pool)}`,
  ),
  bidirectional(
    "global-luck-delta",
    "luckDeltaPercentile",
    (pct, pool) => `You're luckier than ${pct}% of ${poolPhrase(pool)}`,
    (pct, pool) => `You're unluckier than ${pct}% of ${poolPhrase(pool)}`,
  ),
  unidirectional(
    "global-longest-win-streak",
    "longestWinStreakPercentile",
    (pct, pool) => `Your longest win streak beats ${pct}% of ${poolPhrase(pool)}`,
  ),
  unidirectional(
    "global-longest-loss-streak",
    "longestLossStreakPercentile",
    (pct, pool) => `Your longest losing streak is longer than ${pct}% of ${poolPhrase(pool)}`,
  ),
  unidirectional(
    "global-transaction-activity",
    "transactionTotalPercentile",
    (pct, pool) => `You made more moves than ${pct}% of ${poolPhrase(pool)}`,
  ),
];
```

- [ ] **Step 4: Register the modules**

In `src/engine/insights/index.ts`, add the import and spread:

```ts
import { globalInsights } from "./global";
```

```ts
export const allInsights: InsightModule[] = [
  ...regretInsights,
  ...luckInsights,
  ...peopleInsights,
  ...narrativeInsights,
  ...identityInsights,
  ...globalInsights,
];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run src/engine/insights/global.test.ts`
Expected: PASS (7 tests).

Run: `./node_modules/.bin/vitest run`
Expected: PASS — `engine.test.ts`'s golden snapshot is still unchanged, because it still
passes `{}` for `globalStats` (Task 6, Step 5) — the new modules exist but are inert until
Task 9 populates real data.

- [ ] **Step 6: Commit**

```bash
git add src/engine/insights/global.ts src/engine/insights/global.test.ts src/engine/insights/index.ts
git commit -m "feat: add the 7 global-comparison insight modules"
```

---

### Task 8: Write `team_season_stats` during sync

**Files:**
- Modify: `src/app/api/sync/route.ts`

**Interfaces:**
- Consumes: `computeSeasonFacts` (`@/engine`), `computeTeamSeasonStatsRows` /
  `upsertTeamSeasonStats` (`@/sync/team-season-stats`, Tasks 3–4), `teamIdByRoster` now
  returned by `persistBundle` (Task 4).
- Produces: no new exports — this task only wires an existing call site. A failed stats
  write is caught locally and logged; it must never turn a successful sync into an error
  response.

- [ ] **Step 1: Write the failing integration test**

Create `tests/sync-route-team-stats.test.ts`:

```ts
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { ENGINE_VERSION } from "@/engine";
import { teamSeasonStats } from "@/db/schema";
import { createFixtureSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";
import { computeSeasonFacts } from "@/engine";
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
        and(eq(teamSeasonStats.teamId, anyTeamId), eq(teamSeasonStats.engineVersion, ENGINE_VERSION)),
      );
    expect(row).toBeDefined();
    expect(rows).toHaveLength(teamIdByRoster.size);
  });
});
```

This test exercises the exact sequence the route will run (`persistBundle` →
`computeSeasonFacts` → `computeTeamSeasonStatsRows` → `upsertTeamSeasonStats`) without
spinning up the Next.js route handler itself, consistent with how `tests/persist.test.ts`
already tests sync logic directly rather than through `fetch`.

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run tests/sync-route-team-stats.test.ts`
Expected: FAIL — no row found (nothing upserts `team_season_stats` yet from this sequence
in production code; this test currently calls the pieces manually so it should actually
PASS already if Tasks 3–5 are correct). If it passes already, that confirms the building
blocks work in sequence — proceed to Step 3 to wire the same sequence into the real route,
then re-run this test only as a regression check.

- [ ] **Step 3: Wire the route**

In `src/app/api/sync/route.ts`, add imports:

```ts
import { computeSeasonFacts } from "@/engine";
import { computeTeamSeasonStatsRows, upsertTeamSeasonStats } from "@/sync/team-season-stats";
```

Change:

```ts
    await persistBundle(db, bundle);

    const yourRosterId = resolveYourRosterId(bundle.teams, parsed.data.userId);
```

to:

```ts
    const { teamIdByRoster } = await persistBundle(db, bundle);

    try {
      const facts = computeSeasonFacts(bundle);
      const rows = computeTeamSeasonStatsRows(facts, teamIdByRoster);
      await upsertTeamSeasonStats(db, rows);
    } catch (error) {
      // Global-comparison data is a side effect of sync, not sync's primary
      // job — a failure here must not turn a successful league sync into an
      // error response.
      console.error("team_season_stats upsert failed", error);
    }

    const yourRosterId = resolveYourRosterId(bundle.teams, parsed.data.userId);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run tests/sync-route-team-stats.test.ts`
Expected: PASS.

Run: `./node_modules/.bin/vitest run`
Expected: PASS, full suite green.

- [ ] **Step 5: Manual smoke test**

Run: `pnpm dev`, then in another terminal:
```bash
curl -X POST http://localhost:3000/api/sync -H 'content-type: application/json' \
  -d '{"leagueId":"1269125082375008256"}'
```
Expected: `200` with the usual sync response JSON. Then check Postgres directly:
```bash
psql fantasy_wrapped -c "select count(*) from team_season_stats;"
```
Expected: a row per team in that league.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/sync/route.ts tests/sync-route-team-stats.test.ts
git commit -m "feat: write team_season_stats during sync"
```

---

### Task 9: Wire `getWrapped`, populate the golden fixture, review the diff

**Files:**
- Modify: `src/sync/wrapped.ts`
- Modify: `src/engine/engine.test.ts`
- Modify: `docs/engine.md`
- Regenerate: `src/engine/__golden__/*.json`

**Interfaces:**
- Consumes: `getGlobalStats` (Task 5).
- Produces: no new exports. This is the task where global cards become observable in
  production and in the golden snapshots for the first time.

- [ ] **Step 1: Wire `getGlobalStats` into `getWrapped`**

In `src/sync/wrapped.ts`, add the import:

```ts
import { getGlobalStats } from "@/lib/global-stats";
```

Change:

```ts
    const bundle = await loadBundle(league.id);
    if (!bundle) return null;
    const facts = computeSeasonFacts(bundle);
    script = generateCardScript(facts, rosterId);
```

to:

```ts
    const bundle = await loadBundle(league.id);
    if (!bundle) return null;
    const facts = computeSeasonFacts(bundle);
    const globalStats = await getGlobalStats(db, team.id);
    script = generateCardScript(facts, rosterId, globalStats);
```

- [ ] **Step 2: Run the wrapped-claim test suite to confirm nothing broke**

Run: `./node_modules/.bin/vitest run tests/wrapped-claim.test.ts`
Expected: PASS. (This test seeds `wrapped_scripts` rows directly and doesn't hit the
cache-miss path that calls `getGlobalStats`, so it should be unaffected — confirm by
reading its assertions if anything unexpected fails.)

- [ ] **Step 3: Populate the golden-test fixture with real global data**

In `src/engine/engine.test.ts`, add the import:

```ts
import type { GlobalStats } from "./types";
```

Add a fixture constant near the top of the file (after `LEAGUES`):

```ts
// A fixed, representative GlobalStats fixture so global-category cards are
// exercised in the golden snapshot for review — not meant to represent any
// real pool, just enough variety to hit both brag and wince branches.
const FIXTURE_GLOBAL_STATS: GlobalStats = {
  benchRegretRatePercentile: { percentile: 84, poolSize: 340 },
  flippableLossRatePercentile: { percentile: 47, poolSize: 340 },
  allPlayWinPctPercentile: { percentile: 93, poolSize: 340 },
  luckDeltaPercentile: { percentile: 9, poolSize: 340 },
  longestWinStreakPercentile: { percentile: 88, poolSize: 340 },
  longestLossStreakPercentile: { percentile: 31, poolSize: 340 },
  transactionTotalPercentile: { percentile: 96, poolSize: 340 },
};
```

Change the `beforeAll` block's:

```ts
    facts = computeSeasonFacts(bundle);
    scripts = generateLeagueWrapped(bundle);
```

to:

```ts
    facts = computeSeasonFacts(bundle);
    const globalStatsByRosterId = Object.fromEntries(
      bundle.teams.map((t) => [t.providerRosterId, FIXTURE_GLOBAL_STATS]),
    );
    scripts = generateLeagueWrapped(bundle, globalStatsByRosterId);
```

- [ ] **Step 4: Run the engine tests and inspect the diff**

Run: `./node_modules/.bin/vitest run src/engine/engine.test.ts`
Expected: the golden-snapshot test FAILS — this is expected, the snapshot is stale. Read
the printed diff carefully: confirm every manager now has 1–2 additional `global`-category
cards (per `CATEGORY_CAPS.global = 2`), with plausible headlines from the 7 modules in
Task 7, and confirm that any *displaced* card (if `MAX_CARDS = 9` was already being hit for
a manager) is one with genuinely lower notability than the global card that bumped it —
not an accidental regression. This is the same "read the diff like a human" discipline
`docs/engine.md` already requires for any insight-selection change.

- [ ] **Step 5: Accept the diff and regenerate snapshots**

Run: `./node_modules/.bin/vitest run -u src/engine/engine.test.ts`
Expected: PASS, `__golden__/*.json` files updated.

- [ ] **Step 6: Run the full suite one more time**

Run: `./node_modules/.bin/vitest run`
Expected: PASS across the board.

Run: `pnpm typecheck`
Expected: PASS.

Run: `./node_modules/.bin/biome check .`
Expected: no issues (biome, not `pnpm lint` — the RTK hook on this machine has previously
mangled that command's reported output).

- [ ] **Step 7: Document the new category**

In `docs/engine.md`, update the pipeline diagram:

```
    NormalizedLeagueBundle
      → computeSeasonFacts()        facts.ts    every stat, per team
      → computeCandidates()         insights/   40+ modules, each may return one candidate
      → selectCards()               select.ts   floor → topic dedupe → category caps → story order
      → classifyLeagueArchetypes()  archetype.ts finale
      → CardScript                  what the copy layer and UI consume
```

to add a line noting the external input, directly below it:

```
    (GlobalStats, fetched outside the engine via src/lib/global-stats.ts, flows into
     computeCandidates/selectCards/generateCardScript as a plain argument — the one
     input to the pipeline that isn't derived from computeSeasonFacts.)
```

Add a short new subsection after "Adding an insight module":

```markdown
## The `global` category

Unlike every other category, `global` insight modules (`src/engine/insights/global.ts`)
don't read `facts` — they read a `GlobalStats` object, fetched by `src/lib/global-stats.ts`
via a percentile query against `team_season_stats` (one row per team-season, written
during sync). A missing key in `GlobalStats` means the pool for that stat was below the
minimum size (25 team-seasons) — the module returns `null`, same as any other weak
insight. Global cards are computed once, at first Wrapped generation, and frozen in the
same `wrapped_scripts` cache as every other card.
```

- [ ] **Step 8: Commit**

```bash
git add src/sync/wrapped.ts src/engine/engine.test.ts src/engine/__golden__/ docs/engine.md
git commit -m "feat: wire global comparisons into getWrapped and update golden snapshots"
```

---

## Self-Review Notes

- **Spec coverage:** identity scope (Task 6/9, single team-season), pool/cross-league
  comparability (Task 1/3, rate-based columns only), privacy (Task 7, aggregate-only
  headlines), cold start (Task 5, `MIN_GLOBAL_POOL`), architecture/engine purity (Task 2/6),
  persisted table rationale (Task 1/3/4), v1 stat set (Task 7), error handling (Task 5/8
  fail-open), testing (unit tests Task 3/7, integration Task 4/5/8, golden Task 9) — all
  covered. Out-of-scope items (cross-league identity, raw points, standalone page, cached
  snapshot) are not implemented anywhere in this plan, matching the spec.
- **Placeholder scan:** no TBD/TODO; every step has real, complete code.
- **Type consistency:** `GlobalStats`/`GlobalStatEntry` (Task 2) match field-for-field
  across `src/lib/global-stats.ts` (Task 5), `src/engine/insights/global.ts` (Task 7), and
  the golden fixture (Task 9). `TeamSeasonStatsRow` (Task 3) matches the `teamSeasonStats`
  Drizzle columns (Task 1) and the `upsertTeamSeasonStats` insert (Task 4).
