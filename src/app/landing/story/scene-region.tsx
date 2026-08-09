"use client";

/**
 * A scene is a region of the one tall canvas.
 *
 * It is not a page, a section, or a slide. It occupies an authored rectangle,
 * and once the story has passed through it, it stays there in its finished
 * state — which is the whole reason the final reveal can be real.
 */

import type { ReactNode } from "react";
import { LANDING_WIDTH, SCENE_BY_ID, type SceneId } from "./timeline";

export function SceneRegion({
  scene,
  children,
  className,
  /** Inset from the canvas edges, in canvas px. */
  gutter = 72,
}: {
  scene: SceneId;
  children: ReactNode;
  className?: string;
  gutter?: number;
}) {
  const spec = SCENE_BY_ID.get(scene);
  if (!spec) return null;
  return (
    <section
      data-scene={scene}
      className={className ? `landing-scene ${className}` : "landing-scene"}
      style={{
        top: spec.top,
        width: LANDING_WIDTH,
        height: spec.height,
        paddingLeft: gutter,
        paddingRight: gutter,
      }}
    >
      {children}
    </section>
  );
}
