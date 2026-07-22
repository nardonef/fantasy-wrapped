"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

type League = { leagueId: string; name: string; season: number; status: string; teams: number };
type SyncedTeam = {
  rosterId: string;
  displayName: string;
  teamName: string | null;
  record: string;
};
type Synced = { leagueId: string; season: number; name: string; teams: SyncedTeam[] };

type Phase =
  | { step: "user" }
  | { step: "leagues"; leagues: League[] }
  | { step: "syncing"; leagueName: string }
  | { step: "teams"; synced: Synced };

const SEASONS = [2025, 2024, 2023];

export function LandingFlow() {
  const [phase, setPhase] = useState<Phase>({ step: "user" });
  const [username, setUsername] = useState("");
  const [season, setSeason] = useState(SEASONS[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function findLeagues(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sleeper/leagues?username=${encodeURIComponent(username.trim())}&season=${season}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      if (data.leagues.length === 0) {
        throw new Error(`No ${season} leagues found for “${username.trim()}”`);
      }
      setPhase({ step: "leagues", leagues: data.leagues });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function syncLeague(league: League) {
    setPhase({ step: "syncing", leagueName: league.name });
    setError(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leagueId: league.leagueId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setPhase({ step: "teams", synced: data });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
      setPhase({ step: "user" });
    }
  }

  return (
    <div className="mt-10">
      <AnimatePresence mode="wait">
        {phase.step === "user" && (
          <motion.form
            key="user"
            onSubmit={findLeagues}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.25 }}
          >
            <label
              htmlFor="username"
              className="block text-[10px] tracking-[0.3em] text-chalk-dim uppercase"
            >
              Sleeper username
            </label>
            <div className="mt-2 flex border-2 border-chalk/25 focus-within:border-flag">
              <input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. frothydogs"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="w-full bg-transparent px-4 py-3.5 font-mono text-base outline-none placeholder:text-chalk-dim/40"
              />
              <button
                type="submit"
                disabled={busy}
                className="display shrink-0 bg-flag px-5 text-lg text-field disabled:opacity-60"
              >
                {busy ? "…" : "Go"}
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              {SEASONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeason(s)}
                  className={`border px-3 py-1 font-mono text-xs ${
                    s === season
                      ? "border-flag bg-flag/10 text-flag"
                      : "border-chalk/20 text-chalk-dim"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </motion.form>
        )}

        {phase.step === "leagues" && (
          <motion.div
            key="leagues"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.25 }}
          >
            <p className="text-[10px] tracking-[0.3em] text-chalk-dim uppercase">
              Pick your league
            </p>
            <ul className="mt-3 divide-y divide-chalk/10 border-y border-chalk/10">
              {phase.leagues.map((league, i) => (
                <motion.li
                  key={league.leagueId}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <button
                    type="button"
                    onClick={() => syncLeague(league)}
                    className="group flex w-full items-center justify-between px-1 py-4 text-left"
                  >
                    <span>
                      <span className="block font-mono text-sm font-bold group-hover:text-flag">
                        {league.name}
                      </span>
                      <span className="mt-0.5 block font-mono text-xs text-chalk-dim">
                        {league.teams} teams · {league.season}
                      </span>
                    </span>
                    <span className="display text-2xl text-chalk-dim group-hover:text-flag">→</span>
                  </button>
                </motion.li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setPhase({ step: "user" })}
              className="mt-4 font-mono text-xs text-chalk-dim underline underline-offset-4"
            >
              different username
            </button>
          </motion.div>
        )}

        {phase.step === "syncing" && (
          <motion.div
            key="syncing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="py-6"
          >
            <motion.div
              className="h-1.5 w-full origin-left bg-flag"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: [0, 0.55, 0.8, 0.94] }}
              transition={{ duration: 8, times: [0, 0.3, 0.7, 1], ease: "easeOut" }}
            />
            <p className="display mt-6 text-3xl">Pulling the tape…</p>
            <p className="mt-2 font-mono text-xs text-chalk-dim">
              Reading every week of {phase.leagueName}. Nothing will be forgotten.
            </p>
          </motion.div>
        )}

        {phase.step === "teams" && (
          <motion.div
            key="teams"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <p className="text-[10px] tracking-[0.3em] text-chalk-dim uppercase">
              {phase.synced.name} · who are you?
            </p>
            <ul className="mt-3 divide-y divide-chalk/10 border-y border-chalk/10">
              {phase.synced.teams.map((team, i) => (
                <motion.li
                  key={team.rosterId}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <Link
                    href={`/w/sleeper/${phase.synced.leagueId}/${phase.synced.season}/${team.rosterId}`}
                    className="group flex w-full items-center justify-between px-1 py-3.5"
                  >
                    <span>
                      <span className="block font-mono text-sm font-bold group-hover:text-flag">
                        {team.displayName}
                      </span>
                      {team.teamName && (
                        <span className="mt-0.5 block font-mono text-xs text-chalk-dim">
                          {team.teamName}
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-xs text-chalk-dim">{team.record}</span>
                  </Link>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 border-l-2 border-card-red pl-3 font-mono text-xs text-card-red"
          role="alert"
        >
          {error}
        </motion.p>
      )}
    </div>
  );
}
