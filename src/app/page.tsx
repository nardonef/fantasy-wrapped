import Link from "next/link";
import { LandingFlow } from "@/components/LandingFlow";

export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col px-7 pt-16 pb-10 sm:mx-auto sm:w-full sm:max-w-md">
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

      <LandingFlow />

      <Link
        href="/api/auth/yahoo/start"
        className="label mt-6 block border border-chalk/20 px-4 py-3.5 text-center transition-colors hover:border-flag hover:text-flag"
      >
        Connect Yahoo instead
      </Link>

      <footer className="label mt-auto pt-12 text-chalk-faint">
        Sleeper &amp; Yahoo leagues · ESPN coming
      </footer>
    </main>
  );
}
