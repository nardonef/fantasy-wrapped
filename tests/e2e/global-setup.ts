import { execSync } from "node:child_process";

/** Seed the fixture league into whatever DATABASE_URL the app will use. */
export default function globalSetup(): void {
  execSync("pnpm tsx scripts/sync-league.ts --fixtures 1269125082375008256", {
    stdio: "inherit",
  });
}
