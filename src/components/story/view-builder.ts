import type { PlayerRef, SeasonFacts, TeamSeasonFacts, WrappedCard } from "@/engine";
import type { CardView, LayoutArchetype, Tone } from "./model";
import { headshot } from "./model";

/**
 * Decides WHICH numbers each layout archetype shows. StoryPlayer renders the
 * result; it never reaches into facts itself. Everything here is derived from
 * the card's own facts and refs plus SeasonFacts — the engine is untouched.
 */

/** Semantic accent -> class, resolved per surface. Light accents are darker. */
function accentClass(token: "pos" | "neg" | "ink" | "", tone: Tone): string {
  if (token === "pos") return tone === "light" ? "text-flag-ink" : "text-flag";
  if (token === "neg") return tone === "light" ? "text-card-red-ink" : "text-card-red";
  return tone === "light" ? "text-paper-ink" : "text-chalk";
}

/** Season point totals always carry a decimal, so a pair of them lines up. */
const points = (n: number) => n.toFixed(1);

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

function formatRecord(r: { wins: number; losses: number; ties: number }): string {
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}

/** Title-cases a fact key for the verdict rows: pointsFor -> Points For. */
export function humanize(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/**
 * Labels for the hero numeral on `statement` cards. ghostFor() picks the
 * number; this says what it means. Without it, the biggest type on the card is
 * an unlabelled figure.
 */
const HERO_LABEL: Record<string, string> = {
  "bench-points-total": "Points left on your bench",
  "flippable-losses": "Losses that were coin flips",
  "record-if-optimal": "Your record, played perfectly",
  "dropped-league-winner": "Points they scored after you dropped them",
  "zero-hero": "Points from a starter",
  "close-game-record": "Your record in one-score games",
  "combined-loss-margin": "Total margin across every loss",
  "robbed-week": "Points that still lost",
  "daylight-robbery-win": "Points that somehow won",
  "draft-bust": "Points from your earliest pick",
  "waiver-steal": "Points after you claimed him",
  "draft-steal": "Points from a late pick",
  "punching-bag": "Their score against you",
  "peak-week": "Your best week",
  "collapse-week": "Your worst week",
  "playoff-story": "Where you finished",
  "points-machine": "Points scored",
  // volatility and crowns-and-stinkers each have two branches that produce
  // different facts, so their labels are chosen in the switch below.
};

type BuildViewInput = {
  card: WrappedCard;
  layout: LayoutArchetype;
  tone: Tone;
  /** The jumbotron numeral, already picked by ghostFor(). */
  ghost: string | null;
  team: TeamSeasonFacts;
  facts: SeasonFacts;
};

export function buildView({ card, layout, tone, ghost, team, facts }: BuildViewInput): CardView {
  // Facts are an open string-keyed bag by design — each insight decides its own
  // shape — so reading them is the one place this file cannot be type-driven.
  const x = card.facts as Record<string, string | number | boolean | null>;
  const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));
  const refs = card.refs ?? {};
  const a = (token: "pos" | "neg" | "ink" | "") => accentClass(token, tone);
  const byName = (n: string) => Object.values(facts.teams).find((q) => q.displayName === n);
  const v: CardView = {};

  switch (layout) {
    case "chart": {
      // Weekly scores, with the relevant week or run highlighted.
      const regular = team.weeks.filter((w) => !w.isPlayoff);
      let from: number | null = null;
      let to: number | null = null;
      if (card.insightId === "streak") {
        from = num(x.fromWeek);
        to = num(x.toWeek);
      } else if (card.insightId === "season-arc") {
        // Same split the insight itself uses, so the highlighted run is the
        // second half the copy is talking about.
        const played = regular.filter((w) => w.result !== null);
        from = played[Math.floor(played.length / 2)]?.week ?? null;
        to = played[played.length - 1]?.week ?? null;
      }
      const peak = team.highWeek?.week;
      // Regular season only. The record beside the chart counts those games,
      // and a team knocked out in week 15 would otherwise show consolation
      // scores as part of "the season on paper".
      v.bars = regular.map((w) => {
        const inRun = from != null && to != null && w.week >= from && w.week <= to;
        return { value: w.score, highlight: w.week === peak || inRun };
      });
      v.rows = [
        {
          label: "Record",
          value: formatRecord(team.record),
          accent: a(team.record.wins > team.record.losses ? "pos" : "neg"),
        },
        {
          label: "Points for",
          value: points(team.pointsFor),
          accent: a(team.pointsForRank <= 3 ? "pos" : ""),
        },
        {
          label: "Finish",
          value: `${ordinal(team.standingsRank)} of ${facts.league.totalTeams}`,
          accent: a(team.standingsRank <= 3 ? "pos" : "neg"),
        },
      ];
      break;
    }

    case "bars": {
      // Points for vs points against, as proportional widths off the larger.
      const hi = Math.max(team.pointsFor, team.pointsAgainst) || 1;
      v.compare = [
        {
          label: "You scored",
          value: points(team.pointsFor),
          width: `${Math.round((team.pointsFor / hi) * 100)}%`,
          positive: true,
        },
        {
          label: "Scored against you",
          value: points(team.pointsAgainst),
          width: `${Math.round((team.pointsAgainst / hi) * 100)}%`,
          positive: false,
        },
      ];
      break;
    }

    case "versus": {
      if (card.insightId === "worst-benching") {
        v.versus = [
          {
            label: "You started",
            name: String(x.startedPlayer),
            photo: headshot(refs.started, true),
            positive: false,
          },
          {
            label: "You benched",
            name: String(x.benchedPlayer),
            photo: headshot(refs.benched, true),
            positive: true,
          },
        ];
        v.foot = {
          label: "Points left behind",
          value: String(x.pointsLeftBehind),
          accent: a("neg"),
        };
      } else {
        const won = Boolean(x.wonTheTrade);
        // A trade can move four players; the chip names the one whose points
        // decided it and counts the rest, rather than truncating a list.
        const side = (list: string, ref?: PlayerRef) => {
          const names = list.split(", ").filter(Boolean);
          return names.length > 1 && ref ? `${ref.name} +${names.length - 1}` : list;
        };
        v.versus = [
          {
            label: "You gave up",
            name: side(String(x.gave), refs.gave),
            photo: headshot(refs.gave, true),
            positive: !won,
          },
          {
            label: "You received",
            name: side(String(x.got), refs.got),
            photo: headshot(refs.got, true),
            positive: won,
          },
        ];
        v.foot = {
          label: "Rest-of-season net",
          value: `${num(x.netPoints) > 0 ? "+" : ""}${x.netPoints}`,
          accent: a(won ? "pos" : "neg"),
        };
      }
      break;
    }

    case "person": {
      const name = String(x.nemesis || x.victim || x.champion || "");
      const other = byName(name);
      v.person = {
        initials:
          name
            .replace(/[^A-Za-z]/g, "")
            .slice(0, 2)
            .toUpperCase() || "??",
        name,
        // teamName is nullable in real leagues, and plenty of managers name
        // the team after themselves. Either way, repeating the display name
        // directly under itself reads as a bug — drop to the record alone.
        meta: other
          ? [other.teamName === name ? null : other.teamName, formatRecord(other.record)]
              .filter(Boolean)
              .join(" · ")
          : "",
        positive: card.insightId !== "nemesis",
      };
      if (card.insightId === "nemesis") {
        v.pair = [
          { label: "They beat you", value: `${x.lossesToThem}×`, accent: a("neg") },
          { label: "Outscored by", value: String(x.totalMargin), accent: a("neg") },
        ];
      } else if (card.insightId === "victim") {
        v.pair = [
          { label: "You beat them", value: `${x.winsAgainstThem}×`, accent: a("pos") },
          { label: "Outscored by", value: `+${x.totalMargin}`, accent: a("pos") },
        ];
      } else {
        v.pair = [
          { label: "You beat them", value: `${x.winsVsChampion}×`, accent: a("pos") },
          { label: "Their losses", value: String(x.championSeasonLosses), accent: a("") },
        ];
      }
      break;
    }

    case "portrait": {
      v.player = {
        name: String(x.mvp),
        meta: `${x.position ?? ""} · ${x.startedWeeks} starts`,
        photo: headshot(refs.player),
      };
      v.pair = [
        { label: "Points delivered", value: String(x.startedPoints), accent: a("pos") },
        { label: "Of your total", value: `${x.shareOfTeamPct}%`, accent: a("pos") },
      ];
      break;
    }

    case "ledger": {
      if (card.insightId === "opponent-season-highs") {
        const names = String(x.opponents).split(", ");
        const weeks = String(x.weeks).split(", ");
        v.entries = names.map((n, i) => ({
          label: `Week ${weeks[i]}`,
          text: `${n} had their best week of the year`,
          accent: a("neg"),
        }));
      } else if (card.insightId === "faab-story") {
        v.entries = [
          { label: "Spent", text: `$${x.faabSpent} of budget`, accent: a("pos") },
          {
            label: "Top bid",
            text: x.biggestBidPlayer
              ? `$${x.biggestBid} on ${x.biggestBidPlayer}`
              : "None recorded",
            accent: a(""),
          },
        ];
      } else {
        // transaction-extreme. Real leagues contain managers with 0 moves all
        // season — the nullish fallbacks keep those rows from reading
        // "undefined".
        v.entries = [
          { label: "Waivers", text: String(x.waivers ?? "—"), accent: a("") },
          { label: "Free agents", text: String(x.freeAgents ?? "—"), accent: a("") },
          { label: "Trades", text: String(x.trades ?? "—"), accent: a("") },
        ];
        v.pair = [
          { label: "Your moves", value: String(x.totalMoves), accent: a("pos") },
          { label: "League median", value: String(x.leagueMedian ?? "—"), accent: a("") },
        ];
      }
      break;
    }

    case "verdict":
      // Only the finale uses this layout, and buildStoryCards fills its rows
      // from archetype.evidence — there is no WrappedCard behind it.
      break;

    default: {
      // statement — hero numeral plus, where it earns it, a player or a pair.
      v.heroLabel = HERO_LABEL[card.insightId] ?? "";
      v.hero = ghost ?? undefined;
      // Tone already encodes the card's sentiment (see toneFor), and it is a
      // finer signal than category: a last-place finish is a "narrative" card
      // but its number is not a brag.
      v.heroAccent = a(tone === "light" ? "pos" : "neg");

      switch (card.insightId) {
        case "dropped-league-winner":
          v.player = {
            name: String(x.player),
            meta: `Dropped week ${x.droppedWeek}`,
            photo: headshot(refs.player, true),
          };
          break;
        case "waiver-steal":
          v.hero = String(x.startedPointsAfter);
          v.player = {
            name: String(x.pickup),
            meta: `Claimed week ${x.week}`,
            photo: headshot(refs.player, true),
          };
          break;
        case "draft-bust":
          v.hero = String(x.startedPoints);
          v.player = {
            name: String(x.bust),
            meta: `Round ${x.round}, pick ${x.pickNo}`,
            photo: headshot(refs.player, true),
          };
          break;
        case "draft-steal":
          v.hero = String(x.startedPoints);
          v.player = {
            name: String(x.steal),
            meta: `Round ${x.round}, pick ${x.pickNo}`,
            photo: headshot(refs.player, true),
          };
          break;
        case "record-if-optimal":
          v.pair = [
            { label: "Actual", value: String(x.actualRecord), accent: a("ink") },
            { label: "Optimal", value: String(x.optimalRecord), accent: a("pos") },
          ];
          break;
        case "flippable-losses":
          v.pair = [
            { label: "Actual", value: String(x.actualRecord), accent: a("ink") },
            {
              label: "Weeks",
              value: `${String(x.weeks).split(", ").length} of them`,
              accent: a("pos"),
            },
          ];
          break;
        case "peak-week":
        case "collapse-week":
          v.hero = String(x.score);
          v.pair = [
            {
              label: "That week",
              value: String(x.score),
              accent: a(card.insightId === "peak-week" ? "pos" : "neg"),
            },
            { label: "Your average", value: String(x.seasonAverage), accent: a("ink") },
          ];
          break;
        case "punching-bag":
          v.hero = String(x.score);
          break;
        case "points-machine":
          v.hero = String(x.pointsFor);
          break;
        case "volatility":
          // "Most volatile" carries a high and a low; "steadiest" carries only
          // an average, and labelling that one "your best week" would lie.
          if (x.highScore != null) {
            v.hero = String(x.highScore);
            v.heroLabel = "Your best week";
            v.pair = [
              { label: "Best week", value: String(x.highScore), accent: a("pos") },
              { label: "Worst week", value: String(x.lowScore), accent: a("neg") },
            ];
          } else {
            v.hero = String(x.averageScore);
            v.heroLabel = "Your score, every week";
          }
          break;
        case "crowns-and-stinkers":
          if (x.topScoreWeeks != null && x.worstScoreWeeks != null) {
            v.hero = String(x.topScoreWeeks);
            v.heroLabel = "Weeks at the top of the league";
            v.pair = [
              { label: "Weekly crowns", value: String(x.topScoreWeeks), accent: a("pos") },
              { label: "Weekly stinkers", value: String(x.worstScoreWeeks), accent: a("neg") },
            ];
          } else if (x.topScoreWeeks != null) {
            v.hero = String(x.topScoreWeeks);
            v.heroLabel = "Weeks at the top of the league";
          } else {
            v.hero = String(x.worstScoreWeeks);
            v.heroLabel = "Weeks as the league's worst";
          }
          break;
        case "close-game-record":
          v.hero = `${x.closeWins}–${x.closeLosses}`;
          v.heroLabel = `Games inside ${x.marginThreshold} points`;
          break;
        case "playoff-story":
          v.hero = x.standingsRank != null ? ordinal(num(x.standingsRank)) : String(x.finish);
          v.pair = [
            { label: "Record", value: String(x.record ?? "—"), accent: a("ink") },
            {
              label: "Season",
              value: String(x.finish),
              accent: a(x.finish === "champion" ? "pos" : "neg"),
            },
          ];
          break;
      }
    }
  }

  return v;
}
