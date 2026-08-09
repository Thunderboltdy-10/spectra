"use client";

/**
 * The landing story.
 *
 * One canvas, one field, one prism, one presence layer, thirteen scenes. This
 * file is the composition root and deliberately nothing else: every scene owns
 * its own beats and its own composition, and the only thing they share is the
 * surface they are all built on.
 *
 * The order of the layers matters and is the whole trick:
 *
 *   landing-frame        fixed viewport, the room
 *     landing-field      the environment, z 0
 *     prism layer        z 1 behind the work, z 70 when carried
 *     landing-canvas     z 10, the tall work surface the camera moves over
 *       presence layer   inside the surface, so cursors scale with it
 *       scenes           regions of the surface
 */

import { useEffect, useMemo } from "react";
import { StoryCanvas } from "./story-canvas";
import { LandingField } from "../field/landing-field";
import { PrismLayer } from "../prism/prism-layer";
import { InteractionLayer } from "@/features/spectra/components/presence/interaction-layer";
import { useStoryPresence } from "./use-story-states";
import { watchStoryMotion } from "./story-motion";
import type { Beat } from "./beats";
import type { SceneId } from "./timeline";

import { WakeScene, WAKE_BEATS } from "../scenes/wake";
import { HeroScene, HERO_BEATS } from "../scenes/hero";
import { PrepareScene, PREPARE_BEATS } from "../scenes/prepare";
import { TransformScene, TRANSFORM_BEATS } from "../scenes/transform";
import { LivingScene, LIVING_BEATS } from "../scenes/living";
import { ContentionScene, CONTENTION_BEATS } from "../scenes/contention";
import { DockScene, DOCK_BEATS } from "../scenes/dock";
import { WorkbenchScene, WORKBENCH_BEATS } from "../scenes/workbench";
import { ReferencesScene, REFERENCES_BEATS } from "../scenes/references";
import { CalendarScene, CALENDAR_BEATS } from "../scenes/calendar";
import { FoundryScene, FOUNDRY_BEATS } from "../scenes/foundry";
import { ScaleScene, SCALE_BEATS } from "../scenes/scale";
import { RevealScene, RevealShell, REVEAL_BEATS } from "../scenes/reveal";

const BEATS: Partial<Record<SceneId, readonly Beat[]>> = {
  wake: WAKE_BEATS,
  hero: HERO_BEATS,
  prepare: PREPARE_BEATS,
  transform: TRANSFORM_BEATS,
  living: LIVING_BEATS,
  contention: CONTENTION_BEATS,
  dock: DOCK_BEATS,
  workbench: WORKBENCH_BEATS,
  references: REFERENCES_BEATS,
  calendar: CALENDAR_BEATS,
  foundry: FOUNDRY_BEATS,
  scale: SCALE_BEATS,
  reveal: REVEAL_BEATS,
};

export function LandingStory() {
  const beats = useMemo(() => BEATS, []);
  const states = useStoryPresence(beats);

  /* Calm mode is consulted inside the frame loop, so it is watched once here
     rather than subscribed to by every line of text on the page. */
  useEffect(watchStoryMotion, []);

  return (
    <StoryCanvas
      ground={<LandingField />}
      shell={<RevealShell />}
      overlay={<PrismLayer />}
    >
      {/* One presence layer for the whole story. It lives inside the canvas
          surface, so a cursor pointing at a control stays on that control at
          any camera scale, and travel between scenes is one continuous move. */}
      <InteractionLayer states={states} anchor="static" />

      <WakeScene />
      <HeroScene />
      <PrepareScene />
      <TransformScene />
      <LivingScene />
      <ContentionScene />
      <DockScene />
      <WorkbenchScene />
      <ReferencesScene />
      <CalendarScene />
      <FoundryScene />
      <ScaleScene />
      <RevealScene />
    </StoryCanvas>
  );
}
