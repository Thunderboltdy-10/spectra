"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { showRetryToast } from "@/components/ui/retry-toast";
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
import { spectraBus, type SpectraCommands, type SpectraCommandOutcome } from "../events";
import { requestViewportAction } from "../viewport-readiness";
import { useSpectraPreferences } from "../settings/preference-store";
import {
  readRouteSideSession,
  readSharedWorkbenchSession,
  transferSideSessionToLibrary,
  writeRouteSideSession,
  writeSharedWorkbenchSession,
} from "../workbench";
import { launchFrom, useLifeLanding } from "../life/use-life";
import { threadName } from "../threads/threads-model";
import { LiveThreadPanel } from "./live-thread-panel";
import { rememberFullViewOrigin, requestFullView } from "./full-view-origin";
import { createLatestStudioLoad } from "./latest-studio-load";
import { expectLanding } from "../anchors/open-anchor";
import {
  StudioSplitPlaceholder,
  useArtifactStudioState,
} from "./artifact-studio-shell";
import { workspaceHref } from "../pages/shell-location";

/**
 * Routes that already own `useArtifactStudioState` + `ArtifactStudio` (Home,
 * the Library shell, Agents) must not mount a second studio here. Two studios
 * on one page load two Yjs copies and stall the first paint.
 */
