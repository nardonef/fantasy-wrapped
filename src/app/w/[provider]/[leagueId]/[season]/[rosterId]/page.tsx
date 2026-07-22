import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildStoryCards } from "@/components/story/model";
import { StoryPlayer } from "@/components/story/StoryPlayer";
import type { Provider } from "@/db/schema";
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
  const parsed = parseParams(await params);
  if (!parsed) notFound();
  const wrapped = await getWrapped(
    parsed.provider,
    parsed.leagueId,
    parsed.season,
    parsed.rosterId,
  );
  if (!wrapped) notFound();

  const cards = buildStoryCards(wrapped.script, wrapped.copy);

  return (
    <StoryPlayer
      cards={cards}
      managerName={wrapped.team.displayName}
      leagueName={wrapped.league.name}
      season={wrapped.league.season}
    />
  );
}
