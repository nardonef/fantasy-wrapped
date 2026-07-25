import type { NormalizedLeagueBundle, NormalizedPlayerWeek } from "@/providers/types";
import { optimalLineup, SLOT_ELIGIBILITY, startingSlots } from "./lineup";
import type {
  DraftPickFacts,
  DropFacts,
  PickupFacts,
  PlayerRef,
  SeasonFacts,
  StreakFacts,
  SwapRef,
  TeamPlayerSeason,
  TeamSeasonFacts,
  TeamWeekFacts,
  TradeFacts,
} from "./types";

const EPSILON = 1e-9;
const CLOSE_GAME_THRESHOLD = 6;
const WINNERS_BRACKET_ROUNDS = new Set([
  "championship",
  "semifinal",
  "quarterfinal",
  "third_place",
  "placement",
  "playoff",
]);

function stdev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function longestStreak(
  results: { week: number; result: "W" | "L" | "T" }[],
  kind: "W" | "L",
): StreakFacts {
  let best: StreakFacts = null;
  let current: { length: number; fromWeek: number; toWeek: number } | null = null;
  for (const r of results) {
    if (r.result === kind) {
      current = current
        ? { length: current.length + 1, fromWeek: current.fromWeek, toWeek: r.week }
        : { length: 1, fromWeek: r.week, toWeek: r.week };
      if (!best || current.length > best.length) best = { ...current };
    } else {
      current = null;
    }
  }
  return best;
}

