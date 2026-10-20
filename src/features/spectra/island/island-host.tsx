"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSpectraRun } from "../ai/use-spectra-run";
import { spectraBus } from "../events";
import type { SpectraCommandOutcome } from "../events/contracts";
import { useProvideIslandEngine } from "./engine";
import { Island } from "./island";
import { HOME_PATH } from "../chat/home-routes";

/** Pages that lend the island their own run engine (they show the runs they start): Home's conversation among them. */
const ROUTES_WITH_OWN_ENGINE = [HOME_PATH, "/workspace", "/library", "/agents"];

function ownsEngine(pathname: string) {
  return ROUTES_WITH_OWN_ENGINE.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * The island on every signed-in page, with the general run engine. Pages
 * that own an engine lend theirs over it while they are mounted; everywhere
 * else this one sends, answers and stops. A run it starts arrives as a tab.
 */
export function IslandHost() {
  const pathname = usePathname();
  const general = !ownsEngine(pathname);
  const engine = useSpectraRun({
    surface: "chat",
    currentView: pathname,
    observeDurableRuns: general,
    onOpenArtifact: async (workId) => {
      await spectraBus.command("work.open", { workId, surface: "panel" });
    },
  });

  // A thread open in the Side is the one the island replies to, until the
  // user lets go of it for a new conversation.
  const side = useSyncExternalStore(
    (listener) => spectraBus.subscribe("side.thread", listener),
    () => spectraBus.getQuery("side.thread") ?? null,
    () => null,
  );
  const [letGo, setLetGo] = useState<string | null>(null);
  const focus = general && side && side.threadId !== letGo ? side : null;

  useEffect(() => {
    if (!general) return;
    return spectraBus.handle("run.stopRequested", async ({ runId }) => {
      if (runId && engine.activeRunId && engine.activeRunId !== runId) return;
      await engine.stop(runId);
      return { status: "completed", message: "Stop requested. Committed work remains available." } satisfies SpectraCommandOutcome;
    });
  }, [general, engine]);

  useProvideIslandEngine(
    useMemo(
      () => ({
        engine,
        focus,
        startNewThread: focus ? () => setLetGo(focus.threadId) : undefined,
      }),
      [engine, focus],
    ),
    { fallback: true },
  );
  return <Island />;
}
