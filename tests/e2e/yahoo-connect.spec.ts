import { expect, test } from "@playwright/test";

test.describe("Yahoo connect flow", () => {
  // The landing page's "Connect Yahoo instead" entry point is temporarily
  // hidden while Yahoo's Fantasy Sports API access application is pending
  // (see STATUS.md) — the app currently 403s on real Yahoo accounts even
  // though the OAuth handshake itself is correct. Re-enable once approved.
  test.skip("landing page links to the Yahoo OAuth start route", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: "Connect Yahoo instead" });
    await expect(link).toHaveAttribute("href", "/api/auth/yahoo/start");
  });

  test("picker renders leagues and syncing redirects to the story", async ({ page }) => {
    await page.route("**/api/yahoo/leagues", async (route) => {
      await route.fulfill({
        json: {
          guid: "GUID-1",
          leagues: [{ leagueKey: "423.l.1", name: "Legends Only League", season: 2025, teams: 10 }],
        },
      });
    });
    await page.route("**/api/yahoo/sync", async (route) => {
      await route.fulfill({
        json: {
          provider: "yahoo",
          leagueId: "423.l.1",
          season: 2025,
          name: "Legends Only League",
          yourRosterId: "3",
          teams: [],
        },
      });
    });

    await page.goto("/connect/yahoo");
    await expect(page.getByText("Legends Only League")).toBeVisible();
    await page.getByText("Legends Only League").click();
    await page.waitForURL("**/w/yahoo/423.l.1/2025/3");
  });

  test("shows an error state when Yahoo league discovery fails", async ({ page }) => {
    await page.route("**/api/yahoo/leagues", async (route) => {
      await route.fulfill({
        status: 401,
        json: { error: "Your Yahoo session expired — sign in again." },
      });
    });
    await page.goto("/connect/yahoo");
    await expect(
      page.getByRole("alert").filter({ hasText: "Your Yahoo session expired — sign in again." }),
    ).toHaveText("Your Yahoo session expired — sign in again.");
  });
});
