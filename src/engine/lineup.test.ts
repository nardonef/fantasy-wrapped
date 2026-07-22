import { describe, expect, it } from "vitest";
import { type LineupPlayer, optimalLineup, SLOT_ELIGIBILITY, startingSlots } from "./lineup";

/** Exhaustive search over all legal assignments — ground truth for small cases. */
function bruteForceBest(slots: string[], players: LineupPlayer[]): number {
  let best = 0;
  const usedPlayers = new Set<string>();
  const recurse = (slotIndex: number, total: number) => {
    if (slotIndex === slots.length) {
      best = Math.max(best, total);
      return;
    }
    // Leave the slot empty
    recurse(slotIndex + 1, total);
    const eligible = SLOT_ELIGIBILITY[slots[slotIndex]] ?? [];
    for (const player of players) {
      if (usedPlayers.has(player.id) || !player.position) continue;
      if (!eligible.includes(player.position)) continue;
      usedPlayers.add(player.id);
      recurse(slotIndex + 1, total + player.points);
      usedPlayers.delete(player.id);
    }
  };
  recurse(0, 0);
  return best;
}

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("optimalLineup", () => {
  it("fills a standard lineup with the obvious best players", () => {
    const slots = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"];
    const players: LineupPlayer[] = [
      { id: "qb1", position: "QB", points: 25 },
      { id: "qb2", position: "QB", points: 30 },
      { id: "rb1", position: "RB", points: 15 },
      { id: "rb2", position: "RB", points: 12 },
      { id: "rb3", position: "RB", points: 18 },
      { id: "wr1", position: "WR", points: 20 },
      { id: "wr2", position: "WR", points: 8 },
      { id: "te1", position: "TE", points: 5 },
      { id: "te2", position: "TE", points: 9 },
    ];
    const { total } = optimalLineup(slots, players);
    // QB 30, RBs 18+15, WRs 20+8, TE 9, FLEX rb2 12
    expect(total).toBe(30 + 18 + 15 + 20 + 8 + 9 + 12);
  });

  it("routes a second QB into SUPER_FLEX over a weaker RB", () => {
    const slots = ["QB", "SUPER_FLEX"];
    const players: LineupPlayer[] = [
      { id: "qb1", position: "QB", points: 30 },
      { id: "qb2", position: "QB", points: 25 },
      { id: "rb1", position: "RB", points: 10 },
    ];
    expect(optimalLineup(slots, players).total).toBe(55);
  });

  it("does not waste a dedicated slot on a flex-eligible player", () => {
    // Greedy-by-points must put the TE in TE, not FLEX, so the RB still fits.
    const slots = ["TE", "FLEX"];
    const players: LineupPlayer[] = [
      { id: "te1", position: "TE", points: 20 },
      { id: "rb1", position: "RB", points: 15 },
    ];
    expect(optimalLineup(slots, players).total).toBe(35);
  });

  it("ignores players with unknown positions", () => {
    const slots = ["QB"];
    const players: LineupPlayer[] = [
      { id: "x", position: null, points: 50 },
      { id: "qb1", position: "QB", points: 10 },
    ];
    expect(optimalLineup(slots, players).total).toBe(10);
  });

  it("matches brute force on 300 random rosters", () => {
    const rand = mulberry32(42);
    const positions = ["QB", "RB", "WR", "TE", "K", "DEF"];
    const slotPool = [
      "QB",
      "RB",
      "RB",
      "WR",
      "WR",
      "TE",
      "FLEX",
      "SUPER_FLEX",
      "K",
      "DEF",
      "REC_FLEX",
      "WRRB_FLEX",
    ];
    for (let trial = 0; trial < 300; trial++) {
      const slots = slotPool.filter(() => rand() < 0.6).slice(0, 7);
      const players: LineupPlayer[] = Array.from(
        { length: Math.floor(rand() * 9) + 1 },
        (_, i) => ({
          id: `p${i}`,
          position: positions[Math.floor(rand() * positions.length)],
          points: Math.round(rand() * 300) / 10,
        }),
      );
      const greedy = optimalLineup(slots, players).total;
      const exact = bruteForceBest(slots, players);
      expect(greedy, `trial ${trial}: slots=${slots.join(",")}`).toBeCloseTo(exact, 6);
    }
  });
});

describe("startingSlots", () => {
  it("strips bench-like slots", () => {
    expect(startingSlots(["QB", "RB", "FLEX", "BN", "BN", "IR", "TAXI"])).toEqual([
      "QB",
      "RB",
      "FLEX",
    ]);
  });
});
