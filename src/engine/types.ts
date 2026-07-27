export type PlayerRef = {
  providerPlayerId: string;
  name: string;
  position: string | null;
};

export type SwapRef = {
  benched: PlayerRef;
  benchedPoints: number;
  started: PlayerRef;
  startedPoints: number;
  gain: number;
};

export type TeamWeekFacts = {
  week: number;
  isPlayoff: boolean;
  bracketRound: string | null;
  score: number;
  opponentRosterId: string | null;
  opponentScore: number | null;
  result: "W" | "L" | "T" | null;
  margin: number | null;
  /** 1 = highest score in the league this week (regular season ranks only). */
  weeklyRank: number | null;
  allPlayWins: number | null;
  allPlayLosses: number | null;
  starterPoints: number;
  optimalPoints: number;
  benchRegret: number;
  /** Best single start/sit swap this week, if any bench player beat a starter. */
  bestSwap: SwapRef | null;
  /** Would the optimal lineup have won a game the actual lineup lost? */
  flippableLoss: boolean;
};

export type TeamPlayerSeason = {
  player: PlayerRef;
  startedPoints: number;
  startedWeeks: number;
  benchPoints: number;
  benchWeeks: number;
};

export type TradeFacts = {
  week: number;
  partnerRosterIds: string[];
  gained: { player: PlayerRef; restOfSeasonPoints: number }[];
  lost: { player: PlayerRef; restOfSeasonPoints: number }[];
  /** gained − lost rest-of-season points (positive = you won the trade). */
  delta: number;
};

export type PickupFacts = {
  week: number;
  player: PlayerRef;
  faab: number | null;
  restOfSeasonStartedPoints: number;
  restOfSeasonPoints: number;
};

export type DropFacts = {
  week: number;
  player: PlayerRef;
  /** Points the player scored league-wide after the drop. */
  pointsAfterDrop: number;
};

export type DraftPickFacts = {
  round: number;
  pickNo: number;
  amount: number | null;
  isKeeper: boolean;
  player: PlayerRef;
  /** Points scored for the drafting team (any slot). */
  pointsForTeam: number;
  startedPointsForTeam: number;
};

export type StreakFacts = {
  length: number;
  fromWeek: number;
  toWeek: number;
} | null;

export type TeamSeasonFacts = {
  rosterId: string;
  displayName: string;
  teamName: string | null;
  avatarUrl: string | null;
  finalRank: number | null;
  /** Regular season, computed from matchups. */
  record: { wins: number; losses: number; ties: number };
  pointsFor: number;
  pointsAgainst: number;
  /** Rank by regular-season points scored, 1 = most. */
  pointsForRank: number;
  pointsAgainstRank: number;
  standingsRank: number;
  weeks: TeamWeekFacts[];
  avgScore: number;
  stdevScore: number;
  highWeek: TeamWeekFacts;
  lowWeek: TeamWeekFacts;
  allPlay: { wins: number; losses: number; winPct: number };
  /** actual win% − all-play win% (positive = lucky). */
  luckDelta: number;
  /** Wins expected from all-play record over the same number of games. */
  expectedWins: number;
  closeGames: { wins: number; losses: number; threshold: number };
  weeklyCrowns: number;
  weeklyStinkers: number;
  /** Times an opponent posted their personal season high against you. */
  opponentSeasonHighs: { week: number; opponentRosterId: string; score: number }[];
  longestWinStreak: StreakFacts;
  longestLossStreak: StreakFacts;
  h2h: Record<
    string,
    { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number }
  >;
  benchRegretTotal: number;
  optimalRecord: { wins: number; losses: number; ties: number };
  flippableLosses: TeamWeekFacts[];
  bestSwapOfSeason: (SwapRef & { week: number }) | null;
  players: TeamPlayerSeason[];
  mvp: (TeamPlayerSeason & { shareOfStartedPoints: number }) | null;
  trades: TradeFacts[];
  pickups: PickupFacts[];
  drops: DropFacts[];
  draftPicks: DraftPickFacts[];
  faabSpent: number;
  transactionCounts: { trades: number; waivers: number; freeAgents: number; total: number };
  playoffs: {
    made: boolean;
    exitRound: string | null;
    champion: boolean;
    runnerUp: boolean;
  };
};

export type LeagueFacts = {
  name: string;
  season: number;
  totalTeams: number;
  regularSeasonWeeks: number[];
  playoffWeeks: number[];
  medianScore: number;
};

export type SeasonFacts = {
  league: LeagueFacts;
  teams: Record<string, TeamSeasonFacts>;
  /** rosterIds ordered by a stat, best first — for percentile/rank lookups. */
  rankings: {
    pointsFor: string[];
    benchRegret: string[];
    luck: string[];
    volatility: string[];
    transactionVolume: string[];
    faabSpent: string[];
    allPlayWinPct: string[];
  };
};

export type InsightCategory = "regret" | "luck" | "people" | "narrative" | "identity";

export type CandidateInsight = {
  id: string;
  category: InsightCategory;
  /** Insights sharing a topic overlap; the selector keeps only the best one. */
  topic?: string;
  /** 0–100. Below ~35 never ships; the selector cuts hard. */
  notability: number;
  /** Working headline for evals — NOT final user copy. */
  headline: string;
  /** Exact numbers/names the copy layer must preserve verbatim. */
  facts: Record<string, string | number | boolean | null>;
  /**
   * The players this card is about, for the UI only — headshots, portraits.
   * Deliberately outside `facts`: copy validation requires every number in
   * `facts` to survive into the sentence verbatim, and a player id is not a
   * number the LLM should ever be asked to reproduce.
   */
  refs?: Record<string, PlayerRef>;
};

export type WrappedCard = {
  insightId: string;
  category: InsightCategory;
  headline: string;
  facts: Record<string, string | number | boolean | null>;
  refs?: Record<string, PlayerRef>;
};

export type Archetype = {
  id: string;
  name: string;
  /**
   * The accusation, with the numbers that convict, strongest first — the
   * finale card shows the top three.
   *
   * An ordered array, not a Record, because scripts are cached as jsonb and
   * Postgres normalises object keys by (length, bytes). A Record round-trips
   * with its order scrambled, which silently reorders the evidence rows and
   * changes which ones make the cut.
   */
  evidence: { key: string; value: string | number }[];
};

export type CardScript = {
  engineVersion: string;
  leagueName: string;
  season: number;
  rosterId: string;
  managerName: string;
  teamName: string | null;
  cards: WrappedCard[];
  archetype: Archetype;
};
