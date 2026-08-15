import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { YAHOO_TOKEN_COOKIE, decryptCookieValue } from "@/lib/yahoo-cookies";
import { createHttpYahooApi } from "@/providers/yahoo/client";
import { yahooUsersSchema } from "@/providers/yahoo/schemas";
import { cleanYahoo } from "@/providers/yahoo/yahoo-json";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const encrypted = request.cookies.get(YAHOO_TOKEN_COOKIE)?.value;
  const token = encrypted ? decryptCookieValue(encrypted) : null;
  if (!token) {
    return NextResponse.json({ error: "Your Yahoo session expired — sign in again." }, { status: 401 });
  }

  try {
    const api = createHttpYahooApi(token);
    const raw = await api.getUserLeagues();
    const cleaned = cleanYahoo(raw) as { fantasy_content?: { users?: unknown } };
    const users = yahooUsersSchema.parse(cleaned.fantasy_content?.users ?? []);
    const user = users[0];
    if (!user) throw new Error("Yahoo returned no logged-in user");

    const leagues = (user.games ?? []).flatMap((game) => game.leagues ?? []);
    return NextResponse.json({
      guid: user.guid,
      leagues: leagues.map((l) => ({
        leagueKey: l.league_key,
        name: l.name,
        season: Number(l.season),
        teams: Number(l.num_teams),
      })),
    });
  } catch (error) {
    console.error("Yahoo league lookup failed", error);
    return NextResponse.json({ error: "Could not load your Yahoo leagues." }, { status: 502 });
  }
}
