import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3199",
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "pnpm start -p 3199",
    url: "http://localhost:3199/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
