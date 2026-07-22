/**
 * Optimal lineup solver.
 *
 * Exact dynamic program over slot subsets (slots ≤ ~10 → ≤ 1024 states).
 * Greedy is NOT exact here: eligibility sets are not laminar once slots like
 * REC_FLEX (WR/TE) and WRRB_FLEX (WR/RB) coexist — they overlap without
 * nesting, which breaks the matroid property. lineup.test.ts verifies this
 * solver against brute-force enumeration.
 */

export type LineupPlayer = {
  id: string;
  position: string | null;
  points: number;
};

export type LineupAssignment = {
  slot: string;
  playerId: string;
  points: number;
};

export const SLOT_ELIGIBILITY: Record<string, readonly string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["WR", "RB"],
  WRRB_WRT: ["WR", "RB"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  DL: ["DL"],
  LB: ["LB"],
  DB: ["DB"],
  IDP_FLEX: ["DL", "LB", "DB"],
};

export const NON_STARTING_SLOTS = new Set(["BN", "IR", "TAXI"]);

export function startingSlots(rosterPositions: string[]): string[] {
  return rosterPositions.filter((p) => !NON_STARTING_SLOTS.has(p));
}

/**
 * Maximum-points legal lineup from the given player pool. Deterministic:
 * players considered in points-then-id order, backtrack prefers earlier slots.
 */
export function optimalLineup(
  slots: string[],
  players: LineupPlayer[],
): { total: number; assignments: LineupAssignment[] } {
  const slotCount = slots.length;
  const stateCount = 1 << slotCount;
  const eligibleMaskByPlayer = (player: LineupPlayer): number => {
    if (!player.position) return 0;
    let mask = 0;
    for (let s = 0; s < slotCount; s++) {
      if ((SLOT_ELIGIBILITY[slots[s]] ?? []).includes(player.position)) mask |= 1 << s;
    }
    return mask;
  };

  const pool = [...players]
    .sort((a, b) => b.points - a.points || a.id.localeCompare(b.id))
    .map((p) => ({ ...p, eligibleMask: eligibleMaskByPlayer(p) }))
    .filter((p) => p.eligibleMask !== 0);

  // dp[mask] = best total with exactly the slots in `mask` filled.
  const dp = new Float64Array(stateCount).fill(Number.NEGATIVE_INFINITY);
  dp[0] = 0;
  // choice[i][mask]: slot index + 1 the i-th player occupies in the best
  // solution reaching `mask` after considering players 0..i, or 0 for skip.
  const choices: Uint8Array[] = [];

  for (const player of pool) {
    const next = Float64Array.from(dp);
    const choice = new Uint8Array(stateCount);
    for (let mask = 0; mask < stateCount; mask++) {
      let candidates = player.eligibleMask & mask;
      while (candidates !== 0) {
        const slotBit = candidates & -candidates;
        candidates ^= slotBit;
        const prev = dp[mask ^ slotBit];
        if (prev === Number.NEGATIVE_INFINITY) continue;
        const value = prev + player.points;
        if (value > next[mask]) {
          next[mask] = value;
          choice[mask] = 32 - Math.clz32(slotBit); // slot index + 1
        }
      }
    }
    dp.set(next);
    choices.push(choice);
  }

  let bestMask = 0;
  for (let mask = 1; mask < stateCount; mask++) {
    if (dp[mask] > dp[bestMask]) bestMask = mask;
  }
  const total = dp[bestMask] === Number.NEGATIVE_INFINITY ? 0 : dp[bestMask];

  const assignments: LineupAssignment[] = [];
  let mask = bestMask;
  for (let i = pool.length - 1; i >= 0; i--) {
    const slotPlusOne = choices[i][mask];
    if (slotPlusOne !== 0) {
      const slotIndex = slotPlusOne - 1;
      assignments.push({ slot: slots[slotIndex], playerId: pool[i].id, points: pool[i].points });
      mask ^= 1 << slotIndex;
    }
  }
  assignments.reverse();

  return { total, assignments };
}
