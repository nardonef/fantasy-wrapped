import { gunzipSync } from "node:zlib";
import { expect, type Page, test } from "@playwright/test";

const WRAPPED_URL = "/w/sleeper/1269125082375008256/2025/5";

/**
 * Captures every PostHog event name sent through the /ingest proxy, in
 * order. posthog-js sends capture bodies gzip-compressed (as text/plain, to
 * dodge a CORS preflight) rather than as plain JSON, so this decompresses
 * before parsing.
 */
function trackCapturedEvents(page: Page): string[] {
  const events: string[] = [];
  page.on("request", (request) => {
    if (!request.url().includes("/ingest/") || request.method() !== "POST") return;
    const buf = request.postDataBuffer();
    if (!buf) return;
    const body = JSON.parse(gunzipSync(buf).toString("utf-8")) as {
      event?: string;
      batch?: { event: string }[];
    };
    if (body.event) events.push(body.event);
    for (const item of body.batch ?? []) events.push(item.event);
  });
  return events;
}

test("landing page renders the pitch and username form", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("told straight");
  await expect(page.getByLabel("Sleeper username")).toBeVisible();
});

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
  // No card chrome on mobile: the lg:border/lg:bg classes must not apply
  // unconditionally, or the panel would look like something was added.
  await expect(panel).toHaveCSS("border-top-width", "0px");
});

test("wrapped story plays through to the archetype finale", async ({ page }) => {
  await page.goto(WRAPPED_URL);

  const player = page.getByTestId("story-player");
  await expect(player).toBeVisible();
  // Opener: the season summary record.
  await expect(player).toContainText("4-10");
  await expect(player).toContainText("01 / 11");

  // Tap through every card to the finale.
  const next = page.getByRole("button", { name: "next card" });
  for (let i = 0; i < 10; i++) {
    await next.click();
  }
  await expect(player).toContainText("11 / 11");
  await expect(player).toContainText("The Saboteur");
  await expect(page.getByRole("button", { name: /send it to the chat/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /the ballot/i })).toBeVisible();

  // Back navigation works.
  await page.getByRole("button", { name: "previous card" }).click();
  await expect(player).toContainText("10 / 11");
});

test("the opener draws the season shape beside the record it produced", async ({ page }) => {
  await page.goto(WRAPPED_URL);
  const player = page.getByTestId("story-player");

  await expect(player).toHaveAttribute("data-layout", "chart");
  // One bar per regular-season week — not per week played, which would put
  // consolation games in "the season on paper".
  await expect(player.getByTestId("chart-bar")).toHaveCount(14);
  await expect(player).toContainText("WK 14");
});

test("the deck varies its layout and inverts for a brag", async ({ page }) => {
  await page.goto(WRAPPED_URL);
  const player = page.getByTestId("story-player");
  const next = page.getByRole("button", { name: "next card" });

  await expect(player).toHaveAttribute("data-tone", "dark");

  const layouts = new Set<string>();
  const tones = new Set<string>();
  for (let i = 0; i < 11; i++) {
    layouts.add((await player.getAttribute("data-layout")) ?? "");
    tones.add((await player.getAttribute("data-tone")) ?? "");
    await next.click();
  }

  // One layout for every card is exactly what this replaced.
  expect(layouts.size).toBeGreaterThan(3);
  // Manager 5's MVP card is a brag: it flips the whole screen to paper.
  expect([...tones].sort()).toEqual(["dark", "light"]);
});

test("the finale convicts with the archetype's evidence, strongest first", async ({ page }) => {
  await page.goto(WRAPPED_URL);
  const next = page.getByRole("button", { name: "next card" });
  for (let i = 0; i < 10; i++) {
    await next.click();
  }

  const player = page.getByTestId("story-player");
  await expect(player).toHaveAttribute("data-layout", "verdict");
  await expect(player).toHaveAttribute("data-tone", "light");

  // Order is load-bearing and has to survive the jsonb round-trip that stores
  // the script: the bench points are the accusation, so they lead.
  const rows = player.getByTestId("verdict-row");
  await expect(rows).toHaveCount(3);
  // Uppercased by CSS on screen; the DOM keeps the humanized key.
  await expect(rows.first()).toContainText("Bench Points Wasted");
  await expect(rows.first()).toContainText("504.6");
});

test("the story holds a phone-shaped card on a wide desktop", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) < 640, "phones are full-bleed by design");
  await page.goto(WRAPPED_URL);

  const player = page.getByTestId("story-player");
  await expect(player).toBeVisible();

  const frame = await player.boundingBox();
  const vp = page.viewportSize();
  if (!frame || !vp) throw new Error("no layout box");

  // Full-bleed on a 2560px monitor was the bug: the type sits at its clamp
  // ceiling and strands itself in two metres of empty ground.
  expect(frame.width).toBeLessThanOrEqual(520);
  expect(frame.width).toBeLessThan(vp.width / 2);
  // Centred on the page ground, not pinned left.
  expect(Math.abs(vp.width - (frame.x * 2 + frame.width))).toBeLessThan(2);
  // 9:16, the format the deck is actually written for.
  expect(frame.height / frame.width).toBeCloseTo(16 / 9, 1);
});

