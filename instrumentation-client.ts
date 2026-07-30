import posthog from "posthog-js";
import { getPostHogEnvironment } from "@/lib/posthog-environment";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

// Unset locally until a project is provisioned — every other call site checks
// posthog-js's own initialized state, so capture calls are no-ops until then.
if (token) {
  posthog.init(token, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2026-05-30",
    // App Router navigations don't fire browser page loads; PageviewTracker
    // captures $pageview explicitly on route change instead.
    capture_pageview: false,
    // Not using feature flags/experiments in this phase. Skipping the
    // flags round-trip also means init doesn't block on it succeeding —
    // without this, an invalid/unrecognized token (e.g. CI's placeholder)
    // leaves the SDK stuck un-loaded and every capture() call a silent
    // no-op, even though the actual capture endpoint accepts any token.
    advanced_disable_flags: true,
    // posthog-js silently drops every capture() call from a
    // webdriver-controlled browser (correct behavior in production: bot
    // traffic shouldn't count as real users). e2e tests are exactly such a
    // browser, so CI alone opts back in via this undocumented,
    // posthog-js-internal flag -- never set outside CI, so production
    // traffic is still filtered normally.
    ...(process.env.NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT_CAPTURE === "true"
      ? { __preview_capture_bot_pageviews: true }
      : {}),
  });
  posthog.register({ environment: getPostHogEnvironment() });
}
