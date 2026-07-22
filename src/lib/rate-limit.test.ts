import { describe, expect, it } from "vitest";
import { pruneRateLimitWindows, rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  it("allows up to the limit within a window, then blocks with retry-after", () => {
    const key = `test-${Math.random()}`;
    const t0 = 1_000_000;
    expect(rateLimit(key, 2, 60_000, t0).allowed).toBe(true);
    expect(rateLimit(key, 2, 60_000, t0 + 1000).allowed).toBe(true);
    const blocked = rateLimit(key, 2, 60_000, t0 + 2000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(58);
  });

  it("resets after the window expires", () => {
    const key = `test-${Math.random()}`;
    const t0 = 1_000_000;
    rateLimit(key, 1, 60_000, t0);
    expect(rateLimit(key, 1, 60_000, t0 + 1).allowed).toBe(false);
    expect(rateLimit(key, 1, 60_000, t0 + 60_001).allowed).toBe(true);
  });

  it("prunes expired windows", () => {
    const key = `test-${Math.random()}`;
    rateLimit(key, 1, 1, 0);
    pruneRateLimitWindows(10);
    expect(rateLimit(key, 1, 60_000, 20).allowed).toBe(true);
  });
});
