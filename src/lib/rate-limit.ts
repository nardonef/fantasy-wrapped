/**
 * Fixed-window in-memory rate limiter. Per-instance (resets on deploy and is
 * not shared across serverless instances) — adequate to stop a single client
 * hammering the sync endpoint; swap for a shared store if abuse shows up.
 */
type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const current = windows.get(key);
  if (!current || now >= current.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count < limit) {
    current.count++;
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return { allowed: false, retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) };
}

/** Periodically drop expired windows so the map doesn't grow unbounded. */
export function pruneRateLimitWindows(now: number = Date.now()): void {
  for (const [key, window] of windows) {
    if (now >= window.resetAt) windows.delete(key);
  }
}
