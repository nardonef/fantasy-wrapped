# Desktop Layouts (Landing, Ballot, Story Player) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the landing page, ballot page, and story player a real desktop
layout at `lg:` (1024px+), instead of the current phone-width column pinned
top-left of an otherwise empty screen — without touching the story card's
own proportions, which PR #6 already measured and locked in.

**Architecture:** Every change is a `lg:`-prefixed Tailwind variant added to
existing JSX — no new components, no new routes, no client-state changes
except one new callback (`goTo`) in `StoryPlayer`. Below 1024px every surface
renders byte-for-byte what ships today.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind v4, `motion`,
Playwright (`mobile` project at Pixel 7 width / `desktop` project at
2560×1440 — see `playwright.config.ts`).

## Global Constraints

- Breakpoint is `lg:` (1024px) for all three surfaces — a new breakpoint for
  this codebase (existing responsive code only uses `sm:` at 640px).
- The `.story-frame` card's width/height/`aspect-ratio`/`container-type`
  (`src/app/globals.css:125-139`) get **zero** changes.
- `src/components/LandingFlow.tsx`'s internal phase state machine
  (user → leagues → syncing → teams) is untouched — only its wrapper in
  `src/app/page.tsx` changes.
- No copy changes. Every string in every task is copied verbatim from the
  current source.
- E2e tests live in `tests/e2e/wrapped.spec.ts`, following its existing
  `test.skip((viewport?.width ?? 0) < N, "reason")` gating pattern (see
  `tests/e2e/wrapped.spec.ts:110-111`) rather than a new Playwright project.
- Run `pnpm build && pnpm test:e2e -- -g "<test name>"` to run a single new
  e2e test against both projects (mobile + desktop) — `pnpm test:e2e` alone
  reuses a running server outside CI but needs a fresh `pnpm build` after
  any source change since the config's `webServer` runs `pnpm start`
  (production), not `pnpm dev`.
- Run `pnpm typecheck && pnpm lint` before every commit in this plan.

---

### Task 1: Landing page — split stage

**Files:**
- Modify: `src/app/page.tsx` (currently 26 lines, full file)
- Test: `tests/e2e/wrapped.spec.ts` (append two tests)

**Interfaces:**
- Consumes: `LandingFlow` component (`src/components/LandingFlow.tsx`),
  unchanged — imported and rendered exactly as today, just re-wrapped.
- Produces: `data-testid="landing-panel"` on the div wrapping `LandingFlow`,
  used by this task's own tests only.

- [ ] **Step 1: Write the two failing e2e tests**

Add to `tests/e2e/wrapped.spec.ts`, after the existing
`test("landing page renders the pitch and username form", ...)` test:

```ts
test("landing splits into two columns on a wide desktop", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) < 1024, "narrow layouts stay single-column");
  await page.goto("/");
  const header = page.locator("header");
  const panel = page.getByTestId("landing-panel");
  await expect(panel).toBeVisible();
  const headerBox = await header.boundingBox();
  const panelBox = await panel.boundingBox();
  if (!headerBox || !panelBox) throw new Error("no layout box");
  // Side by side, not stacked: the panel starts to the right of the header.
  expect(panelBox.x).toBeGreaterThan(headerBox.x + headerBox.width);
});

test("landing stays a single stacked column on mobile", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) >= 1024, "desktop gets the split layout");
  await page.goto("/");
  const header = page.locator("header");
  const panel = page.getByTestId("landing-panel");
  const headerBox = await header.boundingBox();
  const panelBox = await panel.boundingBox();
  if (!headerBox || !panelBox) throw new Error("no layout box");
  // Stacked: the panel starts below the header, not beside it.
  expect(panelBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm build && pnpm test:e2e -- -g "landing (splits|stays a single)"`

Expected: FAIL — `getByTestId("landing-panel")` matches nothing, since the
div doesn't exist yet.

- [ ] **Step 3: Replace `src/app/page.tsx` with the split-stage layout**

