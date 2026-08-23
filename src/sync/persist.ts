import { eq, inArray, sql } from "drizzle-orm";
import type { db as Database } from "@/db";
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

const CHUNK_SIZE = 1000;

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Idempotently write one normalized league-season to Postgres.
 * Leagues/teams/players are upserted (stable ids across re-syncs, so
 * wrapped_scripts survive); matchups/player_scores/transactions/draft_picks
 * are replaced wholesale inside the transaction.
 */
export async function persistBundle(
  db: typeof Database,
  bundle: NormalizedLeagueBundle,
): Promise<{ leagueId: string; teamIdByRoster: Map<string, string> }> {
  return db.transaction(async (tx) => {
    const [league] = await tx
      .insert(leagues)
      .values({
        provider: bundle.league.provider,
        providerLeagueId: bundle.league.providerLeagueId,
        season: bundle.league.season,
        name: bundle.league.name,
        totalTeams: bundle.league.totalTeams,
        rosterPositions: bundle.league.rosterPositions,
        scoringSettings: bundle.league.scoringSettings,
        playoffStartWeek: bundle.league.playoffStartWeek,
        playoffTeams: bundle.league.playoffTeams,
        lastScoredWeek: bundle.league.lastScoredWeek,
        previousProviderLeagueId: bundle.league.previousProviderLeagueId,
        syncStatus: "synced",
        syncError: null,
        syncedAt: new Date(),
        raw: bundle.league.raw,
      })
      .onConflictDoUpdate({
        target: [leagues.provider, leagues.providerLeagueId, leagues.season],
        set: {
          name: sql`excluded.name`,
          totalTeams: sql`excluded.total_teams`,
          rosterPositions: sql`excluded.roster_positions`,
          scoringSettings: sql`excluded.scoring_settings`,
          playoffStartWeek: sql`excluded.playoff_start_week`,
          playoffTeams: sql`excluded.playoff_teams`,
          lastScoredWeek: sql`excluded.last_scored_week`,
          previousProviderLeagueId: sql`excluded.previous_provider_league_id`,
          syncStatus: sql`excluded.sync_status`,
          syncError: sql`excluded.sync_error`,
          syncedAt: sql`excluded.synced_at`,
          raw: sql`excluded.raw`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: leagues.id });
    const leagueId = league.id;

    const teamRows = await tx
      .insert(teams)
      .values(
        bundle.teams.map((t) => ({
          leagueId,
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
      )
      .onConflictDoUpdate({
        target: [teams.leagueId, teams.providerRosterId],
        set: {
          providerUserId: sql`excluded.provider_user_id`,
          displayName: sql`excluded.display_name`,
          teamName: sql`excluded.team_name`,
          avatarUrl: sql`excluded.avatar_url`,
          wins: sql`excluded.wins`,
          losses: sql`excluded.losses`,
          ties: sql`excluded.ties`,
          pointsFor: sql`excluded.points_for`,
          pointsAgainst: sql`excluded.points_against`,
          finalRank: sql`excluded.final_rank`,
          playoffSeed: sql`excluded.playoff_seed`,
          raw: sql`excluded.raw`,
        },
      })
      .returning({ id: teams.id, providerRosterId: teams.providerRosterId });
    const teamIdByRoster = new Map(teamRows.map((t) => [t.providerRosterId, t.id]));
    const requireTeamId = (rosterId: string): string => {
      const id = teamIdByRoster.get(rosterId);
      if (!id) throw new Error(`Unknown providerRosterId ${rosterId} in bundle`);
      return id;
    };

    const playerIdByProvider = new Map<string, string>();
    for (const rows of chunk(bundle.players, CHUNK_SIZE)) {
      const inserted = await tx
        .insert(players)
        .values(
          rows.map((p) => ({
            provider: bundle.league.provider,
            providerPlayerId: p.providerPlayerId,
            name: p.name,
            position: p.position,
            nflTeam: p.nflTeam,
          })),
        )
        .onConflictDoUpdate({
          target: [players.provider, players.providerPlayerId],
          set: {
            name: sql`excluded.name`,
            position: sql`excluded.position`,
            nflTeam: sql`excluded.nfl_team`,
          },
        })
        .returning({ id: players.id, providerPlayerId: players.providerPlayerId });
      for (const p of inserted) playerIdByProvider.set(p.providerPlayerId, p.id);
    }
    const requirePlayerId = (providerPlayerId: string): string => {
      const id = playerIdByProvider.get(providerPlayerId);
      if (!id) throw new Error(`Unknown providerPlayerId ${providerPlayerId} in bundle`);
      return id;
    };

    // Replace derived rows wholesale — simplest idempotency, and none of them
    // are referenced by anything that must survive a re-sync.
    await tx.delete(matchups).where(eq(matchups.leagueId, leagueId));
    await tx.delete(playerScores).where(eq(playerScores.leagueId, leagueId));
    await tx.delete(transactions).where(eq(transactions.leagueId, leagueId));
    await tx.delete(draftPicks).where(eq(draftPicks.leagueId, leagueId));

    if (bundle.matchups.length > 0) {
      await tx.insert(matchups).values(
        bundle.matchups.map((m) => ({
          leagueId,
          week: m.week,
          teamAId: requireTeamId(m.teamA),
          teamBId: m.teamB ? requireTeamId(m.teamB) : null,
          teamAScore: m.teamAScore,
          teamBScore: m.teamBScore,
          isPlayoff: m.isPlayoff,
          bracketRound: m.bracketRound,
        })),
      );
    }

    for (const rows of chunk(bundle.playerWeeks, CHUNK_SIZE)) {
      await tx.insert(playerScores).values(
        rows.map((pw) => ({
          leagueId,
          teamId: requireTeamId(pw.providerRosterId),
          playerId: requirePlayerId(pw.providerPlayerId),
          week: pw.week,
          points: pw.points,
          started: pw.started,
          slot: pw.slot,
        })),
      );
    }

    if (bundle.transactions.length > 0) {
      await tx.insert(transactions).values(
        bundle.transactions.map((t) => ({
          leagueId,
          providerTxId: t.providerTxId,
          week: t.week,
          type: t.type,
          rosterIds: t.rosterIds,
          assets: t.assets,
          executedAt: t.executedAt,
        })),
      );
    }

    if (bundle.draftPicks.length > 0) {
      await tx.insert(draftPicks).values(
        bundle.draftPicks.map((p) => ({
          leagueId,
          teamId: p.providerRosterId ? requireTeamId(p.providerRosterId) : null,
          playerId: p.providerPlayerId ? requirePlayerId(p.providerPlayerId) : null,
          round: p.round,
          pickNo: p.pickNo,
          isKeeper: p.isKeeper,
          amount: p.amount,
        })),
      );
    }

    // Teams that vanished from the provider (rare, but leagues shrink) —
    // remove any not present in this bundle.
    const keepRosterIds = bundle.teams.map((t) => t.providerRosterId);
    const staleTeams = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.leagueId, leagueId));
    const keepIds = new Set(keepRosterIds.map((r) => teamIdByRoster.get(r)));
    const staleIds = staleTeams.map((t) => t.id).filter((id) => !keepIds.has(id));
    if (staleIds.length > 0) {
      await tx.delete(teams).where(inArray(teams.id, staleIds));
    }

    return { leagueId, teamIdByRoster };
  });
}
