"use client";

/*
 * The story player.
 *
 * Eight layout archetypes instead of one. The old player drew every card as
 * ghost numeral + kicker + title + body, so a ten-card story read as one card
 * ten times. Each archetype here is chosen by what the card's numbers *are*:
 * a season shape wants bars over time, a benching wants two players side by
 * side, an MVP wants a face. `statement` is the old layout, kept as the
 * fallback, so an unmapped insight still renders.
 *
 * Every card is a top group (kicker, title, the primary visual) and a bottom
 * group (the copy that lands the joke, and on the finale the CTA). Sizes and
 * timings come from the design's measured values, not from taste.
 */

import { AnimatePresence, motion } from "motion/react";
import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CardView, StoryCard, Tone } from "./model";

type Props = {
  cards: StoryCard[];
  managerName: string;
  leagueName: string;
  season: number;
  leagueHref: string;
  /** Telemetry only, not rendered: identifies the league/roster to PostHog. */
  leagueId: string;
  rosterId: string;
  archetype: string;
};

const EASE = [0.16, 1, 0.3, 1] as const;

/** Secondary and tertiary ink, per surface. */
const dim = (tone: Tone) => (tone === "light" ? "text-paper-ink-dim" : "text-chalk-dim");
const faint = (tone: Tone) => (tone === "light" ? "text-paper-ink-dim" : "text-chalk-faint");
const rule = (tone: Tone) => (tone === "light" ? "rule-light" : "rule-dark");

/* ---------- shared primitives ---------- */

function Kicker({ text, accent }: { text: string; accent: string }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
      className={`label tracking-[0.26em] ${accent}`}
    >
      {text}
    </motion.p>
  );
}

function Title({ text, big }: { text: string; big?: boolean }) {
  return (
    <motion.h2
      initial={{ clipPath: "inset(0 0 100% 0)" }}
      animate={{ clipPath: "inset(0 0 -12% 0)" }}
      transition={{ delay: 0.2, duration: 0.8, ease: EASE }}
      className={`display mt-4 whitespace-pre-line ${
        big ? "text-[clamp(2.1rem,11.2cqw,2.75rem)]" : "text-[clamp(2rem,10.7cqw,2.625rem)]"
      }`}
    >
      {text}
    </motion.h2>
  );
}

function Body({
  text,
  tone,
  large,
  callout,
}: {
  text: string;
  tone: Tone;
  /** The person layout sets its body a step larger. */
  large?: boolean;
  /** Ledger cards float their copy in a raised panel with an accent edge. */
  callout?: boolean;
}) {
  if (!text) return null;
  const size = large ? "text-[16px] leading-[1.5]" : "text-[15px] leading-[1.55]";
  return (
    <motion.p
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.6, ease: EASE }}
      className={
        callout
          ? `border-l-2 border-flag bg-field-raised px-5 py-4 text-[15px] leading-[1.55] text-pretty ${
              tone === "light" ? "text-paper-ink" : "text-chalk"
            }`
          : `max-w-[38ch] text-pretty ${size} ${dim(tone)}`
      }
    >
      {text}
    </motion.p>
  );
}

/**
 * Two-up stat block. `divided` rules it top and bottom with a centre hairline;
 * `split` drops the rules and pushes the second column to the right edge.
 */
function Pair({
  pair,
  tone,
  variant = "divided",
}: {
  pair: CardView["pair"];
  tone: Tone;
  variant?: "divided" | "split";
}) {
  if (!pair?.length) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.45, duration: 0.6, ease: EASE }}
      className={`relative mt-7 flex items-stretch ${variant === "divided" ? "py-1" : ""}`}
    >
      {variant === "divided" && (
        <>
          <span className={`absolute inset-x-0 top-0 h-px ${rule(tone)}`} />
          <span className={`absolute inset-x-0 bottom-0 h-px ${rule(tone)}`} />
        </>
      )}
      {pair.map((p, i) => (
        <div
          key={p.label}
          className={`relative flex-1 py-4 ${i > 0 && variant === "divided" ? "pl-5" : ""} ${
            i > 0 && variant === "split" ? "text-right" : ""
          }`}
        >
          {i > 0 && variant === "divided" && (
            <span className={`absolute top-0 bottom-0 left-0 w-px ${rule(tone)}`} />
          )}
          <div className={`label ${faint(tone)}`}>{p.label}</div>
          <div className={`display mt-2 text-[clamp(1.75rem,9cqw,2.25rem)] ${p.accent}`}>
            {p.value}
          </div>
        </div>
      ))}
    </motion.div>
  );
}

