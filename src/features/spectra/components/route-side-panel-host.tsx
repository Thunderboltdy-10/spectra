"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { describeFailure } from "@/components/ui/truthful-state";
import {
  getSpectraArtifact,
  getSpectraRunDetail,
  getSpectraThread,
  postSpectra,
  type SpectraArtifact,
  type SpectraThread,
} from "../data/api";
import { createApplicationCommandDispatcher } from "../commands/application-dispatcher";
import { spectraBus } from "../events";
import { requestViewportAction } from "../viewport-readiness";
import { useSpectraPreferences } from "../settings/preference-store";
import {
  readRouteSideSession,
  readSharedWorkbenchSession,
  transferSideSessionToLibrary,
  writeRouteSideSession,
  writeSharedWorkbenchSession,
} from "../workbench";
import { LiveThreadPanel } from "./live-thread-panel";
import { createLatestStudioLoad } from "./latest-studio-load";
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
  const { preferences, replace: replacePreferences } = useSpectraPreferences();
  const eligible = ROUTE_SIDE_PANEL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const [work, setWork] = useState<SpectraArtifact | null>(null);
  const [thread, setThread] = useState<SpectraThread | null>(null);
  const [workWidth, setWorkWidth] = useState(620);
  const [threadWidth, setThreadWidth] = useState(480);
  const [workLoad] = useState(() => createLatestStudioLoad(
    (workId, signal) => getSpectraArtifact(workId, { signal }),
  ));
  const [threadLoad] = useState(() => createLatestStudioLoad(
    (threadId) => getSpectraThread(threadId),
  ));
  const artifacts = useMemo(() => (work ? [work] : []), [work]);
  const studio = useArtifactStudioState("spectra.route.studio", artifacts);
  const { openSplit, closeStudio, activateTab, setDirty } = studio;

  const openWork = useCallback(
    async (workId: string) => {
      const result = await workLoad.load(workId);
      if (!result) return;
      setWork(result.artifact);
      openSplit(result.artifact);
    },
    [openSplit, workLoad],
  );
  const loadWork = useCallback(
    async (workId: string) => {
      try {
        await openWork(workId);
      } catch (error) {
        const failure = describeFailure(error, {
          fallback: "This work could not be opened. Check your connection, then try again.",
        });
        toast.error(failure.message, {
          description: `Reference ${failure.reference}`,
          action: {
            label: "Try again",
            onClick: () => void loadWork(workId),
          },
        });
      }
    },
    [openWork],
  );
  const openThread = useCallback(async (threadId: string) => {
    const result = await threadLoad.load(threadId);
    if (!result) return;
    setThread(result.thread);
  }, [threadLoad]);
  const loadThread = useCallback(
    async (threadId: string) => {
      try {
        await openThread(threadId);
      } catch (error) {
        const failure = describeFailure(error, {
          fallback: "This conversation could not be opened. Check your connection, then try again.",
        });
        toast.error(failure.message, {
          description: `Reference ${failure.reference}`,
          action: {
            label: "Try again",
            onClick: () => void loadThread(threadId),
          },
        });
      }
    },
    [openThread],
  );

  useEffect(() => {
    setWork(null);
    setThread(null);
    if (!eligible) return;
    const restored = readRouteSideSession(window.localStorage, pathname);
    if (restored.workId) void loadWork(restored.workId);
    if (restored.threadId) void loadThread(restored.threadId);
    return () => {
      workLoad.cancel();
      threadLoad.cancel();
    };
  }, [eligible, loadThread, loadWork, pathname, threadLoad, workLoad]);

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

  const fullscreen = useCallback(
    (workId: string) => {
      workLoad.cancel();
      const shared = readSharedWorkbenchSession(window.localStorage);
      writeSharedWorkbenchSession(
        window.localStorage,
        transferSideSessionToLibrary(shared, { ...sideSession, workId }),
      );
      router.push(`/library/${encodeURIComponent(workId)}`);
    },
    [router, sideSession, workLoad],
  );

  const applicationCommandDispatcher = useMemo(
    () =>
      createApplicationCommandDispatcher({
        openArtifact: (artifactId, surface) =>
          requestViewportAction({
            targetId: artifactId,
            view: "artifact",
            navigate: () =>
              surface === "full" ? fullscreen(artifactId) : openWork(artifactId),
          }),
        navigate: (destination, targetId) => {
          if (destination === "library") {
            router.push(
              targetId
                ? `/library/${encodeURIComponent(targetId)}`
                : "/library",
            );
          } else if (destination === "calendar") {
            router.push("/calendar");
          } else if (destination === "settings") {
            router.push(
              targetId
                ? `/settings?section=${encodeURIComponent(targetId)}`
                : "/settings",
            );
          } else {
            router.push(
              targetId
                ? `/workspace/${encodeURIComponent(targetId)}`
                : "/workspace?home=1",
            );
          }
        },
        openThread: (threadId) =>
          requestViewportAction({
            targetId: threadId,
            view: "conversation",
            navigate: () => openThread(threadId),
          }),
        addComment: ({ artifactId, body, regionId }) => postSpectra({
          action: "createArtifactComment",
          artifactId,
          commentBody: body,
          regionId: regionId ?? "artifact:structure",
          fallbackExcerpt: regionId ?? "artifact structure",
        }),
        preferences,
        replacePreferences,
      }),
    [fullscreen, openThread, openWork, preferences, replacePreferences, router],
  );

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
      async (command) => {
        const resolvedThreadId =
          command.threadId?.trim() ||
          (await getSpectraRunDetail(command.runId)).run.threadId;
        if (!resolvedThreadId) throw new Error("RUN_THREAD_NOT_FOUND");
        await openThread(resolvedThreadId);
      },
    );
    return () => {
      removeWork();
      removeThread();
    };
  }, [eligible, fullscreen, loadWork, openThread]);

  function closeWork() {
    workLoad.cancel();
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
          executeApplicationCommand={applicationCommandDispatcher}
        />
      ) : null}
      {thread ? (
        <LiveThreadPanel
          threadId={thread._id}
          title={thread.title}
          width={threadWidth}
          onWidthChange={setThreadWidth}
          onClose={() => { threadLoad.cancel(); setThread(null); }}
          onOpenArtifact={(workId) => void loadWork(workId)}
          onOpenWorkspace={(workspaceId) =>
            router.push(`/workspace/${encodeURIComponent(workspaceId)}`)
          }
        />
      ) : null}
    </div>
  );
}
