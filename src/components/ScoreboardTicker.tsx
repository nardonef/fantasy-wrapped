"use client";

import { motion } from "motion/react";

const TICKER_TEXT =
  "Wk 4: 41–point blowout  ·  Wk 9: benched your MVP  ·  Wk 12: the trade you regret  ·  ";

/**
 * Content is duplicated back-to-back and the track translates exactly -50%,
 * so the loop reads as seamless. 9s at mobile width reads as frantic once the
 * same content is stretched across a desktop viewport, so the loop slows down
 * past the collapse to a single column (see desktop-cover.md) — a fixed
 * duration rather than a true constant px/s, but close enough at the widths
 * this app actually renders at.
 */
export function ScoreboardTicker({ className = "" }: { className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.7, duration: 0.4 }}
      className={`relative overflow-hidden bg-ticker py-[14px] ${className}`}
    >
      <span className="rule-dark absolute inset-x-0 top-0 h-px" aria-hidden />
      <div className="ticker-track flex w-max animate-[ticker-scroll_9s_linear_infinite] lg:animate-[ticker-scroll_28s_linear_infinite]">
        <span className="shrink-0 whitespace-pre font-mono text-[10px] font-medium tracking-[0.06em] text-flag/60">
          {TICKER_TEXT}
        </span>
        <span
          aria-hidden
          className="shrink-0 whitespace-pre font-mono text-[10px] font-medium tracking-[0.06em] text-flag/60"
        >
          {TICKER_TEXT}
        </span>
      </div>
    </motion.div>
  );
}