test("story type sizes off the card, not the window", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) < 640, "phones are full-bleed by design");
  await page.goto(WRAPPED_URL);
  const title = page.getByTestId("story-player").locator("h2").first();
  const titlePx = () => title.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));

  await page.setViewportSize({ width: 2560, height: 1440 });
  await expect(title).toBeVisible();
  const tall = await titlePx();

  // A short window makes the card narrower than a phone. Sized in vw the title
  // would stay pinned at its full-viewport ceiling and overrun the card; sized
  // in cqw it tracks the frame it is actually drawn in.
  await page.setViewportSize({ width: 2560, height: 600 });
  const short = await titlePx();

  expect(short).toBeLessThan(tall);
});

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

test("explicit previous/next controls flank the card on desktop", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) < 1024, "the flanking controls are desktop-only");
  await page.goto(WRAPPED_URL);
  const player = page.getByTestId("story-player");
  const prevControl = page.getByRole("button", { name: "Previous", exact: true });
  const nextControl = page.getByRole("button", { name: "Next", exact: true });

  await expect(player).toContainText("01 / 11");
  await expect(prevControl).toBeDisabled();
  await expect(nextControl).toBeEnabled();

  await nextControl.click();
  await expect(player).toContainText("02 / 11");
  await expect(prevControl).toBeEnabled();

  await prevControl.click();
  await expect(player).toContainText("01 / 11");
});

test("league ballot page lists superlatives and links to wrappeds", async ({ page }) => {
  await page.goto("/l/sleeper/1269125082375008256/2025");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ballot");
  await expect(page.getByText("The Ring")).toBeVisible();
  // Every team gets a final verdict row.
  await expect(page.getByText("Final verdicts")).toBeVisible();
});

test("ballot pins the title while the right column scrolls independently", async ({
  page,
  viewport,
}) => {
  test.skip((viewport?.width ?? 0) < 1024, "narrow layouts scroll as one page");
  await page.goto("/l/sleeper/1269125082375008256/2025");
  const heading = page.getByRole("heading", { level: 1 });
  const scroller = page.getByTestId("ballot-scroll");
  const before = await heading.boundingBox();
  await scroller.evaluate((el) => el.scrollBy(0, 400));
  // Positive control: the scroll container actually scrolled. Without this,
  // the heading-position assertion below passes even if lg:overflow-y-auto
  // were removed entirely, since the heading lives in a sibling column.
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const after = await heading.boundingBox();
  if (!before || !after) throw new Error("no layout box");
  expect(after.y).toBeCloseTo(before.y, 0);
});

test("ballot scrolls as a single page on mobile", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) >= 1024, "desktop pins the title in its own column");
  await page.goto("/l/sleeper/1269125082375008256/2025");
  const heading = page.getByRole("heading", { level: 1 });
  const before = await heading.boundingBox();
  await page.evaluate(() => window.scrollBy(0, 400));
  const after = await heading.boundingBox();
  if (!before || !after) throw new Error("no layout box");
  expect(after.y).toBeLessThan(before.y);
});

test("ballot links still navigate normally with the click-tracking handler attached", async ({
  page,
}) => {
  await page.goto("/l/sleeper/1269125082375008256/2025");
  // BallotLink wraps next/link's onClick to fire a capture call first — this
  // catches a regression where that wrapper swallows the click or calls
  // preventDefault instead of just observing it. league_ballot_link_clicked
  // itself isn't asserted here for the same reason wrapped_ballot_link_clicked
  // isn't in the test above: the click navigates away, racing the capture
  // request in a way that isn't worth chasing in a test.
  await page.locator('a[href^="/w/sleeper/1269125082375008256/2025/"]').first().click();
  await expect(page).toHaveURL(/\/w\/sleeper\/1269125082375008256\/2025\/\d+/);
});

test("unknown roster 404s", async ({ page }) => {
  const response = await page.goto("/w/sleeper/1269125082375008256/2025/99");
  expect(response?.status()).toBe(404);
});

test("playing through the story captures the expected PostHog events", async ({ page }) => {
  const events = trackCapturedEvents(page);
  await page.goto(WRAPPED_URL);
  await expect(page.getByTestId("story-player")).toBeVisible();

  const next = page.getByRole("button", { name: "next card" });
  for (let i = 0; i < 10; i++) {
    await next.click();
  }
  await page.getByRole("button", { name: /send it to the chat/i }).click();

  // posthog-js batches capture calls, so give the queue time to flush before
  // asserting rather than racing it. wrapped_ballot_link_clicked is left
  // unasserted here: clicking it navigates away, which races (and can
  // truncate) the capture request in a way that isn't worth chasing in a
  // test — it's covered by code review, not e2e.
  await expect.poll(() => events.includes("wrapped_share_clicked"), { timeout: 10_000 }).toBe(true);

  expect(events.filter((e) => e === "wrapped_card_viewed")).toHaveLength(11);
  expect(events).toEqual(
    expect.arrayContaining([
      "wrapped_story_started",
      "wrapped_story_completed",
      "wrapped_share_clicked",
    ]),
  );
});