/**
 * `inline` puts the label left and the value right, and colours the value.
 * `stacked` puts the label above the value and colours the label instead —
 * the verdict finale reads as a list of charges, not a table.
 */
function Rows({
  rows,
  tone,
  variant = "inline",
}: {
  rows: CardView["rows"];
  tone: Tone;
  variant?: "inline" | "stacked";
}) {
  if (!rows?.length) return null;
  return (
    <div className="mt-6 flex flex-col">
      {rows.map((r, i) => (
        <motion.div
          key={r.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 + i * 0.06, duration: 0.6, ease: EASE }}
          data-testid={variant === "stacked" ? "verdict-row" : "stat-row"}
          className={
            variant === "inline"
              ? "relative flex items-baseline justify-between gap-4 py-3.5"
              : "relative py-3.5"
          }
        >
          <span className={`absolute inset-x-0 top-0 h-px ${rule(tone)}`} />
          <span className={`label shrink-0 ${variant === "inline" ? faint(tone) : r.accent}`}>
            {r.label}
          </span>
          <span
            className={`display ${
              variant === "inline"
                ? `text-right text-2xl ${r.accent}`
                : "mt-2 block text-[clamp(1.5rem,7cqw,1.875rem)]"
            }`}
          >
            {r.value}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

/** The no-photo state: labelled, not an empty hole. */
function PhotoSlot({ tone, compact }: { tone: Tone; compact?: boolean }) {
  return (
    <div
      className={`absolute inset-0 grid place-items-center ${
        tone === "light" ? "bg-paper-ink/5" : "bg-field-raised"
      }`}
      style={{
        backgroundImage: `repeating-linear-gradient(-45deg, transparent 0 6px, ${
          tone === "light" ? "rgb(10 10 11 / 0.05)" : "rgb(250 250 250 / 0.045)"
        } 6px 12px)`,
      }}
    >
      {!compact && (
        <span className={`label text-center leading-[1.8] ${faint(tone)}`}>
          Player headshot
          <br />
          Sleeper CDN
        </span>
      )}
    </div>
  );
}

/**
 * A headshot, or the slot where one would be. The URL is only ever built from
 * a providerPlayerId the engine carried, but Sleeper still 404s for players it
 * has no photo of — so a failed load falls back rather than showing a broken
 * image. `key` on the img resets the failed state when the card changes.
 */
function Headshot({
  photo,
  tone,
  compact,
  className,
}: {
  photo?: string | null;
  tone: Tone;
  compact?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!photo || failed) return <PhotoSlot tone={tone} compact={compact} />;
  return (
    // biome-ignore lint/performance/noImgElement: next/image would bill a Vercel image transformation to re-encode headshots Sleeper already serves at the right size (48px chips, one 208px portrait), and it swallows the load failure this component exists to handle.
    <img
      key={photo}
      src={photo}
      alt=""
      onError={() => setFailed(true)}
      className={className ?? "absolute inset-0 size-full object-cover"}
    />
  );
}

function PlayerChip({
  name,
  meta,
  photo,
  accent,
  tone,
  delay = 0.4,
}: {
  name: string;
  meta?: string;
  photo?: string | null;
  accent?: string;
  tone: Tone;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.6, ease: EASE }}
      className={`flex items-center gap-4 border p-4 ${
        accent ?? (tone === "light" ? "border-paper-ink/15" : "border-chalk/15")
      }`}
    >
      <div className="relative size-12 shrink-0 overflow-hidden rounded-full">
        <Headshot photo={photo} tone={tone} compact />
      </div>
      <div className="min-w-0 flex-1">
        {meta && <div className={`label ${faint(tone)}`}>{meta}</div>}
        <div className="display mt-1.5 truncate text-xl">{name}</div>
      </div>
    </motion.div>
  );
}

/* ---------- archetypes ---------- */

type ArchProps = { card: StoryCard; tone: Tone; accent: string };
type Arch = { top: React.ReactNode; bottom: React.ReactNode };

/** Hero numeral plus, where it earns it, a player or a pair. */
function statement({ card, tone, accent }: ArchProps): Arch {
  const v = card.view;
  return {
    // No ghosted numeral behind the type any more: the hero below IS that
    // number, so the old jumbotron layer just printed it twice, and at
    // full-bleed size it collided with the progress rail.
    top: (
      <>
        <Kicker text={card.kicker} accent={accent} />
        <Title text={card.title} />
      </>
    ),
    bottom: (
      <>
        {v.hero && (
          <motion.div
            initial={{ clipPath: "inset(0 0 100% 0)" }}
            animate={{ clipPath: "inset(0 0 -6% 0)" }}
            transition={{ delay: 0.3, duration: 0.8, ease: EASE }}
          >
            {v.heroLabel && <div className={`label ${faint(tone)}`}>{v.heroLabel}</div>}
            <div
              className={`display-xl mt-2.5 text-[clamp(4rem,23cqw,6.5rem)] ${v.heroAccent ?? ""}`}
            >
              {v.hero}
            </div>
          </motion.div>
        )}
        {v.player && (
          <div className="mt-6">
            <PlayerChip {...v.player} tone={tone} delay={0.5} />
          </div>
        )}
        <div className="mt-5">
          <Body text={card.body} tone={tone} />
        </div>
        <Pair pair={v.pair} tone={tone} />
      </>
    ),
  };
}

/** Weekly score bars — the season's shape at a glance. */
function chart({ card, tone, accent }: ArchProps): Arch {
  const bars = card.view.bars ?? [];
  const max = Math.max(...bars.map((b) => b.value), 1);
  return {
    top: (
      <>
        <Kicker text={card.kicker} accent={accent} />
        <Title text={card.title} />
        <div className="mt-8 flex h-24 items-end gap-1">
          {bars.map((b, i) => (
            <motion.span
              key={b.week}
              data-testid="chart-bar"
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: 0.3 + i * 0.035, duration: 0.5, ease: EASE }}
              style={{ height: `${Math.max(8, Math.round((b.value / max) * 100))}%` }}
              className={`flex-1 origin-bottom ${b.highlight ? "bg-flag" : "bg-card-red"}`}
            />
          ))}
        </div>
        <div className="mt-2.5 flex justify-between">
          <span className={`label ${faint(tone)}`}>WK {bars[0]?.week ?? 1}</span>
          <span className={`label ${faint(tone)}`}>WK {bars[bars.length - 1]?.week ?? 1}</span>
        </div>
      </>
    ),
    bottom: <Rows rows={card.view.rows} tone={tone} />,
  };
}

