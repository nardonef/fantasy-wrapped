import { LandingFlow } from "@/components/LandingFlow";

export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col px-7 pt-16 pb-10 sm:mx-auto sm:w-full sm:max-w-md lg:mx-auto lg:grid lg:max-w-none lg:grid-cols-12 lg:grid-rows-[1fr_auto] lg:items-center lg:gap-x-[clamp(1.5rem,3vw,3rem)] lg:px-[clamp(2rem,6vw,7.5rem)] lg:py-0">
      <header className="lg:col-start-1 lg:col-span-6 lg:flex lg:flex-col lg:gap-[28px]">
        <p className="label text-chalk-faint lg:text-[12px] lg:tracking-[0.18em]">
          Fantasy Football · 2025
        </p>
        <h1 className="display mt-5 text-[clamp(2.75rem,14vw,3.75rem)] lg:mt-0 lg:text-[clamp(48px,5.6vw,88px)] lg:font-bold lg:leading-[0.98] lg:tracking-[-0.03em]">
          Your season.
          <br />
          <span className="text-flag">Wrapped.</span>
        </h1>
        <p className="mt-5 max-w-[34ch] text-[15px] leading-[1.55] text-pretty text-chalk-dim lg:mt-0 lg:max-w-[30ch] lg:text-[17px] lg:leading-[1.6]">
          Every start, sit, trade and bad beat.
          <br />
          Nothing forgotten, nothing forgiven.
        </p>
      </header>

      <div data-testid="landing-form" className="lg:col-start-8 lg:col-span-4">
        <LandingFlow />
      </div>

      <footer className="label mt-auto pt-12 text-chalk-faint lg:col-span-12 lg:row-start-2 lg:mt-0 lg:pt-0 lg:pb-10 lg:text-[11px] lg:tracking-[0.18em] lg:text-chalk-muted">
        Sleeper leagues · ESPN &amp; Yahoo coming
      </footer>
    </main>
  );
}
