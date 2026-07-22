import type { TransactionAssets, TransactionType } from "@/db/schema";
import type {
  NormalizedDraftPick,
  NormalizedLeagueBundle,
  NormalizedMatchup,
  NormalizedPlayer,
  NormalizedPlayerWeek,
  NormalizedTeam,
  NormalizedTransaction,
} from "@/providers/types";
import {
  type SleeperBracketMatch,
  type SleeperMatchup,
  sleeperBracketSchema,
  sleeperDraftPicksSchema,
  sleeperDraftsSchema,
  sleeperLeagueSchema,
  sleeperMatchupsSchema,
  sleeperPlayersSchema,
  sleeperRostersSchema,
  sleeperTransactionsSchema,
  sleeperUsersSchema,
} from "./schemas";

/** Everything fetched for one league-season, still provider-shaped. */
export type SleeperLeaguePayloads = {
  league: unknown;
  users: unknown;
  rosters: unknown;
  matchupsByWeek: Record<number, unknown>;
  transactionsByRound: Record<number, unknown>;
  winnersBracket: unknown;
  losersBracket: unknown;
  drafts: unknown;
  draftPicksByDraft: Record<string, unknown>;
  players: unknown;
};

const NON_STARTING_SLOTS = new Set(["BN", "IR", "TAXI"]);
/** Sleeper marks an empty starter slot with the string "0". */
const EMPTY_STARTER = "0";

const pairKey = (week: number, a: number, b: number) =>
  `${week}:${Math.min(a, b)}-${Math.max(a, b)}`;

function labelWinnersRound(match: SleeperBracketMatch, maxRound: number): string {
  if (match.p === 1) return "championship";
  if (match.p === 3) return "third_place";
  if (match.p != null) return "placement";
  if (match.r === maxRound - 1) return "semifinal";
  if (match.r === maxRound - 2) return "quarterfinal";
  return "playoff";
}

function bracketFinalRanks(
  winners: SleeperBracketMatch[],
  losers: SleeperBracketMatch[],
  playoffTeams: number | null,
): Map<number, number> {
  const ranks = new Map<number, number>();
  for (const match of winners) {
    if (match.p != null && match.w != null && match.l != null) {
      ranks.set(match.w, match.p);
      ranks.set(match.l, match.p + 1);
    }
  }
  const offset = playoffTeams ?? 0;
  if (offset > 0) {
    for (const match of losers) {
      if (match.p != null && match.w != null && match.l != null) {
        ranks.set(match.w, offset + match.p);
        ranks.set(match.l, offset + match.p + 1);
      }
    }
  }
  return ranks;
}

function normalizeTransactionType(type: string): TransactionType {
  if (type === "trade" || type === "waiver" || type === "free_agent") return type;
  return "commissioner";
}

