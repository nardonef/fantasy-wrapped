import Link from "next/link";
import { LandingFlow } from "@/components/LandingFlow";

export default function Home() {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-[#08080a] px-[clamp(28px,5vw,72px)] pt-9 pb-8 text-[#f4f4f6]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-70"
        style={{
          background: "radial-gradient(90% 60% at 50% 34%, rgba(88,120,255,0.11), transparent 62%)",
        }}
      />

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center py-[clamp(40px,7vh,88px)] text-center">
        <h1 className="max-w-[9em] font-display text-[clamp(52px,9.2vw,148px)] font-bold leading-[0.86] tracking-[-0.045em]">
          Your season.
          <br />
          <span className="text-[#5b83ff]">Wrapped.</span>
        </h1>

        <p className="mt-8 max-w-[38ch] text-[clamp(16px,1.2vw,19px)] leading-[1.55] tracking-[-0.005em] text-pretty text-[rgba(244,244,246,0.58)]">
          Every start, sit, trade and bad beat,
          <br />
          nothing forgotten, nothing forgiven.
        </p>

        <LandingFlow />
      </main>

      <Link
        href="/api/auth/yahoo/start"
        className="relative z-10 mt-6 self-center text-[13px] font-medium text-[rgba(244,244,246,0.48)] underline decoration-[rgba(244,244,246,0.24)] underline-offset-4 transition-colors hover:text-[#5b83ff] hover:decoration-[#5b83ff]"
      >
        Connect Yahoo instead
      </Link>

      <footer className="relative z-10 border-t border-[rgba(244,244,246,0.08)] pt-[18px]">
        <p className="font-mono text-[10.5px] leading-none font-medium tracking-[0.18em] text-[rgba(244,244,246,0.34)] uppercase">
          SLEEPER &amp; YAHOO LEAGUES
          <span className="px-2.5 text-[rgba(244,244,246,0.18)]">/</span>
          ESPN COMING
        </p>
      </footer>
    </div>
  );
}
