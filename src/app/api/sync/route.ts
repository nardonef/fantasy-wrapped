import { after, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { pruneRateLimitWindows, rateLimit } from "@/lib/rate-limit";
import { createHttpSleeperApi, fetchSleeperLeagueBundle } from "@/providers/sleeper";
import { persistBundle } from "@/sync/persist";
import { resolveYourRosterId } from "@/sync/resolve-roster";
import { warmLeagueCopy } from "@/sync/wrapped";

export const dynamic = "force-dynamic";
// Bumped from 120: the response itself still returns as soon as sync
// finishes (warming runs in `after()`, after the response is sent, and
// doesn't delay it), but the background warm loop for the rest of the
// league — sequential, one Haiku call per team — needs headroom to finish
// within the same invocation for a full-sized league.
export const maxDuration = 300;

const bodySchema = z.object({ leagueId: z.string().min(1), userId: z.string().optional() });
const SYNCS_PER_HOUR = 12;

/**
 * Sync a Sleeper league into Postgres. A full completed season is ~40 public
 * API calls — fast enough to run inline.
 */
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  pruneRateLimitWindows();
  const limit = rateLimit(`sync:${ip}`, SYNCS_PER_HOUR, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many syncs — try again in a few minutes." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

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

    const yourRosterId = resolveYourRosterId(bundle.teams, parsed.data.userId);

    // Runs after the response is sent, so it never delays the client — the
    // point is to overlap this league's copy generation with the "Pulling
    // the tape…" animation and the navigation that follows, rather than pay
    // for it cold when the user (or the next manager to open their own
    // share link) lands on a wrapped page. Excludes the syncing user's own
    // roster: that page is about to be viewed synchronously, which is the
    // faster and already-deduped path (see getWrapped's `cache` wrapper).
    after(() =>
      warmLeagueCopy(
        "sleeper",
        bundle.league.providerLeagueId,
        bundle.league.season,
        yourRosterId ?? undefined,
      ),
    );

    return NextResponse.json({
      provider: "sleeper",
      leagueId: bundle.league.providerLeagueId,
      season: bundle.league.season,
      name: bundle.league.name,
      yourRosterId,
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
