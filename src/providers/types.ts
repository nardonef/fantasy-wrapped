import type { Provider, TransactionAssets, TransactionType } from "@/db/schema";

/**
 * Provider-agnostic representation of one league-season, fully hydrated.
 * Adapters are the only code that sees provider-shaped data; everything
 * downstream (persistence, insight engine) consumes this.
 */
export type NormalizedLeagueBundle = {
  league: {
    provider: Provider;
    providerLeagueId: string;
    season: number;
    name: string;
    totalTeams: number;
    rosterPositions: string[];
    scoringSettings: Record<string, number>;
    playoffStartWeek: number | null;
    playoffTeams: number | null;
    lastScoredWeek: number | null;
    previousProviderLeagueId: string | null;
    raw: unknown;
  };
  teams: NormalizedTeam[];
  matchups: NormalizedMatchup[];
  playerWeeks: NormalizedPlayerWeek[];
  players: NormalizedPlayer[];
  transactions: NormalizedTransaction[];
  draftPicks: NormalizedDraftPick[];
};

export type NormalizedTeam = {
  providerRosterId: string;
  providerUserId: string | null;
  displayName: string;
  teamName: string | null;
  avatarUrl: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  finalRank: number | null;
  playoffSeed: number | null;
  raw: unknown;
};

export type NormalizedMatchup = {
  week: number;
  /** providerRosterId; teamA has the lower id for stable pairing. */
  teamA: string;
  teamB: string | null;
  teamAScore: number;
  teamBScore: number | null;
  isPlayoff: boolean;
  bracketRound: string | null;
};

export type NormalizedPlayerWeek = {
  providerRosterId: string;
  week: number;
  providerPlayerId: string;
  points: number;
  started: boolean;
  slot: string | null;
};

export type NormalizedPlayer = {
  providerPlayerId: string;
  name: string;
  position: string | null;
  nflTeam: string | null;
};

export type NormalizedTransaction = {
  providerTxId: string;
  week: number;
  type: TransactionType;
  rosterIds: string[];
  assets: TransactionAssets;
  executedAt: Date | null;
};

export type NormalizedDraftPick = {
  round: number;
  pickNo: number;
  providerRosterId: string | null;
  providerPlayerId: string | null;
  isKeeper: boolean;
  amount: number | null;
};
