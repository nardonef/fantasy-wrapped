"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PendingStoryOverlay } from "@/components/PendingStoryOverlay";

type League = { leagueKey: string; name: string; season: number; teams: number };
type SyncedTeam = { rosterId: string; displayName: string; teamName: string | null; record: string };
type Synced = { leagueId: string; season: number; name: string; teams: SyncedTeam[]; yourRosterId: string | null };

type Phase =
  | { step: "loading" }
  | { step: "leagues"; leagues: League[]; guid: string }
  | { step: "syncing"; leagueName: string }
  | { step: "teams"; synced: Synced }
  | { step: "error"; message: string };

const EASE = [0.16, 1, 0.3, 1] as const;
const LIST = "mt-3 divide-y divide-chalk/12 border-y border-chalk/12";

export function YahooConnectFlow() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ step: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/yahoo/leagues")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load your Yahoo leagues.");
        if (cancelled) return;
        if (data.leagues.length === 0) {
          setPhase({ step: "error", message: "No NFL fantasy leagues found on this Yahoo account." });
          return;
        }
        setPhase({ step: "leagues", leagues: data.leagues, guid: data.guid });
      })
      .catch((err) => {
        if (!cancelled) {
          setPhase({ step: "error", message: err instanceof Error ? err.message : "Something went wrong" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function syncLeague(league: League, guid: string) {
    setPhase({ step: "syncing", leagueName: league.name });
    try {
      const res = await fetch("/api/yahoo/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leagueKey: league.leagueKey, guid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      if (data.yourRosterId) {
        router.push(`/w/yahoo/${data.leagueId}/${data.season}/${data.yourRosterId}`);
        return;
      }
      setPhase({ step: "teams", synced: data });
    } catch (err) {
      setPhase({ step: "error", message: err instanceof Error ? err.message : "Sync failed" });
    }
  }

  return (
    <div className="mt-10">
      <AnimatePresence mode="wait">
        {phase.step === "loading" && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-6">
            <LoadingScreen title="Checking your Yahoo leagues…" description="One second." />
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
                  key={league.leagueKey}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.4, ease: EASE }}
                >
                  <button
                    type="button"
                    onClick={() => syncLeague(league, phase.guid)}
                    className="group flex w-full items-center justify-between gap-4 py-4 text-left"
                  >
                    <span className="min-w-0">
                      <span className="display block truncate text-xl group-hover:text-flag">{league.name}</span>
                      <span className="label mt-1.5 block text-chalk-faint">
                        {league.teams} teams · {league.season}
                      </span>
                    </span>
                    <span className="display shrink-0 text-xl text-chalk-faint group-hover:text-flag">→</span>
                  </button>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}

        {phase.step === "syncing" && (
          <motion.div key="syncing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-6">
            <LoadingScreen
              title="Pulling the tape…"
              description={`Reading every week of ${phase.leagueName}. Nothing will be forgotten.`}
            />
          </motion.div>
        )}

        {phase.step === "teams" && (
          <motion.div key="teams" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
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
                    href={`/w/yahoo/${phase.synced.leagueId}/${phase.synced.season}/${team.rosterId}`}
                    className="group flex w-full items-baseline justify-between gap-4 py-3.5"
                  >
                    <span className="min-w-0">
                      <span className="display block truncate text-lg group-hover:text-flag">{team.displayName}</span>
                      {team.teamName && <span className="label mt-1.5 block text-chalk-faint">{team.teamName}</span>}
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

      {phase.step === "error" && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-5 border-l-2 border-card-red bg-field-raised px-4 py-3 text-[14px] leading-[1.5] text-card-red"
          role="alert"
        >
          {phase.message}
        </motion.p>
      )}
    </div>
  );
}
