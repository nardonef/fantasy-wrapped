"use client";

import { motion } from "motion/react";

const EASE = [0.16, 1, 0.3, 1] as const;

export function CoverIntro() {
  return (
    <header>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--sb-accent)]"
      >
        Fantasy Football · 2025
      </motion.p>
      <motion.h1
        initial={{ clipPath: "inset(0 100% 0 0)" }}
        animate={{ clipPath: "inset(0 0% 0 0)" }}
        transition={{ duration: 0.8, delay: 0.2, ease: EASE }}
        className="mt-[22px] text-[50px] leading-[0.92] font-extrabold tracking-[-0.01em] uppercase text-[var(--sb-ink)]"
      >
        Your season.
        <br />
        <span className="text-[var(--sb-accent)]">Wrapped.</span>
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.3, ease: EASE }}
        className="mt-5 max-w-[285px] text-[14px] leading-[1.55] text-[var(--sb-ink-secondary)]"
      >
        Every start, sit, trade and bad beat — called live, replayed forever.
      </motion.p>
    </header>
  );
}
