"use client";

/**
 * Scene 2 — preparing the prism.
 *
 * Gathering tension. Spectra takes the glass, rotates it into the pose that
 * makes a transformation readable, and moves it left to leave room for what
 * comes out. Pablo's AI marks where the output will land.
 *
 * The pose is authored rather than animated: the slot declares the angle and
 * how much authority it has over the idle drift, and the object settles into it
 * over about a second. If the visitor spun the glass a moment ago, it settles
 * from wherever they left it. Nothing snaps.
 */

import { useRef } from "react";
import { targetAttrs } from "@/features/spectra/collaboration/target-attributes";
import { SceneRegion } from "../story/scene-region";
import { Body, Marker, useDuring } from "../story/scene-kit";
import { usePrismSlot } from "../prism/prism-slot";
import type { Beat } from "../story/beats";

export const PREPARE_BEATS: readonly Beat[] = [
  {
    actor: "spectra",
    from: 0.06,
    to: 0.34,
    path: "prepare/prism",
    primitive: "canvasObject",
    label: "Prism",
    act: { kind: "drag", to: "prepare/stage" },
    note: "Setting the angle",
  },
  {
    actor: "pabloAi",
    from: 0.3,
    to: 0.5,
    path: "prepare/marker",
    primitive: "richtext",
    act: { kind: "type", text: "Output" },
  },
  {
    actor: "spectra",
    from: 0.46,
    to: 0.74,
    path: "prepare/body",
    primitive: "richtext",
    act: {
      kind: "type",
      text: "Three unfinished things go in. One piece of work comes out, with everything it came from still attached.",
    },
  },
];

/**
 * The transformation pose.
 *
 * The input face turns away to the left and rear so it reads as concealed; the
 * output triangle faces the room; the long glass side keeps the object's real
 * thickness visible. A continuously rotating aperture would be more clever and
 * far less legible.
 */
const TRANSFORM_POSE = [0.07, -1.02, -0.04] as const;

export function PrepareScene() {
  const prismRef = useRef<HTMLDivElement>(null);
  const owned = useDuring("prepare", 0.04, 1);

  usePrismSlot(prismRef, {
    fill: 1,
    lambda: 2.2,
    pose: TRANSFORM_POSE,
    poseWeight: 1,
    owned,
    priority: 2,
  });

  return (
    <SceneRegion scene="prepare">
      <div className="relative h-full">
        {/* Centre-left, and ten per cent smaller than the hero: the object
            steps back to make room for what it is about to produce. */}
        <div
          ref={prismRef}
          className="absolute left-[6px] top-[26px] h-[404px] w-[404px]"
          {...targetAttrs("prepare/prism", undefined, "canvasObject")}
        />

        {/* The alignment region Pablo's AI sets: a place, not a picture. It is
            the only mark on this part of the canvas until work lands in it. */}
        <div
          className="absolute right-0 top-[64px] h-[292px] w-[452px] rounded-[var(--radius-lg)] border border-dashed"
          style={{
            borderColor:
              "color-mix(in oklab, var(--brand-primary) 26%, transparent)",
            background:
              "color-mix(in oklab, var(--brand-primary) 3%, transparent)",
          }}
          {...targetAttrs("prepare/output", undefined, "surface")}
        >
          <div className="p-4">
            <Marker
              beats={PREPARE_BEATS}
              scene="prepare"
              path="prepare/marker"
            />
          </div>
        </div>

        <div className="absolute bottom-[26px] right-0 w-[452px]">
          <Body beats={PREPARE_BEATS} scene="prepare" path="prepare/body" />
        </div>
      </div>
    </SceneRegion>
  );
}
