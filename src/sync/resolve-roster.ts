/**
 * Match a Sleeper user id to their roster in a synced league, so the landing
 * flow can skip the "who are you?" picker when the answer is already known.
 * A bare pure function — no DB, no fetch — so the matching logic itself is
 * unit-testable without spinning up a database.
 */
export function resolveYourRosterId(
  teams: { providerRosterId: string; providerUserId: string | null }[],
  userId: string | null | undefined,
): string | null {
  if (!userId) return null;
  return teams.find((t) => t.providerUserId === userId)?.providerRosterId ?? null;
}
