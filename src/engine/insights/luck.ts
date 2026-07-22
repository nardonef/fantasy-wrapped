import type { CandidateInsight } from "../types";
import {
  clamp,
  formatRecord,
  type InsightModule,
  managerName,
  ordinal,
  rankIn,
  round1,
  team,
} from "./helpers";

export const luckInsights: InsightModule[] = [
  {
    id: "schedule-luck",
    category: "luck",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const rank = rankIn(facts.rankings.luck, rosterId);
      const n = facts.league.totalTeams;
      const delta = t.luckDelta;
      const expectedWins = round1(t.expectedWins);
      const games = t.record.wins + t.record.losses + t.record.ties;
      if (rank === 1 && delta >= 0.1) {
        return {
          id: this.id,
          category: "luck",
          topic: "schedule-luck",
          notability: clamp(65 + delta * 150, 65, 90),
          headline: `Luckiest schedule in the league: you won ${t.record.wins} but earned ${expectedWins}. The schedule carried you.`,
          facts: {
            actualWins: t.record.wins,
            deservedWins: expectedWins,
            allPlayRecord: `${t.allPlay.wins}-${t.allPlay.losses}`,
            games,
          },
        };
      }
      if (rank === n && delta <= -0.1) {
        return {
          id: this.id,
          category: "luck",
          topic: "schedule-luck",
          notability: clamp(70 + -delta * 150, 70, 92),
          headline: `Unluckiest schedule in the league: you played like ${expectedWins} wins and got ${t.record.wins}.`,
          facts: {
            actualWins: t.record.wins,
            deservedWins: expectedWins,
            allPlayRecord: `${t.allPlay.wins}-${t.allPlay.losses}`,
            games,
          },
        };
      }
      return null;
    },
  },
  {
    id: "opponent-season-highs",
    category: "luck",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const painful = t.opponentSeasonHighs.filter((h) => {
        const w = t.weeks.find((week) => week.week === h.week);
        return w?.result === "L";
      });
      if (painful.length < 2) return null;
      const names = painful.map((h) => managerName(facts, h.opponentRosterId));
      return {
        id: this.id,
        category: "luck",
        notability: painful.length >= 3 ? clamp(74 + 6 * (painful.length - 3), 74, 92) : 56,
        headline: `${painful.length} different opponents had their best week of the season against you (${names.join(", ")})`,
        facts: {
          count: painful.length,
          opponents: names.join(", "),
          weeks: painful.map((h) => h.week).join(", "),
        },
      };
    },
  },
  {
    id: "close-game-record",
    category: "luck",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const { wins, losses, threshold } = t.closeGames;
      const total = wins + losses;
      if (total < 3) return null;
      if (losses === 0 && wins >= 3) {
        return {
          id: this.id,
          category: "luck",
          topic: "close-games",
          notability: clamp(58 + 6 * (wins - 3), 58, 80),
          headline: `${wins}-0 in games decided by ${threshold} points or fewer. The coin kept landing heads.`,
          facts: { closeWins: wins, closeLosses: losses, marginThreshold: threshold },
        };
      }
      if (wins === 0 && losses >= 3) {
        return {
          id: this.id,
          category: "luck",
          topic: "close-games",
          notability: clamp(64 + 6 * (losses - 3), 64, 86),
          headline: `0-${losses} in games decided by ${threshold} points or fewer.`,
          facts: { closeWins: wins, closeLosses: losses, marginThreshold: threshold },
        };
      }
      return null;
    },
  },
  {
    id: "combined-loss-margin",
    category: "luck",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const losses = t.weeks.filter((w) => !w.isPlayoff && w.result === "L");
      if (losses.length < 3) return null;
      const combined = round1(losses.reduce((s, w) => s + Math.abs(w.margin ?? 0), 0));
      if (combined > losses.length * 8) return null;
      return {
        id: this.id,
        category: "luck",
        topic: "close-games",
        notability: 76,
        headline: `Your ${losses.length} losses came by a combined ${combined} points`,
        facts: { losses: losses.length, combinedMargin: combined },
      };
    },
  },
  {
    id: "points-against-extreme",
    category: "luck",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const n = facts.league.totalTeams;
      const pa = round1(t.pointsAgainst);
      if (t.pointsAgainstRank === 1) {
        return {
          id: this.id,
          category: "luck",
          topic: "schedule-luck",
          notability: 58,
          headline: `${pa} points against — the league's heaviest fire, and it all landed on you`,
          facts: { pointsAgainst: pa, leagueRank: 1 },
        };
      }
      if (t.pointsAgainstRank === n) {
        return {
          id: this.id,
          category: "luck",
          topic: "schedule-luck",
          notability: 50,
          headline: `${pa} points against — softest schedule in the league`,
          facts: { pointsAgainst: pa, leagueRank: n },
        };
      }
      return null;
    },
  },
  {
    id: "robbed-week",
    category: "luck",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      // Best league-wide weekly score that still took a loss.
      let robbed: { week: number; score: number; rank: number; oppScore: number } | null = null;
      for (const w of t.weeks) {
        if (w.isPlayoff || w.result !== "L" || w.weeklyRank == null || w.opponentScore == null)
          continue;
        if (w.weeklyRank <= 2 && (!robbed || w.weeklyRank < robbed.rank)) {
          robbed = {
            week: w.week,
            score: round1(w.score),
            rank: w.weeklyRank,
            oppScore: round1(w.opponentScore),
          };
        }
      }
      if (!robbed) return null;
      return {
        id: this.id,
        category: "luck",
        notability: robbed.rank === 1 ? 82 : 66,
        headline: `Week ${robbed.week}: you scored ${robbed.score} — ${ordinal(robbed.rank)} best in the league — and still lost`,
        facts: {
          week: robbed.week,
          score: robbed.score,
          weeklyRank: robbed.rank,
          opponentScore: robbed.oppScore,
        },
      };
    },
  },
  {
    id: "daylight-robbery-win",
    category: "luck",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const n = facts.league.totalTeams;
      let stolen: { week: number; score: number; rank: number } | null = null;
      for (const w of t.weeks) {
        if (w.isPlayoff || w.result !== "W" || w.weeklyRank == null) continue;
        if (w.weeklyRank >= n - 1 && (!stolen || w.weeklyRank > stolen.rank)) {
          stolen = { week: w.week, score: round1(w.score), rank: w.weeklyRank };
        }
      }
      if (!stolen) return null;
      return {
        id: this.id,
        category: "luck",
        notability: stolen.rank === n ? 78 : 60,
        headline: `Week ${stolen.week}: you won with the ${ordinal(stolen.rank)} best score of the week (${stolen.score})`,
        facts: { week: stolen.week, score: stolen.score, weeklyRank: stolen.rank },
      };
    },
  },
  {
    id: "beat-the-champ",
    category: "luck",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      if (t.playoffs.champion) return null;
      const champ = Object.values(facts.teams).find((x) => x.playoffs.champion);
      if (!champ) return null;
      const ledger = t.h2h[champ.rosterId];
      if (!ledger || ledger.wins === 0) return null;
      const champLossesTotal = champ.record.losses;
      if (champLossesTotal > 4) return null;
      return {
        id: this.id,
        category: "luck",
        notability: ledger.wins >= 2 ? 66 : 52,
        headline: `You beat ${champ.displayName} — the eventual champion — ${ledger.wins} time${ledger.wins > 1 ? "s" : ""}. They only lost ${champLossesTotal} regular-season games.`,
        facts: {
          champion: champ.displayName,
          winsVsChampion: ledger.wins,
          championSeasonLosses: champLossesTotal,
          record: formatRecord(t.record),
        },
      };
    },
  },
];
