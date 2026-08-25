"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getSpectraArtifact,
  getSpectraThread,
  type SpectraArtifact,
  type SpectraThread,
} from "../data/api";
import { spectraBus } from "../events";
import {
  readRouteSideSession,
  readSharedWorkbenchSession,
  transferSideSessionToLibrary,
  writeRouteSideSession,
  writeSharedWorkbenchSession,
} from "../workbench";
import { LiveThreadPanel } from "./live-thread-panel";
import {
  StudioSplitPlaceholder,
  useArtifactStudioState,
} from "./artifact-studio-shell";

/**
 * Routes that already own `useArtifactStudioState` + `ArtifactStudio` must not
 * mount a second studio here. Two studios on one page load two Yjs copies and
 * stall the first paint.
 */
const ROUTE_SIDE_PANEL_PREFIXES = [
  "/school",
  "/analytics",
  "/settings",
  "/managebac",
  "/admin",
  "/superadmin",
];

const ArtifactStudio = dynamic(
  () => import("./artifact-studio").then((module) => module.ArtifactStudio),
  { loading: () => <StudioSplitPlaceholder /> },
);

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
  const artifacts = useMemo(() => (work ? [work] : []), [work]);
  const studio = useArtifactStudioState("spectra.route.studio", artifacts);
  const { openSplit, closeStudio, activateTab, setDirty } = studio;

  const loadWork = useCallback(
    async (workId: string) => {
      try {
        const result = await getSpectraArtifact(workId);
        setWork(result.artifact);
        openSplit(result.artifact);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not open this work.",
        );
      }
    },
    [openSplit],
  );
  const loadThread = useCallback(async (threadId: string) => {
    try {
      const result = await getSpectraThread(threadId);
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
    router.push(`/library/${encodeURIComponent(workId)}`);
  }

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
    // fullscreen closes over the latest side session for the library handoff.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadWork/loadThread are the live openers
  }, [eligible, loadThread, loadWork, pathname, thread?._id, work?._id]);

  function closeWork() {
    closeStudio();
    setWork(null);
  }

  if (!eligible || (!work && !thread)) return null;
  return (
    <div className="spectra-wave-y relative z-panel flex h-full max-w-[calc(100vw-76px)] shrink-0">
      {studio.mode === "split" && studio.activeArtifact ? (
        <ArtifactStudio
          mode="split"
          artifact={studio.activeArtifact}
          artifacts={artifacts}
          tabs={studio.tabs}
          dirtyIds={studio.dirtyIds}
          panelWidth={workWidth}
          sourceLabel="Route preview"
          onPanelWidthChange={setWorkWidth}
          onClose={closeWork}
          onExpand={() => fullscreen(studio.activeArtifact!._id)}
          onActivateTab={activateTab}
          onCloseTab={() => closeWork()}
          onDirtyChange={setDirty}
        />
      ) : null}
      {thread ? (
        <LiveThreadPanel
          threadId={thread._id}
          title={thread.title}
          width={threadWidth}
          onWidthChange={setThreadWidth}
          onClose={() => setThread(null)}
          onOpenArtifact={(workId) => void loadWork(workId)}
          onOpenWorkspace={(workspaceId) =>
            router.push(`/workspace/${encodeURIComponent(workspaceId)}`)
          }
        />
      ) : null}
    </div>
  );
}
