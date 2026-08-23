# Desktop layouts — landing, ballot, story player

## Problem

The app is designed mobile-first and it shows past a laptop-width viewport: the
landing page and the ballot page are single narrow columns pinned top-left,
with the rest of the frame empty. The story player already solved this for
itself in PR #6 — the deck stays a fixed 9:16 card, height-led, capped near
phone width, so its own layout math never changes — but that leaves the
flanking space on a wide monitor doing nothing.

This spec covers a desktop treatment for all three surfaces, evaluated
against real screenshots and mockups built from Signal's actual tokens
(published as a comparison artifact during brainstorming). For all three, the
chosen direction is **Option A** from that comparison — Split stage for
landing and ballot, Rail context for the story player.

## Scope

- `src/app/page.tsx` (landing)
- `src/app/l/[provider]/[leagueId]/[season]/page.tsx` (ballot)
- `src/components/story/StoryPlayer.tsx` + `src/app/globals.css` (story player)

Out of scope: `src/components/LandingFlow.tsx`'s internal phase logic
(user → leagues → syncing → teams) is untouched — this is a wrapper/layout
change around it, not a rework of the flow itself. The story card's own
aspect ratio, type-sizing (`cqw`), and per-archetype layouts are untouched —
that's the thing PR #6 already measured and got right; this spec only adds
content to the space around it.

## Breakpoint

All three treatments activate at **`lg:` (1024px)**, a new breakpoint for
this codebase (existing responsive code only uses `sm:` at 640px). Below
`1024px` every surface is byte-for-byte what ships today. `1024px` is chosen
because it's comfortably past the 640px point where the story card already
locks to its capped phone-width shape, leaving enough room either side for
the two new gutters without the card needing to shrink.

The two Playwright projects (`mobile` at Pixel 7 / ~412px, `desktop` at
2560×1440) straddle this breakpoint already, so no new project is needed —
`mobile` continues to exercise the untouched narrow layout, `desktop`
exercises the new one.

## Landing — Split stage

`src/app/page.tsx`'s `<main>` becomes a two-column grid at `lg:`
(`lg:grid lg:grid-cols-2 lg:items-center lg:gap-16`, roughly — exact spacing
is an implementation detail, not a spec decision). Below `lg:`, `<main>`
keeps its current stacked-column classes unchanged.

- **Left column**: the existing `<header>` (kicker, `h1`, subhead), unchanged
  copy, now vertically centered in the viewport instead of pinned to the top.
- **Right column**: `<LandingFlow />`, wrapped at `lg:` only in a bordered
  panel using the same raised-surface material the story card uses
  (`border border-chalk/15 bg-field-raised`, padded). Below `lg:` the wrapper
  contributes no border/background/padding, so `LandingFlow`'s own mobile
  styling is unchanged.
- The panel wraps **all four phases** of `LandingFlow` (username entry,
  league picker, syncing screen, team picker) — not just the initial form —
  since they occupy the same slot in sequence. No changes inside
  `LandingFlow.tsx` itself are required; the panel is purely a wrapper
  `page.tsx` applies around the existing component.
- `<footer>` stays where it is in document order (after `LandingFlow`, so
  under the right column on narrow layouts); on `lg:` it's reasonable for it
  to sit under the left column instead since that's the calmer half of the
  composition — left to the implementation plan to place precisely.

## Ballot — Split stage

`src/app/l/[provider]/[leagueId]/[season]/page.tsx`'s `<main>` becomes a
two-column grid at `lg:` (`lg:grid lg:grid-cols-[minmax(0,380px)_1fr]
lg:gap-16 lg:h-dvh`). Below `lg:`, unchanged.

- **Left column**: kicker + `h1` ("The ballot.") + subhead, vertically
  centered in the viewport (`lg:flex lg:h-full lg:flex-col lg:justify-center`),
  and stays put — it never scrolls out of view while the right column does.
