"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PendingStoryOverlay } from "@/components/PendingStoryOverlay";

type League = { leagueId: string; name: string; season: number; status: string; teams: number };
type SyncedTeam = {
  rosterId: string;
  displayName: string;
  teamName: string | null;
  record: string;
};
type Synced = {
  leagueId: string;
  season: number;
  name: string;
  teams: SyncedTeam[];
  /** The syncing user's own roster, when Sleeper's owner id matched one. */
  yourRosterId: string | null;
};

type Phase =
  | { step: "user" }
  | { step: "leagues"; leagues: League[] }
  | { step: "syncing"; leagueName: string }
  | { step: "teams"; synced: Synced };

const SEASONS = [2025, 2024, 2023];
const EASE = [0.16, 1, 0.3, 1] as const;

/** Every list on this page is hairline-ruled rather than boxed. */
const LIST = "mt-3 divide-y divide-chalk/12 border-y border-chalk/12";

export function LandingFlow() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ step: "user" });
  const [username, setUsername] = useState("");
  const [season, setSeason] = useState(SEASONS[0]);
  const [userId, setUserId] = useState<string | null>(null);
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
      setUserId(data.userId);
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
        body: JSON.stringify({ leagueId: league.leagueId, userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      if (data.yourRosterId) {
        // Known team — skip the picker and go straight to the story. Stay on
        // the "syncing" phase (and its animation) until the new route takes
        // over, rather than flash the team list first.
        router.push(`/w/sleeper/${data.leagueId}/${data.season}/${data.yourRosterId}`);
        return;
      }
      setPhase({ step: "teams", synced: data });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
      setPhase({ step: "user" });
    }
  }

  return (
    <div className="mt-10 lg:mt-8">
      <AnimatePresence mode="wait">
        {phase.step === "user" && (
          <motion.form
            key="user"
            onSubmit={findLeagues}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="lg:flex lg:flex-col lg:gap-[14px]"
          >
            <label
              htmlFor="username"
              className="font-mono text-[9px] font-medium uppercase tracking-[0.2em] text-chalk-faint"
            >
              Sleeper username
            </label>
            <div className="mt-3 flex items-stretch gap-[10px] lg:mt-0">
              <input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. frothydogs"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-h-11 min-w-0 flex-1 border border-chalk/15 bg-transparent px-[12px] py-[14px] font-mono text-[15px] text-chalk outline-none transition-colors placeholder:text-chalk-faint focus:border-flag"
              />
              <button
                type="submit"
                disabled={busy}
                className="flex h-[46px] shrink-0 items-center justify-center bg-flag px-[18px] font-mono text-[12px] font-bold tracking-[0.06em] text-field transition-opacity hover:opacity-85 disabled:opacity-60"
              >
                {busy ? "…" : "GO"}
              </button>
            </div>
            <div className="mt-5 flex gap-2 lg:mt-4">
              {SEASONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeason(s)}
                  className={`border px-[13px] py-[7px] font-mono text-[10px] font-medium tracking-[0.12em] transition-colors ${
                    s === season
                      ? "border-flag text-flag"
                      : "border-chalk/15 text-chalk-faint hover:border-chalk-muted"
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
          >
            <p className="label text-chalk-faint">Pick your league</p>
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
                      <span className="display block truncate text-xl group-hover:text-flag">
                        {league.name}
                      </span>
                      <span className="label mt-1.5 block text-chalk-faint">
                        {league.teams} teams · {league.season}
                      </span>
                    </span>
                    <span className="display shrink-0 text-xl text-chalk-faint group-hover:text-flag">
                      →
                    </span>
                  </button>
                </motion.li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setPhase({ step: "user" })}
              className="label mt-5 text-chalk-faint underline underline-offset-4"
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
            <LoadingScreen
              title="Pulling the tape…"
              description={`Reading every week of ${phase.leagueName}. Nothing will be forgotten.`}
            />
          </motion.div>
        )}

        {phase.step === "teams" && (
          <motion.div
            key="teams"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <p className="label text-chalk-faint">{phase.synced.name} · who are you?</p>
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
                      <span className="display block truncate text-lg group-hover:text-flag">
                        {team.displayName}
                      </span>
                      {team.teamName && (
                        <span className="label mt-1.5 block text-chalk-faint">{team.teamName}</span>
                      )}
                    </span>
                    <span className="label shrink-0 text-chalk-faint">{team.record}</span>
                    <PendingStoryOverlay />
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
          className="mt-5 border-l-2 border-card-red bg-field-raised px-4 py-3 text-[14px] leading-[1.5] text-card-red"
          role="alert"
        >
          {error}
        </motion.p>
      )}
    </div>
  );
}
