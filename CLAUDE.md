# Fantasy Football Wrapped

Public web app: a fantasy manager connects their league and gets a Spotify Wrapped–style,
tap-through story recap of their season, ending in a manager archetype built to be
screenshotted into the group chat. Two surfaces: individual Wrapped, league superlatives.

**The product bar:** every card must land as a laugh, a wince, or a brag. A card that is
merely accurate has failed. When in doubt, cut the card.

## Stack

- Next.js (App Router, TypeScript strict) + Tailwind v4; `motion` for the story player
- Postgres via Drizzle (`src/db/schema.ts`); local Homebrew Postgres, Neon in prod
- Biome (lint+format), Vitest (unit/golden), Playwright (e2e, from Phase 4)
- pnpm. Node 22+.

## Commands

- `pnpm dev` / `pnpm build`
- `pnpm typecheck` · `pnpm lint` (Biome) · `pnpm test` (Vitest)
- `pnpm db:generate` → new migration from schema change; `pnpm db:migrate` → apply
- `.env`: `DATABASE_URL` (local: `postgres://frank@localhost:5432/fantasy_wrapped`)

## Architecture

Data flows one way:

    provider API → adapter (normalize) → Postgres → SeasonFacts → candidate insights
      → select/order → CardScript → LLM copy pass → story UI / share images

- `src/providers/` — one adapter per platform (sleeper, yahoo, espn). Adapters are the ONLY
  code that sees provider-shaped data; they emit a `NormalizedLeagueBundle`. Raw payloads are
  stored in jsonb so the engine can be re-run without re-fetching.
- `src/engine/` — pure, deterministic, no I/O. The product lives here. Insight modules are
  the unit of iteration: each is one file with `{ id, category, compute(facts, teamId) }`
  returning a candidate with a notability score, or null. See `docs/engine.md` (Phase 2).
- `wrapped_scripts` table caches generated scripts per team per `engineVersion`.

## Rules

- The engine must stay pure and deterministic — golden-file tests depend on it. No Date.now,
  no randomness, no network in `src/engine/`.
- Never trust provider data shape; adapters validate with zod and fail loudly.
- Copy shown to users must contain the exact numbers from the CardScript (validated) —
  the LLM may write the sentence, never the stats.
- Tests are part of the same unit of work as the code. Engine changes must show their
  card-selection diff via golden files.

## Eval loop (how to iterate on insight quality)

Fixtures of real leagues live in `fixtures/` (recorded Sleeper API responses).
`pnpm eval` (Phase 2) renders every manager's card script as markdown into `evals/output/`
for human review. Add an insight module → run evals → read the output like a human would →
tighten notability until only cards that land survive.
