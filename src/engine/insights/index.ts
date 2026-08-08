import type { CandidateInsight, GlobalStats, SeasonFacts } from "../types";
import { globalInsights } from "./global";
import type { InsightModule } from "./helpers";
import { identityInsights } from "./identity";
import { luckInsights } from "./luck";
import { narrativeInsights } from "./narrative";
import { peopleInsights } from "./people";
import { regretInsights } from "./regret";

export const allInsights: InsightModule[] = [
  ...regretInsights,
  ...luckInsights,
  ...peopleInsights,
  ...narrativeInsights,
  ...identityInsights,
  ...globalInsights,
];

export function computeCandidates(
  facts: SeasonFacts,
  rosterId: string,
  globalStats: GlobalStats,
): CandidateInsight[] {
  const candidates: CandidateInsight[] = [];
  for (const module of allInsights) {
    const insight = module.compute(facts, rosterId, globalStats);
    if (insight) candidates.push(insight);
  }
  return candidates.sort((a, b) => b.notability - a.notability || a.id.localeCompare(b.id));
}
