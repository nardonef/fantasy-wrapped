import { NextResponse } from "next/server";
import { z } from "zod";
import { createHttpSleeperApi } from "@/providers/sleeper";

export const dynamic = "force-dynamic";

const userSchema = z.object({ user_id: z.string() }).loose();
const leagueListSchema = z.array(
  z
    .object({
      league_id: z.string(),
      name: z.string(),
      season: z.string(),
      status: z.string(),
      total_rosters: z.number(),
      avatar: z.string().nullish(),
    })
    .loose(),
);

/** Resolve a Sleeper username to their leagues for a season. Public data, no auth. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const username = url.searchParams.get("username")?.trim();
  const season = url.searchParams.get("season") ?? "2025";
  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  const api = createHttpSleeperApi();
  let user: z.infer<typeof userSchema>;
  try {
    user = userSchema.parse(await api.getUser(username));
  } catch {
    return NextResponse.json({ error: `No Sleeper user named “${username}”` }, { status: 404 });
  }

  const leagues = leagueListSchema.parse(
    (await api.getUserLeagues(user.user_id, Number(season))) ?? [],
  );
  return NextResponse.json({
    userId: user.user_id,
    leagues: leagues.map((l) => ({
      leagueId: l.league_id,
      name: l.name,
      season: Number(l.season),
      status: l.status,
      teams: l.total_rosters,
    })),
  });
}
