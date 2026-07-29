import { ImageResponse } from "next/og";
import type { Provider } from "@/db/schema";
import { getWrapped } from "@/sync/wrapped";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Params = {
  provider: string;
  leagueId: string;
  season: string;
  rosterId: string;
};

/**
 * The group-chat artifact: the archetype verdict, on the same light surface
 * the finale card uses. Fonts are system sans — loading Geist into
 * ImageResponse needs a font binary committed to the repo (see STATUS.md).
 */
export default async function OgImage({ params }: { params: Promise<Params> }) {
  const p = await params;
  const wrapped =
    p.provider === "sleeper"
      ? // withCopy: false — this image renders the archetype name and never
        // reads copy. Generating it here would block a link unfurl on the LLM,
        // and chat clients give up long before that finishes.
        await getWrapped(p.provider as Provider, p.leagueId, Number(p.season), p.rosterId, false)
      : null;

  const archetype = wrapped?.script.archetype.name ?? "Fantasy Wrapped";
  const manager = wrapped?.team.displayName ?? "";
  const league = wrapped ? `${wrapped.league.name} · ${wrapped.league.season}` : "";

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        padding: 72,
        backgroundColor: "#FAFAFA",
        color: "#0A0A0B",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          fontSize: 22,
          letterSpacing: 6,
          textTransform: "uppercase",
          // The light-surface accent. #5B8CFF on #FAFAFA is about 2.3:1.
          color: "#2148D8",
        }}
      >
        {league}
      </div>
      <div
        style={{
          fontSize: 124,
          fontWeight: 700,
          letterSpacing: -4,
          lineHeight: 0.94,
          marginTop: 20,
        }}
      >
        {archetype}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 48,
          paddingTop: 28,
          borderTop: "1px solid rgba(10, 10, 11, 0.15)",
          fontSize: 22,
          letterSpacing: 6,
          textTransform: "uppercase",
          color: "#52525B",
        }}
      >
        <span>{manager}</span>
        <span>Fantasy Wrapped</span>
      </div>
    </div>,
    size,
  );
}
