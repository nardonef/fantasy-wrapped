import type { CandidateInsight } from "../types";
import { clamp, type InsightModule, managerName, round1, team } from "./helpers";

export const peopleInsights: InsightModule[] = [
  {
    id: "nemesis",
    category: "people",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      let nemesis: { rosterId: string; losses: number; wins: number; margin: number } | null = null;
      for (const [oppId, ledger] of Object.entries(t.h2h)) {
        if (ledger.losses < 2) continue;
        const margin = ledger.pointsAgainst - ledger.pointsFor;
        if (
          !nemesis ||
          ledger.losses > nemesis.losses ||
          (ledger.losses === nemesis.losses && margin > nemesis.margin)
        ) {
          nemesis = { rosterId: oppId, losses: ledger.losses, wins: ledger.wins, margin };
        }
      }
      if (!nemesis) return null;
      const name = managerName(facts, nemesis.rosterId);
      const swept = nemesis.wins === 0;
      return {
        id: this.id,
        category: "people",
        topic: "rivalry",
        notability: nemesis.losses >= 3 ? 78 : swept ? 62 : 48,
        headline: swept
          ? `${name} owned you this season: ${nemesis.losses}-0, by ${round1(nemesis.margin)} total points`
          : `Your nemesis: ${name} (${nemesis.wins}-${nemesis.losses} against them)`,
        facts: {
          nemesis: name,
          lossesToThem: nemesis.losses,
          winsAgainstThem: nemesis.wins,
          totalMargin: round1(nemesis.margin),
          swept,
        },
      };
    },
  },
  {
    id: "victim",
    category: "people",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      let victim: { rosterId: string; wins: number; margin: number } | null = null;
      for (const [oppId, ledger] of Object.entries(t.h2h)) {
        if (ledger.wins < 2 || ledger.losses > 0) continue;
        const margin = ledger.pointsFor - ledger.pointsAgainst;
        if (!victim || ledger.wins > victim.wins) {
          victim = { rosterId: oppId, wins: ledger.wins, margin };
        }
      }
      if (!victim) return null;
      const name = managerName(facts, victim.rosterId);
      return {
        id: this.id,
        category: "people",
        topic: "rivalry",
        notability: victim.wins >= 3 ? 60 : 42,
        headline: `${name} was your personal win button: ${victim.wins}-0, +${round1(victim.margin)} points`,
        facts: {
          victim: name,
          winsAgainstThem: victim.wins,
          totalMargin: round1(victim.margin),
        },
      };
    },
  },
  {
    id: "mvp",
    category: "people",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      if (!t.mvp) return null;
      const share = Math.round(t.mvp.shareOfStartedPoints * 100);
      const pts = round1(t.mvp.startedPoints);
      return {
        id: this.id,
        category: "people",
        notability: share >= 22 ? 62 : share >= 16 ? 46 : 38,
        headline: `Your MVP: ${t.mvp.player.name} — ${pts} points, ${share}% of everything you scored`,
        facts: {
          mvp: t.mvp.player.name,
          position: t.mvp.player.position,
          startedPoints: pts,
          shareOfTeamPct: share,
          startedWeeks: t.mvp.startedWeeks,
        },
      };
    },
  },
  {
    id: "draft-bust",
    category: "people",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const earlyPicks = t.draftPicks.filter((p) => !p.isKeeper && p.round <= 2);
      if (earlyPicks.length === 0) return null;
      const bust = [...earlyPicks].sort(
        (a, b) => a.startedPointsForTeam - b.startedPointsForTeam,
      )[0];
      const pts = round1(bust.startedPointsForTeam);
      if (pts > 110) return null;
      const notability = pts <= 40 ? 78 : pts <= 70 ? 64 : 48;
      return {
        id: this.id,
        category: "people",
        topic: "draft-verdict",
        notability,
        headline: `Round ${bust.round} pick ${bust.player.name} gave you ${pts} started points all season`,
        facts: {
          bust: bust.player.name,
          round: bust.round,
          pickNo: bust.pickNo,
          startedPoints: pts,
        },
      };
    },
  },
  {
    id: "waiver-steal",
    category: "people",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      // A productive streamed defense/kicker is routine, not a steal.
      const skillPickups = t.pickups.filter(
        (p) => p.player.position && !["DEF", "K"].includes(p.player.position),
      );
      const best = [...skillPickups].sort(
        (a, b) => b.restOfSeasonStartedPoints - a.restOfSeasonStartedPoints,
      )[0];
      if (!best || best.restOfSeasonStartedPoints < 60) return null;
      const pts = round1(best.restOfSeasonStartedPoints);
      const free = best.faab == null || best.faab <= 2;
      let notability = pts >= 110 ? clamp(64 + (pts - 110) / 6, 64, 84) : 50;
      if (free) notability = clamp(notability + 6, 0, 88);
      return {
        id: this.id,
        category: "people",
        notability,
        headline: `Week ${best.week} pickup ${best.player.name} gave you ${pts} points${best.faab != null ? ` for $${best.faab}` : ""}`,
        facts: {
          pickup: best.player.name,
          week: best.week,
          startedPointsAfter: pts,
          faabSpent: best.faab,
        },
      };
    },
  },
  {
    id: "trade-verdict",
    category: "people",
    compute(facts, rosterId): CandidateInsight | null {
      const t = team(facts, rosterId);
      const biggest = [...t.trades].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
      if (!biggest || Math.abs(biggest.delta) < 50) return null;
      const delta = round1(Math.abs(biggest.delta));
      const won = biggest.delta > 0;
      const partner = managerName(facts, biggest.partnerRosterIds[0] ?? "");
      const gainedNames = biggest.gained.map((g) => g.player.name).join(", ") || "nothing";
      const lostNames = biggest.lost.map((l) => l.player.name).join(", ") || "nothing";
      const notability = won
        ? clamp(56 + (delta - 50) / 5, 56, 80)
        : clamp(64 + (delta - 50) / 5, 64, 88);
      return {
        id: this.id,
        category: "people",
        notability,
        headline: won
          ? `You fleeced ${partner}: got ${gainedNames}, gave ${lostNames} — up ${delta} points on the deal`
          : `The ${gainedNames} trade: ${partner} beat you by ${delta} points of rest-of-season value`,
        facts: {
          partner,
          week: biggest.week,
          got: gainedNames,
          gave: lostNames,
          netPoints: round1(biggest.delta),
          wonTheTrade: won,
        },
      };
    },
  },
  {
    id: "punching-bag",
    category: "people",
    compute(facts, rosterId): CandidateInsight | null {
      // Inverse of opponent-season-highs: YOU had your season high against
      // someone and still find yourself here — the team everyone feasts on is
      // covered by opponent-season-highs; this one is the team whose best week
      // ruined someone else's season high hopes... keep it simple: your season
      // high came against the eventual champion or the top seed.
      const t = team(facts, rosterId);
      const high = t.highWeek;
      if (!high?.opponentRosterId || high.result !== "W") return null;
      const opp = facts.teams[high.opponentRosterId];
      if (!opp) return null;
      if (!opp.playoffs.champion && opp.standingsRank !== 1) return null;
      return {
        id: this.id,
        category: "people",
        notability: 44,
        headline: `Your best week (${round1(high.score)}) came against ${opp.displayName}${opp.playoffs.champion ? " — the eventual champ" : " — the #1 seed"}`,
        facts: {
          week: high.week,
          score: round1(high.score),
          opponent: opp.displayName,
          opponentWasChampion: opp.playoffs.champion,
        },
      };
    },
  },
];
