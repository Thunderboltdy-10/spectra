"use client";

import { useMemo } from "react";
import { useSpectraRun } from "@/features/spectra/ai/use-spectra-run";
import {
  useProvideIslandEngine,
  type SpectraRunEngine,
} from "@/features/spectra/island/engine";
import { Island } from "@/features/spectra/island/island";
import { spectraBus } from "@/features/spectra/events";
import { useWorld } from "./world-context";

/*
 * The real island, docked at the bottom of the landing page exactly where it
 * lives in Spectra. It sends, streams and keeps threads like the app's own;
 * the story world answers it. The page shows threads itself, as the chat page
 * does (it binds them): an answer opens in a pane beside the work, never as a
 * card over the page, and a scene's own run stays a tab on the rail while the
 * scene shows what it did.
 */

export function useLandingEngine(onOpenWork: (workId: string) => void) {
  return useSpectraRun({
    surface: "chat",
    currentView: "/landing",
    observeDurableRuns: false,
    onOpenArtifact: (workId) => onOpenWork(workId),
  });
}

const keepClosed = () => undefined;

export function LandingIsland({
  engine,
  onOpenThread = keepClosed,
  bindsThread = true,
}: {
  engine: SpectraRunEngine;
  /** False: the island opens each answer as its own card over itself, as it does on any page of the app. */
  bindsThread?: boolean;
  onOpenThread?: (thread: {
    runId: string;
    threadId: string;
    title: string;
  }) => void;
}) {
  const world = useWorld();
  useProvideIslandEngine(
    useMemo(
      () => ({
        engine,
        focus: null,
        bindsThread,
        // A new question is a thread of its own; words typed after an answer follow it up.
        startNewThread: () => {
          world.fresh = true;
        },
        openThread: (runId: string, threadId: string, title: string) =>
          onOpenThread({ runId, threadId, title }),
      }),
      [engine, onOpenThread, world, bindsThread],
    ),
  );
  return <Island />;
}

type Reference = { id: string; type: string; title: string };

/** Henry types into the island, a few letters at a time, and sends. Work he handed it goes with the words. */
export function typeIntoIsland(
  text: string,
  {
    fresh = false,
    perLetter = 46,
    references,
  }: { fresh?: boolean; perLetter?: number; references?: Reference[] } = {},
) {
  return new Promise<void>((resolve) => {
    let index = 0;
    const timer = window.setInterval(() => {
      index = Math.min(text.length, index + 1 + Math.round(Math.random()));
      const done = index >= text.length;
      spectraBus.emit("island.compose", {
        fresh: fresh && index <= 2,
        text: text.slice(0, index),
        references,
        send: done,
      });
      if (done) {
        window.clearInterval(timer);
        resolve();
      }
    }, perLetter);
  });
}

/** Where the island's field is on screen, for a hand handing it something. */
export function islandField() {
  return document.querySelector<HTMLElement>("[data-island-composer]");
}
