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

## Git workflow — required, no exceptions

`main` is protected on GitHub: direct pushes are rejected, merges require the `checks` CI
run to pass, and this applies to the repo owner too (no admin bypass). Every change goes
through this flow:

1. Branch off latest `main`: `git checkout -b <type>/<short-description>` — types: `feat`,
   `fix`, `chore`, `docs`, `refactor`.
2. Commit there. Push the branch (`git push -u origin <branch>`), not `main`.
3. Open a PR: `gh pr create --fill` (or with an explicit title/body for anything non-trivial).
4. Wait for CI to go green: `gh pr checks --watch` or `gh run watch`. Fix and push more
   commits to the same branch if it fails — don't open a second PR for the same change.
5. Merge once green: `gh pr merge --squash --delete-branch`. Squash is the only merge
   method enabled on this repo — keep `main`'s history one commit per change.

No review approval is required (solo project) — the CI gate is the check, not a human
approver. If a change is trivial enough that this feels like overhead, it still goes
through the flow; that's the point of it being default behavior, not a judgment call per
change.
