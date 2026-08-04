"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getSpectraArtifact, getSpectraThread, type SpectraArtifact, type SpectraThread } from "../data/api";
import { spectraBus } from "../events";
import {
  readRouteSideSession,
  readSharedWorkbenchSession,
  transferSideSessionToLibrary,
  writeRouteSideSession,
  writeSharedWorkbenchSession,
} from "../workbench";
import { ArtifactStudio } from "./artifact-studio";
import { LiveThreadPanel } from "./live-thread-panel";

const ROUTE_SIDE_PANEL_PREFIXES = ["/calendar", "/agents", "/school", "/analytics"];

export function RouteSidePanelHost() {
  const pathname = usePathname();
  const router = useRouter();
  const eligible = ROUTE_SIDE_PANEL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const [work, setWork] = useState<SpectraArtifact | null>(null);
  const [thread, setThread] = useState<SpectraThread | null>(null);
  const [workWidth, setWorkWidth] = useState(620);
  const [threadWidth, setThreadWidth] = useState(480);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());

  const loadWork = useCallback(async (workId: string) => {
    try {
      const result = await getSpectraArtifact(workId);
      setWork(result.artifact);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open this work.");
    }
  }, []);
  const loadThread = useCallback(async (threadId: string) => {
    try {
      const result = await getSpectraThread(threadId);
      setThread(result.thread);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open this conversation.");
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
    const removeThread = spectraBus.handle("run.openConversation", (command) => {
      if (command.threadId) void loadThread(command.threadId);
    });
    return () => { removeWork(); removeThread(); };
  }, [eligible, loadThread, loadWork, pathname, thread?._id, work?._id]);

  const sideSession = useMemo(() => ({
    version: 1 as const,
    routeKey: pathname,
    workId: work?._id,
    threadId: thread?._id,
    updatedAt: Date.now(),
  }), [pathname, thread?._id, work?._id]);

  function fullscreen(workId: string) {
    const shared = readSharedWorkbenchSession(window.localStorage);
    writeSharedWorkbenchSession(window.localStorage, transferSideSessionToLibrary(shared, { ...sideSession, workId }));
    router.push(`/library/${encodeURIComponent(workId)}`);
  }

  if (!eligible || (!work && !thread)) return null;
  return (
    <div className="spectra-wave-y pointer-events-none fixed inset-y-0 right-0 z-[88] flex max-w-[calc(100vw-76px)] [&>[data-studio-panel]]:!pointer-events-auto [&>[data-studio-panel]]:!relative [&>[data-studio-panel]]:!inset-auto">
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
          onClose={() => setWork(null)}
          onExpand={() => fullscreen(work._id)}
          onActivateTab={() => undefined}
          onCloseTab={() => setWork(null)}
          onDirtyChange={(workId, dirty) => setDirtyIds((current) => {
            const next = new Set(current);
            if (dirty) next.add(workId); else next.delete(workId);
            return next;
          })}
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
          onOpenWorkspace={(workspaceId) => router.push(`/workspace/${encodeURIComponent(workspaceId)}`)}
        />
      ) : null}
    </div>
  );
}
