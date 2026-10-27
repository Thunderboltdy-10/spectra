"use client";

import { useMemo } from "react";
import { useSpectraRun } from "@/features/spectra/ai/use-spectra-run";
import { useProvideIslandEngine } from "@/features/spectra/island/engine";
import { Island } from "@/features/spectra/island/island";
import { spectraBus } from "@/features/spectra/events";

/*
 * The real island, docked at the bottom of the landing page exactly where it
 * lives in Spectra. It sends, streams and keeps threads like the app's own;
 * the story world answers it. A work it opens goes to the page's side panel.
 */

export function LandingIsland({ onOpenWork }: { onOpenWork: (workId: string) => void }) {
  const engine = useSpectraRun({
    surface: "chat",
    currentView: "/landing",
    observeDurableRuns: false,
    onOpenArtifact: (workId) => onOpenWork(workId),
  });
  useProvideIslandEngine(useMemo(() => ({ engine, focus: null }), [engine]), { fallback: true });
  return <Island />;
}

type Reference = { id: string; type: string; title: string };

/** Henry types into the island, a few letters at a time, and sends. Work he handed it goes with the words. */
export function typeIntoIsland(text: string, { fresh = false, perLetter = 46, references }: { fresh?: boolean; perLetter?: number; references?: Reference[] } = {}) {
  return new Promise<void>((resolve) => {
    let index = 0;
    const timer = window.setInterval(() => {
      index = Math.min(text.length, index + 1 + Math.round(Math.random()));
      const done = index >= text.length;
      spectraBus.emit("island.compose", { fresh: fresh && index <= 2, text: text.slice(0, index), references, send: done });
      if (done) {
        window.clearInterval(timer);
        resolve();
      }
    }, perLetter);
  });
}

/** Puts the island's open thread card away, as pressing Escape does; the thread stays on its rail. */
export function putIslandAway() {
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

/** Where the island's field is on screen, for a hand handing it something. */
export function islandField() {
  return document.querySelector<HTMLElement>("[data-island-composer]");
}
