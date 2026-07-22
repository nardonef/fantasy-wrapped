# Fantasy Football Wrapped

Your fantasy football season, told back to you with precision and a little
cruelty. A public web app: connect your league, get a Spotify-Wrapped-style
tap-through story of your season — bench regret, schedule luck, your nemesis,
the trade you lost — ending in a manager archetype built to be screenshotted
into the group chat. Plus a league-wide superlatives ballot designed to start
arguments.

Sleeper leagues today; Yahoo and ESPN planned.

## Stack

Next.js (App Router) · PostgreSQL + Drizzle · Tailwind v4 + Motion ·
Claude (copywriting) · Biome · Vitest · Playwright

## Run it

```sh
createdb fantasy_wrapped && createdb fantasy_wrapped_test
cp .env.example .env          # set DATABASE_URL (+ ANTHROPIC_API_KEY for LLM copy)
pnpm install
pnpm db:migrate
pnpm dev                      # open http://localhost:3000, enter a Sleeper username
```

## Development

| Command | What |
|---|---|
| `pnpm test` / `pnpm test:e2e` | Vitest units + goldens / Playwright story flow |
| `pnpm eval` | Render every fixture manager's card script as markdown for human review |
| `pnpm tsx scripts/record-fixtures.ts <leagueId>` | Snapshot a real league into `fixtures/` |
| `pnpm tsx scripts/sync-league.ts [--fixtures] <leagueId>` | Sync a league into Postgres |
| `pnpm tsx scripts/copy-eval.ts <leagueId>` | Generate LLM copy for tone review (needs API key) |

The product lives in `src/engine/` — pure, deterministic, golden-tested.
Read `docs/engine.md` for how to add an insight, and `docs/tone.md` for the
voice. The iteration loop: add/tune an insight → `pnpm eval` → read the
output like a group-chat member → cut anything that doesn't land.
