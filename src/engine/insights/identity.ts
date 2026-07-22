import type { CandidateInsight } from "../types";
import { clamp, type InsightModule, isLast, rankIn, round1, team } from "./helpers";

export const identityInsights: InsightModule[] = [
  {
    id: "transaction-extreme",
    category: "identity",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const total = t.transactionCounts.total;
      const counts = Object.values(facts.teams)
        .map((x) => x.transactionCounts.total)
        .sort((a, b) => a - b);
      const medianMoves = counts[Math.floor(counts.length / 2)];
      if (rankIn(facts.rankings.transactionVolume, rosterId) === 1 && total >= medianMoves * 2) {
        return {
          id: this.id,
          category: "identity",
          topic: "activity",
          notability: clamp(52 + (total - medianMoves * 2) / 2, 52, 78),
          headline: `${total} roster moves — most in the league (median was ${medianMoves})`,
          facts: {
            totalMoves: total,
            leagueMedian: medianMoves,
            waivers: t.transactionCounts.waivers,
            freeAgents: t.transactionCounts.freeAgents,
            trades: t.transactionCounts.trades,
          },
        };
      }
      if (isLast(facts.rankings.transactionVolume, rosterId, facts) && total <= 5) {
        return {
          id: this.id,
          category: "identity",
          topic: "activity",
          notability: 58,
          headline: `${total} roster moves all season. You drafted a team and walked away.`,
          facts: { totalMoves: total, leagueMedian: medianMoves },
        };
      }
      return null;
    },
  },
  {
    id: "faab-story",
    category: "identity",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const spends = Object.values(facts.teams).map((x) => x.faabSpent);
      const maxSpend = Math.max(...spends);
      if (maxSpend === 0) return null;
      if (t.faabSpent === maxSpend && rankIn(facts.rankings.faabSpent, rosterId) === 1) {
        const best = [...t.pickups]
          .filter((p) => (p.faab ?? 0) > 0)
          .sort((a, b) => (b.faab ?? 0) - (a.faab ?? 0))[0];
        return {
          id: this.id,
          category: "identity",
          topic: "activity",
          notability: 48,
          headline: `$${t.faabSpent} of FAAB spent — league high${best ? `, topped by $${best.faab} on ${best.player.name}` : ""}`,
          facts: {
            faabSpent: t.faabSpent,
            biggestBid: best?.faab ?? null,
            biggestBidPlayer: best?.player.name ?? null,
          },
        };
      }
      return null;
    },
  },
  {
    id: "volatility",
    category: "identity",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const sd = round1(t.stdevScore);
      if (rankIn(facts.rankings.volatility, rosterId) === 1) {
        return {
          id: this.id,
          category: "identity",
          topic: "variance",
          notability: 50,
          headline: `Most volatile team in the league: ${round1(t.highWeek.score)} one week, ${round1(t.lowWeek.score)} another`,
          facts: {
            stdev: sd,
            highScore: round1(t.highWeek.score),
            lowScore: round1(t.lowWeek.score),
          },
        };
      }
      if (isLast(facts.rankings.volatility, rosterId, facts)) {
        return {
          id: this.id,
          category: "identity",
          topic: "variance",
          notability: 42,
          headline: `Steadiest team in the league — same score every week, for better or worse`,
          facts: { stdev: sd, averageScore: round1(t.avgScore) },
        };
      }
      return null;
    },
  },
  {
    id: "crowns-and-stinkers",
    category: "identity",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const crowns = t.weeklyCrowns;
      const stinkers = t.weeklyStinkers;
      if (crowns >= 2 && stinkers >= 2) {
        return {
          id: this.id,
          category: "identity",
          topic: "variance",
          notability: 64,
          headline: `${crowns} weeks as the league's top score. ${stinkers} weeks as its worst. No in-between.`,
          facts: { topScoreWeeks: crowns, worstScoreWeeks: stinkers },
        };
      }
      if (crowns >= 3) {
        return {
          id: this.id,
          category: "identity",
          notability: 56,
          headline: `${crowns} weeks with the best score in the league`,
          facts: { topScoreWeeks: crowns },
        };
      }
      if (stinkers >= 3) {
        return {
          id: this.id,
          category: "identity",
          notability: 60,
          headline: `${stinkers} weeks with the worst score in the league`,
          facts: { worstScoreWeeks: stinkers },
        };
      }
      return null;
    },
  },
  {
    id: "points-machine",
    category: "identity",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const pf = round1(t.pointsFor);
      if (t.pointsForRank === 1 && !t.playoffs.champion) {
        return {
          id: this.id,
          category: "identity",
          topic: "points-vs-outcome",
          notability: 58,
          headline: `${pf} points — the most in the league. Rings given for it: zero.`,
          facts: { pointsFor: pf, leagueRank: 1, champion: false },
        };
      }
      if (isLast(facts.rankings.pointsFor, rosterId, facts)) {
        return {
          id: this.id,
          category: "identity",
          topic: "points-vs-outcome",
          notability: 60,
          headline: `${pf} points scored — fewest in the league`,
          facts: { pointsFor: pf, leagueRank: facts.league.totalTeams },
        };
      }
      return null;
    },
  },
];
