# Insight Engine

The product lives in `src/engine/`. Pure, deterministic, no I/O — golden tests
depend on byte-identical output for identical input.

## Pipeline

    NormalizedLeagueBundle
      → computeSeasonFacts()        facts.ts    every stat, per team
      → computeCandidates()         insights/   40+ modules, each may return one candidate
      → selectCards()               select.ts   floor → topic dedupe → category caps → story order
      → classifyLeagueArchetypes()  archetype.ts unique-per-league finale
      → CardScript                  what the copy layer and UI consume

    (GlobalStats, fetched outside the engine via src/lib/global-stats.ts, flows into
     computeCandidates/selectCards/generateCardScript as a plain argument — the one
     input to the pipeline that isn't derived from computeSeasonFacts.)

## Adding an insight module

1. Pick the category file in `src/engine/insights/` (regret/luck/people/narrative/identity/global).
2. Add a module: `{ id, category, compute(facts, rosterId) → CandidateInsight | null }`.
   - Return `null` aggressively. A card that is merely accurate has failed.
   - `notability` 0–100: 45 is the shipping floor; 60+ means "group chat would react";
     80+ means "this is the screenshot". Scale by league rank and absolute magnitude.
   - Set `topic` if the insight overlaps another (e.g. all optimal-lineup angles share
     `topic: "optimal-lineup"`) — the selector keeps only the strongest per topic.
   - `facts` must carry every exact number/name the copy needs — the LLM copy layer is
     forbidden from inventing numbers and validated against these values.
3. Run `pnpm eval` and READ the output in `evals/output/` like a group-chat member.
   Check both leagues; check the cutting-room floor for cards that should ship and
   shipped cards that should die.
4. Run `pnpm test` — golden files will show the exact selection diff. If the diff is
   intended, update snapshots (`pnpm vitest run -u`) and bump `ENGINE_VERSION` if the
   output shape or meaning changed.

## The `global` category

Unlike every other category, `global` insight modules (`src/engine/insights/global.ts`)
don't read `facts` — they read a `GlobalStats` object, fetched by `src/lib/global-stats.ts`
via a percentile query against `team_season_stats` (one row per team-season, written
during sync). A missing key in `GlobalStats` means the pool for that stat was below the
minimum size (25 team-seasons) — the module returns `null`, same as any other weak
insight. Global cards are computed once, at first Wrapped generation, and frozen in the
same `wrapped_scripts` cache as every other card.

## Notability calibration notes (learned from real leagues)

- League-rank-1 in a stat is notable; "top 3" usually is not.
- Defenses and kickers are excluded from pickup/drop insights — streaming them is
  routine management, not a story.
- Bench regret is universal; only extremes are stories (rank 1, or 4+ flippable losses).
- The archetype is assigned league-wide, each at most once (fallback repeats), so the
  finales read as a superlatives ballot across the group chat.

## Eval leagues

- `fixtures/sleeper/1269125082375008256` — "Lonely Fans", 2025, 10-team redraft, rolling waivers
- `fixtures/sleeper/1257059475584471040` — "Asian American Association", 2025, 10-team keeper, FAAB

Record more with `pnpm tsx scripts/record-fixtures.ts <leagueId>`.