```tsx
import { LandingFlow } from "@/components/LandingFlow";

export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col px-7 pt-16 pb-10 sm:mx-auto sm:w-full sm:max-w-md lg:mx-0 lg:grid lg:max-w-none lg:grid-cols-2 lg:content-center lg:items-center lg:gap-x-16 lg:gap-y-10 lg:px-16 lg:py-16">
      <header>
        <p className="label text-chalk-faint">Fantasy Football · 2025</p>
        <h1 className="display mt-5 text-[clamp(2.75rem,14vw,3.75rem)]">
          Your season,
          <br />
          <span className="text-flag">told straight.</span>
        </h1>
        <p className="mt-5 max-w-[34ch] text-[15px] leading-[1.55] text-pretty text-chalk-dim">
          Every start, sit, trade and bad beat — handed back to you with precision and a little
          cruelty. Built to be screenshotted.
        </p>
      </header>

      <div
        data-testid="landing-panel"
        className="lg:border lg:border-chalk/15 lg:bg-field-raised lg:p-10"
      >
        <LandingFlow />
      </div>

      <footer className="label mt-auto pt-12 text-chalk-faint lg:col-span-2 lg:mt-0 lg:pt-0">
        Sleeper leagues &amp; Yahoo coming
      </footer>
    </main>
  );
}
```

Note the footer text above must stay exactly what's already in the file —
copy it from the current `src/app/page.tsx` rather than retyping it, since
this snippet is illustrative of structure, not a copy source.

- [ ] **Step 4: Run the dev server and check both widths by eye**

Run: `pnpm dev`, then open `http://localhost:3000` at ~1440px and ~2560px
wide (desktop) and ~400px wide (mobile, or Chrome DevTools device toolbar).
Confirm: mobile is pixel-identical to before this change; desktop shows the
header on the left, the bordered panel with the username form on the right,
both roughly vertically centered, with the footer spanning underneath both.
If the two columns don't line up vertically, adjust `lg:items-center` /
`lg:content-center` on the `<main>` — the exact spacing was intentionally
left to this step, not specified upstream.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm build && pnpm test:e2e -- -g "landing (splits|stays a single)"`

Expected: PASS on both `mobile` and `desktop` projects.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add src/app/page.tsx tests/e2e/wrapped.spec.ts
git commit -m "feat: split-stage desktop layout for the landing page"
```

---

### Task 2: Ballot page — split stage

**Files:**
- Modify: `src/app/l/[provider]/[leagueId]/[season]/page.tsx`
- Test: `tests/e2e/wrapped.spec.ts` (append two tests)

**Interfaces:**
- Consumes: nothing from Task 1 or Task 3 — independent.
- Produces: `data-testid="ballot-scroll"` on the right-column scroll
  container, used by this task's own tests only.

- [ ] **Step 1: Write the two failing e2e tests**

Add to `tests/e2e/wrapped.spec.ts`, after the existing
`test("league ballot page lists superlatives and links to wrappeds", ...)`
test:

```ts
test("ballot pins the title while the right column scrolls independently", async ({
  page,
  viewport,
}) => {
  test.skip((viewport?.width ?? 0) < 1024, "narrow layouts scroll as one page");
  await page.goto("/l/sleeper/1269125082375008256/2025");
  const heading = page.getByRole("heading", { level: 1 });
  const before = await heading.boundingBox();
  await page.getByTestId("ballot-scroll").evaluate((el) => el.scrollBy(0, 400));
  const after = await heading.boundingBox();
  if (!before || !after) throw new Error("no layout box");
  expect(after.y).toBeCloseTo(before.y, 0);
});

test("ballot scrolls as a single page on mobile", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) >= 1024, "desktop pins the title in its own column");
  await page.goto("/l/sleeper/1269125082375008256/2025");
  const heading = page.getByRole("heading", { level: 1 });
  const before = await heading.boundingBox();
  await page.mouse.wheel(0, 400);
  const after = await heading.boundingBox();
  if (!before || !after) throw new Error("no layout box");
  expect(after.y).toBeLessThan(before.y);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm build && pnpm test:e2e -- -g "ballot (pins|scrolls as a single)"`

Expected: FAIL — `getByTestId("ballot-scroll")` matches nothing on the
desktop-gated test; on the mobile-gated test the page doesn't scroll yet the
way the assertion expects to observe (the whole `<main>` already scrolls
today, so this one may actually pass by accident before the change — that's
fine, it's locking in current behavior as a regression guard, not asserting
new behavior).

- [ ] **Step 3: Edit `src/app/l/[provider]/[leagueId]/[season]/page.tsx`**

Replace the `return (...)` block (from `<main className="min-h-dvh px-7
py-16 sm:mx-auto sm:max-w-xl">` through the matching `</main>`) with:

