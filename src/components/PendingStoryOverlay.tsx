"use client";

import { useLinkStatus } from "next/link";
import { createPortal } from "react-dom";
import { LoadingScreen } from "@/components/LoadingScreen";

/**
 * Drop as a child inside a <Link> that leads to a wrapped page. useLinkStatus
 * reports pending state for that specific Link — true from the moment it's
 * clicked, well before the destination has resolved anything, false once the
 * new page takes over. Purely client-side.
 *
 * Deliberately NOT a route-level loading.tsx: that was tried first and
 * rejected. A loading.tsx introduces a Suspense boundary around the whole
 * segment, and Next's streaming model commits the response's HTTP status
 * before an async notFound() inside that boundary can run — so requests for
 * a genuinely unknown roster came back 200 instead of 404 (looks fine to a
 * human, wrong to a crawler or an uptime check). This hook never touches the
 * target route's server rendering, so that failure mode doesn't exist here.
 *
 * Portaled to document.body rather than rendered in place: several call
 * sites nest this inside a `motion.li`, and Framer Motion elements often
 * carry a `transform`, which creates a new containing block that would trap
 * a `position: fixed` overlay inside that list item instead of the viewport.
 */
export function PendingStoryOverlay() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-page">
      <div className="story-frame relative flex flex-col justify-center overflow-hidden bg-field px-7 text-chalk sm:border sm:border-chalk/12">
        <LoadingScreen
          title="Building their story…"
          description="Same treatment as yours. Won't take long."
          barDurationSeconds={4}
        />
      </div>
    </div>,
    document.body,
  );
}
