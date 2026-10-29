"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import type { StoryWorld, WorldEvent } from "../world/world";

/** The visit's world, for the sections that act in it or listen to it. */
export const WorldContext = createContext<StoryWorld | null>(null);

export function useWorld() {
  const world = useContext(WorldContext);
  if (!world) throw new Error("The landing world is not mounted.");
  return world;
}

/** Hear what happens in the world while mounted. */
export function useWorldEvent(listener: (event: WorldEvent) => void) {
  const world = useWorld();
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => world.on((event) => ref.current(event)), [world]);
}
