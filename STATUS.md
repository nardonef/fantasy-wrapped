# Status

**Live:** https://fantasy-wrapped-three.vercel.app
**Repo:** https://github.com/nardonef/fantasy-wrapped

Setup/dev commands: `README.md`. Architecture and rules: `CLAUDE.md`. How to add
an insight: `docs/engine.md`. Voice/tone: `docs/tone.md`.

## Shipped

- Sleeper ingest (public API, no auth) → normalized bundle → Postgres
- Insight engine: season facts, 32 insight modules, notability-based
  selection, 22 unique-per-league archetypes
- Copy layer: Claude-written card copy with number-fidelity validation,
  deterministic fallback when no API key or generation fails
- Story player (mobile-first, tap-through), league superlatives ballot
- Deployed on Vercel + Neon; CI (lint/typecheck/test/build/e2e) on every push

## Next

- [ ] **Try Frank's own league on the live app** — the actual acceptance test;
      eval fixtures so far are other people's leagues, nobody's checked
      whether the cards land for a manager who can judge them firsthand
- [ ] Set `ANTHROPIC_API_KEY` in Vercel to turn on live Claude copy (currently
      serving deterministic fallback copy — correct, just not final quality)

## Blocked on Frank

- [ ] Yahoo developer app credentials → Yahoo adapter (Phase 6)
- [ ] ESPN credentials/cookie auth → ESPN adapter (after Yahoo)

## Not started / deferred

- Sentry, Plausible (need accounts)
- Custom domain (currently on default vercel.app subdomain)
- Neon Previews Integration (per-PR database branches — Preview deployments
  currently share the production database; fine while there's no real
  user data yet)