```tsx
  return (
    <main className="min-h-dvh px-7 py-16 sm:mx-auto sm:max-w-xl lg:mx-0 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,380px)_1fr] lg:gap-16 lg:px-16 lg:py-0">
      <div className="lg:flex lg:h-dvh lg:flex-col lg:justify-center">
        <p className="label text-chalk-faint">
          {facts.league.name} · {facts.league.season}
        </p>
        <h1 className="display mt-5 text-[clamp(2.75rem,14vw,3.75rem)]">
          The <span className="text-flag">ballot.</span>
        </h1>
        <p className="mt-4 text-[15px] leading-[1.55] text-chalk-dim">
          The awards nobody asked for. Argue amongst yourselves.
        </p>
      </div>

      <div data-testid="ballot-scroll" className="lg:h-dvh lg:overflow-y-auto lg:py-16">
        <section className="mt-12 lg:mt-0">
          <ul className="divide-y divide-chalk/12 border-y border-chalk/12">
            {superlatives.map((award) => (
              <li key={award.id} className="py-6">
                <p className="label text-flag">{award.label}</p>
                <BallotLink
                  href={wrappedHref(award.rosterId)}
                  leagueId={p.leagueId}
                  rosterId={award.rosterId}
                  linkType="award"
                  awardId={award.id}
                  className="display mt-2.5 block text-3xl hover:text-flag"
                >
                  {award.winner}
                  <PendingStoryOverlay />
                </BallotLink>
                <p className="mt-2 text-[14px] leading-[1.5] text-pretty text-chalk-dim">
                  {award.detail}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-16">
          <h2 className="label text-chalk-faint">Final verdicts · tap yours</h2>
          <ul className="mt-3 divide-y divide-chalk/12 border-y border-chalk/12">
            {teams.map((team) => (
              <li key={team.rosterId}>
                <BallotLink
                  href={wrappedHref(team.rosterId)}
                  leagueId={p.leagueId}
                  rosterId={team.rosterId}
                  linkType="team"
                  className="group flex items-baseline justify-between gap-4 py-4"
                >
                  <span className="label shrink-0 text-chalk-faint group-hover:text-flag">
                    {team.displayName}
                  </span>
                  <span className="display truncate text-right text-lg group-hover:text-flag">
                    {archetypes.get(team.rosterId)?.name}
                  </span>
                  <PendingStoryOverlay />
                </BallotLink>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
```

Everything inside the two `<section>`s is unchanged from the current file —
only the surrounding `<main>` and the new wrapping `<div>`s around the title
block and the two sections are new.

- [ ] **Step 4: Run the dev server and check both widths by eye**

Run: `pnpm dev`, open `/l/sleeper/1269125082375008256/2025` at ~1440px+ wide
and confirm the title stays in place while scrolling the awards/teams list,
and at mobile width confirm the page looks and scrolls exactly as before.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm build && pnpm test:e2e -- -g "ballot (pins|scrolls as a single)"`

Expected: PASS on both `mobile` and `desktop` projects.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add "src/app/l/[provider]/[leagueId]/[season]/page.tsx" tests/e2e/wrapped.spec.ts
git commit -m "feat: split-stage desktop layout for the ballot page"
```

---

### Task 3: Story player — rail context

**Files:**
- Modify: `src/components/story/StoryPlayer.tsx`
- Test: `tests/e2e/wrapped.spec.ts` (append two tests)

**Interfaces:**
- Consumes: `StoryCard.kicker: string` (`src/components/story/model.ts:45`),
  already required on every card and already rendered elsewhere in this
  file (`<Kicker text={card.kicker} .../>` in every archetype) — no new
  data dependency.
- Produces: `data-testid="chapter-link"` on each jump-nav button, and a new
  internal `goTo(i: number): void` callback, both local to this component —
  nothing downstream depends on them.

- [ ] **Step 1: Write the two failing e2e tests**

Add to `tests/e2e/wrapped.spec.ts`, after the existing
`test("story type sizes off the card, not the window", ...)` test:

