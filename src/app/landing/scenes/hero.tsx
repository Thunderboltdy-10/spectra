"use client";

/**
 * Scene 1 — the hero.
 *
 * Curiosity, confidence, space. The left column is authored line by line; the
 * right is where the one true prism arrives, carried in from beyond the edge by
 * Spectra rather than fading up out of nothing.
 *
 * The Quick Chat here is the product's real composer. Spectra types into it
 * through the same path a keyboard takes, which is why the send button lights
 * and the field autosizes: nothing about it is a drawing of a composer.
 */

import { useRef } from "react";
import { CommandBar } from "@/features/spectra/components/command-bar";
import { targetAttrs } from "@/features/spectra/collaboration/target-attributes";
import { SceneRegion } from "../story/scene-region";
import { Carried, Headline, Body, Marker, useDuring } from "../story/scene-kit";
import { useStoryTyping } from "../story/use-story-typing";
import { usePrismSlot } from "../prism/prism-slot";
import type { Beat } from "../story/beats";

export const HERO_BEATS: readonly Beat[] = [
  {
    actor: "spectra",
    from: 0.02,
    to: 0.1,
    path: "hero/marker",
    primitive: "richtext",
    act: { kind: "type", text: "Spectra workspace" },
  },
  {
    actor: "spectra",
    from: 0.12,
    to: 0.24,
    path: "hero/line-1",
    primitive: "richtext",
    act: { kind: "type", text: "Every piece" },
  },
  {
    actor: "spectra",
    from: 0.24,
    to: 0.33,
    path: "hero/line-2",
    primitive: "richtext",
    act: { kind: "type", text: "of work," },
  },
  {
    actor: "spectra",
    from: 0.33,
    to: 0.42,
    path: "hero/line-3",
    primitive: "richtext",
    act: { kind: "type", text: "connected." },
  },
  {
    actor: "pabloAi",
    from: 0.3,
    to: 0.48,
    path: "hero/body",
    primitive: "richtext",
    act: {
      kind: "type",
      text: "Documents, sources, plans and conversations stay aware of one another, so people and AI can work in the same place.",
    },
  },
  {
    actor: "pablo",
    from: 0.44,
    to: 0.56,
    path: "hero/actions",
    primitive: "canvasObject",
    label: "Actions",
    act: { kind: "drag", to: "hero/copy" },
    note: "Placing the actions",
  },
  {
    actor: "spectra",
    from: 0.5,
    to: 0.68,
    path: "hero/prism",
    primitive: "canvasObject",
    label: "Prism",
    act: { kind: "drag", to: "hero/stage" },
    note: "Bringing in the prism",
  },
  {
    actor: "pablo",
    from: 0.6,
    to: 0.72,
    path: "hero/quickchat",
    primitive: "canvasObject",
    label: "Quick Chat",
    act: { kind: "drag", to: "hero/copy" },
    note: "Placing Quick Chat",
  },
  {
    actor: "spectra",
    from: 0.76,
    to: 0.94,
    path: "hero/quickchat/input",
    primitive: "richtext",
    label: "Quick Chat",
    act: {
      kind: "type",
      text: "Turn these notes into a revision document for Friday.",
    },
    linger: 0.04,
  },
];

/** The composed hero pose: output face legible, depth preserved on the side. */
const HERO_POSE = [0.1, -0.62, 0.03] as const;

export function HeroScene() {
  const prismRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  /* Spectra holds the glass while it is being carried in. Once released, the
     visitor can spin it: the lease was for the entrance, not forever. */
  const carrying = useDuring("hero", 0.5, 0.7);

  usePrismSlot(prismRef, {
    fill: 1,
    lambda: carrying ? 8 : 2.6,
    pose: HERO_POSE,
    poseWeight: carrying ? 0.5 : 0.16,
    owned: carrying,
  });

  useStoryTyping(chatRef, {
    beats: HERO_BEATS,
    scene: "hero",
    path: "hero/quickchat/input",
  });

  return (
    <SceneRegion scene="hero">
      <div className="flex h-full items-start pt-[96px]">
        <div
          className="landing-lede w-[520px] shrink-0"
          {...targetAttrs("hero/copy", undefined, "surface")}
        >
          <Marker beats={HERO_BEATS} scene="hero" path="hero/marker" />
          <Headline
            beats={HERO_BEATS}
            scene="hero"
            size="hero"
            accentLast
            paths={["hero/line-1", "hero/line-2", "hero/line-3"]}
            className="-mt-1"
          />
          <Body beats={HERO_BEATS} scene="hero" path="hero/body" />

          {/* The buttons arrive as one object because that is what they are:
              a decision about what to do next, not two independent widgets. */}
          <Carried
            beats={HERO_BEATS}
            scene="hero"
            path="hero/actions"
            from={[-64, 150]}
            className="flex items-center gap-3"
          >
            <span
              className="landing-btn"
              data-tone="primary"
              {...targetAttrs("hero/actions/start", undefined, "button")}
            >
              Get started
            </span>
            <span
              className="landing-btn"
              {...targetAttrs("hero/actions/tour", undefined, "button")}
            >
              See how it works
            </span>
          </Carried>

          <Carried
            beats={HERO_BEATS}
            scene="hero"
            path="hero/quickchat"
            from={[40, 210]}
            className="w-full pt-2"
          >
            <div ref={chatRef} className="w-[470px]">
              <CommandBar
                placeholder="Ask Spectra to make something"
                onSubmit={() => false}
              />
            </div>
          </Carried>
        </div>

        {/* The glass lives in the right half. The slot is a box, not a picture:
            the object is a single fixed 3D scene that reads this rectangle
            every frame, so it travels with the camera without being re-created. */}
        <div
          className="relative ml-auto h-full w-[430px]"
          {...targetAttrs("hero/stage", undefined, "surface")}
        >
          <Carried
            beats={HERO_BEATS}
            scene="hero"
            path="hero/prism"
            from={[600, -40]}
            className="absolute right-[-38px] top-[86px] h-[460px] w-[460px]"
          >
            <div
              ref={prismRef}
              className="h-full w-full"
              {...targetAttrs("hero/prism", undefined, "canvasObject")}
            />
          </Carried>
        </div>
      </div>
    </SceneRegion>
  );
}
