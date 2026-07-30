import { afterEach, describe, expect, it, vi } from "vitest";

const { capture, shutdown, PostHog } = vi.hoisted(() => {
  const capture = vi.fn();
  const shutdown = vi.fn().mockResolvedValue(undefined);
  // A real `function`, not an arrow function: arrow functions can't be used
  // as constructors, and captureServerEvent calls `new PostHog(...)`.
  const PostHog = vi.fn().mockImplementation(function PostHogMock() {
    return { capture, shutdown };
  });
  return { capture, shutdown, PostHog };
});

vi.mock("posthog-node", () => ({ PostHog }));

const { captureServerEvent, wrappedDistinctId } = await import("./posthog-server");

describe("wrappedDistinctId", () => {
  it("builds a stable id from the route's identifying params", () => {
    expect(wrappedDistinctId("sleeper", "1269125082375008256", 2025, "5")).toBe(
      "wrapped:sleeper:1269125082375008256:2025:5",
    );
  });
});

describe("captureServerEvent", () => {
  const originalToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    else process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = originalToken;
    vi.clearAllMocks();
  });

  it("is a no-op when no project token is configured", async () => {
    // Assigning undefined coerces to the string "undefined" (env vars are
    // always strings) rather than unsetting the key — delete it instead.
    delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    await captureServerEvent("wrapped_not_found", "wrapped:sleeper:1:2025:5");
    expect(PostHog).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("captures with the given distinct id and properties, then shuts the client down", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test_token";
    await captureServerEvent("wrapped_not_found", "wrapped:sleeper:1:2025:5", {
      reason: "wrapped_missing",
    });

    expect(PostHog).toHaveBeenCalledWith(
      "phc_test_token",
      expect.objectContaining({ host: "https://us.i.posthog.com" }),
    );
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "wrapped:sleeper:1:2025:5",
        event: "wrapped_not_found",
        properties: expect.objectContaining({ reason: "wrapped_missing" }),
      }),
    );
    expect(shutdown).toHaveBeenCalled();
  });
});
