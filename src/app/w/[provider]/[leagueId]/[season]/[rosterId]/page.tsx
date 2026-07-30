import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildStoryCards } from "@/components/story/model";
import { StoryPlayer } from "@/components/story/StoryPlayer";
import type { Provider } from "@/db/schema";
import { captureServerEvent, wrappedDistinctId } from "@/lib/posthog-server";
import { loadSeasonFacts } from "@/sync/load";
import { getWrapped } from "@/sync/wrapped";

export const dynamic = "force-dynamic";

type Params = {
  provider: string;
  leagueId: string;
  season: string;
  rosterId: string;
};

function parseParams(params: Params) {
  const season = Number.parseInt(params.season, 10);
  if (params.provider !== "sleeper" || Number.isNaN(season)) return null;
  return {
    provider: params.provider as Provider,
    leagueId: params.leagueId,
    season,
    rosterId: params.rosterId,
  };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const parsed = parseParams(await params);
  if (!parsed) return {};
  const wrapped = await getWrapped(
    parsed.provider,
    parsed.leagueId,
    parsed.season,
    parsed.rosterId,
  );
  if (!wrapped) return {};
  return {
    title: `${wrapped.team.displayName} — ${wrapped.league.season} Fantasy Wrapped`,
    description: `${wrapped.script.archetype.name}. ${wrapped.league.name}, told straight.`,
    openGraph: {
      title: `${wrapped.team.displayName} is ${wrapped.script.archetype.name}`,
      description: `${wrapped.league.name} · ${wrapped.league.season} Fantasy Wrapped`,
    },
  };
}

export default async function WrappedPage({ params }: { params: Promise<Params> }) {
  const rawParams = await params;
  const parsed = parseParams(rawParams);
  if (!parsed) {
    await captureServerEvent(
      "wrapped_not_found",
      wrappedDistinctId(
        rawParams.provider,
        rawParams.leagueId,
        Number.parseInt(rawParams.season, 10),
        rawParams.rosterId,
      ),
      { reason: "bad_params" },
    );
    notFound();
  }
  const distinctId = wrappedDistinctId(
    parsed.provider,
    parsed.leagueId,
    parsed.season,
    parsed.rosterId,
  );
  const wrapped = await getWrapped(
    parsed.provider,
    parsed.leagueId,
    parsed.season,
    parsed.rosterId,
  );
  if (!wrapped) {
    await captureServerEvent("wrapped_not_found", distinctId, { reason: "wrapped_missing" });
    notFound();
  }

  // The layouts need the league-wide numbers the engine reasoned over, which
  // the cached CardScript doesn't carry. Only this page pays for it — the OG
  // image and metadata read the script alone.
  const facts = await loadSeasonFacts(wrapped.leagueDbId);
  if (!facts) {
    await captureServerEvent("wrapped_not_found", distinctId, { reason: "facts_missing" });
    notFound();
  }
  const team = facts.teams[parsed.rosterId];
  if (!team) {
    await captureServerEvent("wrapped_not_found", distinctId, { reason: "team_missing" });
    notFound();
  }

  const cards = buildStoryCards(wrapped.script, wrapped.copy, team, facts);

  return (
    <StoryPlayer
      cards={cards}
      managerName={wrapped.team.displayName}
      leagueName={wrapped.league.name}
      season={wrapped.league.season}
      leagueHref={`/l/${parsed.provider}/${parsed.leagueId}/${parsed.season}`}
      leagueId={parsed.leagueId}
      rosterId={parsed.rosterId}
      archetype={wrapped.script.archetype.name}
    />
  );
}
