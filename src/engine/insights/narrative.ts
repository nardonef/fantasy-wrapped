import type { CandidateInsight } from "../types";
import { clamp, formatRecord, type InsightModule, managerName, round1, team } from "./helpers";

export const narrativeInsights: InsightModule[] = [
  {
    id: "peak-week",
    category: "narrative",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const high = t.highWeek;
      if (!high) return null;
      const leagueHigh = Object.values(facts.teams).every((x) => x.highWeek.score <= high.score);
      // Merely "your best week" is boring — it must be the league's best week,
      // or at least have won the week outright.
      if (!leagueHigh && high.weeklyRank !== 1) return null;
      return {
        id: this.id,
        category: "narrative",
        topic: "peak",
        notability: leagueHigh ? 68 : 52,
        headline: leagueHigh
          ? `Week ${high.week}: ${round1(high.score)} points — the highest score anyone posted all season`
          : `Week ${high.week}: ${round1(high.score)} points — the best score anyone managed that week`,
        facts: {
          week: high.week,
          score: round1(high.score),
          leagueSeasonHigh: leagueHigh,
          seasonAverage: round1(t.avgScore),
        },
      };
    },
  },
  {
    id: "collapse-week",
    category: "narrative",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const low = t.lowWeek;
      if (!low) return null;
      const leagueLow = Object.values(facts.teams).every((x) => x.lowWeek.score >= low.score);
      if (!leagueLow && low.weeklyRank !== facts.league.totalTeams) return null;
      return {
        id: this.id,
        category: "narrative",
        topic: "collapse",
        notability: leagueLow ? 66 : 46,
        headline: leagueLow
          ? `Week ${low.week}: ${round1(low.score)} points — the single worst score anyone managed all year`
          : `Week ${low.week}: ${round1(low.score)} points. We don't talk about week ${low.week}.`,
        facts: {
          week: low.week,
          score: round1(low.score),
          leagueSeasonLow: leagueLow,
          seasonAverage: round1(t.avgScore),
        },
      };
    },
  },
  {
    id: "streak",
    category: "narrative",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const win = t.longestWinStreak;
      const loss = t.longestLossStreak;
      const winLen = win?.length ?? 0;
      const lossLen = loss?.length ?? 0;
      if (winLen < 4 && lossLen < 4) return null;
      if (lossLen >= winLen && loss) {
        return {
          id: this.id,
          category: "narrative",
          notability: clamp(58 + 6 * (lossLen - 4), 58, 84),
          headline: `Weeks ${loss.fromWeek}–${loss.toWeek}: ${lossLen} straight losses`,
          facts: {
            streakType: "losing",
            length: lossLen,
            fromWeek: loss.fromWeek,
            toWeek: loss.toWeek,
          },
        };
      }
      if (win) {
        return {
          id: this.id,
          category: "narrative",
          notability: clamp(52 + 5 * (winLen - 4), 52, 78),
          headline: `Weeks ${win.fromWeek}–${win.toWeek}: ${winLen} straight wins`,
          facts: {
            streakType: "winning",
            length: winLen,
            fromWeek: win.fromWeek,
            toWeek: win.toWeek,
          },
        };
      }
      return null;
    },
  },
  {
    id: "season-arc",
    category: "narrative",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const regular = t.weeks.filter((w) => !w.isPlayoff && w.result !== null);
      if (regular.length < 8) return null;
      const half = Math.floor(regular.length / 2);
      const firstHalf = regular.slice(0, half);
      const secondHalf = regular.slice(half);
      const w1 = firstHalf.filter((w) => w.result === "W").length;
      const w2 = secondHalf.filter((w) => w.result === "W").length;
      const swing = w2 - w1;
      if (Math.abs(swing) < 3) return null;
      const collapse = swing < 0;
      return {
        id: this.id,
        category: "narrative",
        topic: collapse ? "collapse" : "peak",
        notability: clamp(58 + 6 * (Math.abs(swing) - 3), 58, 82),
        headline: collapse
          ? `Started ${w1}-${half - w1}, finished ${w2}-${secondHalf.length - w2}. The wheels came off.`
          : `Started ${w1}-${half - w1}, finished ${w2}-${secondHalf.length - w2}. The second-half surge.`,
        facts: {
          firstHalfWins: w1,
          firstHalfLosses: half - w1,
          secondHalfWins: w2,
          secondHalfLosses: secondHalf.length - w2,
          collapse,
        },
      };
    },
  },
  {
    id: "draft-steal",
    category: "narrative",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const late = t.draftPicks.filter((p) => !p.isKeeper && p.round >= 8);
      const steal = [...late].sort((a, b) => b.startedPointsForTeam - a.startedPointsForTeam)[0];
      if (!steal || steal.startedPointsForTeam < 90) return null;
      const pts = round1(steal.startedPointsForTeam);
      return {
        id: this.id,
        category: "narrative",
        topic: "draft-verdict",
        notability: clamp(54 + (pts - 90) / 8, 54, 78),
        headline: `Round ${steal.round}: ${steal.player.name}. ${pts} points from pick ${steal.pickNo}.`,
        facts: {
          steal: steal.player.name,
          round: steal.round,
          pickNo: steal.pickNo,
          startedPoints: pts,
        },
        refs: { player: steal.player },
      };
    },
  },
  {
    id: "playoff-story",
    category: "narrative",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const n = facts.league.totalTeams;
      if (t.playoffs.champion) {
        const final = t.weeks.find((w) => w.bracketRound === "championship");
        return {
          id: this.id,
          category: "narrative",
          topic: "finish",
          notability: 88,
          headline: `Champion.${final && final.margin != null ? ` Won the final by ${round1(Math.abs(final.margin))}.` : ""}`,
          facts: {
            finish: "champion",
            finalMargin: final?.margin != null ? round1(Math.abs(final.margin)) : null,
            record: formatRecord(t.record),
          },
        };
      }
      if (t.playoffs.runnerUp) {
        const final = t.weeks.find((w) => w.bracketRound === "championship");
        const champ = Object.values(facts.teams).find((x) => x.playoffs.champion);
        return {
          id: this.id,
          category: "narrative",
          topic: "finish",
          notability: 80,
          headline: `One game from the title. ${champ ? `${champ.displayName} ` : ""}beat you in the final${final && final.margin != null ? ` by ${round1(Math.abs(final.margin))}` : ""}.`,
          facts: {
            finish: "runner-up",
            finalMargin: final?.margin != null ? round1(Math.abs(final.margin)) : null,
            champion: champ?.displayName ?? null,
          },
        };
      }
      if (!t.playoffs.made) {
        const playoffTeams = Object.values(facts.teams).filter((x) => x.playoffs.made).length;
        if (t.standingsRank === playoffTeams + 1) {
          return {
            id: this.id,
            category: "narrative",
            topic: "finish",
            notability: 70,
            headline: `First team out. ${formatRecord(t.record)} and home for the playoffs.`,
            facts: {
              finish: "first-out",
              standingsRank: t.standingsRank,
              record: formatRecord(t.record),
              playoffSpots: playoffTeams,
            },
          };
        }
        if (t.standingsRank === n) {
          return {
            id: this.id,
            category: "narrative",
            topic: "finish",
            notability: 72,
            headline: `Dead last. ${formatRecord(t.record)}.`,
            facts: { finish: "last", record: formatRecord(t.record), standingsRank: n },
          };
        }
        return null;
      }
      if (t.playoffs.exitRound) {
        const exitWeek = [...t.weeks]
          .reverse()
          .find((w) => w.bracketRound === t.playoffs.exitRound && w.result === "L");
        const beatenBy = exitWeek?.opponentRosterId
          ? managerName(facts, exitWeek.opponentRosterId)
          : null;
        return {
          id: this.id,
          category: "narrative",
          topic: "finish",
          notability: t.playoffs.exitRound === "semifinal" ? 56 : 46,
          headline: `Playoff exit: ${t.playoffs.exitRound}${beatenBy ? `, knocked out by ${beatenBy}` : ""}${exitWeek?.margin != null ? ` by ${round1(Math.abs(exitWeek.margin))}` : ""}`,
          facts: {
            finish: t.playoffs.exitRound,
            knockedOutBy: beatenBy,
            margin: exitWeek?.margin != null ? round1(Math.abs(exitWeek.margin)) : null,
          },
        };
      }
      return null;
    },
  },
];
