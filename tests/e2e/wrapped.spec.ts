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
  await expect(player).toContainText("1/10");

  // Tap through every card to the finale.
  const next = page.getByRole("button", { name: "next card" });
  for (let i = 0; i < 9; i++) {
    await next.click();
  }
  await expect(player).toContainText("10/10");
  await expect(player).toContainText("The Saboteur");
  await expect(page.getByRole("button", { name: /send it to the chat/i })).toBeVisible();

  // Back navigation works.
  await page.getByRole("button", { name: "previous card" }).click();
  await expect(player).toContainText("9/10");
});

test("unknown roster 404s", async ({ page }) => {
  const response = await page.goto("/w/sleeper/1269125082375008256/2025/99");
  expect(response?.status()).toBe(404);
});
