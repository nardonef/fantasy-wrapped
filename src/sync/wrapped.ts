import { and, eq } from "drizzle-orm";
import { fallbackCopy } from "@/copy/fallback";
import type { WrappedCopy } from "@/copy/schema";
import { writeCopy } from "@/copy/writer";
import { db } from "@/db";
import type { Provider } from "@/db/schema";
import { leagues, teams, wrappedScripts } from "@/db/schema";
import { type CardScript, computeSeasonFacts, ENGINE_VERSION, generateCardScript } from "@/engine";
import { loadBundle } from "./load";

export type WrappedPayload = {
  script: CardScript;
  copy: WrappedCopy;
  league: { name: string; season: number; providerLeagueId: string; provider: Provider };
  team: { id: string; displayName: string; teamName: string | null; avatarUrl: string | null };
  allTeams: { rosterId: string; displayName: string; teamName: string | null }[];
};

/**
 * Load (or compute and cache) one manager's Wrapped: card script + copy.
 * Scripts cache per (team, engineVersion); copy caches alongside once
 * generated. Without an ANTHROPIC_API_KEY the deterministic fallback copy is
 * served and NOT cached, so adding a key later upgrades the copy.
 */
export async function getWrapped(
  provider: Provider,
  providerLeagueId: string,
  season: number,
  rosterId: string,
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
  if (!league || league.syncStatus !== "synced") return null;

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
    if (process.env.ANTHROPIC_API_KEY) {
      const result = await writeCopy(script);
      copy = result.copy;
      if (!result.usedFallback) {
        await db
          .update(wrappedScripts)
          .set({ copy, copyModel: result.model, updatedAt: new Date() })
          .where(
            and(
              eq(wrappedScripts.teamId, team.id),
              eq(wrappedScripts.engineVersion, ENGINE_VERSION),
            ),
          );
      }
    } else {
      copy = fallbackCopy(script);
    }
  }

  return {
    script,
    copy,
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
}
