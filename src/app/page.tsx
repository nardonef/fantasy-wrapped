import { CoverIntro } from "@/components/CoverIntro";
import { LandingFlow } from "@/components/LandingFlow";
import { ScoreboardTicker } from "@/components/ScoreboardTicker";

export default function Home() {
  return (
    <main className="scoreboard relative flex min-h-dvh flex-col bg-[var(--sb-bg)] px-7 pt-[108px] text-[var(--sb-ink)] sm:mx-auto sm:w-full sm:max-w-md">
      <CoverIntro />

      <LandingFlow />

      <ScoreboardTicker />
    </main>
  );
}
