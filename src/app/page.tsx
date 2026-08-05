import { LandingFlow } from "@/components/LandingFlow";

export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col px-7 pt-16 pb-10 sm:mx-auto sm:w-full sm:max-w-md lg:mx-0 lg:grid lg:max-w-none lg:grid-cols-2 lg:content-center lg:items-center lg:gap-x-16 lg:gap-y-10 lg:px-16 lg:py-16">
      <header>
        <p className="label text-chalk-faint">Fantasy Football · 2025</p>
        <h1 className="display mt-5 text-[clamp(2.75rem,14vw,3.75rem)]">
          Your season,
          <br />
          <span className="text-flag">told straight.</span>
        </h1>
        <p className="mt-5 max-w-[34ch] text-[15px] leading-[1.55] text-pretty text-chalk-dim">
          Every start, sit, trade and bad beat — handed back to you with precision and a little
          cruelty. Built to be screenshotted.
        </p>
      </header>

      <div
        data-testid="landing-panel"
        className="lg:border lg:border-chalk/15 lg:bg-field-raised lg:p-10"
      >
        <LandingFlow />
      </div>

      <footer className="label mt-auto pt-12 text-chalk-faint lg:col-span-2 lg:mt-0 lg:pt-0">
        Sleeper leagues · ESPN &amp; Yahoo coming
      </footer>
    </main>
  );
}