const ROUTE_SIDE_PANEL_PREFIXES = [
  "/school",
  "/calendar",
  "/devices",
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

type ConversationTarget = string | SpectraCommands["run.openConversation"];

export function RouteSidePanelHost() {
  const pathname = usePathname();
  const router = useRouter();
  const { preferences, replace: replacePreferences } = useSpectraPreferences();
  const eligible = ROUTE_SIDE_PANEL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const [work, setWork] = useState<SpectraArtifact | null>(null);
  const [thread, setThread] = useState<SpectraThread | null>(null);
  /* The Side holds one panel (SHELL.md): what opened last is in front, and
     closing it brings back what it covered. */
  const [front, setFront] = useState<"work" | "thread">("work");
  const [workWidth, setWorkWidth] = useState(620);
  const [threadWidth, setThreadWidth] = useState(480);
  const [workLoad] = useState(() => createLatestStudioLoad(
    (workId, signal) => getSpectraArtifact(workId, { signal }),
  ));
  const [threadLoad] = useState(() => createLatestStudioLoad(
    async (target: ConversationTarget, signal) => {
      const threadId = typeof target === "string"
        ? target.trim()
        : target.threadId?.trim() || (await getSpectraRunDetail(target.runId)).run.threadId;
      signal.throwIfAborted();
      if (!threadId) throw new Error("This run no longer has an available conversation.");
      return getSpectraThread(threadId);
    },
    (target) => typeof target === "string" ? target.trim() : target.threadId?.trim() || target.runId,
  ));
  const artifacts = useMemo(() => (work ? [work] : []), [work]);
  const studio = useArtifactStudioState("spectra.route.studio", artifacts);
  const { openSplit, closeStudio, activateTab, setDirty } = studio;

  const openWork = useCallback(
    async (workId: string) => {
      const result = await workLoad.load(workId);
      if (!result) return;
      setWork(result.artifact);
      setFront("work");
      openSplit(result.artifact);
    },
    [openSplit, workLoad],
  );
  const loadWork = useCallback(
    async (workId: string, failureToastId?: string | number) => {
      try {
        await openWork(workId);
        if (failureToastId !== undefined) toast.dismiss(failureToastId);
      } catch (error) {
        const failure = describeFailure(error, {
          fallback: "This work could not be opened. Check your connection, then try again.",
        });
        showRetryToast(failure.message, (id) => loadWork(workId, id), {
          id: failureToastId,
          description: `Reference ${failure.reference}`,
          label: "Try again",
        });
      }
    },
    [openWork],
  );
  const openThread = useCallback(async (target: ConversationTarget) => {
    const result = await threadLoad.load(target);
    if (!result) return false;
    setThread(result.thread);
    setFront("thread");
    return true;
  }, [threadLoad]);
  const loadThread = useCallback(
    async (
      target: ConversationTarget,
      failureToastId?: string | number,
    ): Promise<SpectraCommandOutcome> => {
      try {
        const opened = await openThread(target);
        if (failureToastId !== undefined) toast.dismiss(failureToastId);
        return opened
          ? { status: "completed", message: "Conversation opened." }
          : { status: "failed", message: "This conversation open was cancelled." };
      } catch (error) {
        const failure = describeFailure(error, {
          fallback: "This conversation could not be opened. Check your connection, then try again.",
        });
        showRetryToast(failure.message, async (id) => { await loadThread(target, id); }, {
          id: failureToastId,
          description: `Reference ${failure.reference}`,
          label: "Try again",
        });
        return { status: "failed", message: failure.message };
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
      rememberFullViewOrigin(workId, `${window.location.pathname}${window.location.search}`);
      requestFullView(workId);
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
              surface === "full" ? fullscreen(artifactId) : loadWork(artifactId),
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
            router.push(workspaceHref(targetId));
          }
        },
        openThread: (threadId) =>
          requestViewportAction({
            targetId: threadId,
            view: "conversation",
            navigate: async () => {
              const outcome = await loadThread(threadId);
              if (outcome.status === "failed") throw new Error(outcome.message);
            },
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
    [fullscreen, loadThread, loadWork, preferences, replacePreferences, router],
  );

  useEffect(() => {
    if (!eligible) return;
    const removeWork = spectraBus.handle("work.open", (command) => {
      expectLanding(command.workId, command.region);
      if (command.surface === "full") {
        fullscreen(command.workId);
        return;
      }
      void loadWork(command.workId);
    });
    const removeThread = spectraBus.handle(
      "run.openConversation",
      (command) => loadThread(command),
    );
    return () => {
      removeWork();
      removeThread();
    };
  }, [eligible, fullscreen, loadThread, loadWork]);

  // The island rests as the reply bar of the thread open here.
  const showsWork = Boolean(work) && (front === "work" || !thread);
  const showsThread = Boolean(thread) && (front === "thread" || !work);
  const sideThreadId = eligible && showsThread ? thread?._id ?? null : null;
  const sideThreadTitle = thread ? threadName(thread) : "";
  useEffect(() => {
    spectraBus.setQuery("side.thread", sideThreadId ? { threadId: sideThreadId, title: sideThreadTitle } : null);
    return () => spectraBus.setQuery("side.thread", null);
  }, [sideThreadId, sideThreadTitle]);

  // A page's collapsible panel tucks away while this holds the Side.
  const sideKind = !eligible ? null : showsThread ? "thread" : showsWork ? "work" : null;
  useEffect(() => {
    spectraBus.setQuery("side.open", sideKind ? { kind: sideKind } : null);
    return () => spectraBus.setQuery("side.open", null);
  }, [sideKind]);

  // The island centres on what is left of the stage (ISLAND.md, "Placement").
  const measureSide = useCallback((node: HTMLDivElement | null) => {
    const root = document.documentElement;
    if (!node || typeof ResizeObserver === "undefined") {
      root.style.removeProperty("--spectra-side-width");
      return;
    }
    const observer = new ResizeObserver(() => root.style.setProperty("--spectra-side-width", `${Math.round(node.getBoundingClientRect().width)}px`));
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--spectra-side-width");
    };
  }, []);

  function closeWork() {
    workLoad.cancel();
    closeStudio();
    setWork(null);
    setFront("thread");
  }

  function closeThread() {
    threadLoad.cancel();
    setThread(null);
    setFront("work");
  }

  // A thread opened here grows out of the card or row it was opened from (a work's studio lands itself).
  const workSlot = useRef<HTMLDivElement>(null);
  const threadSlot = useRef<HTMLDivElement>(null);
  useLifeLanding(threadSlot, thread?._id);

  if (!eligible || (!work && !thread)) return null;
  return (
    <div ref={measureSide} className="spectra-wave-y relative z-panel flex h-full max-w-[calc(100vw-76px)] shrink-0">
      {studio.mode === "split" && studio.activeArtifact ? (
        <div ref={workSlot} data-side-slot="work" hidden={!showsWork} className="flex h-full shrink-0 [&[hidden]]:hidden">
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
          onExpand={() => {
            // The Side panel grows into the full view.
            launchFrom(workSlot.current);
            fullscreen(studio.activeArtifact!._id);
          }}
          onActivateTab={activateTab}
          onCloseTab={() => closeWork()}
          onDirtyChange={setDirty}
          onOpenThread={(next) => void loadThread(next.id)}
          executeApplicationCommand={applicationCommandDispatcher}
        />
        </div>
      ) : null}
      {thread ? (
        <div ref={threadSlot} data-side-slot="thread" hidden={!showsThread} className="flex h-full shrink-0 [&[hidden]]:hidden">
        <LiveThreadPanel
          threadId={thread._id}
          title={sideThreadTitle}
          width={threadWidth}
          onWidthChange={setThreadWidth}
          onClose={closeThread}
          onOpenArtifact={(workId) => void loadWork(workId)}
          onOpenWorkspace={(workspaceId) =>
            router.push(workspaceHref(workspaceId))
          }
        />
        </div>
      ) : null}
    </div>
  );
}
