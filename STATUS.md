# Status

**Live:** https://fantasy-wrapped-three.vercel.app
**Repo:** https://github.com/nardonef/fantasy-wrapped

Setup/dev commands: `README.md`. Architecture and rules: `CLAUDE.md`. How to add
an insight: `docs/engine.md`. Voice/tone: `docs/tone.md`.

`main` is branch-protected: every change goes through a branch + PR + CI-gated squash
merge (see CLAUDE.md "Git workflow"). Direct pushes to `main` are rejected by GitHub,
including for the repo owner — verified live, not just configured.

## Shipped

- Sleeper ingest (public API, no auth) → normalized bundle → Postgres
- Insight engine: season facts, 32 insight modules, notability-based
  selection, 22 unique-per-league archetypes
- Copy layer: Claude-written card copy with number-fidelity validation,
  deterministic fallback when no API key or generation fails
- Story player (mobile-first, tap-through), league superlatives ballot
- Signal design system: near-black + electric blue, Geist/Geist Mono, with a
  light surface for brag cards. Eight layout archetypes in the story player,
  chosen per insight, replacing the single ghost-numeral card
- Selection: `bench-points-total` no longer shares a topic with the
  record-counterfactual cards, and regret is capped at 3. The
  notability-92 bench card that `docs/tone.md` calibrates against now ships
- Deployed on Vercel + Neon; CI (lint/typecheck/test/build/e2e) on every push

## Next

- [ ] **Try Frank's own league on the live app** — the actual acceptance test;
      eval fixtures so far are other people's leagues, nobody's checked
      whether the cards land for a manager who can judge them firsthand.
      More pointed now that the redesign changed every card's presentation
- [ ] Set `ANTHROPIC_API_KEY` in Vercel to turn on live Claude copy (currently
      serving deterministic fallback copy — correct, just not final quality)
- [ ] **The copy now duplicates the layout.** The layouts display the card's
      numbers in large type, and `validateCardCopy` still requires every
      number in `facts` to appear verbatim in the copy, so each card states
      its figures twice — the MVP card shows `374.6 / 22%` and then the body
      says "374.6 points, 22% of everything you scored". `buildPrompt` has no
      idea what the view renders.
      The fix keeps the safety property rather than weakening it: validate
      that the CARD contains the exact numbers (satisfied by `view` or copy),
      not that the copy does. The LLM still can't invent a stat; the copy is
      just freed to do what the layout can't. `docs/tone.md` needs a pass
      too — its calibration examples assume the copy carries the figures.
      Blocked in practice on the API key above: fallback copy is the engine's
      own headline, so there is nothing to tune until real copy is running.
- [ ] **The season's finish can be crowded out of the story.** `playoff-story`
      carries topic `finish` and `selectCards` is careful to order it last —
      but only if it survived the category caps and `MAX_CARDS` first, and it
      competes with every other narrative card. Measured across both fixture
      leagues: 6 of 20 managers end their Wrapped without ever being told how
      the season finished. Reserving a slot for it fixes all six, but measured
      cost is that it displaces `mvp` three times and `nemesis` twice — the
      cards feeding the two most distinctive layouts. That trade wants real
      copy and a human read before it's made, not a guess.

## Blocked on Frank

- [ ] Yahoo developer app credentials → Yahoo adapter (Phase 6)
- [ ] ESPN credentials/cookie auth → ESPN adapter (after Yahoo)

## Not started / deferred

- Sentry, Plausible (need accounts)
- Custom domain (currently on default vercel.app subdomain)
- Neon Previews Integration (per-PR database branches — Preview deployments
  currently share the production database; fine while there's no real
  user data yet)

## Known limitations

- `/api/sync` rate limiter (`src/lib/rate-limit.ts`) is an in-memory `Map`,
  scoped to one serverless instance. On Vercel this is best-effort, not a
  real guarantee — a client can exceed 12/hour by landing on different warm
  instances. Not a security issue yet (public data, no cost beyond DB
  writes), but swap for a shared store (e.g. Upstash Redis) before real
  traffic makes this matter.
- Sleeper's full player dump (~5–10MB) is re-fetched on every sync — works,
  wasteful. Worth caching if sync volume grows.
- The optimal-lineup solver doesn't know which players were actually on IR
  a given week — normalization collapses every non-starter to `slot: "BN"`,
  losing the IR/healthy-bench distinction Sleeper provides. Bench-regret
  figures could be mildly inflated in the rare case where the best bench
  alternative was actually IR-ineligible that week.
- The OG share image renders in system sans, not Geist, because `ImageResponse`
  needs a font binary committed to the repo. The type is a shade off the
  in-app finale card it mirrors.
- A cached `wrapped_scripts` row is read back with `as CardScript` and no
  validation. That is safe as long as any change to the script's SHAPE comes
  with an `ENGINE_VERSION` bump (the rule already written in `version.ts`),
  since rows are keyed on it — but a shape change without a bump will crash
  the page for every already-cached team, not fail gracefully.
- Vercel Deployment Protection was confirmed off for Production; Preview
  environment status wasn't re-checked after the toggle — verify before
  sharing preview links with anyone.
