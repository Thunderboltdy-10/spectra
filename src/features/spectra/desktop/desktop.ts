"use client";

import { useSyncExternalStore } from "react";

/**
 * What Spectra for desktop tells its own pages. The app sets it, read-only,
 * before any Spectra page runs; a browser tab never has it.
 */
export type SpectraDesktop = {
  version: string;
  protocol: string;
  platform: string;
  origin: string;
  capabilities: readonly string[];
};

export type DesktopCapability = "window" | "silent-pair" | "sign-in-handoff" | "restart-update";

declare global {
  interface Window {
    spectraDesktop?: SpectraDesktop;
  }
}

function read(): SpectraDesktop | null {
  if (typeof window === "undefined") return null;
  const marker = window.spectraDesktop;
  if (!marker || typeof marker !== "object" || typeof marker.version !== "string") return null;
  return marker;
}

/** The app around this page, or null in an ordinary browser. */
export function spectraDesktop(): SpectraDesktop | null {
  return read();
}

export function desktopCan(capability: DesktopCapability, marker = read()) {
  return Boolean(marker?.capabilities?.includes(capability));
}

const never = () => () => undefined;

/** The app around this page; null on the server and in a browser. */
export function useDesktop(): SpectraDesktop | null {
  return useSyncExternalStore(never, read, () => null);
}
