"use client";

/**
 * Scene 0 — the surface wakes.
 *
 * Quiet anticipation. Nothing here announces AI. Pablo places the mark,
 * Spectra writes the word beside it, and the navigation arrives as one
 * coherent header rather than seven items flying in from seven directions.
 *
 * The alignment guide is the tell that this is a work surface: it appears
 * while the mark is being placed and leaves the moment it lands.
 */

import { useRef } from "react";
import { SpectraLogo } from "@/components/spectra-logo";
import { targetAttrs } from "@/features/spectra/collaboration/target-attributes";
import { SceneRegion } from "../story/scene-region";
import { Authored } from "../story/authored";
import { Carried, useSceneStyle } from "../story/scene-kit";
import type { Beat } from "../story/beats";

export const WAKE_BEATS: readonly Beat[] = [
  {
    actor: "pablo",
    from: 0.08,
    to: 0.44,
    path: "header/mark",
    primitive: "canvasObject",
    label: "Spectra mark",
    act: { kind: "drag", to: "header/brand" },
    note: "Placing the mark",
  },
  {
    actor: "spectra",
    from: 0.46,
    to: 0.72,
    path: "header/wordmark",
    primitive: "richtext",
    act: { kind: "type", text: "Spectra" },
  },
];

const NAV = [
  "How it works",
  "Capabilities",
  "Specialists",
  "For schools",
  "Pricing",
] as const;

export function WakeScene() {
  const hostRef = useRef<HTMLDivElement>(null);
  useSceneStyle(hostRef, "wake");

  return (
    <SceneRegion scene="wake">
      <div ref={hostRef} className="landing-wake" data-live="false">
        <header
          className="landing-header"
          {...targetAttrs("header", undefined, "surface")}
        >
          <div
            className="landing-header-brand"
            {...targetAttrs("header/brand", undefined, "surface")}
          >
            {/* The guide exists only while the mark is being placed. A ruler
                that stayed on the page would be decoration. */}
            <span className="landing-guide" aria-hidden="true" />
            <Carried
              beats={WAKE_BEATS}
              scene="wake"
              path="header/mark"
              from={[-118, -64]}
              className="landing-header-mark"
            >
              <span {...targetAttrs("header/mark", undefined, "canvasObject")}>
                <SpectraLogo size={22} />
              </span>
            </Carried>
            <Authored
              beats={WAKE_BEATS}
              scene="wake"
              path="header/wordmark"
              className="landing-header-word"
            />
          </div>

          {/* The navigation is one object. It arrives as a group because that
              is what it is: a header, not seven independent decisions. */}
          <nav className="landing-header-nav" aria-label="Landing sections">
            {NAV.map((label) => (
              <span key={label} className="landing-header-link">
                {label}
              </span>
            ))}
          </nav>
          <div className="landing-header-actions">
            <span className="landing-header-link">Sign in</span>
            <span className="landing-header-cta">Get started</span>
          </div>
        </header>
      </div>
    </SceneRegion>
  );
}