- **Right column**: both existing `<section>`s (superlatives, then teams),
  unchanged internally, now living inside their own scroll container
  (`lg:h-full lg:overflow-y-auto`). This directly fixes the current
  "all scroll, no scan" problem — a 10-plus-team league's page no longer
  scrolls the title out of frame.
- No new data is introduced (unlike Option C's standings rail, which was not
  chosen) — same superlatives list, same team list, same links, just
  repartitioned.

## Story player — Rail context

The `.story-frame` card itself gets **zero CSS changes** — same width,
height, `aspect-ratio`, and `container-type` math as today. This is the
point of choosing this option: PR #6 already tested and rejected widening
the card, so this treatment only touches the space around it.

`StoryPlayer.tsx`'s outer wrapper (currently
`<div className="grid min-h-dvh place-items-center bg-page">`) becomes, at
`lg:`, a three-column grid: `lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]
lg:items-center`, with the two flanking `1fr` columns equal so the card
stays centered regardless of what content sits in the gutters. Below `lg:`,
unchanged (`place-items-center`, single implicit column).

- **Left gutter** (`hidden lg:flex`, new sibling of `.story-frame`):
  a single decorative line — manager name · league name · season — set in
  `writing-mode: vertical-rl`, muted (`chalk-faintest`-equivalent opacity),
  `aria-hidden="true"`. Purely atmospheric, no interaction.
- **Right gutter** (`hidden lg:flex`, new sibling of `.story-frame`): a
  vertical list, one entry per card, rendering `card.kicker` (already present
  on every `StoryCard` — no new data needed) in the app's mono label style.
  Each entry is a `<button type="button">` that jumps to that card via a new
  `goTo(i: number)` callback (`setIndex(i)`, added alongside the existing
  `advance`/`back`). The entry for the current `index` is visually
  distinguished (accent color + leading marker, per the mock) and carries
  `aria-current="true"`.
- The existing tap-zone buttons (`previous card` / `next card`, spanning the
  card itself) and keyboard nav (arrow keys / space) are unchanged — the
  chapter list is an addition for pointer users on a wide screen, not a
  replacement.
- This is the only surface where the new UI is interactive rather than
  purely decorative/re-flowed, so it's also the one with real new behavior
  to test (see Testing).

Options B ("Chart goes wide", per-archetype max-widths) and C ("Cinema
letterbox", widening the aspect ratio itself) were considered and rejected:
B breaks the deck's single-frame-size assumption for a payoff that's real
but speculative without a prototype; C directly re-litigates the "wider ≠
better" conclusion PR #6 already reached and measured.

## Testing

Per-surface Playwright coverage, added to the existing `mobile` /
`desktop` project split rather than a new project:

- **Landing**: `desktop`-only assertion that the split-stage layout is
  present (e.g. the right-column panel's bounding box sits to the right of
  the header's), and `mobile`-only assertion that it's absent (single
  stacked column, no panel border). Existing "renders the pitch and username
  form" test stays project-agnostic since that assertion holds in both
  layouts.
- **Ballot**: `desktop`-only assertion that the left column stays in the
  same position while the right column scrolls (e.g. scroll the right
  column, assert the `h1`'s bounding box is unchanged). `mobile`-only
  assertion that the whole page scrolls as one region, as today.
- **Story player**: `desktop`-only test that the chapter rail is visible,
  that its entries match each card's `kicker`, and that clicking a non-adjacent
  entry jumps `index` straight to it (progress rail and card content update
  accordingly). `mobile`-only assertion that the rail is not rendered and
  that tap-zone/keyboard navigation behave exactly as the existing
  `wrapped.spec.ts` assertions already check — no change needed there beyond
  confirming they still pass unmodified.

No new error states are introduced by this work — there's no new failure
mode being added (no new network calls, no new data dependency beyond
`card.kicker`, which is already required and rendered elsewhere on every
card).
