import type { NormalizedLeagueBundle } from "@/providers/types";
import { classifyArchetype } from "./archetype";
import { computeSeasonFacts } from "./facts";
import { selectCards } from "./select";
import type { CardScript, SeasonFacts } from "./types";
import { ENGINE_VERSION } from "./version";

export { classifyArchetype, classifyLeagueArchetypes } from "./archetype";
export { computeSeasonFacts } from "./facts";
export { computeCandidates } from "./insights";
export { selectCards } from "./select";
export * from "./types";
export { ENGINE_VERSION } from "./version";

export function generateCardScript(facts: SeasonFacts, rosterId: string): CardScript {
  const t = facts.teams[rosterId];
  if (!t) throw new Error(`Unknown rosterId ${rosterId}`);
  return {
    engineVersion: ENGINE_VERSION,
    leagueName: facts.league.name,
    season: facts.league.season,
    rosterId,
    managerName: t.displayName,
    teamName: t.teamName,
    cards: selectCards(facts, rosterId),
    archetype: classifyArchetype(facts, rosterId),
  };
}

/** One Wrapped per manager in the league. */
export function generateLeagueWrapped(bundle: NormalizedLeagueBundle): CardScript[] {
  const facts = computeSeasonFacts(bundle);
  return Object.keys(facts.teams)
    .sort((a, b) => Number(a) - Number(b))
    .map((rosterId) => generateCardScript(facts, rosterId));
}
