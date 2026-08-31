import { YahooConnectFlow } from "@/components/YahooConnectFlow";

export default function ConnectYahoo() {
  return (
    <main className="relative flex min-h-dvh flex-col px-7 pt-16 pb-10 sm:mx-auto sm:w-full sm:max-w-md">
      <header>
        <p className="label text-chalk-faint">Yahoo Fantasy Football</p>
        <h1 className="display mt-5 text-[clamp(2.75rem,14vw,3.75rem)]">You're in.</h1>
      </header>
      <YahooConnectFlow />
    </main>
  );
}
