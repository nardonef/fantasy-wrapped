import { expect, test } from "@playwright/test";

/**
 * The landing flow's real "type a username, sync" path hits the live Sleeper
 * API, which the other e2e specs deliberately avoid — they seed the fixture
 * league directly and navigate straight to a URL. To exercise the auto-team
 * redirect without a network dependency, these mock the two client-facing
 * endpoints and point them at the fixture league global-setup already seeded
 * (1269125082375008256, season 2025, roster 5 — the same one every other
 * wrapped-story test uses), so the redirect target is a real page.
 */

const LEAGUE_ID = "1269125082375008256";
const SEASON = 2025;

async function mockLeagues(page: import("@playwright/test").Page) {
  await page.route("**/api/sleeper/leagues*", (route) =>
    route.fulfill({
      json: {
        userId: "test-user-1",
        leagues: [
          {
            leagueId: LEAGUE_ID,
            name: "Lonely Fans",
            season: SEASON,
            status: "complete",
            teams: 10,
          },
        ],
      },
    }),
  );
}

test("a known roster skips the team picker and lands straight on your story", async ({ page }) => {
  await mockLeagues(page);
  await page.route("**/api/sync", (route) =>
    route.fulfill({
      json: {
        provider: "sleeper",
        leagueId: LEAGUE_ID,
        season: SEASON,
        name: "Lonely Fans",
        yourRosterId: "5",
        teams: [{ rosterId: "5", displayName: "Manager 5", teamName: null, record: "4-10" }],
      },
    }),
  );

  await page.goto("/");
  await page.getByLabel("Sleeper username").fill("frank");
  await page.getByRole("button", { name: "Go" }).click();
  await page.getByRole("button", { name: /Lonely Fans/ }).click();

  // Never shows "who are you?" — the match is enough to skip it.
  await expect(page.getByText("who are you?")).toHaveCount(0);
  await expect(page).toHaveURL(`/w/sleeper/${LEAGUE_ID}/${SEASON}/5`);
  await expect(page.getByTestId("story-player")).toBeVisible();
});

test("no matching roster falls back to the picker", async ({ page }) => {
  await mockLeagues(page);
  await page.route("**/api/sync", (route) =>
    route.fulfill({
      json: {
        provider: "sleeper",
        leagueId: LEAGUE_ID,
        season: SEASON,
        name: "Lonely Fans",
        yourRosterId: null,
        teams: [
          { rosterId: "5", displayName: "Manager 5", teamName: null, record: "4-10" },
          { rosterId: "1", displayName: "InfinityStoner", teamName: null, record: "6-8" },
        ],
      },
    }),
  );

  await page.goto("/");
  await page.getByLabel("Sleeper username").fill("commissioner");
  await page.getByRole("button", { name: "Go" }).click();
  await page.getByRole("button", { name: /Lonely Fans/ }).click();

  await expect(page.getByText("who are you?")).toBeVisible();
  await expect(page.getByRole("link", { name: /Manager 5/ })).toBeVisible();
  await expect(page).toHaveURL("/");
});
