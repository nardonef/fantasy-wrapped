import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  draftPicks,
  leagues,
  matchups,
  playerScores,
  players,
  teams,
  transactions,
} from "@/db/schema";
import type { NormalizedLeagueBundle } from "@/providers/types";

/**
 * Reconstruct the NormalizedLeagueBundle for a synced league from Postgres —
 * the inverse of persistBundle. The engine only ever consumes bundles, so
 * live sync and DB replay produce identical Wrapped output.
 */
export async function loadBundle(leagueDbId: string): Promise<NormalizedLeagueBundle | null> {
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueDbId));
  if (!league) return null;

  const teamRows = await db.select().from(teams).where(eq(teams.leagueId, leagueDbId));
  const teamById = new Map(teamRows.map((t) => [t.id, t]));

  const matchupRows = await db
    .select()
    .from(matchups)
    .where(eq(matchups.leagueId, leagueDbId))
    .orderBy(asc(matchups.week));

  const scoreRows = await db
    .select()
    .from(playerScores)
    .where(eq(playerScores.leagueId, leagueDbId));

  const playerIds = [...new Set(scoreRows.map((s) => s.playerId))];
  const draftRows = await db.select().from(draftPicks).where(eq(draftPicks.leagueId, leagueDbId));
  for (const d of draftRows) if (d.playerId) playerIds.push(d.playerId);
  const playerRows = playerIds.length
    ? await db
        .select()
        .from(players)
        .where(inArray(players.id, [...new Set(playerIds)]))
    : [];
  const playerById = new Map(playerRows.map((p) => [p.id, p]));

  const txRows = await db.select().from(transactions).where(eq(transactions.leagueId, leagueDbId));

  const rosterIdOf = (teamId: string): string => teamById.get(teamId)?.providerRosterId ?? teamId;

  return {
    league: {
      provider: league.provider,
      providerLeagueId: league.providerLeagueId,
      season: league.season,
      name: league.name,
      totalTeams: league.totalTeams,
      rosterPositions: league.rosterPositions,
      scoringSettings: league.scoringSettings,
      playoffStartWeek: league.playoffStartWeek,
      playoffTeams: league.playoffTeams,
      lastScoredWeek: league.lastScoredWeek,
      previousProviderLeagueId: league.previousProviderLeagueId,
      raw: league.raw,
    },
    teams: teamRows.map((t) => ({
      providerRosterId: t.providerRosterId,
      providerUserId: t.providerUserId,
      displayName: t.displayName,
      teamName: t.teamName,
      avatarUrl: t.avatarUrl,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pointsFor: t.pointsFor,
      pointsAgainst: t.pointsAgainst,
      finalRank: t.finalRank,
      playoffSeed: t.playoffSeed,
      raw: t.raw,
    })),
    matchups: matchupRows.map((m) => ({
      week: m.week,
      teamA: rosterIdOf(m.teamAId),
      teamB: m.teamBId ? rosterIdOf(m.teamBId) : null,
      teamAScore: m.teamAScore,
      teamBScore: m.teamBScore,
      isPlayoff: m.isPlayoff,
      bracketRound: m.bracketRound,
    })),
    playerWeeks: scoreRows.map((s) => ({
      providerRosterId: rosterIdOf(s.teamId),
      week: s.week,
      providerPlayerId: playerById.get(s.playerId)?.providerPlayerId ?? s.playerId,
      points: s.points,
      started: s.started,
      slot: s.slot,
    })),
    players: playerRows.map((p) => ({
      providerPlayerId: p.providerPlayerId,
      name: p.name,
      position: p.position,
      nflTeam: p.nflTeam,
    })),
    transactions: txRows.map((t) => ({
      providerTxId: t.providerTxId,
      week: t.week,
      type: t.type,
      rosterIds: t.rosterIds,
      assets: t.assets,
      executedAt: t.executedAt,
    })),
    draftPicks: draftRows.map((d) => ({
      round: d.round,
      pickNo: d.pickNo,
      providerRosterId: d.teamId ? rosterIdOf(d.teamId) : null,
      providerPlayerId: d.playerId ? (playerById.get(d.playerId)?.providerPlayerId ?? null) : null,
      isKeeper: d.isKeeper,
      amount: d.amount,
    })),
  };
}
