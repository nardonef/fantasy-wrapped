import { LandingFlow } from "@/components/LandingFlow";

export default function Home() {
  return (
    <main className="yardlines relative flex min-h-dvh flex-col px-6 pt-14 pb-10 sm:mx-auto sm:w-full sm:max-w-md">
      <header>
        <p className="text-xs tracking-[0.35em] text-chalk-dim uppercase">
          Fantasy Football · 2025
        </p>
        <h1 className="display mt-4 text-[clamp(3.4rem,17vw,5.5rem)]">
          Your season,
          <br />
          <span className="text-flag">told straight.</span>
        </h1>
        <p className="mt-5 max-w-[34ch] text-sm leading-relaxed text-chalk-dim">
          Every start, sit, trade and bad beat — handed back to you with precision and a little
          cruelty. Built to be screenshotted.
        </p>
      </header>

      <LandingFlow />

      <footer className="mt-auto pt-12 text-[10px] tracking-widest text-chalk-dim/60 uppercase">
        Sleeper leagues · ESPN &amp; Yahoo coming
      </footer>
    </main>
  );
}
