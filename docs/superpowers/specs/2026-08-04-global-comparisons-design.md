# Global Comparisons — Design

## Problem

Today every Wrapped card compares a manager only against their own league (rank within
league, vs. their own optimal lineup, vs. their own history). This spec adds a new card
category that compares a team-season against every team-season the app has ever synced,
across all leagues — "your bench regret rate beats 92% of everyone we've tracked." It
extends the existing brag/wince/laugh product bar; it does not introduce a new surface,
page, or account system.

## Scope decisions

- **Identity**: "you" = the single team-season currently being viewed, not an account or
  a person tracked across leagues/seasons. No login, no cross-league identity linking.
- **Pool**: every team-season across every synced league, regardless of provider or
  scoring settings.
- **Cross-league comparability**: v1 includes only stats that are already scale-invariant
  or expressed as a rate/percentage, so leagues with different team counts, scoring
  systems, or roster sizes remain comparable without a normalization step. Raw point
  totals are explicitly out of scope for v1.
- **Privacy**: comparisons are aggregate-only (a percentile and a pool size). Cards never
  name or otherwise identify another specific team, manager, or league.
- **Cold start**: each stat has a minimum pool size; below it, the corresponding card is
  not generated at all (same "return null aggressively" convention already used
  throughout `src/engine/insights/`). No partial/placeholder card, no denominator shown
  for a tiny pool. Starting floor: **25** team-seasons per stat, tunable later.

## Architecture

New insight category, `global`, added alongside `regret` | `luck` | `people` | `narrative`
| `identity`:

```
NormalizedLeagueBundle
  → computeSeasonFacts()                          (unchanged, pure)
  → getGlobalStats(teamId)          NEW — DB I/O, lives outside src/engine/
  → computeCandidates(facts, teamId, globalStats)  globalStats is a plain data argument
  → selectCards() → classifyLeagueArchetypes() → CardScript
```

`src/engine/` stays pure and I/O-free per the existing project rule (golden tests depend
on determinism). `getGlobalStats` is called once, upstream, by the same route/service that
already assembles `facts` for card generation. It returns a plain object containing only
the keys whose pool cleared the minimum size — a missing key means "not enough data yet,"
not zero. Golden tests pass a fixed fixture object for `globalStats`, so engine
determinism is unaffected by the live pool changing over time.

Insight modules in a new `src/engine/insights/global.ts` follow the existing contract:
`{ id, category: "global", compute(facts, globalStats, rosterId) }`. If a stat's key is
absent from `globalStats` (pool too small), `compute()` returns `null` — identical to how
every other insight module already handles a weak/unavailable signal.

### Why a persisted table, not a live recompute

The stats this feature needs (`benchRegretTotal`, `allPlay.winPct`, `longestWinStreak`,
`luckDelta`, `transactionCounts.total`, etc.) are derived by `computeSeasonFacts()` from raw
matchup/player-score rows at request time — they are not persisted as queryable columns
today; only the *selected cards* end up cached, in `wrapped_scripts`. A live percentile
query needs a real column to run `PERCENT_RANK()`-style aggregation over; recomputing every
other league's facts from raw data on every Wrapped generation would be the expensive
operation this design exists to avoid.

**Fix**: a new table, `team_season_stats`, one row per team-season, written during
`/api/sync` immediately after that league's facts are computed (not lazily on first
Wrapped view) — so a synced league contributes to the pool as soon as it syncs, independent
of whether anyone ever generates a Wrapped for it.

```
team_season_stats
  team_id          uuid, FK -> teams, cascade delete
  engine_version   text
  bench_regret_rate     double precision   -- benchRegretTotal / pointsFor
  flippable_loss_rate   double precision   -- flippableLosses.length / gamesPlayed
  all_play_win_pct      double precision
  luck_delta            double precision
  longest_win_streak    integer
  longest_loss_streak   integer
  transaction_total     integer
  unique (team_id, engine_version)
```

`engine_version` mirrors `wrapped_scripts`' existing versioning convention: if a stat's
formula changes, old rows don't silently pollute the pool under a changed definition — the
percentile query filters `WHERE engine_version = current`, and stale rows simply age out of
the pool rather than requiring a migration or backfill. Shipping this feature requires
bumping `ENGINE_VERSION`, per the existing rule in `docs/engine.md`.

`getGlobalStats(teamId)` isolates the query behind one function so v1's live-query approach
can later be swapped for a cached/precomputed snapshot without touching insight modules or
call sites, if the pool ever grows large enough that per-request queries become costly.

## v1 stat set

All seven are scale-invariant or already expressed as a rate, so no normalization step is
needed across differently-shaped leagues:

| Stat | Definition | Direction |
|---|---|---|
| Bench regret rate | `benchRegretTotal / pointsFor` | lower is better |
| Flippable-loss rate | `flippableLosses.length / gamesPlayed` | lower is better |
| All-play win% | `allPlay.winPct` | higher is better |
| Luck delta | `actual win% − all-play win%` | context-dependent (framed as "luckiest"/"unluckiest", not "better"/"worse") |
| Longest win streak | `longestWinStreak.length` | higher is better |
| Longest loss streak | `longestLossStreak.length` | higher is better (as a wince card) |
| Waiver activity | `transactionCounts.total` | framed as "most active," not better/worse |

Note: waiver activity has a minor league-size skew (a 12-team league has a smaller
free-agent pool per manager than a 10-team one) — accepted for v1 as a minor imprecision,
not corrected.

Copy pattern: percentile + pool size only, e.g. "Your bench regret rate beats 92% of every
manager we've tracked" — never a reference to another specific team/league/manager. Cards
reuse existing story-player layout archetypes (e.g. `statement`/`chart`); no new UI
component is required for v1, since this is a new insight source feeding the existing
renderer, not a new visual.

## Error handling

- If the `team_season_stats` upsert fails during sync, log and continue — it's a side
  effect of sync, not sync's primary job, and a missing row only means that team doesn't
  contribute to the pool yet.
- If `getGlobalStats`'s query fails or times out, degrade to an empty object (no `global`
  category cards for that generation) rather than failing Wrapped generation — same
  fail-open instinct as the existing fallback-copy behavior when the LLM call fails.

## Testing

- `src/engine/insights/global.ts` — unit tests with fixed `globalStats` fixtures, covering
  notability scaling, `null` return when a key is absent, and correct framing for both
  "higher is better" and "lower is better" stats.
- `getGlobalStats` and the sync-time upsert — integration tests against the real test DB:
  percentile correctness, floor gating (small pool → key omitted), upsert-on-sync
  behavior.
- Golden files — add a fixed `globalStats` fixture to existing golden-test setup so
  `global`-category cards appear in the reviewable selection diff, same as every other
  category.
- No new Playwright e2e test — this extends the existing story flow rather than adding a
  new page, so current story-player e2e coverage already exercises it.

## Out of scope for v1

- Cross-league/cross-season identity ("you" aggregated across multiple leagues).
- Raw point-total comparisons and any score normalization (z-score, league-shape
  segmentation).
- A standalone global-stats/leaderboard page.
- Precomputed/cached percentile snapshots (revisit only if live per-request queries become
  a measured performance problem).
