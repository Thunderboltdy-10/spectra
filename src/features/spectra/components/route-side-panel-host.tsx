"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getSpectraArtifact,
  getSpectraThread,
  type SpectraArtifact,
  type SpectraThread,
} from "../data/api";
import { spectraBus } from "../events";
import { useSpectraMotion } from "../motion/motion-level";
import {
  readRouteSideSession,
  readSharedWorkbenchSession,
  transferSideSessionToLibrary,
  writeRouteSideSession,
  writeSharedWorkbenchSession,
} from "../workbench";
import { ArtifactStudio } from "./artifact-studio";
import { LiveThreadPanel } from "./live-thread-panel";

const ROUTE_SIDE_PANEL_PREFIXES = [
  "/calendar",
  "/agents",
  "/school",
  "/analytics",
];

export function RouteSidePanelHost() {
  const pathname = usePathname();
  const router = useRouter();
  const eligible = ROUTE_SIDE_PANEL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const [work, setWork] = useState<SpectraArtifact | null>(null);
  const [thread, setThread] = useState<SpectraThread | null>(null);
  const [workWidth, setWorkWidth] = useState(620);
  const [threadWidth, setThreadWidth] = useState(480);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const motionLevel = useSpectraMotion();
  const [exiting, setExiting] = useState<null | "work" | "thread">(null);
  const [handingOff, setHandingOff] = useState(false);
  const exitTimersRef = useRef<number[]>([]);
  useEffect(
    () => () => {
      for (const timer of exitTimersRef.current) window.clearTimeout(timer);
    },
    [],
  );

  const PANEL_EXIT_MS = 180;
  function cancelPendingExits() {
    for (const timer of exitTimersRef.current) window.clearTimeout(timer);
    exitTimersRef.current = [];
    setExiting(null);
    setHandingOff(false);
  }
  function scheduleNavigation(callback: () => void) {
    if (motionLevel.disabled) {
      callback();
      return;
    }
    exitTimersRef.current.push(window.setTimeout(callback, PANEL_EXIT_MS));
  }
  function closeWork() {
    if (motionLevel.disabled) {
      setWork(null);
      return;
    }
    setExiting("work");
    scheduleNavigation(() => {
      setWork(null);
      setExiting(null);
    });
  }
  function closeThread() {
    if (motionLevel.disabled) {
      setThread(null);
      return;
    }
    setExiting("thread");
    scheduleNavigation(() => {
      setThread(null);
      setExiting(null);
    });
  }

  const loadWork = useCallback(async (workId: string) => {
    try {
      const result = await getSpectraArtifact(workId);
      cancelPendingExits();
      setWork(result.artifact);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not open this work.",
      );
    }
  }, []);
  const loadThread = useCallback(async (threadId: string) => {
    try {
      const result = await getSpectraThread(threadId);
      cancelPendingExits();
      setThread(result.thread);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not open this conversation.",
      );
    }
  }, []);

  useEffect(() => {
    setWork(null);
    setThread(null);
    if (!eligible) return;
    const restored = readRouteSideSession(window.localStorage, pathname);
    if (restored.workId) void loadWork(restored.workId);
    if (restored.threadId) void loadThread(restored.threadId);
  }, [eligible, loadThread, loadWork, pathname]);

  useEffect(() => {
    if (!eligible) return;
    writeRouteSideSession(window.localStorage, {
      version: 1,
      routeKey: pathname,
      workId: work?._id,
      threadId: thread?._id,
      updatedAt: Date.now(),
    });
  }, [eligible, pathname, thread?._id, work?._id]);

  useEffect(() => {
    if (!eligible) return;
    const removeWork = spectraBus.handle("work.open", (command) => {
      if (command.surface === "full") {
        fullscreen(command.workId);
        return;
      }
      void loadWork(command.workId);
    });
    const removeThread = spectraBus.handle(
      "run.openConversation",
      (command) => {
        if (command.threadId) void loadThread(command.threadId);
      },
    );
    return () => {
      removeWork();
      removeThread();
    };
    // fullscreen is a stable handoff onto the library route for this panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fullscreen closes over the latest side session
  }, [eligible, loadThread, loadWork, pathname, thread?._id, work?._id]);

  const sideSession = useMemo(
    () => ({
      version: 1 as const,
      routeKey: pathname,
      workId: work?._id,
      threadId: thread?._id,
      updatedAt: Date.now(),
    }),
    [pathname, thread?._id, work?._id],
  );

  function fullscreen(workId: string) {
    const shared = readSharedWorkbenchSession(window.localStorage);
    writeSharedWorkbenchSession(
      window.localStorage,
      transferSideSessionToLibrary(shared, { ...sideSession, workId }),
    );
    // The panel hands off to the library route: a short settle so the transfer
    // reads as one surface becoming the other, not a navigation pop.
    if (motionLevel.disabled) {
      router.push(`/library/${encodeURIComponent(workId)}`);
      return;
    }
    setHandingOff(true);
    scheduleNavigation(() =>
      router.push(`/library/${encodeURIComponent(workId)}`),
    );
  }

  if (!eligible || (!work && !thread)) return null;
  return (
    <div
      className={`spectra-wave-y spectra-panel-enter pointer-events-none relative z-[88] flex h-full max-w-[calc(100vw-76px)] shrink-0 [&>[data-studio-panel]]:!pointer-events-auto ${exiting ? "spectra-panel-exit" : ""} ${handingOff ? "spectra-panel-handoff" : ""}`}
    >
      {work ? (
        <ArtifactStudio
          mode="split"
          compact
          artifact={work}
          artifacts={[work]}
          tabs={[]}
          dirtyIds={dirtyIds}
          panelWidth={workWidth}
          sourceLabel="Route preview"
          onPanelWidthChange={setWorkWidth}
          onClose={closeWork}
          onExpand={() => fullscreen(work._id)}
          onActivateTab={() => undefined}
          onCloseTab={() => setWork(null)}
          onDirtyChange={(workId, dirty) =>
            setDirtyIds((current) => {
              const next = new Set(current);
              if (dirty) next.add(workId);
              else next.delete(workId);
              return next;
            })
          }
        />
      ) : null}
      {thread ? (
        <LiveThreadPanel
          threadId={thread._id}
          title={thread.title}
          width={threadWidth}
          onWidthChange={setThreadWidth}
          onClose={closeThread}
          onOpenArtifact={(workId) => void loadWork(workId)}
          onOpenWorkspace={(workspaceId) =>
            router.push(`/workspace/${encodeURIComponent(workspaceId)}`)
          }
        />
      ) : null}
    </div>
  );
}
