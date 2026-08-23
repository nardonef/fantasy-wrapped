import { CoverIntro } from "@/components/CoverIntro";
import { LandingFlow } from "@/components/LandingFlow";
import { ScoreboardTicker } from "@/components/ScoreboardTicker";

export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col px-7 pt-[108px] sm:mx-auto sm:w-full sm:max-w-md lg:mx-auto lg:grid lg:max-w-none lg:grid-cols-[1.35fr_1fr] lg:grid-rows-[1fr_auto] lg:items-start lg:gap-x-[clamp(3rem,6vw,7.5rem)] lg:px-[clamp(2rem,6vw,7.5rem)] lg:pt-[12vh] lg:pb-0">
      <CoverIntro />

      <div data-testid="landing-form">
        <LandingFlow />
      </div>

      <ScoreboardTicker className="-mx-7 mt-auto lg:col-span-2 lg:row-start-2 lg:-mx-[clamp(2rem,6vw,7.5rem)] lg:mt-16" />
    </main>
  );
}