/** Two competing totals as proportional bars. */
function bars({ card, tone, accent }: ArchProps): Arch {
  return {
    top: (
      <>
        <Kicker text={card.kicker} accent={accent} />
        <Title text={card.title} />
        <div className="mt-5">
          <Body text={card.body} tone={tone} />
        </div>
        <div className="mt-8 flex flex-col gap-5">
          {card.view.compare?.map((c, i) => (
            <div key={c.label}>
              <div className="mb-2 flex items-baseline justify-between">
                <span className={`label ${c.positive ? faint(tone) : "text-card-red"}`}>
                  {c.label}
                </span>
                <span className={`display text-xl ${c.positive ? "" : "text-card-red"}`}>
                  {c.value}
                </span>
              </div>
              <div className={`h-1 ${tone === "light" ? "bg-paper-ink/8" : "bg-chalk/8"}`}>
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: 0.34 + i * 0.12, duration: 0.7, ease: EASE }}
                  style={{ width: c.width }}
                  className={`h-full origin-left ${
                    c.positive ? (tone === "light" ? "bg-paper-ink" : "bg-chalk") : "bg-card-red"
                  }`}
                />
              </div>
            </div>
          ))}
        </div>
      </>
    ),
    bottom: null,
  };
}

/** Started vs benched, traded away vs received. The comparison IS the joke. */
function versus({ card, tone, accent }: ArchProps): Arch {
  const v = card.view;
  return {
    top: (
      <>
        <Kicker text={card.kicker} accent={accent} />
        <Title text={card.title} />
        <div className="mt-7 flex flex-col gap-3">
          {v.versus?.map((side, i) => (
            <PlayerChip
              key={side.label}
              name={side.name}
              meta={side.label}
              photo={side.photo}
              accent={
                side.positive ? "bg-flag/6 border-flag/40" : "bg-card-red/6 border-card-red/40"
              }
              tone={tone}
              delay={0.4 + i * 0.1}
            />
          ))}
        </div>
        {v.foot && (
          <div className="relative mt-7 flex items-baseline justify-between gap-4 py-5">
            <span className={`absolute inset-x-0 top-0 h-px ${rule(tone)}`} />
            <span className={`absolute inset-x-0 bottom-0 h-px ${rule(tone)}`} />
            <span className={`label ${faint(tone)}`}>{v.foot.label}</span>
            <span className={`display text-3xl ${v.foot.accent}`}>{v.foot.value}</span>
          </div>
        )}
      </>
    ),
    bottom: <Body text={card.body} tone={tone} />,
  };
}

