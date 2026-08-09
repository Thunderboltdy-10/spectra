"use client";

/**
 * The landing page.
 *
 * There is one thing on it: a story that builds itself. Everything a visitor
 * used to have to read as claims — feature grids, capability cards, a pricing
 * table, a contact form — is now something they watch being made, on the real
 * surfaces, by the real collaboration system. So this file is deliberately
 * almost empty: it mounts the story and puts one door in reach of it.
 *
 * The rail is the only chrome. It exists because the page is roughly thirty
 * screens tall and a visitor who decides in the first three of them should not
 * have to scroll to the end to act. It retires when the product's own furniture
 * resolves at the reveal, because at that point the room has a sidebar and two
 * pieces of navigation stacked on each other would be one too many.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import { SpectraLogo } from "@/components/spectra-logo";
import { LandingStory } from "./story/landing-story";
import { onStoryFrame } from "./story/story-clock";
import { channelFor } from "./story/timeline";

/**
 * The one persistent affordance.
 *
 * Its opacity is a pure function of the story frame, read imperatively like
 * every other moving thing on this page: no scroll listener, no React state, no
 * re-render. It leaves as the shell arrives and comes back if the visitor
 * scrolls up, because the whole story is reversible and this is part of it.
 */
function Rail() {
  const hostRef = useRef<HTMLElement>(null);

  useEffect(
    () =>
      onStoryFrame((frame) => {
        const node = hostRef.current;
        if (!node) return;
        const box = channelFor(frame, frame.viewport);
        /* Two reasons to stand down, and the stronger one wins: the product
           chrome is resolving, or the visitor is moving fast enough that a
           fixed element would smear against a moving canvas. */
        const gone = Math.min(
          1,
          Math.max(box.open * 1.6, Math.min(1, Math.abs(frame.velocity) / 260)),
        );
        node.style.opacity = (1 - gone).toFixed(3);
        node.style.transform = `translate3d(0, ${(-14 * gone).toFixed(1)}px, 0)`;
        const live = gone < 0.98 ? "true" : "false";
        if (node.dataset.live !== live) node.dataset.live = live;
      }),
    [],
  );

  return (
    <header ref={hostRef} className="landing-rail" data-live="true">
      <Link href="/" className="landing-rail-brand" aria-label="Spectra home">
        <SpectraLogo size={22} />
        <span>Spectra</span>
      </Link>
      <nav className="landing-rail-actions" aria-label="Account">
        <Link href="/sign-in" className="landing-rail-link">
          Sign in
        </Link>
        <Link href="/sign-up" className="landing-btn" data-size="compact" data-tone="primary">
          Get started
        </Link>
      </nav>
    </header>
  );
}

export function LandingClient() {
  return (
    <main className="landing-root">
      <Rail />
      <LandingStory />
    </main>
  );
}
