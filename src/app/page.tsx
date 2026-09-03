import { LandingFlow } from "@/components/LandingFlow";

export default function Home() {
  return (
    <div
      className="relative isolate flex min-h-dvh flex-col overflow-hidden text-[#f4f4f7]"
      style={{
        background: "radial-gradient(120% 90% at 50% -10%, #16182a 0%, #0b0b12 55%, #08080c 100%)",
      }}
    >
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pt-[76px] pb-16 text-center">
        <h1 className="font-display text-[clamp(46px,7vw,92px)] font-extrabold leading-[0.92] tracking-[-0.04em]">
          Your season.
          <br />
          <span className="text-[#5b7cf6]">Wrapped.</span>
        </h1>

        <p className="mt-[22px] max-w-[430px] text-[17px] leading-[1.55] text-pretty text-[#8b8b99]">
          Every start, sit, trade and bad beat,
          <br />
          nothing forgotten, nothing forgiven.
        </p>

        <LandingFlow />
      </main>

      <footer className="relative z-10 flex h-14 shrink-0 items-center border-t border-[#16161f] px-8">
        <p className="font-mono text-[11px] font-medium tracking-[0.16em] text-[#43434f] uppercase">
          SLEEPER LEAGUES
          <span className="px-2.5 text-[#2a2a35]">/</span>
          ESPN &amp; YAHOO COMING
        </p>
      </footer>
    </div>
  );
}
