"use client";

import { useEffect, useSyncExternalStore } from "react";

/*
 * On a phone the island rests out of the way: a faint lip at the bottom edge
 * that a swipe up (or a tap) raises. A page showing the island off — Setup's
 * island step — keeps it up while it is on screen.
 */
const PHONE = "(max-width: 639px)";

function subscribePhone(listener: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(PHONE);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
const isPhone = () => typeof window.matchMedia === "function" && window.matchMedia(PHONE).matches;

let showcases = 0;
const listeners = new Set<() => void>();
function subscribeShowcase(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the island rests hidden here: a phone, with nothing showing it off. */
export function useIslandRestsHidden() {
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false);
  const showcased = useSyncExternalStore(subscribeShowcase, () => showcases > 0, () => false);
  return phone && !showcased;
}

/** Keeps the island up while the calling component is mounted. */
export function useIslandShowcase() {
  useEffect(() => {
    showcases += 1;
    for (const listener of listeners) listener();
    return () => {
      showcases -= 1;
      for (const listener of listeners) listener();
    };
  }, []);
}
