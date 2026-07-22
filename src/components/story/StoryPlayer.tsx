"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import type { StoryCard } from "./model";

type Props = {
  cards: StoryCard[];
  managerName: string;
  leagueName: string;
  season: number;
};

export function StoryPlayer({ cards, managerName, leagueName, season }: Props) {
  const [index, setIndex] = useState(0);
  const card = cards[index];

  const advance = useCallback(
    () => setIndex((i) => Math.min(i + 1, cards.length - 1)),
    [cards.length],
  );
  const back = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") advance();
      if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, back]);

  async function share() {
    const url = window.location.href;
    const text = `${managerName}'s ${season} Fantasy Wrapped — ${leagueName}`;
    if (navigator.share) {
      await navigator.share({ title: text, url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(url);
    }
  }

  const finale = card.isFinale;

  return (
    <div
      className={`relative flex h-dvh w-full flex-col overflow-hidden ${
        finale ? "bg-flag text-field" : "bg-field text-chalk"
      }`}
      data-testid="story-player"
    >
      {/* Progress segments */}
      <div className="absolute inset-x-0 top-0 z-30 flex gap-1 px-3 pt-3">
        {cards.map((c, i) => (
          <div key={c.key} className={`h-[3px] flex-1 ${finale ? "bg-field/20" : "bg-chalk/20"}`}>
            <div
              className={`h-full ${finale ? "bg-field" : "bg-flag"} ${
                i < index ? "w-full" : i === index ? "w-full" : "w-0"
              }`}
              style={i === index ? { transition: "width 0.3s" } : undefined}
            />
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-baseline justify-between px-5 pt-8">
        <span
          className={`font-mono text-[10px] tracking-[0.3em] uppercase ${
            finale ? "text-field/70" : "text-chalk-dim"
          }`}
        >
          {leagueName}
        </span>
        <span
          className={`font-mono text-[10px] tracking-[0.3em] uppercase ${
            finale ? "text-field/70" : "text-chalk-dim"
          }`}
        >
          {index + 1}/{cards.length}
        </span>
      </div>

      {/* Tap zones */}
      <button
        type="button"
        aria-label="previous card"
        onClick={back}
        className="absolute inset-y-0 left-0 z-10 w-1/3"
      />
      <button
        type="button"
        aria-label="next card"
        onClick={advance}
        className="absolute inset-y-0 right-0 z-10 w-2/3"
      />

      {/* Card content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={card.key}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className={`yardlines relative flex flex-1 flex-col justify-end px-6 pb-16 ${
            card.accent === "red" && !finale ? "hazard" : ""
          }`}
        >
          {card.ghost && (
            <motion.span
              aria-hidden
              initial={{ opacity: 0, scale: 1.15 }}
              animate={{ opacity: 0.09, scale: 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="display pointer-events-none absolute top-1/2 right-0 left-0 -translate-y-[62%] overflow-hidden text-center whitespace-nowrap"
              style={{
                // Fit the jumbotron numeral to the viewport regardless of digits.
                fontSize: `min(42vh, ${Math.floor(150 / Math.max(2, card.ghost.length))}vw)`,
              }}
            >
              {card.ghost}
            </motion.span>
          )}

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.3 }}
            className={`font-mono text-[11px] font-bold tracking-[0.3em] uppercase ${
              finale ? "text-field/70" : card.accent === "red" ? "text-card-red" : "text-flag"
            }`}
          >
            {card.kicker}
          </motion.p>

          <motion.h2
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            className={`display mt-3 ${finale ? "text-[clamp(3.2rem,15vw,6rem)]" : "text-[clamp(2.6rem,11vw,4.5rem)]"}`}
          >
            {card.title}
          </motion.h2>

          {card.body && (
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.26, duration: 0.3 }}
              className={`mt-4 max-w-[38ch] font-mono text-sm leading-relaxed ${
                finale ? "text-field/85" : "text-chalk/85"
              }`}
            >
              {card.body}
            </motion.p>
          )}

          {finale && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="relative z-20 mt-8 flex items-center gap-4"
            >
              <button
                type="button"
                onClick={share}
                className="display border-4 border-field px-6 py-2.5 text-xl active:bg-field active:text-flag"
              >
                Send it to the chat
              </button>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Manager tag */}
      <div className="absolute bottom-5 left-6 z-20">
        <span
          className={`font-mono text-[10px] tracking-[0.3em] uppercase ${
            finale ? "text-field/60" : "text-chalk-dim/70"
          }`}
        >
          {managerName} · {season}
        </span>
      </div>

      {index === 0 && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 1, 0] }}
          transition={{ delay: 1.2, duration: 2.4, times: [0, 0.2, 0.8, 1] }}
          className="absolute right-6 bottom-5 z-20 font-mono text-[10px] tracking-[0.3em] text-chalk-dim uppercase"
        >
          tap →
        </motion.span>
      )}
    </div>
  );
}
