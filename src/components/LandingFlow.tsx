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
const EASE = [0.16, 1, 0.3, 1] as const;

/** Every list on this page is hairline-ruled rather than boxed. */
const LIST = "mt-3 divide-y divide-[var(--sb-hairline)] border-y border-[var(--sb-hairline)]";

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
    <div className="flex flex-1 flex-col">
      <AnimatePresence mode="wait">
        {phase.step === "user" && (
          <motion.form
            key="user"
            onSubmit={findLeagues}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.6, delay: 0.4, ease: EASE }}
            className="mt-auto pb-[34px]"
          >
            <label
              htmlFor="username"
              className="block font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--sb-ink-tertiary)]"
            >
              Sleeper username
            </label>
            <div className="mt-3 flex gap-[10px]">
              <input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. frothydogs"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-h-11 flex-1 border border-[var(--sb-hairline)] bg-transparent px-3 py-3.5 font-mono text-[15px] text-[var(--sb-ink)] outline-none transition-colors placeholder:text-[var(--sb-ink-tertiary)] focus:border-[var(--sb-accent)]"
              />
              <button
                type="submit"
                disabled={busy}
                className="h-[46px] shrink-0 bg-[var(--sb-accent)] px-[18px] font-mono text-[12px] font-bold tracking-[0.06em] text-[var(--sb-bg)] uppercase transition-opacity hover:opacity-85 disabled:opacity-60"
              >
                {busy ? "…" : "Go"}
              </button>
            </div>
            <div className="mt-5 flex gap-2">
              {SEASONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeason(s)}
                  className={`border px-[13px] py-[7px] font-mono text-[10px] font-medium tracking-[0.12em] transition-colors ${
                    s === season
                      ? "border-[var(--sb-accent)] text-[var(--sb-accent)]"
                      : "border-[var(--sb-hairline)] text-[var(--sb-ink-tertiary)] hover:border-[var(--sb-hairline-strong)]"
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
            transition={{ duration: 0.3, ease: EASE }}
            className="mt-10"
          >
            <p className="label text-[var(--sb-ink-tertiary)]">Pick your league</p>
            <ul className={LIST}>
              {phase.leagues.map((league, i) => (
                <motion.li
                  key={league.leagueId}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.4, ease: EASE }}
                >
                  <button
                    type="button"
                    onClick={() => syncLeague(league)}
                    className="group flex w-full items-center justify-between gap-4 py-4 text-left"
                  >
                    <span className="min-w-0">
                      <span className="display block truncate text-xl group-hover:text-[var(--sb-accent)]">
                        {league.name}
                      </span>
                      <span className="label mt-1.5 block text-[var(--sb-ink-tertiary)]">
                        {league.teams} teams · {league.season}
                      </span>
                    </span>
                    <span className="display shrink-0 text-xl text-[var(--sb-ink-tertiary)] group-hover:text-[var(--sb-accent)]">
                      →
                    </span>
                  </button>
                </motion.li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setPhase({ step: "user" })}
              className="label mt-5 text-[var(--sb-ink-tertiary)] underline underline-offset-4"
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
            className="mt-10 py-6"
          >
            <div className="h-px w-full bg-[var(--sb-hairline)]">
              <motion.div
                className="h-full origin-left bg-[var(--sb-accent)]"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: [0, 0.55, 0.8, 0.94] }}
                transition={{ duration: 8, times: [0, 0.3, 0.7, 1], ease: "easeOut" }}
              />
            </div>
            <p className="display mt-7 text-3xl">Pulling the tape…</p>
            <p className="mt-3 text-[15px] leading-[1.55] text-[var(--sb-ink-secondary)]">
              Reading every week of {phase.leagueName}. Nothing will be forgotten.
            </p>
          </motion.div>
        )}

        {phase.step === "teams" && (
          <motion.div
            key="teams"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="mt-10"
          >
            <p className="label text-[var(--sb-ink-tertiary)]">{phase.synced.name} · who are you?</p>
            <ul className={LIST}>
              {phase.synced.teams.map((team, i) => (
                <motion.li
                  key={team.rosterId}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.4, ease: EASE }}
                >
                  <Link
                    href={`/w/sleeper/${phase.synced.leagueId}/${phase.synced.season}/${team.rosterId}`}
                    className="group flex w-full items-baseline justify-between gap-4 py-3.5"
                  >
                    <span className="min-w-0">
                      <span className="display block truncate text-lg group-hover:text-[var(--sb-accent)]">
                        {team.displayName}
                      </span>
                      {team.teamName && (
                        <span className="label mt-1.5 block text-[var(--sb-ink-tertiary)]">
                          {team.teamName}
                        </span>
                      )}
                    </span>
                    <span className="label shrink-0 text-[var(--sb-ink-tertiary)]">{team.record}</span>
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
          className="mt-5 border-l-2 border-card-red bg-[var(--sb-raised)] px-4 py-3 text-[14px] leading-[1.5] text-card-red"
          role="alert"
        >
          {error}
        </motion.p>
      )}
    </div>
  );
}
