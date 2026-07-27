import type { CandidateInsight } from "../types";
import { clamp, formatRecord, type InsightModule, rankIn, round1, team } from "./helpers";

export const regretInsights: InsightModule[] = [
  {
    id: "bench-points-total",
    category: "regret",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const rank = rankIn(facts.rankings.benchRegret, rosterId);
      const total = round1(t.benchRegretTotal);
      const perWeek = round1(
        t.benchRegretTotal / Math.max(1, facts.league.regularSeasonWeeks.length),
      );
      let notability: number;
      if (rank === 1) notability = clamp(72 + (total - 150) / 10, 72, 92);
      else if (rank === 2 && total > 130) notability = 55;
      else if (total > 180) notability = 50;
      else return null;
      return {
        id: this.id,
        category: "regret",
        // Not `optimal-lineup`: "you wasted N points" is a different claim from
        // "your record should have been X". flippable-losses and
        // record-if-optimal are the same counterfactual twice and still dedupe
        // against each other; this one stands on its own.
        topic: "bench-waste",
        notability,
        headline:
          rank === 1
            ? `${total} points died on your bench this season (${perWeek}/week), most in the league`
            : `${total} points died on your bench this season (${perWeek}/week)`,
        facts: { totalBenchPoints: total, perWeek, leagueRank: rank },
      };
    },
  },
  {
    id: "flippable-losses",
    category: "regret",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const count = t.flippableLosses.length;
      if (count === 0) return null;
      const weeks = t.flippableLosses.map((w) => w.week);
      const missedPlayoffs = !t.playoffs.made;
      let notability: number;
      if (count >= 3) notability = clamp(78 + 5 * (count - 3), 78, 95);
      else if (count === 2) notability = 64;
      else notability = missedPlayoffs ? 55 : 42;
      return {
        id: this.id,
        category: "regret",
        topic: "optimal-lineup",
        notability,
        headline: `${count} of your losses were already wins — if you'd started the right players. Weeks ${weeks.join(", ")}.`,
        facts: {
          flippableLosses: count,
          weeks: weeks.join(", "),
          missedPlayoffs,
          actualRecord: formatRecord(t.record),
        },
      };
    },
  },
  {
    id: "record-if-optimal",
    category: "regret",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const deltaWins = t.optimalRecord.wins - t.record.wins;
      if (deltaWins < 2) return null;
      const notability = deltaWins >= 4 ? 74 : deltaWins === 3 ? 58 : 44;
      return {
        id: this.id,
        category: "regret",
        topic: "optimal-lineup",
        notability,
        headline: `You went ${formatRecord(t.record)}. With perfect lineups you go ${formatRecord(t.optimalRecord)}.`,
        facts: {
          actualRecord: formatRecord(t.record),
          optimalRecord: formatRecord(t.optimalRecord),
          winsLeftOnBench: deltaWins,
        },
      };
    },
  },
  {
    id: "worst-benching",
    category: "regret",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const swap = t.bestSwapOfSeason;
      if (!swap) return null;
      const gain = round1(swap.gain);
      const week = t.weeks.find((w) => w.week === swap.week);
      const flippedGame =
        week?.result === "L" && week.margin != null && Math.abs(week.margin) < swap.gain;
      let notability: number;
      if (gain >= 30) notability = clamp(70 + (gain - 30) / 2, 70, 88);
      else if (gain >= 20) notability = 58;
      else if (gain >= 12) notability = 40;
      else return null;
      if (flippedGame) notability = clamp(notability + 12, 0, 96);
      return {
        id: this.id,
        category: "regret",
        notability,
        headline: `Week ${swap.week}: you benched ${swap.benched.name} (${round1(swap.benchedPoints)}) and started ${swap.started.name} (${round1(swap.startedPoints)})${flippedGame ? " — it cost you the game" : ""}`,
        facts: {
          week: swap.week,
          benchedPlayer: swap.benched.name,
          benchedPoints: round1(swap.benchedPoints),
          startedPlayer: swap.started.name,
          startedPoints: round1(swap.startedPoints),
          pointsLeftBehind: gain,
          costTheGame: flippedGame ?? false,
        },
        refs: { started: swap.started, benched: swap.benched },
      };
    },
  },
  {
    id: "dropped-league-winner",
    category: "regret",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      // Streaming defenses and kickers is normal management, not regret.
      const skillDrops = t.drops.filter(
        (d) => d.player.position && !["DEF", "K"].includes(d.player.position),
      );
      const worst = [...skillDrops].sort((a, b) => b.pointsAfterDrop - a.pointsAfterDrop)[0];
      if (!worst || worst.pointsAfterDrop < 100) return null;
      const pts = round1(worst.pointsAfterDrop);
      const notability = pts >= 130 ? clamp(66 + (pts - 130) / 8, 66, 88) : 50;
      return {
        id: this.id,
        category: "regret",
        notability,
        headline: `You dropped ${worst.player.name} in week ${worst.week}. ${pts} points after that.`,
        facts: {
          player: worst.player.name,
          droppedWeek: worst.week,
          pointsAfterDrop: pts,
        },
        refs: { player: worst.player },
      };
    },
  },
  {
    id: "zero-hero",
    category: "regret",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      // Started someone who put up a goose egg (or negative) in a game lost by
      // less than a bench player would have provided.
      let worst: { week: number; player: string; points: number; margin: number } | null = null;
      for (const w of t.weeks) {
        if (w.result !== "L" || w.margin == null || !w.bestSwap) continue;
        if (w.bestSwap.startedPoints <= 0 && Math.abs(w.margin) < w.bestSwap.gain) {
          if (!worst || Math.abs(w.margin) < Math.abs(worst.margin)) {
            worst = {
              week: w.week,
              player: w.bestSwap.started.name,
              points: round1(w.bestSwap.startedPoints),
              margin: round1(Math.abs(w.margin)),
            };
          }
        }
      }
      if (!worst) return null;
      return {
        id: this.id,
        category: "regret",
        notability: 68,
        headline: `Week ${worst.week}: you started ${worst.player} (${worst.points} pts) and lost by ${worst.margin}`,
        facts: {
          week: worst.week,
          player: worst.player,
          playerPoints: worst.points,
          lossMargin: worst.margin,
        },
      };
    },
  },
];
