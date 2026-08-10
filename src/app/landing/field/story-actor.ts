"use client";

/**
 * Who is working, and where.
 *
 * The field has to mean something. A pool of grain that brightens under the
 * mouse pointer is a hover effect; a pool that gathers where an actor is
 * genuinely editing is the product telling you something true. This is the
 * channel between the two: the presence layer publishes whichever actor is
 * currently acting, in viewport pixels, and the field colours itself after
 * them.
 *
 * It is a plain mutable object rather than state, because it is read inside the
 * frame loop and nothing should re-render when it changes.
 */

const NEUTRAL: readonly [number, number, number] = [0.55, 0.57, 0.62];

export const storyActor = {
  /** Viewport pixels. */
  x: 0,
  y: 0,
  /** Reach in CSS px. */
  radius: 260,
  /** 0..1. Zero means nobody is acting and the field returns to rest. */
  strength: 0,
  /** The acting identity's colour, linear rgb. */
  color: NEUTRAL as readonly [number, number, number],
};

export function clearStoryActor() {
  storyActor.strength = 0;
}