export function normalizeSleeperLeague(payloads: SleeperLeaguePayloads): NormalizedLeagueBundle {
  const league = sleeperLeagueSchema.parse(payloads.league);
  const users = sleeperUsersSchema.parse(payloads.users);
  const rosters = sleeperRostersSchema.parse(payloads.rosters);
  const winnersBracket = sleeperBracketSchema.parse(payloads.winnersBracket ?? []);
  const losersBracket = sleeperBracketSchema.parse(payloads.losersBracket ?? []);
  const playersDump = sleeperPlayersSchema.parse(payloads.players ?? {});

  const weekNumbers = Object.keys(payloads.matchupsByWeek)
    .map(Number)
    .sort((a, b) => a - b);
  const lastScoredWeek =
    league.settings.last_scored_leg ?? league.settings.leg ?? weekNumbers.at(-1) ?? null;
  const playoffStartWeek = league.settings.playoff_week_start || null;
  const playoffTeams = league.settings.playoff_teams ?? null;

  const usersById = new Map(users.map((u) => [u.user_id, u]));

  const teams: NormalizedTeam[] = rosters.map((roster) => {
    const owner = roster.owner_id ? usersById.get(roster.owner_id) : undefined;
    const s = roster.settings ?? {};
    return {
      providerRosterId: String(roster.roster_id),
      providerUserId: roster.owner_id ?? null,
      displayName: owner?.display_name ?? `Manager ${roster.roster_id}`,
      teamName: owner?.metadata?.team_name ?? null,
      avatarUrl: owner?.avatar ? `https://sleepercdn.com/avatars/thumbs/${owner.avatar}` : null,
      wins: s.wins ?? 0,
      losses: s.losses ?? 0,
      ties: s.ties ?? 0,
      pointsFor: (s.fpts ?? 0) + (s.fpts_decimal ?? 0) / 100,
      pointsAgainst: (s.fpts_against ?? 0) + (s.fpts_against_decimal ?? 0) / 100,
      finalRank: null,
      playoffSeed: null,
      raw: roster,
    };
  });

  const finalRanks = bracketFinalRanks(winnersBracket, losersBracket, playoffTeams);
  for (const team of teams) {
    const rank = finalRanks.get(Number(team.providerRosterId));
    if (rank != null) team.finalRank = rank;
  }

  // Map playoff pairings to bracket round labels. Bracket round r is played in
  // week playoffStartWeek + r - 1 (winners and losers brackets share rounds).
  const bracketRoundByPair = new Map<string, string>();
  if (playoffStartWeek) {
    const maxRound = Math.max(0, ...winnersBracket.map((m) => m.r));
    for (const match of winnersBracket) {
      if (typeof match.t1 === "number" && typeof match.t2 === "number") {
        const week = playoffStartWeek + match.r - 1;
        bracketRoundByPair.set(
          pairKey(week, match.t1, match.t2),
          labelWinnersRound(match, maxRound),
        );
      }
    }
    for (const match of losersBracket) {
      if (typeof match.t1 === "number" && typeof match.t2 === "number") {
        const week = playoffStartWeek + match.r - 1;
        bracketRoundByPair.set(pairKey(week, match.t1, match.t2), "consolation");
      }
    }
  }

  const startingSlots = league.roster_positions.filter((p) => !NON_STARTING_SLOTS.has(p));

  const matchups: NormalizedMatchup[] = [];
  const playerWeeks: NormalizedPlayerWeek[] = [];
  const referencedPlayerIds = new Set<string>();

  for (const week of weekNumbers) {
    if (lastScoredWeek != null && week > lastScoredWeek) continue;
    const weekMatchups = sleeperMatchupsSchema.parse(payloads.matchupsByWeek[week]);
    const isPlayoff = playoffStartWeek != null && week >= playoffStartWeek;

    const byMatchupId = new Map<number, SleeperMatchup[]>();
    for (const entry of weekMatchups) {
      // Player-week rows (starters + bench) for every roster, paired or not.
      const starterSlot = new Map<string, string>();
      (entry.starters ?? []).forEach((playerId, i) => {
        if (playerId !== EMPTY_STARTER) starterSlot.set(playerId, startingSlots[i] ?? "FLEX");
      });
      const points = entry.players_points ?? {};
      for (const playerId of entry.players ?? []) {
        referencedPlayerIds.add(playerId);
        playerWeeks.push({
          providerRosterId: String(entry.roster_id),
          week,
          providerPlayerId: playerId,
          points: points[playerId] ?? 0,
          started: starterSlot.has(playerId),
          slot: starterSlot.get(playerId) ?? "BN",
        });
      }

      if (entry.matchup_id == null) {
        matchups.push({
          week,
          teamA: String(entry.roster_id),
          teamB: null,
          teamAScore: entry.points ?? 0,
          teamBScore: null,
          isPlayoff,
          bracketRound: null,
        });
      } else {
        const group = byMatchupId.get(entry.matchup_id) ?? [];
        group.push(entry);
        byMatchupId.set(entry.matchup_id, group);
      }
    }

    for (const group of byMatchupId.values()) {
      group.sort((a, b) => a.roster_id - b.roster_id);
      const [a, b] = group;
      matchups.push({
        week,
        teamA: String(a.roster_id),
        teamB: b ? String(b.roster_id) : null,
        teamAScore: a.points ?? 0,
        teamBScore: b ? (b.points ?? 0) : null,
        isPlayoff,
        bracketRound: b
          ? (bracketRoundByPair.get(pairKey(week, a.roster_id, b.roster_id)) ?? null)
          : null,
      });
    }
  }

  const transactions: NormalizedTransaction[] = [];
  for (const round of Object.keys(payloads.transactionsByRound).map(Number)) {
    const roundTxs = sleeperTransactionsSchema.parse(payloads.transactionsByRound[round]);
    for (const tx of roundTxs) {
      if (tx.status !== "complete") continue;
      const adds: Record<string, string[]> = {};
      const drops: Record<string, string[]> = {};
      for (const [playerId, rosterId] of Object.entries(tx.adds ?? {})) {
        (adds[String(rosterId)] ??= []).push(playerId);
        referencedPlayerIds.add(playerId);
      }
      for (const [playerId, rosterId] of Object.entries(tx.drops ?? {})) {
        (drops[String(rosterId)] ??= []).push(playerId);
        referencedPlayerIds.add(playerId);
      }
      const assets: TransactionAssets = { adds, drops };
      const bid = tx.settings?.waiver_bid;
      if (bid != null && tx.roster_ids?.length) {
        assets.faab = { [String(tx.roster_ids[0])]: bid };
      }
      const movedPicks = (tx.draft_picks ?? []).filter(
        (p) => p.previous_owner_id != null && p.owner_id != null,
      );
      if (movedPicks.length > 0) {
        assets.draftPicks = movedPicks.map((p) => ({
          season: p.season,
          round: p.round,
          fromRosterId: String(p.previous_owner_id),
          toRosterId: String(p.owner_id),
        }));
      }
      transactions.push({
        providerTxId: tx.transaction_id,
        week: tx.leg,
        type: normalizeTransactionType(tx.type),
        rosterIds: (tx.roster_ids ?? []).map(String),
        assets,
        executedAt: tx.status_updated ? new Date(tx.status_updated) : null,
      });
    }
  }

  const drafts = sleeperDraftsSchema.parse(payloads.drafts ?? []);
  const draftPicks: NormalizedDraftPick[] = [];
  for (const draft of drafts) {
    const rawPicks = payloads.draftPicksByDraft[draft.draft_id];
    if (rawPicks == null) continue;
    for (const pick of sleeperDraftPicksSchema.parse(rawPicks)) {
      if (pick.player_id) referencedPlayerIds.add(pick.player_id);
      draftPicks.push({
        round: pick.round,
        pickNo: pick.pick_no,
        providerRosterId: pick.roster_id != null ? String(pick.roster_id) : null,
        providerPlayerId: pick.player_id ?? null,
        isKeeper: pick.is_keeper ?? false,
        amount: pick.metadata?.amount ? Number.parseInt(pick.metadata.amount, 10) : null,
      });
    }
  }

  const players: NormalizedPlayer[] = [...referencedPlayerIds].sort().map((playerId) => {
    const p = playersDump[playerId];
    const name = p?.full_name ?? [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
    return {
      providerPlayerId: playerId,
      name: name || playerId,
      position: p?.position ?? null,
      nflTeam: p?.team ?? null,
    };
  });

  return {
    league: {
      provider: "sleeper",
      providerLeagueId: league.league_id,
      season: Number.parseInt(league.season, 10),
      name: league.name,
      totalTeams: league.total_rosters,
      rosterPositions: league.roster_positions,
      scoringSettings: league.scoring_settings,
      playoffStartWeek,
      playoffTeams,
      lastScoredWeek,
      previousProviderLeagueId: league.previous_league_id ?? null,
      raw: payloads.league,
    },
    teams,
    matchups,
    playerWeeks,
    players,
    transactions,
    draftPicks,
  };
}
