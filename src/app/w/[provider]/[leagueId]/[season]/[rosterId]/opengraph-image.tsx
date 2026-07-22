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

/** The group-chat artifact: archetype verdict on penalty-flag yellow. */
export default async function OgImage({ params }: { params: Promise<Params> }) {
  const p = await params;
  const wrapped =
    p.provider === "sleeper"
      ? await getWrapped(p.provider as Provider, p.leagueId, Number(p.season), p.rosterId)
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
        backgroundColor: "#E8FF2B",
        color: "#0A0A0B",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ fontSize: 26, letterSpacing: 8, textTransform: "uppercase", opacity: 0.7 }}>
        {league}
      </div>
      <div
        style={{
          fontSize: 120,
          fontWeight: 900,
          textTransform: "uppercase",
          lineHeight: 0.95,
          marginTop: 16,
        }}
      >
        {archetype}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 40,
          fontSize: 30,
          fontWeight: 700,
        }}
      >
        <span>{manager}</span>
        <span style={{ opacity: 0.7 }}>FANTASY WRAPPED</span>
      </div>
    </div>,
    size,
  );
}
