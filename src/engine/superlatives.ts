import { formatRecord, rankIn, round1 } from "./insights/helpers";
import type { SeasonFacts } from "./types";

export type Superlative = {
  id: string;
  /** The award name — ballot style. */
  label: string;
  rosterId: string;
  winner: string;
  /** The receipts, one line. */
  detail: string;
};

/**
 * League-wide awards ballot — designed to start arguments in the group chat.
 * Only awards with real evidence ship; a quiet league gets a shorter ballot.
 */
export function computeSuperlatives(facts: SeasonFacts): Superlative[] {
  const awards: Superlative[] = [];
  const teamsArr = Object.values(facts.teams);
  const byRoster = (rosterId: string) => facts.teams[rosterId];

  const champion = teamsArr.find((t) => t.playoffs.champion);
  if (champion) {
    awards.push({
      id: "champion",
      label: "The Ring",
      rosterId: champion.rosterId,
      winner: champion.displayName,
      detail: `${formatRecord(champion.record)} regular season, then finished the job.`,
    });
  }

  const luckiest = byRoster(facts.rankings.luck[0]);
  if (luckiest && luckiest.luckDelta >= 0.05) {
    awards.push({
      id: "luckiest",
      label: "Luckiest Alive",
      rosterId: luckiest.rosterId,
      winner: luckiest.displayName,
      detail: `Won ${luckiest.record.wins}, deserved ${round1(luckiest.expectedWins)}. The schedule did the rest.`,
    });
  }

  const cursed = byRoster(facts.rankings.luck[facts.rankings.luck.length - 1]);
  if (cursed && cursed.luckDelta <= -0.05) {
    awards.push({
      id: "cursed",
      label: "Cursed",
      rosterId: cursed.rosterId,
      winner: cursed.displayName,
      detail: `Played like ${round1(cursed.expectedWins)} wins. Got ${cursed.record.wins}.`,
    });
  }

  const benchKing = byRoster(facts.rankings.benchRegret[0]);
  if (benchKing && benchKing.benchRegretTotal >= 80) {
    awards.push({
      id: "bench-king",
      label: "Best Bench in Football",
      rosterId: benchKing.rosterId,
      winner: benchKing.displayName,
      detail: `${round1(benchKing.benchRegretTotal)} points died on the bench. Optimal record: ${formatRecord(benchKing.optimalRecord)}.`,
    });
  }

  const pointsMachine = byRoster(facts.rankings.pointsFor[0]);
  if (pointsMachine) {
    awards.push({
      id: "points-machine",
      label: "The Scoring Title",
      rosterId: pointsMachine.rosterId,
      winner: pointsMachine.displayName,
      detail: `${round1(pointsMachine.pointsFor)} points, most in the league${pointsMachine.playoffs.champion ? "." : " — rings given for it: zero."}`,
    });
  }

  const doormat = teamsArr.find((t) => t.standingsRank === facts.league.totalTeams);
  if (doormat) {
    awards.push({
      id: "doormat",
      label: "The Basement",
      rosterId: doormat.rosterId,
      winner: doormat.displayName,
      detail: `${formatRecord(doormat.record)}. Somebody has to.`,
    });
  }

  const dayTrader = byRoster(facts.rankings.transactionVolume[0]);
  if (dayTrader && dayTrader.transactionCounts.total >= 20) {
    awards.push({
      id: "day-trader",
      label: "Most Time on App",
      rosterId: dayTrader.rosterId,
      winner: dayTrader.displayName,
      detail: `${dayTrader.transactionCounts.total} roster moves. Somebody get this manager a hobby.`,
    });
  }

  // Best pickup league-wide (skill players only).
  let bestPickup: { rosterId: string; player: string; points: number; week: number } | null = null;
  for (const team of teamsArr) {
    for (const pickup of team.pickups) {
      if (!pickup.player.position || ["DEF", "K"].includes(pickup.player.position)) continue;
      if (!bestPickup || pickup.restOfSeasonStartedPoints > bestPickup.points) {
        bestPickup = {
          rosterId: team.rosterId,
          player: pickup.player.name,
          points: pickup.restOfSeasonStartedPoints,
          week: pickup.week,
        };
      }
    }
  }
  if (bestPickup && bestPickup.points >= 80) {
    awards.push({
      id: "best-pickup",
      label: "Heist of the Year",
      rosterId: bestPickup.rosterId,
      winner: byRoster(bestPickup.rosterId)?.displayName ?? "",
      detail: `${bestPickup.player}, week ${bestPickup.week}. ${round1(bestPickup.points)} points, off the street.`,
    });
  }

  // Worst drop league-wide.
  let worstDrop: { rosterId: string; player: string; points: number; week: number } | null = null;
  for (const team of teamsArr) {
    for (const drop of team.drops) {
      if (!drop.player.position || ["DEF", "K"].includes(drop.player.position)) continue;
      if (!worstDrop || drop.pointsAfterDrop > worstDrop.points) {
        worstDrop = {
          rosterId: team.rosterId,
          player: drop.player.name,
          points: drop.pointsAfterDrop,
          week: drop.week,
        };
      }
    }
  }
  if (worstDrop && worstDrop.points >= 120) {
    awards.push({
      id: "worst-drop",
      label: "The Donation",
      rosterId: worstDrop.rosterId,
      winner: byRoster(worstDrop.rosterId)?.displayName ?? "",
      detail: `Dropped ${worstDrop.player} in week ${worstDrop.week}. ${round1(worstDrop.points)} points after that.`,
    });
  }

  // Biggest blowout and closest nail-biter, league-wide.
  let blowout: { winner: string; loser: string; margin: number; week: number } | null = null;
  let nailbiter: { winner: string; loser: string; margin: number; week: number } | null = null;
  for (const team of teamsArr) {
    for (const w of team.weeks) {
      if (w.result !== "W" || w.margin == null || !w.opponentRosterId) continue;
      const entry = {
        winner: team.displayName,
        loser: byRoster(w.opponentRosterId)?.displayName ?? "",
        margin: round1(w.margin),
        week: w.week,
      };
      if (!blowout || entry.margin > blowout.margin) blowout = entry;
      if (entry.margin > 0 && (!nailbiter || entry.margin < nailbiter.margin)) nailbiter = entry;
    }
  }
  if (blowout) {
    const rosterId =
      teamsArr.find((t) => t.displayName === blowout.winner)?.rosterId ?? teamsArr[0].rosterId;
    awards.push({
      id: "blowout",
      label: "Crime of the Season",
      rosterId,
      winner: blowout.winner,
      detail: `Beat ${blowout.loser} by ${blowout.margin} in week ${blowout.week}.`,
    });
  }
  if (nailbiter && nailbiter.margin <= 3) {
    const rosterId =
      teamsArr.find((t) => t.displayName === nailbiter.winner)?.rosterId ?? teamsArr[0].rosterId;
    awards.push({
      id: "nailbiter",
      label: "Photo Finish",
      rosterId,
      winner: nailbiter.winner,
      detail: `Edged ${nailbiter.loser} by ${nailbiter.margin} in week ${nailbiter.week}.`,
    });
  }

  const rollercoaster = byRoster(facts.rankings.volatility[0]);
  if (rollercoaster && rankIn(facts.rankings.volatility, rollercoaster.rosterId) === 1) {
    awards.push({
      id: "rollercoaster",
      label: "Least Medically Advisable",
      rosterId: rollercoaster.rosterId,
      winner: rollercoaster.displayName,
      detail: `${round1(rollercoaster.highWeek.score)} one week, ${round1(rollercoaster.lowWeek.score)} another.`,
    });
  }

  return awards;
}
