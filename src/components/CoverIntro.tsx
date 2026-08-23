"use client";

import { motion } from "motion/react";

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * The cover's kicker + headline + subhead. Sized with one fluid clamp rather
 * than per-breakpoint values so mobile and the desktop split layout meet at
 * the same 50px floor (see desktop-cover.md) instead of jump-cutting at the
 * lg: breakpoint.
 */
export function CoverIntro() {
  return (
    <header>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-flag"
      >
        Fantasy Football · 2025
      </motion.p>
      <motion.h1
        initial={{ clipPath: "inset(0 100% 0 0)" }}
        animate={{ clipPath: "inset(0 0% 0 0)" }}
        transition={{ duration: 0.8, delay: 0.2, ease: EASE }}
        style={{ fontSize: "clamp(50px, 7.2vw, 116px)" }}
        className="mt-[22px] font-extrabold uppercase leading-[0.92] tracking-[-0.01em]"
      >
        Your season.
        <br />
        <span className="text-flag">Wrapped.</span>
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.3, ease: EASE }}
        className="mt-5 max-w-[285px] text-pretty text-[14px] leading-[1.55] text-chalk-dim lg:max-w-[38ch] lg:text-[16px] lg:leading-[1.6]"
      >
        Every start, sit, trade and bad beat — called live, replayed forever.
      </motion.p>
    </header>
  );
}