/** A leaguemate, named and initialled. */
function person({ card, tone, accent }: ArchProps): Arch {
  const v = card.view;
  return {
    top: (
      <>
        <Kicker text={card.kicker} accent={accent} />
        <Title text={card.title} />
        {v.person && (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6, ease: EASE }}
            className="mt-8 flex items-center gap-5"
          >
            <div
              className={`grid size-[76px] shrink-0 place-items-center rounded-full border ${
                v.person.positive ? "border-flag text-flag" : "border-card-red text-card-red"
              }`}
            >
              <span className="display text-2xl">{v.person.initials}</span>
            </div>
            <div className="min-w-0">
              <div className="display truncate text-3xl">{v.person.name}</div>
              <div className={`label mt-2 ${faint(tone)}`}>{v.person.meta}</div>
            </div>
          </motion.div>
        )}
        <Pair pair={v.pair} tone={tone} />
      </>
    ),
    bottom: <Body text={card.body} tone={tone} large />,
  };
}

/** A player's face, at size. */
function portrait({ card, tone, accent }: ArchProps): Arch {
  const v = card.view;
  return {
    top: (
      <>
        <Kicker text={card.kicker} accent={accent} />
        <Title text={card.title} />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.6, ease: EASE }}
          className={`relative mt-6 h-52 overflow-hidden border ${
            tone === "light" ? "border-paper-ink/12" : "border-chalk/12"
          }`}
        >
          <Headshot
            photo={v.player?.photo}
            tone={tone}
            className="absolute inset-0 size-full object-cover object-[50%_12%]"
          />
          <div
            className={`absolute inset-x-0 bottom-0 p-5 ${
              v.player?.photo
                ? tone === "light"
                  ? "bg-gradient-to-t from-paper"
                  : "bg-gradient-to-t from-field"
                : ""
            }`}
          >
            <div className="display text-3xl">{v.player?.name}</div>
            <div className={`label mt-1.5 ${tone === "light" ? "text-flag-ink" : "text-flag"}`}>
              {v.player?.meta}
            </div>
          </div>
        </motion.div>
        <Pair pair={v.pair} tone={tone} variant="split" />
      </>
    ),
    bottom: <Body text={card.body} tone={tone} />,
  };
}

/** An itemised list — waiver runs, opponent highs, the receipts. */
function ledger({ card, tone, accent }: ArchProps): Arch {
  const v = card.view;
  return {
    top: (
      <>
        <Kicker text={card.kicker} accent={accent} />
        <Title text={card.title} />
        <div className="mt-7 flex flex-col">
          {v.entries?.map((e, i) => (
            <motion.div
              key={e.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.06, duration: 0.6, ease: EASE }}
              className="relative flex items-center justify-between gap-4 py-3.5"
            >
              <span className={`absolute inset-x-0 top-0 h-px ${rule(tone)}`} />
              <span
                className={`shrink-0 font-mono text-[11px] leading-none tracking-[0.1em] ${e.accent}`}
              >
                {e.label}
              </span>
              <span className={`h-px flex-1 ${rule(tone)}`} />
              <span
                className={`max-w-[62%] shrink-0 text-right text-[14px] leading-[1.35] ${dim(tone)}`}
              >
                {e.text}
              </span>
            </motion.div>
          ))}
        </div>
      </>
    ),
    bottom: (
      <>
        <Body text={card.body} tone={tone} callout />
        <Pair pair={v.pair} tone={tone} />
      </>
    ),
  };
}

/** The finale: the accusation, and the evidence that convicts. */
function verdict({ card, tone, accent }: ArchProps): Arch {
  return {
    top: (
      <>
        <Kicker text={card.kicker} accent={accent} />
        <Title text={card.title} big />
        <Rows rows={card.view.rows} tone={tone} variant="stacked" />
      </>
    ),
    bottom: <Body text={card.body} tone={tone} />,
  };
}

const ARCHETYPES: Record<string, (p: ArchProps) => Arch> = {
  statement,
  chart,
  bars,
  versus,
  person,
  portrait,
  ledger,
  verdict,
};

/* ---------- player ---------- */

