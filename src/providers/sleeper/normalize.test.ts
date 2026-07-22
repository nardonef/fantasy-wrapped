import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { NormalizedLeagueBundle } from "@/providers/types";
import { createFixtureSleeperApi } from "./client";
import { fetchSleeperLeagueBundle } from "./index";

const LEAGUE_ID = "1269125082375008256"; // "Lonely Fans", 2025, 10-team redraft
const FIXTURE_DIR = path.join(__dirname, "../../../fixtures/sleeper", LEAGUE_ID);

describe("normalizeSleeperLeague (Lonely Fans 2025 fixture)", () => {
  let bundle: NormalizedLeagueBundle;

  beforeAll(async () => {
    bundle = await fetchSleeperLeagueBundle(createFixtureSleeperApi(FIXTURE_DIR), LEAGUE_ID);
  });

  it("normalizes league metadata", () => {
    expect(bundle.league.provider).toBe("sleeper");
    expect(bundle.league.providerLeagueId).toBe(LEAGUE_ID);
    expect(bundle.league.season).toBe(2025);
    expect(bundle.league.totalTeams).toBe(10);
    expect(bundle.league.playoffStartWeek).toBe(15);
    expect(bundle.league.playoffTeams).toBe(6);
    expect(bundle.league.lastScoredWeek).toBe(17);
    expect(bundle.league.rosterPositions.length).toBeGreaterThan(0);
  });

  it("produces one team per roster with records", () => {
    expect(bundle.teams).toHaveLength(10);
    for (const team of bundle.teams) {
      expect(team.displayName).toBeTruthy();
      expect(team.wins + team.losses + team.ties).toBeGreaterThan(0);
      expect(team.pointsFor).toBeGreaterThan(0);
    }
    const rosterIds = new Set(bundle.teams.map((t) => t.providerRosterId));
    expect(rosterIds.size).toBe(10);
  });

  it("pairs every regular-season week into 5 matchups", () => {
    for (let week = 1; week <= 14; week++) {
      const weekMatchups = bundle.matchups.filter((m) => m.week === week);
      expect(weekMatchups, `week ${week}`).toHaveLength(5);
      for (const m of weekMatchups) {
        expect(m.teamB).not.toBeNull();
        expect(m.isPlayoff).toBe(false);
        // teamA has the lower roster id — stable pairing key
        expect(Number(m.teamA)).toBeLessThan(Number(m.teamB as string));
      }
    }
  });

  it("marks playoff weeks and labels the championship", () => {
    const playoffMatchups = bundle.matchups.filter((m) => m.isPlayoff);
    expect(playoffMatchups.length).toBeGreaterThan(0);
    for (const m of playoffMatchups) {
      expect(m.week).toBeGreaterThanOrEqual(15);
    }
    const championship = bundle.matchups.find((m) => m.bracketRound === "championship");
    expect(championship).toBeDefined();
    expect(championship?.week).toBe(17);
  });

  it("assigns final ranks from the bracket, with a unique champion", () => {
    const champions = bundle.teams.filter((t) => t.finalRank === 1);
    expect(champions).toHaveLength(1);
    const runnersUp = bundle.teams.filter((t) => t.finalRank === 2);
    expect(runnersUp).toHaveLength(1);
  });

  it("splits player-weeks into starters and bench with slots", () => {
    const startingSlotCount = bundle.league.rosterPositions.filter(
      (p) => !["BN", "IR", "TAXI"].includes(p),
    ).length;
    for (const team of bundle.teams) {
      const week1 = bundle.playerWeeks.filter(
        (pw) => pw.providerRosterId === team.providerRosterId && pw.week === 1,
      );
      const starters = week1.filter((pw) => pw.started);
      expect(starters, `team ${team.providerRosterId} week 1`).toHaveLength(startingSlotCount);
      for (const s of starters) expect(s.slot).not.toBe("BN");
      for (const b of week1.filter((pw) => !pw.started)) expect(b.slot).toBe("BN");
    }
  });

  it("starter points sum to the matchup score", () => {
    const matchup = bundle.matchups.find((m) => m.week === 1);
    expect(matchup).toBeDefined();
    if (!matchup) return;
    const starterSum = bundle.playerWeeks
      .filter((pw) => pw.providerRosterId === matchup.teamA && pw.week === 1 && pw.started)
      .reduce((sum, pw) => sum + pw.points, 0);
    expect(starterSum).toBeCloseTo(matchup.teamAScore, 1);
  });

  it("resolves every referenced player to a name", () => {
    expect(bundle.players.length).toBeGreaterThan(100);
    const named = bundle.players.filter((p) => p.name !== p.providerPlayerId);
    // Nearly all players should resolve from the dump (team defenses included).
    expect(named.length / bundle.players.length).toBeGreaterThan(0.95);
  });

  it("normalizes transactions with per-roster adds/drops", () => {
    expect(bundle.transactions.length).toBeGreaterThan(0);
    for (const tx of bundle.transactions) {
      expect(["trade", "waiver", "free_agent", "commissioner"]).toContain(tx.type);
      expect(tx.week).toBeGreaterThanOrEqual(0);
    }
    const withAdds = bundle.transactions.filter((t) => Object.keys(t.assets.adds).length > 0);
    expect(withAdds.length).toBeGreaterThan(0);
  });

  it("extracts FAAB bids in a FAAB league", async () => {
    // Lonely Fans uses rolling waivers (no bids); this league uses FAAB.
    const faabLeagueId = "1257059475584471040";
    const faabBundle = await fetchSleeperLeagueBundle(
      createFixtureSleeperApi(path.join(__dirname, "../../../fixtures/sleeper", faabLeagueId)),
      faabLeagueId,
    );
    const withFaab = faabBundle.transactions.filter((t) => t.assets.faab != null);
    expect(withFaab.length).toBeGreaterThan(0);
    for (const tx of withFaab.slice(0, 10)) {
      const [rosterId, bid] = Object.entries(tx.assets.faab ?? {})[0];
      expect(tx.rosterIds).toContain(rosterId);
      expect(bid).toBeGreaterThanOrEqual(0);
    }
  });

  it("normalizes a complete draft", () => {
    expect(bundle.draftPicks).toHaveLength(150);
    const pickNos = new Set(bundle.draftPicks.map((p) => p.pickNo));
    expect(pickNos.size).toBe(150);
    for (const pick of bundle.draftPicks.slice(0, 20)) {
      expect(pick.providerPlayerId).toBeTruthy();
      expect(pick.providerRosterId).toBeTruthy();
    }
  });
});
