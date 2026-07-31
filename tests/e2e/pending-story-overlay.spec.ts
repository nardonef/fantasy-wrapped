import { expect, test } from "@playwright/test";

/**
 * Manual verification of this is unreliable: on a fast local server the
 * whole click-to-render round trip can complete faster than a screenshot
 * tool call takes to fire, making "did the overlay show" a coin flip to
 * observe by eye. Route-delay the navigation instead, so the window during
 * which the overlay must be visible is deterministic rather than a guess
 * about server timing.
 */

test("clicking a team on the ballot shows the loading overlay while the story is still loading", async ({
  page,
}) => {
  await page.goto("/l/sleeper/1269125082375008256/2025");

  await page.route("**/w/sleeper/1269125082375008256/2025/5", async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });

  await page
    .getByRole("link", { name: /Manager 5/ })
    .first()
    .click();

  // Visible during the artificial delay...
  await expect(page.getByText("Building their story…")).toBeVisible();
  await expect(page.getByText("Same treatment as yours. Won't take long.")).toBeVisible();

  // ...and gone once the real story has taken over.
  await expect(page.getByTestId("story-player")).toBeVisible();
  await expect(page.getByText("Building their story…")).toHaveCount(0);
});
