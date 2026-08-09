"use client";

/**
 * How close the camera is to a scene.
 *
 * The tall canvas is permanent, but the expensive things standing on it are
 * not: a rich text editor, a spreadsheet and a 3D-adjacent workbench do not all
 * need to be mounted while the visitor is reading the hero. A surface mounts
 * when the camera is one scene away and stands down when it is two, leaving
 * behind the plate it was mounted in — which is the shape the final reveal
 * actually reads at that scale.
 *
 * This is `useStoryValue`, so it re-renders at scene boundaries and nowhere
 * else. Nothing here runs per frame.
 */

import { useCallback } from "react";
import { useStoryValue } from "./story-clock";
import { SCENES, type SceneId } from "./timeline";

const INDEX = new Map(SCENES.map((scene, index) => [scene.id, index]));

/**
 * True while the camera is within `radius` scenes of `scene`.
 *
 * The default reaches one scene either side, which is a full viewport of
 * warning: by the time a surface is on screen it has been mounted, laid out
 * and painted for a whole scene.
 */
export function useNearScene(scene: SceneId, radius = 1): boolean {
  const home = INDEX.get(scene) ?? 0;
  const select = useCallback(
    (step: { index: number }) => Math.abs(step.index - home) <= radius,
    [home, radius],
  );
  return useStoryValue(select);
}
