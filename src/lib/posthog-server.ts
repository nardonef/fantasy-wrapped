import { PostHog } from "posthog-node";
import { getPostHogEnvironment } from "@/lib/posthog-environment";

// Same "us" region as next.config.ts's proxy and instrumentation-client.ts's
// ui_host — server capture goes direct (no ad blocker to route around), but
// update all three together if the project ever moves to EU cloud.
const HOST = "https://us.i.posthog.com";

/**
 * There's no logged-in user and no client-side device id available on the
 * server, so server-side Wrapped events key off the resource being viewed
 * rather than a person — consistent with grouping by league in PostHog
 * rather than identifying individual managers.
 */
export function wrappedDistinctId(
  provider: string,
  providerLeagueId: string,
  season: number,
  rosterId: string,
): string {
  return `wrapped:${provider}:${providerLeagueId}:${season}:${rosterId}`;
}

export async function captureServerEvent(
  event: string,
  distinctId: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!token) return;
  const client = new PostHog(token, { host: HOST, flushAt: 1, flushInterval: 0 });
  client.capture({
    distinctId,
    event,
    properties: { ...properties, environment: getPostHogEnvironment() },
  });
  await client.shutdown();
}
