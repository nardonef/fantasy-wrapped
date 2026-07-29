import { expect, test } from "@playwright/test";

const WRAPPED_URL = "/w/sleeper/1269125082375008256/2025/5";

test("landing page renders the pitch and username form", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("told straight");
  await expect(page.getByLabel("Sleeper username")).toBeVisible();
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
  const window = page.viewportSize();
  if (!frame || !window) throw new Error("no layout box");

  // Full-bleed on a 2560px monitor was the bug: the type sits at its clamp
  // ceiling and strands itself in two metres of empty ground.
  expect(frame.width).toBeLessThanOrEqual(520);
  expect(frame.width).toBeLessThan(window.width / 2);
  // Centred on the page ground, not pinned left.
  expect(Math.abs(window.width - (frame.x * 2 + frame.width))).toBeLessThan(2);
  // 9:16, the format the deck is actually written for.
  expect(frame.height / frame.width).toBeCloseTo(16 / 9, 1);
});

test("story type sizes off the card, not the window", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) < 640, "phones are full-bleed by design");
  await page.goto(WRAPPED_URL);
  const title = page.getByTestId("story-player").locator("h2").first();
  const titlePx = () =>
    title.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));

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

test("league ballot page lists superlatives and links to wrappeds", async ({ page }) => {
  await page.goto("/l/sleeper/1269125082375008256/2025");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ballot");
  await expect(page.getByText("The Ring")).toBeVisible();
  // Every team gets a final verdict row.
  await expect(page.getByText("Final verdicts")).toBeVisible();
});

test("unknown roster 404s", async ({ page }) => {
  const response = await page.goto("/w/sleeper/1269125082375008256/2025/99");
  expect(response?.status()).toBe(404);
});
