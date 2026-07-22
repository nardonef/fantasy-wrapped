import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { createHttpSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";
import { persistBundle } from "@/sync/persist";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({ leagueId: z.string().min(1) });

/**
 * Sync a Sleeper league into Postgres. A full completed season is ~40 public
 * API calls — fast enough to run inline.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "leagueId is required" }, { status: 400 });
  }

  try {
    const bundle = await fetchSleeperLeagueBundle(createHttpSleeperApi(), parsed.data.leagueId);
    if (bundle.matchups.length === 0) {
      return NextResponse.json(
        { error: "This league has no scored weeks yet — Wrapped needs a played season." },
        { status: 422 },
      );
    }
    await persistBundle(db, bundle);
    return NextResponse.json({
      provider: "sleeper",
      leagueId: bundle.league.providerLeagueId,
      season: bundle.league.season,
      name: bundle.league.name,
      teams: bundle.teams
        .map((t) => ({
          rosterId: t.providerRosterId,
          displayName: t.displayName,
          teamName: t.teamName,
          avatarUrl: t.avatarUrl,
          record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`,
        }))
        .sort((a, b) => Number(a.rosterId) - Number(b.rosterId)),
    });
  } catch (error) {
    console.error("sync failed", error);
    return NextResponse.json(
      { error: "Could not sync that league from Sleeper. Check the league ID and try again." },
      { status: 502 },
    );
  }
}
