"use client";

/**
 * Scene 11 — the pull-back begins.
 *
 * The camera starts leaving. This scene is deliberately the quietest on the
 * page: it is the breath before the reveal, and anything busy here would make
 * the last movement feel like a trick rather than a conclusion.
 *
 * There are exactly three things in it. A closing statement. The prism, back at
 * the size it was in the hero, resolving. And one honest count of what the
 * visitor has actually watched being built, so the reveal has something to
 * refer back to.
 */

import { useRef } from "react";
import { targetAttrs } from "@/features/spectra/collaboration/target-attributes";
import { SceneRegion } from "../story/scene-region";
import { Body, Headline, Marker, useDuring, useSceneT } from "../story/scene-kit";
import { usePrismSlot } from "../prism/prism-slot";
import { clamp01, type Beat } from "../story/beats";

export const SCALE_BEATS: readonly Beat[] = [
  {
    actor: "spectra",
    from: 0.04,
    to: 0.12,
    path: "scale/marker",
    primitive: "richtext",
    act: { kind: "type", text: "All of it, one place" },
  },
  {
    actor: "spectra",
    from: 0.14,
    to: 0.28,
    path: "scale/line-1",
    primitive: "richtext",
    act: { kind: "type", text: "Not a set of" },
  },
  {
    actor: "spectra",
    from: 0.28,
    to: 0.4,
    path: "scale/line-2",
    primitive: "richtext",
    act: { kind: "type", text: "features." },
  },
  {
    actor: "spectra",
    from: 0.4,
    to: 0.54,
    path: "scale/line-3",
    primitive: "richtext",
    act: { kind: "type", text: "One place to work." },
  },

  /* Spectra takes the glass back. Whatever the visitor did to it, it settles. */
  {
    actor: "spectra",
    from: 0.44,
    to: 0.72,
    path: "scale/prism",
    primitive: "canvasObject",
    label: "Prism",
    act: { kind: "drag", to: "scale/rest" },
    note: "Setting it down",
  },
  {
    actor: "pabloAi",
    from: 0.62,
    to: 0.86,
    path: "scale/body",
    primitive: "richtext",
    act: {
      kind: "type",
      text: "One request became a document, a plan, three study blocks and a week that knows about all of them.",
    },
  },
];

/** What the visitor has actually watched happen. Counted, not claimed. */
const MADE = [
  { value: "1", label: "Request" },
  { value: "4", label: "Surfaces" },
  { value: "3", label: "Sources" },
  { value: "3", label: "Study blocks" },
] as const;

const REST_POSE = [0.12, -0.58, 0.02] as const;

export function ScaleScene() {
  const prismRef = useRef<HTMLDivElement>(null);
  const t = useSceneT("scale");
  const holding = useDuring("scale", 0.44, 0.74);

  usePrismSlot(prismRef, {
    fill: 1,
    lambda: holding ? 3.2 : 1.9,
    pose: REST_POSE,
    poseWeight: holding ? 0.85 : 0.3,
    owned: holding,
    priority: 2,
  });

  return (
    <SceneRegion scene="scale">
      <div className="flex h-full items-center gap-16">
        <div className="w-[496px] shrink-0">
          <Marker beats={SCALE_BEATS} scene="scale" path="scale/marker" />
          <Headline
            beats={SCALE_BEATS}
            scene="scale"
            size="section"
            accentLast
            paths={["scale/line-1", "scale/line-2", "scale/line-3"]}
            className="mt-4"
          />
          <Body
            beats={SCALE_BEATS}
            scene="scale"
            path="scale/body"
            className="mt-6"
          />

          {/* The tally. It appears as a row of facts rather than a stat block,
              because these are things the visitor saw rather than metrics. */}
          <dl
            className="mt-8 flex items-baseline gap-10 border-t border-[var(--border-subtle)] pt-5"
            {...targetAttrs("scale/tally", undefined, "surface")}
          >
            {MADE.map((entry, index) => (
              <div
                key={entry.label}
                style={{
                  opacity: clamp01((t - 0.66 - index * 0.03) / 0.06),
                  transform: `translate3d(0, ${
                    t >= 0.66 + index * 0.03 ? 0 : 6
                  }px, 0)`,
                  transition:
                    "opacity var(--motion-slow) var(--ease-standard), transform var(--motion-slow) var(--ease-out-expo)",
                }}
              >
                <dt className="text-micro font-semibold uppercase leading-[1.3] tracking-[0.16em] text-[var(--text-tertiary)]">
                  {entry.label}
                </dt>
                <dd className="mt-1 text-display font-semibold leading-[1] tracking-[-0.03em] tabular-nums text-[var(--text-primary)]">
                  {entry.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div
          className="relative ml-auto h-full w-[400px]"
          {...targetAttrs("scale/rest", undefined, "surface")}
        >
          <div
            ref={prismRef}
            className="absolute right-[-24px] top-[24px] h-[420px] w-[420px]"
            {...targetAttrs("scale/prism", undefined, "canvasObject")}
          />
        </div>
      </div>
    </SceneRegion>
  );
}
