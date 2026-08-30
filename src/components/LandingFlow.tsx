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
    <div
      data-testid="landing-form"
      className="mt-[clamp(40px,6vh,72px)] w-full max-w-[520px] text-left"
    >
      <AnimatePresence mode="wait">
        {phase.step === "user" && (
          <motion.form
            key="user"
            onSubmit={findLeagues}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="flex w-full flex-col items-stretch gap-3"
          >
            <label
              htmlFor="username"
              className="font-mono text-[10.5px] leading-none font-medium tracking-[0.18em] text-[rgba(244,244,246,0.46)] uppercase"
            >
              Sleeper username
            </label>

            <div
              className={`flex items-stretch overflow-hidden rounded-[4px] border bg-[rgba(244,244,246,0.035)] transition-colors duration-150 ease-out focus-within:border-[#5b83ff] focus-within:ring-2 focus-within:ring-[rgba(91,131,255,0.35)] ${
                error ? "border-[rgba(242,84,45,0.6)]" : "border-[rgba(244,244,246,0.14)]"
              }`}
            >
              <input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="frothydogs"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={busy}
                className="h-[60px] min-w-0 flex-1 bg-transparent px-5 font-mono text-[15px] tracking-[0.01em] text-[#f4f4f6] outline-none placeholder:text-[rgba(255,255,255,0.26)] disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={busy}
                className="flex w-[92px] shrink-0 items-center justify-center bg-[#5b83ff] font-mono text-[11px] font-medium tracking-[0.20em] text-[#08080a] uppercase transition-colors duration-150 ease-out hover:bg-[#7c9dff] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {busy ? "…" : "Go"}
              </button>
            </div>

            <div role="radiogroup" aria-label="Season" className="flex flex-wrap items-center gap-2 pt-2">
              <span className="pr-1.5 font-mono text-[10.5px] leading-none font-medium tracking-[0.18em] text-[rgba(244,244,246,0.32)] uppercase">
                Season
              </span>
              {SEASONS.map((s) => {
                const selected = s === season;
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setSeason(s)}
                    className={`min-h-8 rounded-[3px] border px-[14px] py-[9px] font-mono text-xs leading-none tracking-[0.06em] transition-all duration-150 ease-out [@media(pointer:coarse)]:min-h-11 ${
                      selected
                        ? "border-[#5b83ff] bg-[rgba(91,131,255,0.14)] text-[#f4f4f6]"
                        : "border-[rgba(244,244,246,0.14)] text-[rgba(244,244,246,0.46)] hover:border-[rgba(244,244,246,0.28)] hover:text-[rgba(244,244,246,0.70)]"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>

            <p
              role="alert"
              className="min-h-[14px] font-mono text-[10.5px] leading-none font-medium tracking-[0.18em] text-[#ff4a31] uppercase"
            >
              {error}
            </p>

            <p className="text-[13px] leading-[1.6] text-[rgba(244,244,246,0.36)]">
              Public leagues only. We never ask for a password.
            </p>
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
    </div>
  );
}
