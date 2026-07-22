import type { CandidateInsight, InsightCategory, SeasonFacts, TeamSeasonFacts } from "../types";

export type InsightModule = {
  id: string;
  category: InsightCategory;
  compute: (facts: SeasonFacts, rosterId: string) => CandidateInsight | null;
};

/** 1-based rank of a roster in one of the precomputed orderings. */
export function rankIn(ordering: string[], rosterId: string): number {
  return ordering.indexOf(rosterId) + 1;
}

export function isLast(ordering: string[], rosterId: string, facts: SeasonFacts): boolean {
  return rankIn(ordering, rosterId) === facts.league.totalTeams;
}

export function team(facts: SeasonFacts, rosterId: string): TeamSeasonFacts {
  const t = facts.teams[rosterId];
  if (!t) throw new Error(`Unknown rosterId ${rosterId}`);
  return t;
}

export function managerName(facts: SeasonFacts, rosterId: string): string {
  return facts.teams[rosterId]?.displayName ?? `Manager ${rosterId}`;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function formatRecord(r: { wins: number; losses: number; ties: number }): string {
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}
