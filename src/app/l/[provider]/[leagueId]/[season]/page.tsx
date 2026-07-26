import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import type { Provider } from "@/db/schema";
import { leagues } from "@/db/schema";
import { classifyLeagueArchetypes, computeSeasonFacts } from "@/engine";
import { computeSuperlatives } from "@/engine/superlatives";
import { loadBundle } from "@/sync/load";

export const dynamic = "force-dynamic";

type Params = { provider: string; leagueId: string; season: string };

async function loadLeaguePage(params: Params) {
  const season = Number.parseInt(params.season, 10);
  if (params.provider !== "sleeper" || Number.isNaN(season)) return null;
  const [league] = await db
    .select()
    .from(leagues)
    .where(
      and(
        eq(leagues.provider, params.provider as Provider),
        eq(leagues.providerLeagueId, params.leagueId),
        eq(leagues.season, season),
      ),
    );
  if (league?.syncStatus !== "synced") return null;
  const bundle = await loadBundle(league.id);
  if (!bundle) return null;
  const facts = computeSeasonFacts(bundle);
  return { league, facts };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const data = await loadLeaguePage(await params);
  if (!data) return {};
  return {
    title: `${data.facts.league.name} — ${data.facts.league.season} Superlatives`,
    description: "The awards nobody asked for. Argue amongst yourselves.",
  };
}

export default async function LeaguePage({ params }: { params: Promise<Params> }) {
  const p = await params;
  const data = await loadLeaguePage(p);
  if (!data) notFound();
  const { facts } = data;

  const superlatives = computeSuperlatives(facts);
  const archetypes = classifyLeagueArchetypes(facts);
  const teams = Object.values(facts.teams).sort((a, b) => a.standingsRank - b.standingsRank);
  const wrappedHref = (rosterId: string) =>
    `/w/${p.provider}/${p.leagueId}/${facts.league.season}/${rosterId}`;

  return (
    <main className="min-h-dvh px-7 py-16 sm:mx-auto sm:max-w-xl">
      <p className="label text-chalk-faint">
        {facts.league.name} · {facts.league.season}
      </p>
      <h1 className="display mt-5 text-[clamp(2.75rem,14vw,3.75rem)]">
        The <span className="text-flag">ballot.</span>
      </h1>
      <p className="mt-4 text-[15px] leading-[1.55] text-chalk-dim">
        The awards nobody asked for. Argue amongst yourselves.
      </p>

      <section className="mt-12">
        <ul className="divide-y divide-chalk/12 border-y border-chalk/12">
          {superlatives.map((award) => (
            <li key={award.id} className="py-6">
              <p className="label text-flag">{award.label}</p>
              <Link
                href={wrappedHref(award.rosterId)}
                className="display mt-2.5 block text-3xl hover:text-flag"
              >
                {award.winner}
              </Link>
              <p className="mt-2 text-[14px] leading-[1.5] text-pretty text-chalk-dim">
                {award.detail}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-16">
        <h2 className="label text-chalk-faint">Final verdicts · tap yours</h2>
        <ul className="mt-3 divide-y divide-chalk/12 border-y border-chalk/12">
          {teams.map((team) => (
            <li key={team.rosterId}>
              <Link
                href={wrappedHref(team.rosterId)}
                className="group flex items-baseline justify-between gap-4 py-4"
              >
                <span className="label shrink-0 text-chalk-faint group-hover:text-flag">
                  {team.displayName}
                </span>
                <span className="display truncate text-right text-lg group-hover:text-flag">
                  {archetypes.get(team.rosterId)?.name}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
