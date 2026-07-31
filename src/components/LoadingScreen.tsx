"use client";

import { motion } from "motion/react";

type Props = {
  title: string;
  description: string;
  /**
   * How long the bar takes to approach (not reach) full — tuned per caller to
   * the wait it's actually covering. The bar never completes on its own; it
   * stops climbing and holds, so it reads as "still going" rather than
   * "stuck at 94%" for whatever tail remains once the real work finishes and
   * the content swaps in.
   */
  barDurationSeconds?: number;
};

/**
 * The single loading pattern for "you're about to wait on the network and we
 * don't know exactly how long." Originated as sync's "Pulling the tape…"
 * screen; now shared with anywhere else a click leads to a page that has to
 * do real work before it can render — a different wait, so it takes its own
 * title and description rather than reusing sync's copy verbatim.
 */
export function LoadingScreen({ title, description, barDurationSeconds = 8 }: Props) {
  return (
    <div>
      <div className="h-px w-full bg-chalk/12">
        <motion.div
          className="h-full origin-left bg-flag"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: [0, 0.55, 0.8, 0.94] }}
          transition={{ duration: barDurationSeconds, times: [0, 0.3, 0.7, 1], ease: "easeOut" }}
        />
      </div>
      <p className="display mt-7 text-3xl">{title}</p>
      <p className="mt-3 text-[15px] leading-[1.55] text-chalk-dim">{description}</p>
    </div>
  );
}
