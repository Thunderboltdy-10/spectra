"use client";

import { useSyncExternalStore } from "react";

/*
 * Whether things that live on this computer can be used right now, for every
 * surface that greys them out. BridgeConnection, mounted once with the app,
 * keeps it current so a long list of rows doesn't each poll Bridge.
 */

export type BridgeAvailability =
  /** Not known yet; nothing greys out on a guess. */
  | "checking"
  | "ready"
  /** It's on this computer, and this browser hasn't joined it yet. */
  | "not-connected"
  /** This account has used Bridge, and it isn't answering. */
  | "not-running"
  /** This account has never connected a computer. */
  | "not-installed";

let current: BridgeAvailability = "checking";
const listeners = new Set<() => void>();

export function publishBridgeAvailability(next: BridgeAvailability) {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function useBridgeAvailability() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => current,
    () => "checking" as const,
  );
}

/** For code outside React that would otherwise knock on a Bridge that isn't there. */
export function bridgeIsAway() {
  return current === "not-connected" || current === "not-running" || current === "not-installed";
}

/** The same sentence for the Devices page itself, where "go to Devices" means nothing. */
export function bridgeUnavailableHere(availability: BridgeAvailability) {
  if (availability === "not-connected") return "Spectra Bridge isn't connected to this browser yet. Connect it on this page first.";
  if (availability === "not-running") return "Spectra Bridge isn't running on this computer. Open it and this page picks it up.";
  if (availability === "not-installed") return "This needs Spectra Bridge. Get it on this page first.";
  return null;
}

/** The sentence on anything greyed out, with where to go next. */
export function bridgeUnavailableReason(availability: BridgeAvailability) {
  if (availability === "not-connected") return "Spectra Bridge isn't connected to this browser. Go to Devices to connect it.";
  if (availability === "not-running") return "Spectra Bridge isn't running on this computer. Go to Devices to start it.";
  if (availability === "not-installed") return "This needs Spectra Bridge, which isn't installed yet. Go to Devices to get it.";
  return null;
}
