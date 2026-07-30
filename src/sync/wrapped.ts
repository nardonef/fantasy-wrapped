import { and, eq, isNull, lt, or } from "drizzle-orm";
import { cache } from "react";
import { fallbackCopy } from "@/copy/fallback";
import type { WrappedCopy } from "@/copy/schema";
import { writeCopy } from "@/copy/writer";
import { db } from "@/db";
import type { Provider } from "@/db/schema";
import { leagues, teams, wrappedScripts } from "@/db/schema";
import { type CardScript, computeSeasonFacts, ENGINE_VERSION, generateCardScript } from "@/engine";
import { loadBundle } from "./load";

/**
 * A claim older than this is treated as abandoned (the process that made it
 * crashed, or Vercel killed the invocation) rather than still in flight, and
 * is retried rather than left blocking that team's copy forever. Generous
 * relative to a real Haiku call (low single-digit seconds) on purpose — the
 * cost of guessing too short is a duplicate generation; too long just delays
 * a retry after a genuine crash, which is rare.
 */
export const CLAIM_STALE_MS = 2 * 60 * 1000;

/**
 * Atomically claim the right to generate copy for one team, so two callers
 * racing on the same team — most plausibly two people opening the same
 * never-viewed share link within moments of each other — don't both pay for
 * the LLM call. The UPDATE only matches a row that's still uncopied and
 * unclaimed (or whose claim has gone stale), so exactly one caller sees
 * `returning` rows.
 */
export async function tryClaimGeneration(teamId: string): Promise<boolean> {
  const staleThreshold = new Date(Date.now() - CLAIM_STALE_MS);
  const claimed = await db
    .update(wrappedScripts)
    .set({ copyGenerationClaimedAt: new Date() })
    .where(
      and(
        eq(wrappedScripts.teamId, teamId),
        eq(wrappedScripts.engineVersion, ENGINE_VERSION),
        isNull(wrappedScripts.copy),
        or(
          isNull(wrappedScripts.copyGenerationClaimedAt),
          lt(wrappedScripts.copyGenerationClaimedAt, staleThreshold),
        ),
      ),
    )
    .returning({ id: wrappedScripts.id });
  return claimed.length > 0;
}

export type WrappedPayload = {
  script: CardScript;
  copy: WrappedCopy;
  /** Internal league row id — the key for loadSeasonFacts(). */
  leagueDbId: string;
  league: { name: string; season: number; providerLeagueId: string; provider: Provider };
  team: { id: string; displayName: string; teamName: string | null; avatarUrl: string | null };
  allTeams: { rosterId: string; displayName: string; teamName: string | null }[];
};

/**
 * Load (or compute and cache) one manager's Wrapped: card script + copy.
 * Scripts cache per (team, engineVersion); copy caches alongside once
 * generated. Without an ANTHROPIC_API_KEY the deterministic fallback copy is
 * served and NOT cached, so adding a key later upgrades the copy.
 *
 * Wrapped in React's per-request `cache` because the page calls this twice —
 * once from generateMetadata and once from the component. Uncached, a cold
 * view runs two copy generations concurrently: double the latency the user
 * waits through, and double the tokens billed for a result one of them throws
 * away.
 *
 * `withCopy: false` skips generation for callers that only need the script —
 * the OG image renders the archetype name and never reads a word of copy, and
 * it runs as its own request, so the cache above can't spare it. Generating
 * there means a link unfurl blocks on the LLM and times out in the chat app
 * the share card exists for.
 *
 * The flag is a bare boolean, not an options object: `cache` keys on argument
 * identity, and a fresh `{}` per call would never hit.
 */
export const getWrapped = cache(async function getWrapped(
  provider: Provider,
  providerLeagueId: string,
  season: number,
  rosterId: string,
  withCopy = true,
): Promise<WrappedPayload | null> {
  const [league] = await db
    .select()
    .from(leagues)
    .where(
      and(
        eq(leagues.provider, provider),
        eq(leagues.providerLeagueId, providerLeagueId),
        eq(leagues.season, season),
      ),
    );
  if (league?.syncStatus !== "synced") return null;

  const teamRows = await db.select().from(teams).where(eq(teams.leagueId, league.id));
  const team = teamRows.find((t) => t.providerRosterId === rosterId);
  if (!team) return null;

  const [cached] = await db
    .select()
    .from(wrappedScripts)
    .where(
      and(eq(wrappedScripts.teamId, team.id), eq(wrappedScripts.engineVersion, ENGINE_VERSION)),
    );

  let script: CardScript;
  let copy: WrappedCopy | null = null;
  if (cached) {
    script = cached.script as CardScript;
    copy = (cached.copy as WrappedCopy | null) ?? null;
  } else {
    const bundle = await loadBundle(league.id);
    if (!bundle) return null;
    const facts = computeSeasonFacts(bundle);
    script = generateCardScript(facts, rosterId);
    await db
      .insert(wrappedScripts)
      .values({ teamId: team.id, engineVersion: ENGINE_VERSION, script })
      .onConflictDoNothing();
  }

  if (!copy) {
    if (!withCopy) {
      // Caller only needs the script. Serve the deterministic copy so the
      // payload shape is unchanged, without paying for a generation.
      copy = fallbackCopy(script);
    } else if (process.env.ANTHROPIC_API_KEY) {
      if (await tryClaimGeneration(team.id)) {
        const result = await writeCopy(script);
        copy = result.copy;
        if (!result.usedFallback) {
          await db
            .update(wrappedScripts)
            .set({
              copy,
              copyModel: result.model,
              copyUsage: result.telemetry,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(wrappedScripts.teamId, team.id),
                eq(wrappedScripts.engineVersion, ENGINE_VERSION),
              ),
            );
        }
      } else {
        // Someone else claimed this team's generation — re-read rather than
        // assume it's still running. If they already finished, serve the
        // real copy instead of needlessly falling back; if they haven't,
        // this one request falls back rather than wait on a call it isn't
        // paying for.
        const [recheck] = await db
          .select({ copy: wrappedScripts.copy })
          .from(wrappedScripts)
          .where(
            and(
              eq(wrappedScripts.teamId, team.id),
              eq(wrappedScripts.engineVersion, ENGINE_VERSION),
            ),
          );
        copy = (recheck?.copy as WrappedCopy | null) ?? fallbackCopy(script);
      }
    } else {
      copy = fallbackCopy(script);
    }
  }

  return {
    script,
    copy,
    leagueDbId: league.id,
    league: {
      name: league.name,
      season: league.season,
      providerLeagueId: league.providerLeagueId,
      provider: league.provider,
    },
    team: {
      id: team.id,
      displayName: team.displayName,
      teamName: team.teamName,
      avatarUrl: team.avatarUrl,
    },
    allTeams: teamRows
      .map((t) => ({
        rosterId: t.providerRosterId,
        displayName: t.displayName,
        teamName: t.teamName,
      }))
      .sort((a, b) => Number(a.rosterId) - Number(b.rosterId)),
  };
});
