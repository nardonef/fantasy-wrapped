import posthog from "posthog-js";
import { getPostHogEnvironment } from "@/lib/posthog-environment";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const e2e = process.env.NEXT_PUBLIC_POSTHOG_E2E_MODE === "true";

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
    // The /flags round-trip also carries remote config for things like
    // session replay sampling, so it stays on in production. CI's
    // placeholder token gets a 401 from it, which otherwise leaves the SDK
    // permanently un-loaded (every capture() call a silent no-op) — e2e
    // mode skips the request entirely rather than eating that failure.
    advanced_disable_flags: e2e,
    // posthog-js silently drops every capture() call from a
    // webdriver-controlled browser (correct behavior in production: bot
    // traffic shouldn't count as real users). e2e tests are exactly such a
    // browser, so e2e mode opts back in via this undocumented,
    // posthog-js-internal flag.
    ...(e2e ? { __preview_capture_bot_pageviews: true } : {}),
  });
  posthog.register({ environment: getPostHogEnvironment() });
}