```ts
test("the chapter rail lets you jump straight to any card on desktop", async ({
  page,
  viewport,
}) => {
  test.skip((viewport?.width ?? 0) < 1024, "the rail is desktop-only");
  await page.goto(WRAPPED_URL);
  const player = page.getByTestId("story-player");
  await expect(player).toContainText("01 / 11");

  const links = page.getByTestId("chapter-link");
  await expect(links).toHaveCount(11);
  await links.nth(3).click();

  await expect(player).toContainText("04 / 11");
  await expect(links.nth(3)).toHaveAttribute("aria-current", "true");
});

test("the chapter rail is not shown on mobile", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) >= 1024, "the rail only renders on desktop");
  await page.goto(WRAPPED_URL);
  await expect(page.getByTestId("story-player")).toBeVisible();
  await expect(page.getByTestId("chapter-link").first()).toBeHidden();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm build && pnpm test:e2e -- -g "chapter rail"`

Expected: FAIL — `getByTestId("chapter-link")` matches nothing, since the
nav doesn't exist yet.

- [ ] **Step 3: Add the `goTo` callback**

In `src/components/story/StoryPlayer.tsx`, find:

```tsx
  const advance = useCallback(
    () => setIndex((i) => Math.min(i + 1, cards.length - 1)),
    [cards.length],
  );
  const back = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);
```

Add directly after it:

```tsx
  const goTo = useCallback((i: number) => setIndex(i), []);
```

- [ ] **Step 4: Add the two gutters around `.story-frame`**

Find the outer wrapper's opening tag:

```tsx
    <div className="grid min-h-dvh place-items-center bg-page">
```

Replace with:

```tsx
    <div className="grid min-h-dvh place-items-center bg-page lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-8 lg:px-8">
      <div
        aria-hidden="true"
        className="hidden lg:flex lg:h-full lg:items-center lg:justify-self-end"
      >
        <span className={`label tracking-[0.2em] [writing-mode:vertical-rl] ${faint(tone)}`}>
          {managerName} · {leagueName} · {season}
        </span>
      </div>
```

(This inserts the left gutter as the first child, immediately before the
existing `.story-frame` div — the `.story-frame` div itself and everything
inside it is unchanged.)

Then find the `.story-frame` div's closing tag — the last `</div>` before
the outer wrapper's closing `</div>` — and insert the right gutter between
them:

```tsx
      </div>

      <nav
        aria-label="Jump to card"
        className="hidden lg:flex lg:h-full lg:flex-col lg:justify-center lg:justify-self-start lg:gap-2.5"
      >
        {cards.map((c, i) => (
          <button
            key={c.key}
            type="button"
            data-testid="chapter-link"
            aria-current={i === index ? "true" : undefined}
            onClick={() => goTo(i)}
            className={`label text-left tracking-[0.1em] transition-colors ${
              i === index ? (light ? "text-flag-ink" : "text-flag") : `${faint(tone)} hover:opacity-80`
            }`}
          >
            {i === index ? "→ " : ""}
            {c.kicker}
          </button>
        ))}
      </nav>
    </div>
  );
}
```

- [ ] **Step 5: Run the dev server and check both widths by eye**

Run: `pnpm dev`, open `/w/sleeper/1269125082375008256/2025/5` at ~1440px+
wide. Confirm: the card itself is exactly the same size/shape as before
this change (compare against `main` if unsure), a faint vertical wordmark
sits in the left gutter, a clickable list of every card's kicker sits in
the right gutter with the current one highlighted, and clicking any entry
jumps the deck straight to that card. At mobile width, confirm neither
gutter renders and the deck behaves exactly as before.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm build && pnpm test:e2e -- -g "chapter rail"`

Expected: PASS on both `mobile` and `desktop` projects. Also re-run the two
pre-existing desktop-only story tests to confirm the card's own geometry is
untouched:

Run: `pnpm test:e2e -- -g "phone-shaped card|sizes off the card"`

Expected: PASS (unchanged).

- [ ] **Step 7: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add src/components/story/StoryPlayer.tsx tests/e2e/wrapped.spec.ts
git commit -m "feat: desktop chapter rail for the story player"
```

---

## Self-Review Notes

- **Spec coverage:** all three surfaces from the design doc have a task;
  the breakpoint (`lg:`/1024px), the "card gets zero CSS changes" and
  "`LandingFlow` internals untouched" constraints are each enforced by a
  specific step or test above; Options B/C for the story player are not
  implemented, matching the design doc's decision.
- **Placeholder scan:** every step has literal code or a literal shell
  command; no "add appropriate styling" steps.
- **Type consistency:** `goTo(i: number): void` is defined once (Task 3,
  Step 3) and used only within the same task/file; `data-testid` values
  (`landing-panel`, `ballot-scroll`, `chapter-link`) are each defined and
  consumed within their own task, with no cross-task references.
