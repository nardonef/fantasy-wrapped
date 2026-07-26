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
    <main className="min-h-dvh px-6 py-14 sm:mx-auto sm:max-w-xl">
      <p className="text-xs tracking-[0.35em] text-chalk-dim uppercase">
        {facts.league.name} · {facts.league.season}
      </p>
      <h1 className="display mt-3 text-[clamp(3rem,14vw,5rem)]">
        The <span className="text-flag">ballot.</span>
      </h1>
      <p className="mt-3 font-mono text-sm text-chalk-dim">
        The awards nobody asked for. Argue amongst yourselves.
      </p>

      <section className="mt-10">
        <ul className="divide-y divide-chalk/10 border-y border-chalk/10">
          {superlatives.map((award) => (
            <li key={award.id} className="py-5">
              <p className="font-mono text-[10px] font-bold tracking-[0.3em] text-flag uppercase">
                {award.label}
              </p>
              <Link
                href={wrappedHref(award.rosterId)}
                className="display mt-1 block text-3xl hover:text-flag"
              >
                {award.winner}
              </Link>
              <p className="mt-1 font-mono text-xs leading-relaxed text-chalk-dim">
                {award.detail}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-14">
        <h2 className="font-mono text-[10px] tracking-[0.3em] text-chalk-dim uppercase">
          Final verdicts · tap yours
        </h2>
        <ul className="mt-3 divide-y divide-chalk/10 border-y border-chalk/10">
          {teams.map((team) => (
            <li key={team.rosterId}>
              <Link
                href={wrappedHref(team.rosterId)}
                className="group flex items-baseline justify-between py-3.5"
              >
                <span className="font-mono text-sm font-bold group-hover:text-flag">
                  {team.displayName}
                </span>
                <span className="display text-lg text-chalk-dim group-hover:text-flag">
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
