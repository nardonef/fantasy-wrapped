"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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

type Provider = "sleeper" | "yahoo";
const PROVIDER_STORAGE_KEY = "wrapped:lastProvider";

export function LandingFlow() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ step: "user" });
  const [provider, setProviderState] = useState<Provider>("sleeper");
  const [username, setUsername] = useState("");
  const [season, setSeason] = useState(SEASONS[0]);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sleeperTabRef = useRef<HTMLButtonElement>(null);
  const yahooTabRef = useRef<HTMLButtonElement>(null);

  // Read the last-used provider after mount, not in the initializer, so the
  // server-rendered markup (which has no access to localStorage) matches the
  // client's first render and React doesn't flag a hydration mismatch.
  useEffect(() => {
    const stored = window.localStorage.getItem(PROVIDER_STORAGE_KEY);
    if (stored === "sleeper" || stored === "yahoo") setProviderState(stored);
  }, []);

  function setProvider(next: Provider) {
    setProviderState(next);
    window.localStorage.setItem(PROVIDER_STORAGE_KEY, next);
  }

  function handleTabKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next: Provider = provider === "sleeper" ? "yahoo" : "sleeper";
    setProvider(next);
    (next === "sleeper" ? sleeperTabRef : yahooTabRef).current?.focus();
  }

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
    <div data-testid="landing-form" className="mt-[44px] w-full max-w-[460px] text-left">
      <AnimatePresence mode="wait">
        {phase.step === "user" && (
          <motion.div
            key="user"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="flex w-full flex-col items-stretch gap-5"
          >
            <div className="flex flex-col gap-2.5">
              <span
                id="provider-label"
                className="font-mono text-[11px] leading-none font-medium tracking-[0.16em] text-[#6d6d7c] uppercase"
              >
                Where do you play?
              </span>
              <div
                role="tablist"
                aria-labelledby="provider-label"
                onKeyDown={handleTabKeyDown}
                className="flex gap-1 rounded-[11px] border border-[#22222e] bg-[#101018] p-1"
              >
                <button
                  ref={sleeperTabRef}
                  type="button"
                  role="tab"
                  id="provider-tab-sleeper"
                  aria-selected={provider === "sleeper"}
                  aria-controls="provider-panel-sleeper"
                  tabIndex={provider === "sleeper" ? 0 : -1}
                  onClick={() => setProvider("sleeper")}
                  className={`flex h-12 flex-1 items-center justify-center gap-2.5 rounded-[8px] font-display text-[15px] font-semibold transition-all duration-150 ease-out ${
                    provider === "sleeper"
                      ? "border border-[#5b7cf666] bg-[#1c1f33] text-[#f4f4f7] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                      : "border border-transparent text-[#75758a]"
                  }`}
                >
                  <span className="size-5 shrink-0 rounded-[6px] bg-[#5b7cf6]" aria-hidden />
                  Sleeper
                </button>
                <button
                  ref={yahooTabRef}
                  type="button"
                  role="tab"
                  id="provider-tab-yahoo"
                  aria-selected={provider === "yahoo"}
                  aria-controls="provider-panel-yahoo"
                  tabIndex={provider === "yahoo" ? 0 : -1}
                  onClick={() => setProvider("yahoo")}
                  className={`flex h-12 flex-1 items-center justify-center gap-2.5 rounded-[8px] font-display text-[15px] font-semibold transition-all duration-150 ease-out ${
                    provider === "yahoo"
                      ? "border border-[#7b3fe466] bg-[#1c1f33] text-[#f4f4f7] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                      : "border border-transparent text-[#75758a]"
                  }`}
                >
                  <span className="size-5 shrink-0 rounded-[6px] bg-[#7b3fe4]" aria-hidden />
                  Yahoo
                </button>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {provider === "sleeper" && (
                <motion.form
                  key="sleeper"
                  id="provider-panel-sleeper"
                  role="tabpanel"
                  aria-labelledby="provider-tab-sleeper"
                  onSubmit={findLeagues}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="flex flex-col gap-4"
                >
                  <div className="flex flex-col gap-2.5">
                    <label
                      htmlFor="username"
                      className="font-mono text-[11px] leading-none font-medium tracking-[0.16em] text-[#6d6d7c] uppercase"
                    >
                      Sleeper username
                    </label>
                    <div className="flex h-[58px]">
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
                        className={`min-w-0 flex-1 rounded-l-[9px] border border-r-0 bg-[#0e0e16] px-[18px] font-mono text-[15px] text-[#f4f4f7] outline-none transition-colors duration-150 ease-out placeholder:text-[#4a4a58] disabled:opacity-60 ${
                          error ? "border-[#ff4a31]" : "border-[#262633] focus:border-[#5b7cf6]"
                        }`}
                      />
                      <button
                        type="submit"
                        disabled={busy}
                        className="flex w-[108px] shrink-0 items-center justify-center rounded-r-[9px] bg-[#5b7cf6] font-mono text-[12px] font-medium tracking-[0.18em] text-[#0b0b12] transition-colors duration-150 ease-out hover:bg-[#7089f8] disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {busy ? "…" : "GO"}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3.5">
                    <span className="font-mono text-[11px] leading-none font-medium tracking-[0.16em] text-[#6d6d7c] uppercase">
                      Season
                    </span>
                    <div role="radiogroup" aria-label="Season" className="flex flex-wrap gap-2">
                      {SEASONS.map((s) => {
                        const selected = s === season;
                        return (
                          <label
                            key={s}
                            className={`inline-flex h-9 cursor-pointer items-center justify-center rounded-[7px] border px-[13px] pt-[2px] font-mono text-[13px] leading-none transition-colors duration-150 ease-out [@media(pointer:coarse)]:h-11 ${
                              selected
                                ? "border-[#5b7cf6] bg-[#1c1f33] text-[#f4f4f7]"
                                : "border-[#262633] text-[#75758a]"
                            }`}
                          >
                            <input
                              type="radio"
                              name="season"
                              value={s}
                              checked={selected}
                              onChange={() => setSeason(s)}
                              className="sr-only"
                            />
                            {s}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <p
                    role={error ? "alert" : undefined}
                    className={`m-0 text-[13px] leading-[1.5] ${error ? "text-[#ff4a31]" : "text-[#5d5d6b]"}`}
                  >
                    {error ??
                      "Public leagues only. Username is all we need, we never ask for a password."}
                  </p>
                </motion.form>
              )}

              {provider === "yahoo" && (
                <motion.div
                  key="yahoo"
                  id="provider-panel-yahoo"
                  role="tabpanel"
                  aria-labelledby="provider-tab-yahoo"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="flex flex-col gap-4"
                >
                  <div className="flex flex-col gap-2.5">
                    <span className="font-mono text-[11px] leading-none font-medium tracking-[0.16em] text-[#6d6d7c] uppercase">
                      Yahoo fantasy account
                    </span>
                    <button
                      type="button"
                      disabled
                      className="flex h-[58px] cursor-not-allowed items-center justify-center rounded-[9px] bg-[#7b3fe4] font-display text-[16px] font-semibold text-white opacity-50"
                    >
                      Continue with Yahoo
                    </button>
                  </div>

                  <div className="flex items-center gap-3.5">
                    <span className="font-mono text-[11px] leading-none font-medium tracking-[0.16em] text-[#6d6d7c] uppercase">
                      Season
                    </span>
                    <div role="radiogroup" aria-label="Season" className="flex flex-wrap gap-2">
                      {SEASONS.map((s) => {
                        const selected = s === season;
                        return (
                          <label
                            key={s}
                            className={`inline-flex h-9 cursor-pointer items-center justify-center rounded-[7px] border px-[13px] pt-[2px] font-mono text-[13px] leading-none transition-colors duration-150 ease-out [@media(pointer:coarse)]:h-11 ${
                              selected
                                ? "border-[#7b3fe4] bg-[#1c1f33] text-[#f4f4f7]"
                                : "border-[#262633] text-[#75758a]"
                            }`}
                          >
                            <input
                              type="radio"
                              name="season"
                              value={s}
                              checked={selected}
                              onChange={() => setSeason(s)}
                              className="sr-only"
                            />
                            {s}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <p className="m-0 text-[13px] leading-[1.5] text-[#5d5d6b]">
                    Yahoo support is coming soon.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
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
