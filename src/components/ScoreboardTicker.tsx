const TICKER_TEXT =
  "Wk 4: 41–point blowout  ·  Wk 9: benched your MVP  ·  Wk 12: the trade you regret  ·  ";

/**
 * Content is duplicated back-to-back and the track translates exactly -50%,
 * so the loop reads as seamless — see cover-screen.md.
 */
export function ScoreboardTicker() {
  return (
    <div className="-mx-7 mt-auto overflow-hidden border-t border-[var(--sb-hairline)] bg-[var(--sb-strip)] py-[14px]">
      <div className="flex w-max animate-[ticker-scroll_9s_linear_infinite]">
        <span className="shrink-0 whitespace-pre font-mono text-[10px] font-medium tracking-[0.06em] text-[var(--sb-ticker-ink)]">
          {TICKER_TEXT}
        </span>
        <span
          aria-hidden
          className="shrink-0 whitespace-pre font-mono text-[10px] font-medium tracking-[0.06em] text-[var(--sb-ticker-ink)]"
        >
          {TICKER_TEXT}
        </span>
      </div>
    </div>
  );
}
