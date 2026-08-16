import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { YAHOO_TOKEN_COOKIE, decryptCookieValue } from "@/lib/yahoo-cookies";
import { pruneRateLimitWindows, rateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { createHttpYahooApi, fetchYahooLeagueBundle } from "@/providers/yahoo";
import { persistBundle } from "@/sync/persist";
import { resolveYourRosterId } from "@/sync/resolve-roster";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({ leagueKey: z.string().min(1), guid: z.string().optional() });
const SYNCS_PER_HOUR = 12;

/** Sync a Yahoo league into Postgres. The OAuth token identifies the caller directly (no
 * separate userId param, unlike Sleeper) — the picker passes the guid discovered alongside
 * the league list back through so the caller's own roster can be resolved. */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  pruneRateLimitWindows();
  const limit = rateLimit(`sync:${ip}`, SYNCS_PER_HOUR, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many syncs — try again in a few minutes." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  const encrypted = request.cookies.get(YAHOO_TOKEN_COOKIE)?.value;
  const token = encrypted ? decryptCookieValue(encrypted) : null;
  if (!token) {
    return NextResponse.json({ error: "Your Yahoo session expired — sign in again." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "leagueKey is required" }, { status: 400 });
  }

  try {
    const bundle = await fetchYahooLeagueBundle(createHttpYahooApi(token), parsed.data.leagueKey);
    if (bundle.matchups.length === 0) {
      // The token was already used above — clear it here too, same as every
      // other exit path past the auth check, so a retry can't replay it.
      const response = NextResponse.json(
        { error: "This league has no scored weeks yet — Wrapped needs a played season." },
        { status: 422 },
      );
      response.cookies.delete(YAHOO_TOKEN_COOKIE);
      return response;
    }
    await persistBundle(db, bundle);

    const yourRosterId = resolveYourRosterId(bundle.teams, parsed.data.guid);

    const response = NextResponse.json({
      provider: "yahoo",
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
    response.cookies.delete(YAHOO_TOKEN_COOKIE);
    return response;
  } catch (error) {
    console.error("yahoo sync failed", error);
    const response = NextResponse.json(
      { error: "Could not sync that league from Yahoo. Try connecting again." },
      { status: 502 },
    );
    response.cookies.delete(YAHOO_TOKEN_COOKIE);
    return response;
  }
}
