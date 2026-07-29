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
  });
  posthog.register({ environment: getPostHogEnvironment() });
}