export function StoryPlayer({
  cards,
  managerName,
  leagueName,
  season,
  leagueHref,
  leagueId,
  rosterId,
  archetype,
}: Props) {
  const [index, setIndex] = useState(0);
  const card = cards[index];
  const prevIndex = useRef(0);
  const completed = useRef(false);
  const navMethod = useRef<"sequential" | "jump">("sequential");

  const advance = useCallback(() => {
    navMethod.current = "sequential";
    setIndex((i) => Math.min(i + 1, cards.length - 1));
  }, [cards.length]);
  const back = useCallback(() => {
    navMethod.current = "sequential";
    setIndex((i) => Math.max(i - 1, 0));
  }, []);
  const goTo = useCallback((i: number) => {
    navMethod.current = "jump";
    setIndex(i);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") advance();
      if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, back]);

  useEffect(() => {
    if (!posthog.__loaded) return;
    // Associates this and every subsequent event in the session with the
    // league group, so PostHog's League Activity dashboard can roll both
    // surfaces (this page and the ballot) up by league.
    posthog.group("league", leagueId);
    posthog.capture("wrapped_story_started", {
      league_id: leagueId,
      roster_id: rosterId,
      season,
      archetype,
      card_count: cards.length,
    });
  }, [leagueId, rosterId, season, archetype, cards.length]);

  useEffect(() => {
    if (!posthog.__loaded) return;
    const viewed = cards[index];
    const direction = index >= prevIndex.current ? "forward" : "backward";
    prevIndex.current = index;
    posthog.capture("wrapped_card_viewed", {
      league_id: leagueId,
      roster_id: rosterId,
      card_index: index,
      card_key: viewed.key,
      layout: viewed.layout,
      tone: viewed.tone,
      is_finale: viewed.isFinale,
      direction,
      nav_method: navMethod.current,
    });
    if (viewed.isFinale && !completed.current) {
      completed.current = true;
      posthog.capture("wrapped_story_completed", {
        league_id: leagueId,
        roster_id: rosterId,
        season,
        archetype,
        nav_method: navMethod.current,
      });
    }
  }, [index, cards, leagueId, rosterId, season, archetype]);

  async function share() {
    const url = window.location.href;
    const text = `${managerName}'s ${season} Fantasy Wrapped — ${leagueName}`;
    const shareMethod = "share" in navigator ? "web_share" : "clipboard";
    if (posthog.__loaded) {
      posthog.capture("wrapped_share_clicked", {
        league_id: leagueId,
        roster_id: rosterId,
        share_method: shareMethod,
      });
    }
    if (navigator.share) {
      await navigator.share({ title: text, url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(url);
    }
  }

  function trackBallotClick() {
    if (posthog.__loaded) {
      posthog.capture("wrapped_ballot_link_clicked", { league_id: leagueId, roster_id: rosterId });
    }
  }

  // Surface follows sentiment, not just the finale: brag cards invert too.
  const tone = card.tone;
  const light = tone === "light";
  const accent = light
    ? card.accent === "red"
      ? "text-card-red-ink"
      : "text-flag-ink"
    : card.accent === "red"
      ? "text-card-red"
      : "text-flag";
  const { top, bottom } = (ARCHETYPES[card.layout] ?? statement)({ card, tone, accent });

  return (
    <div className="relative grid min-h-dvh place-items-center bg-page lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-8 lg:px-8">
      <div className="hidden lg:flex lg:h-full lg:items-center lg:justify-self-end">
        <button
          type="button"
          aria-label="Previous"
          onClick={back}
          disabled={index === 0}
          className="grid size-11 shrink-0 place-items-center border border-chalk/15 text-chalk-dim transition-colors hover:border-chalk/30 hover:text-chalk disabled:pointer-events-none disabled:opacity-20"
        >
          <span aria-hidden="true" className="text-base leading-none">
            ‹
          </span>
        </button>
      </div>
      <div
        className={`story-frame relative flex flex-col overflow-hidden transition-colors duration-500 sm:border ${
          light
            ? "bg-paper text-paper-ink sm:border-paper-ink/15"
            : "bg-field text-chalk sm:border-chalk/12"
        }`}
        data-testid="story-player"
        data-tone={tone}
        data-layout={card.layout}
      >
        <div className="absolute inset-x-0 top-0 z-30 flex gap-1 px-3 pt-3">
          {cards.map((c, i) => (
            <div
              key={c.key}
              className={`h-[3px] flex-1 ${light ? "bg-paper-ink/15" : "bg-chalk/15"}`}
            >
              <div
                className={`h-full ${light ? "bg-flag-ink" : "bg-flag"} ${i <= index ? "w-full" : "w-0"}`}
                style={i === index ? { transition: "width 0.3s" } : undefined}
              />
            </div>
          ))}
        </div>

        <div className="absolute inset-x-0 top-0 z-20 flex items-baseline gap-3 px-7 pt-8">
          <span aria-hidden className={`label ${faint(tone)}`}>
            ←
          </span>
          <span className={`label truncate ${faint(tone)}`}>
            {leagueName} · {season}
          </span>
          <span className={`label ml-auto shrink-0 ${faint(tone)}`}>
            {String(index + 1).padStart(2, "0")} / {String(cards.length).padStart(2, "0")}
          </span>
        </div>

        <button
          type="button"
          aria-label="previous card"
          tabIndex={-1}
          onClick={back}
          className="absolute inset-y-0 left-0 z-10 w-1/3 focus:outline-none"
        />
        <button
          type="button"
          aria-label="next card"
          tabIndex={-1}
          onClick={advance}
          className="absolute inset-y-0 right-0 z-10 w-2/3 focus:outline-none"
        />

        {/*
         * mode="wait" strictly sequences exit-then-enter, which under rapid
         * clicking can leave the exit animation stuck: the index (and the
         * counter above, which reads it directly) advances immediately, but
         * Framer Motion never fires the enter for the true latest card. The
         * default (overlapping) mode can't get stuck that way, so the two
         * cards are pulled out of flex flow (absolute inset-0, sized by the
         * frame's fixed height) so a brief crossfade doesn't double the
         * layout height.
         */}
        <AnimatePresence>
          <motion.div
            key={card.key}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="absolute inset-0 flex flex-col justify-between px-7 pt-[108px] pb-[78px]"
          >
            <div className="relative">{top}</div>
            <div className="relative">
              {bottom}
              {card.isFinale && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5, duration: 0.6, ease: EASE }}
                  className="relative z-20 mt-7 flex items-center gap-5"
                >
                  <button
                    type="button"
                    onClick={share}
                    className={`label min-h-11 px-6 py-3.5 ${
                      light ? "bg-paper-ink text-paper" : "bg-chalk text-field"
                    }`}
                  >
                    Send it to the chat
                  </button>
                  <a
                    href={leagueHref}
                    onClick={trackBallotClick}
                    className={`label underline underline-offset-4 ${dim(tone)}`}
                  >
                    the ballot →
                  </a>
                </motion.div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="absolute inset-x-0 bottom-6 z-20 flex items-baseline justify-between px-7">
          <span className={`label truncate ${faint(tone)}`}>{managerName}</span>
          <span className={`label shrink-0 ${faint(tone)}`}>Fantasy Wrapped</span>
        </div>

        {index < cards.length - 1 && (
          <span
            className={`label absolute inset-x-0 bottom-11 z-20 text-center ${faint(tone)}`}
            aria-hidden
          >
            tap to continue
          </span>
        )}
      </div>

      <div className="hidden lg:flex lg:h-full lg:items-center lg:justify-self-start lg:gap-6">
        <button
          type="button"
          aria-label="Next"
          onClick={advance}
          disabled={index === cards.length - 1}
          className="grid size-11 shrink-0 place-items-center border border-chalk/15 text-chalk-dim transition-colors hover:border-chalk/30 hover:text-chalk disabled:pointer-events-none disabled:opacity-20"
        >
          <span aria-hidden="true" className="text-base leading-none">
            ›
          </span>
        </button>
        <nav aria-label="Jump to card" className="flex flex-col gap-3">
          {cards.map((c, i) => (
            <button
              key={c.key}
              type="button"
              data-testid="chapter-link"
              aria-current={i === index ? "true" : undefined}
              onClick={() => goTo(i)}
              className={`py-0.5 text-left font-mono text-[11px] font-medium tracking-[0.12em] uppercase transition-colors ${
                i === index ? "text-flag" : "text-chalk-faint hover:text-chalk-dim"
              }`}
            >
              {i === index && <span aria-hidden="true">→ </span>}
              {c.kicker}
            </button>
          ))}
        </nav>
      </div>

      <span
        aria-hidden="true"
        className="label absolute inset-x-0 bottom-8 hidden text-center tracking-[0.2em] text-chalk-faint lg:block"
      >
        {managerName} · {leagueName} · {season}
      </span>
    </div>
  );
}