export function computeSeasonFacts(bundle: NormalizedLeagueBundle): SeasonFacts {
  const playerRefById = new Map<string, PlayerRef>(
    bundle.players.map((p) => [
      p.providerPlayerId,
      { providerPlayerId: p.providerPlayerId, name: p.name, position: p.position },
    ]),
  );
  const ref = (pid: string): PlayerRef =>
    playerRefById.get(pid) ?? { providerPlayerId: pid, name: pid, position: null };

  const slots = startingSlots(bundle.league.rosterPositions);
  const rosterIds = bundle.teams
    .map((t) => t.providerRosterId)
    .sort((a, b) => Number(a) - Number(b));

  // ---- Index player-weeks -------------------------------------------------
  const teamWeekPlayers = new Map<string, NormalizedPlayerWeek[]>();
  const playerLeagueWeekPoints = new Map<string, Map<number, number>>();
  for (const pw of bundle.playerWeeks) {
    const key = `${pw.providerRosterId}:${pw.week}`;
    const list = teamWeekPlayers.get(key) ?? [];
    list.push(pw);
    teamWeekPlayers.set(key, list);

    const byWeek = playerLeagueWeekPoints.get(pw.providerPlayerId) ?? new Map<number, number>();
    byWeek.set(pw.week, Math.max(byWeek.get(pw.week) ?? 0, pw.points));
    playerLeagueWeekPoints.set(pw.providerPlayerId, byWeek);
  }
  const playerPointsAfter = (pid: string, week: number, inclusive = false): number => {
    const byWeek = playerLeagueWeekPoints.get(pid);
    if (!byWeek) return 0;
    let sum = 0;
    for (const [w, pts] of byWeek) {
      if (inclusive ? w >= week : w > week) sum += pts;
    }
    return sum;
  };

  // ---- Per-team week facts ------------------------------------------------
  const weekFactsByTeam = new Map<string, TeamWeekFacts[]>(rosterIds.map((r) => [r, []]));
  const allWeeks = [...new Set(bundle.matchups.map((m) => m.week))].sort((a, b) => a - b);
  const regularSeasonWeeks: number[] = [];
  const playoffWeeks: number[] = [];

  for (const week of allWeeks) {
    const weekMatchups = bundle.matchups.filter((m) => m.week === week);
    const isPlayoff = weekMatchups.some((m) => m.isPlayoff);
    (isPlayoff ? playoffWeeks : regularSeasonWeeks).push(week);

    const scores: { rosterId: string; score: number }[] = [];
    for (const m of weekMatchups) {
      scores.push({ rosterId: m.teamA, score: m.teamAScore });
      if (m.teamB) scores.push({ rosterId: m.teamB, score: m.teamBScore ?? 0 });
    }
    const sortedScores = [...scores].sort((a, b) => b.score - a.score);
    const rankOf = (rosterId: string): number =>
      sortedScores.findIndex((s) => s.rosterId === rosterId) + 1;

    const addWeek = (
      rosterId: string,
      score: number,
      opponentRosterId: string | null,
      opponentScore: number | null,
      bracketRound: string | null,
    ) => {
      const pool = teamWeekPlayers.get(`${rosterId}:${week}`) ?? [];
      const starters = pool.filter((p) => p.started);
      const bench = pool.filter((p) => !p.started);
      const starterPoints = starters.reduce((sum, p) => sum + p.points, 0);
      const { total: optimalPoints } = optimalLineup(
        slots,
        pool.map((p) => ({
          id: p.providerPlayerId,
          position: ref(p.providerPlayerId).position,
          points: p.points,
        })),
      );

      let bestSwap: SwapRef | null = null;
      for (const b of bench) {
        const bPos = ref(b.providerPlayerId).position;
        if (!bPos) continue;
        for (const s of starters) {
          const slotEligible = SLOT_ELIGIBILITY[s.slot ?? ""] ?? [];
          if (!slotEligible.includes(bPos)) continue;
          const gain = b.points - s.points;
          if (gain > EPSILON && (bestSwap === null || gain > bestSwap.gain)) {
            bestSwap = {
              benched: ref(b.providerPlayerId),
              benchedPoints: b.points,
              started: ref(s.providerPlayerId),
              startedPoints: s.points,
              gain,
            };
          }
        }
      }

      const result =
        opponentScore == null
          ? null
          : Math.abs(score - opponentScore) < EPSILON
            ? "T"
            : score > opponentScore
              ? "W"
              : "L";

      weekFactsByTeam.get(rosterId)?.push({
        week,
        isPlayoff,
        bracketRound,
        score,
        opponentRosterId,
        opponentScore,
        result,
        margin: opponentScore == null ? null : score - opponentScore,
        weeklyRank: isPlayoff ? null : rankOf(rosterId),
        allPlayWins: isPlayoff
          ? null
          : scores.filter((s) => s.rosterId !== rosterId && s.score < score - EPSILON).length,
        allPlayLosses: isPlayoff
          ? null
          : scores.filter((s) => s.rosterId !== rosterId && s.score > score + EPSILON).length,
        starterPoints,
        optimalPoints: Math.max(optimalPoints, starterPoints),
        benchRegret: Math.max(0, optimalPoints - starterPoints),
        bestSwap,
        flippableLoss:
          result === "L" && opponentScore != null && optimalPoints > opponentScore + EPSILON,
      });
    };

    for (const m of weekMatchups) {
      addWeek(m.teamA, m.teamAScore, m.teamB, m.teamBScore, m.bracketRound);
      if (m.teamB) addWeek(m.teamB, m.teamBScore ?? 0, m.teamA, m.teamAScore, m.bracketRound);
    }
  }

  // ---- Transactions per team ---------------------------------------------
  const tradesByTeam = new Map<string, TradeFacts[]>(rosterIds.map((r) => [r, []]));
  const pickupsByTeam = new Map<string, PickupFacts[]>(rosterIds.map((r) => [r, []]));
  const dropsByTeam = new Map<string, DropFacts[]>(rosterIds.map((r) => [r, []]));
  const faabByTeam = new Map<string, number>(rosterIds.map((r) => [r, 0]));
  const txCountsByTeam = new Map(
    rosterIds.map((r) => [r, { trades: 0, waivers: 0, freeAgents: 0, total: 0 }]),
  );

  for (const tx of bundle.transactions) {
    for (const rosterId of tx.rosterIds) {
      const counts = txCountsByTeam.get(rosterId);
      if (!counts) continue;
      counts.total++;
      if (tx.type === "trade") counts.trades++;
      else if (tx.type === "waiver") counts.waivers++;
      else if (tx.type === "free_agent") counts.freeAgents++;
    }

    if (tx.type === "trade") {
      for (const rosterId of tx.rosterIds) {
        if (!tradesByTeam.has(rosterId)) continue;
        const gainedIds = tx.assets.adds[rosterId] ?? [];
        const lostIds = tx.assets.drops[rosterId] ?? [];
        if (gainedIds.length === 0 && lostIds.length === 0) continue;
        // Both sides valued the same way: the asset's league-wide points after
        // the trade week (what the player was worth going forward).
        const gained = gainedIds.map((pid) => ({
          player: ref(pid),
          restOfSeasonPoints: playerPointsAfter(pid, tx.week),
        }));
        const lost = lostIds.map((pid) => ({
          player: ref(pid),
          restOfSeasonPoints: playerPointsAfter(pid, tx.week),
        }));
        tradesByTeam.get(rosterId)?.push({
          week: tx.week,
          partnerRosterIds: tx.rosterIds.filter((r) => r !== rosterId),
          gained,
          lost,
          delta:
            gained.reduce((s, g) => s + g.restOfSeasonPoints, 0) -
            lost.reduce((s, l) => s + l.restOfSeasonPoints, 0),
        });
      }
    } else if (tx.type === "waiver" || tx.type === "free_agent") {
      for (const [rosterId, playerIds] of Object.entries(tx.assets.adds)) {
        if (!pickupsByTeam.has(rosterId)) continue;
        const faab = tx.assets.faab?.[rosterId] ?? null;
        if (faab != null) faabByTeam.set(rosterId, (faabByTeam.get(rosterId) ?? 0) + faab);
        for (const pid of playerIds) {
          // Points from the pickup week onward while on this roster.
          let started = 0;
          let total = 0;
          for (const [key, pws] of teamWeekPlayers) {
            const [r, w] = key.split(":");
            if (r !== rosterId || Number(w) < tx.week) continue;
            for (const pw of pws) {
              if (pw.providerPlayerId !== pid) continue;
              total += pw.points;
              if (pw.started) started += pw.points;
            }
          }
          pickupsByTeam.get(rosterId)?.push({
            week: tx.week,
            player: ref(pid),
            faab,
            restOfSeasonStartedPoints: started,
            restOfSeasonPoints: total,
          });
        }
      }
      for (const [rosterId, playerIds] of Object.entries(tx.assets.drops)) {
        if (!dropsByTeam.has(rosterId)) continue;
        for (const pid of playerIds) {
          dropsByTeam.get(rosterId)?.push({
            week: tx.week,
            player: ref(pid),
            pointsAfterDrop: playerPointsAfter(pid, tx.week),
          });
        }
      }
    }
  }

  // ---- Assemble per-team season facts ------------------------------------
  const teamsByRoster = new Map(bundle.teams.map((t) => [t.providerRosterId, t]));
  const teams: Record<string, TeamSeasonFacts> = {};

  for (const rosterId of rosterIds) {
    const team = teamsByRoster.get(rosterId);
    if (!team) continue;
    const weeks = (weekFactsByTeam.get(rosterId) ?? []).sort((a, b) => a.week - b.week);
    const regular = weeks.filter((w) => !w.isPlayoff);
    const scored = regular.filter((w) => w.result !== null);

    const record = {
      wins: scored.filter((w) => w.result === "W").length,
      losses: scored.filter((w) => w.result === "L").length,
      ties: scored.filter((w) => w.result === "T").length,
    };
    const scores = regular.map((w) => w.score);
    const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    const allPlayWins = regular.reduce((s, w) => s + (w.allPlayWins ?? 0), 0);
    const allPlayLosses = regular.reduce((s, w) => s + (w.allPlayLosses ?? 0), 0);
    const allPlayGames = allPlayWins + allPlayLosses;
    const allPlayWinPct = allPlayGames ? allPlayWins / allPlayGames : 0;
    const games = record.wins + record.losses + record.ties;
    const actualWinPct = games ? (record.wins + record.ties / 2) / games : 0;

    const optimalRecord = { wins: 0, losses: 0, ties: 0 };
    for (const w of scored) {
      if (w.opponentScore == null) continue;
      if (w.optimalPoints > w.opponentScore + EPSILON) optimalRecord.wins++;
      else if (w.optimalPoints < w.opponentScore - EPSILON) optimalRecord.losses++;
      else optimalRecord.ties++;
    }

    const h2h: TeamSeasonFacts["h2h"] = {};
    for (const w of weeks) {
      if (!w.opponentRosterId || w.result === null) continue;
      h2h[w.opponentRosterId] ??= {
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      };
      const entry = h2h[w.opponentRosterId];
      if (w.result === "W") entry.wins++;
      else if (w.result === "L") entry.losses++;
      else entry.ties++;
      entry.pointsFor += w.score;
      entry.pointsAgainst += w.opponentScore ?? 0;
    }

    // Opponent season highs scored against this team (regular season).
    const opponentSeasonHighs: TeamSeasonFacts["opponentSeasonHighs"] = [];
    for (const w of regular) {
      if (!w.opponentRosterId || w.opponentScore == null) continue;
      const oppWeeks = (weekFactsByTeam.get(w.opponentRosterId) ?? []).filter(
        (ow) => !ow.isPlayoff,
      );
      const oppMax = Math.max(...oppWeeks.map((ow) => ow.score));
      if (Math.abs(w.opponentScore - oppMax) < EPSILON) {
        opponentSeasonHighs.push({
          week: w.week,
          opponentRosterId: w.opponentRosterId,
          score: w.opponentScore,
        });
      }
    }

    const playerAgg = new Map<string, TeamPlayerSeason>();
    for (const w of weeks) {
      for (const pw of teamWeekPlayers.get(`${rosterId}:${w.week}`) ?? []) {
        const agg = playerAgg.get(pw.providerPlayerId) ?? {
          player: ref(pw.providerPlayerId),
          startedPoints: 0,
          startedWeeks: 0,
          benchPoints: 0,
          benchWeeks: 0,
        };
        if (pw.started) {
          agg.startedPoints += pw.points;
          agg.startedWeeks++;
        } else {
          agg.benchPoints += pw.points;
          agg.benchWeeks++;
        }
        playerAgg.set(pw.providerPlayerId, agg);
      }
    }
    const players = [...playerAgg.values()].sort(
      (a, b) =>
        b.startedPoints - a.startedPoints ||
        a.player.providerPlayerId.localeCompare(b.player.providerPlayerId),
    );
    const totalStartedPoints = players.reduce((s, p) => s + p.startedPoints, 0);
    const mvp =
      players[0] && players[0].startedPoints > 0
        ? {
            ...players[0],
            shareOfStartedPoints: totalStartedPoints
              ? players[0].startedPoints / totalStartedPoints
              : 0,
          }
        : null;

    let bestSwapOfSeason: (SwapRef & { week: number }) | null = null;
    for (const w of weeks) {
      if (w.bestSwap && (!bestSwapOfSeason || w.bestSwap.gain > bestSwapOfSeason.gain)) {
        bestSwapOfSeason = { ...w.bestSwap, week: w.week };
      }
    }

    const results = scored.map((w) => ({ week: w.week, result: w.result as "W" | "L" | "T" }));

    const draftPicks: DraftPickFacts[] = bundle.draftPicks
      .filter((p) => p.providerRosterId === rosterId && p.providerPlayerId)
      .map((p) => {
        const pid = p.providerPlayerId as string;
        const agg = playerAgg.get(pid);
        return {
          round: p.round,
          pickNo: p.pickNo,
          amount: p.amount,
          isKeeper: p.isKeeper,
          player: ref(pid),
          pointsForTeam: (agg?.startedPoints ?? 0) + (agg?.benchPoints ?? 0),
          startedPointsForTeam: agg?.startedPoints ?? 0,
        };
      });

    const playoffWeekFacts = weeks.filter((w) => w.isPlayoff);
    const bracketGames = playoffWeekFacts.filter(
      (w) => w.bracketRound && WINNERS_BRACKET_ROUNDS.has(w.bracketRound),
    );
    const made = bracketGames.length > 0;
    const lastBracketLoss = [...bracketGames].reverse().find((w) => w.result === "L");
    const champion = team.finalRank === 1;

    teams[rosterId] = {
      rosterId,
      displayName: team.displayName,
      teamName: team.teamName,
      avatarUrl: team.avatarUrl,
      finalRank: team.finalRank,
      record,
      pointsFor: scored.reduce((s, w) => s + w.score, 0),
      pointsAgainst: scored.reduce((s, w) => s + (w.opponentScore ?? 0), 0),
      pointsForRank: 0,
      pointsAgainstRank: 0,
      standingsRank: 0,
      weeks,
      avgScore,
      stdevScore: stdev(scores),
      highWeek: regular.reduce((best, w) => (w.score > best.score ? w : best), regular[0]),
      lowWeek: regular.reduce((worst, w) => (w.score < worst.score ? w : worst), regular[0]),
      allPlay: { wins: allPlayWins, losses: allPlayLosses, winPct: allPlayWinPct },
      luckDelta: actualWinPct - allPlayWinPct,
      expectedWins: allPlayWinPct * games,
      closeGames: {
        wins: scored.filter((w) => w.result === "W" && (w.margin ?? 0) <= CLOSE_GAME_THRESHOLD)
          .length,
        losses: scored.filter(
          (w) => w.result === "L" && Math.abs(w.margin ?? 0) <= CLOSE_GAME_THRESHOLD,
        ).length,
        threshold: CLOSE_GAME_THRESHOLD,
      },
      weeklyCrowns: regular.filter((w) => w.weeklyRank === 1).length,
      weeklyStinkers: regular.filter((w) => w.weeklyRank === bundle.league.totalTeams).length,
      opponentSeasonHighs,
      longestWinStreak: longestStreak(results, "W"),
      longestLossStreak: longestStreak(results, "L"),
      h2h,
      benchRegretTotal: regular.reduce((s, w) => s + w.benchRegret, 0),
      optimalRecord,
      flippableLosses: regular.filter((w) => w.flippableLoss),
      bestSwapOfSeason,
      players,
      mvp,
      trades: tradesByTeam.get(rosterId) ?? [],
      pickups: pickupsByTeam.get(rosterId) ?? [],
      drops: dropsByTeam.get(rosterId) ?? [],
      draftPicks,
      faabSpent: faabByTeam.get(rosterId) ?? 0,
      transactionCounts: txCountsByTeam.get(rosterId) ?? {
        trades: 0,
        waivers: 0,
        freeAgents: 0,
        total: 0,
      },
      playoffs: {
        made,
        exitRound: champion ? null : (lastBracketLoss?.bracketRound ?? null),
        champion,
        runnerUp: team.finalRank === 2,
      },
    };
  }

  // ---- League-wide ranks --------------------------------------------------
  const teamList = rosterIds.map((r) => teams[r]).filter(Boolean);
  const rankBy = (value: (t: TeamSeasonFacts) => number, desc = true): string[] =>
    [...teamList]
      .sort(
        (a, b) =>
          (desc ? value(b) - value(a) : value(a) - value(b)) ||
          Number(a.rosterId) - Number(b.rosterId),
      )
      .map((t) => t.rosterId);

  const pointsForOrder = rankBy((t) => t.pointsFor);
  const pointsAgainstOrder = rankBy((t) => t.pointsAgainst);
  const standingsOrder = [...teamList]
    .sort(
      (a, b) =>
        b.record.wins - a.record.wins ||
        b.pointsFor - a.pointsFor ||
        Number(a.rosterId) - Number(b.rosterId),
    )
    .map((t) => t.rosterId);
  for (const t of teamList) {
    t.pointsForRank = pointsForOrder.indexOf(t.rosterId) + 1;
    t.pointsAgainstRank = pointsAgainstOrder.indexOf(t.rosterId) + 1;
    t.standingsRank = standingsOrder.indexOf(t.rosterId) + 1;
  }

  const allRegularScores = teamList.flatMap((t) =>
    t.weeks.filter((w) => !w.isPlayoff).map((w) => w.score),
  );

  return {
    league: {
      name: bundle.league.name.trim(),
      season: bundle.league.season,
      totalTeams: bundle.league.totalTeams,
      regularSeasonWeeks,
      playoffWeeks,
      medianScore: median(allRegularScores),
    },
    teams,
    rankings: {
      pointsFor: pointsForOrder,
      benchRegret: rankBy((t) => t.benchRegretTotal),
      luck: rankBy((t) => t.luckDelta),
      volatility: rankBy((t) => t.stdevScore),
      transactionVolume: rankBy((t) => t.transactionCounts.total),
      faabSpent: rankBy((t) => t.faabSpent),
      allPlayWinPct: rankBy((t) => t.allPlay.winPct),
    },
  };
}
