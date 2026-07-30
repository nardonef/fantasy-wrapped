"use client";

import Link from "next/link";
import posthog from "posthog-js";
import type { ComponentProps, MouseEvent } from "react";

type Props = ComponentProps<typeof Link> & {
  leagueId: string;
  rosterId: string;
  linkType: "award" | "team";
  awardId?: string;
};

/** A next/link that also fires league_ballot_link_clicked before navigating. */
export function BallotLink({
  leagueId,
  rosterId,
  linkType,
  awardId,
  onClick,
  ...linkProps
}: Props) {
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    if (posthog.__loaded) {
      posthog.capture("league_ballot_link_clicked", {
        league_id: leagueId,
        roster_id: rosterId,
        link_type: linkType,
        ...(awardId ? { award_id: awardId } : {}),
      });
    }
    onClick?.(e);
  }

  return <Link {...linkProps} onClick={handleClick} />;
}
