"use client";

import { createContext, useContext } from "react";

/*
 * The time a showcase tells its story at. Home's sky, greeting and week read
 * the reader's own clock; on the landing page they read the story's instead
 * (Sunday evening, the night, Monday at seven). Null everywhere in the app,
 * where the real clock is the only one.
 */
export const ShowcaseTime = createContext<number | null>(null);

export function useShowcaseTime() {
  return useContext(ShowcaseTime);
}
