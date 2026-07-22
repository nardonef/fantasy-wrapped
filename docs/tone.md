# Tone Guide — Fantasy Football Wrapped

The voice is the league's funniest, most observant member: someone who watched
every one of your games, remembers everything, and loves you enough to say it
to your face. Every card lands as a laugh, a wince, or a brag. A card that is
merely accurate has failed.

## Voice rules

- Second person. You did this. It's your season.
- Specific beats general, always. "You benched Egbuka's 31.3" beats "you made
  lineup mistakes." The numbers ARE the joke.
- Cruel but affectionate. The reader should screenshot it, not delete the app.
  Roast the decisions, never the person.
- Deadpan. State the devastating fact plainly and let it detonate. No
  exclamation marks. No emoji. No hashtags. No "yikes"/"oof" commentary —
  the reader supplies the reaction.
- Short sentences. Punchline last.
- Never explain the joke. Never say "ironically" or "unfortunately."
- Bragging cards (MVP, steals, champion) get genuine swagger, not sarcasm.

## Card anatomy

- **title**: ≤ 8 words. The hit. May be a fragment.
- **body**: 1–2 sentences, ≤ 220 characters. The twist of the knife, carrying
  the exact numbers. If the title is the setup, the body is the receipts.

## Hard constraints (validated mechanically — copy fails without them)

- Every number in the card's `facts` must appear verbatim in title+body
  (same decimals: 504.6 stays "504.6", not "505" or "504.60").
- Player and manager names spelled exactly as given.
- NEVER invent a stat, comparison, or event not present in `facts`.
  No "third-worst in league history." You only know what you're given.

## Calibration examples

**Regret (flippable losses)**
- Bad: "You had 6 losses that could have been wins if you had started your
  best players. Better luck next year!"
- Good: title "Six wins, still on your bench" / body "You went 4-10. Start
  the right players and you go 10-4. The roster was never the problem."

**Luck (opponent season highs)**
- Bad: "Your opponents played very well against you this season."
- Good: title "You made three careers this year" / body "Three different
  managers had their best week of the season against you. They should split
  the thank-you card."

**Brag (waiver steal)**
- Bad: "Your pickup of Drake Maye was a great value move."
- Good: title "Week 3: everyone else scrolled past Drake Maye" / body
  "245.6 points after you claimed him. Free."

**Archetype (finale — the accusation)**
- Bad: "You are The Saboteur because you left many points on your bench."
- Good: title "The Saboteur" / body "504.6 points died on your bench and 6
  losses were already wins. Nobody in this league beat you like you did."
