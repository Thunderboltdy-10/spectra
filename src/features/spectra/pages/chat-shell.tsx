"use client";

import dynamic from "next/dynamic";
import { requestFullView } from "../components/full-view-origin";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useAuthedArgs } from "../data/use-authed-args";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import type { BarCommand, CollapseStep } from "@/components/ui/adaptive-bar";
import { PageHeader } from "@/components/ui/page-header";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { useSpectraRun } from "../ai/use-spectra-run";
import { useSpectraContext } from "../hooks/use-spectra-context";
import { spectraBus } from "../events";
import type { SpectraCommandOutcome } from "../events/contracts";
import { createApplicationCommandDispatcher } from "../commands/application-dispatcher";
import { ConversationSurface } from "../components/conversation-surface";
import { ProductErrorState } from "../components/product-state";
import { useProvideIslandEngine } from "../island/engine";
import { CrossfadeText } from "../motion";
import { GlobalSearch } from "../components/context-controls";
import {
  StudioSplitPlaceholder,
  useArtifactStudioState,
} from "../components/artifact-studio-shell";
import {
  disengageFollow,
  isProgrammaticFollowOpen,
} from "../collaboration/follow";
import {
  disengageFollowAi,
  isProgrammaticOpen,
} from "../collaboration/follow-ai";
import {
  getSpectraArtifact,
  getSpectraOverview,
  getSpectraRunDetail,
  getSpectraThread,
  postSpectra,
  type SpectraArtifact,
  type SpectraThreadDetail,
  type SpectraWorkspace,
} from "../data/api";
import { useSpectraPreferences } from "../settings/preference-store";
import { expectLanding } from "../anchors/open-anchor";
import {
  acknowledgeViewportReady,
  requestViewportAction,
} from "../viewport-readiness";
import type { ThreadsBrowserHandle } from "../threads/threads-view";
import { threadName } from "../threads/threads-model";
import { ChatRunsPanel } from "../chat/chat-runs-panel";
import { ChatThreadColumn } from "../chat/chat-thread-column";
import { HomeLead } from "../chat/home-lead";
import { HomeDay } from "../today/home-day";
import { ThreadRenameField } from "../chat/thread-rename-field";
import { useThreadActions } from "../chat/use-thread-actions";
import { useThreadColumn } from "../chat/use-thread-column";
import { HOME_PATH, threadHref } from "../chat/home-routes";
import { workspaceHref } from "./shell-location";

const ArtifactStudio = dynamic(
  () =>
    import("../components/artifact-studio").then(
      (module) => module.ArtifactStudio,
    ),
  { loading: () => <StudioSplitPlaceholder /> },
);

const CHAT_BAR_PLAN: readonly CollapseStep[] = [{ hideLabel: "runs" }, { toMenu: "delete" }, { toMenu: "rename" }, { toMenu: "pin" }, { toMenu: "runs" }];

function chatLoadErrorMessage(threadId: string | null) {
  return threadId
    ? "This thread could not load. Try again."
    : "Threads could not load. Try again.";
}

/*
 * The chat page (SHELL.md, "The chat page"): every thread in a column on the
 * left, the open one filling the sheet, and works opening beside it. The
 * island is this page's composer. The column, the welcome, the runs panel
 * and the thread's own actions live in features/spectra/chat.
 */

export function ChatShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { preferences, replace: replacePreferences } = useSpectraPreferences();
  const requestedThreadId = searchParams.get("threadId");
  const requestedPrompt = searchParams.get("prompt");
  const [threadId, setThreadId] = useState<string | null>(requestedThreadId);
  const [detail, setDetail] = useState<SpectraThreadDetail | null>(null);
  const [workspaces, setWorkspaces] = useState<SpectraWorkspace[]>([]);
  const [artifacts, setArtifacts] = useState<SpectraArtifact[]>([]);
  const [runsOpen, setRunsOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contextLoadError, setContextLoadError] = useState(false);
  const [loading, setLoading] = useState(Boolean(requestedThreadId));
  const [renaming, setRenaming] = useState(false);
  const [chatWorkspaceId, setChatWorkspaceId] = useState<string | null>(null);
  const [studioPanelWidth, setStudioPanelWidth] = useState(700);
  const threadsRef = useRef<ThreadsBrowserHandle>(null);
  const activeThreadRef = useRef<string | null>(requestedThreadId);
  const loadGenerationRef = useRef(0);
  const runsOpenerRef = useRef<HTMLElement | null>(null);
  const syncedRequestedThreadRef = useRef<string | null | undefined>(undefined);
  const consumedPromptRef = useRef<string | null>(null);
  const closePresentation = useSpectraContextStore(
    (state) => state.closePresentation,
  );
  const {
    composerThread,
    setComposerThread,
    open: openPointers,
    setVisibleArtifactIds,
    setActiveWorkspaceContext,
  } = useSpectraContext(artifacts, workspaces);

  const refresh = useCallback(
    async (nextThreadId?: string | null, generation = loadGenerationRef.current) => {
      const isCurrentLoad = () =>
        generation === loadGenerationRef.current &&
        (nextThreadId ?? null) === activeThreadRef.current;
      // The overview hydrates independently; a selected thread must not wait
      // for the work and workspace catalog. The thread column reads its own list.
      const catalogs = getSpectraOverview(undefined, false, false).then((overview) => {
        if (!isCurrentLoad()) return;
        setWorkspaces(overview.workspaces);
        setArtifacts((current) => {
          const next = new Map(
            overview.artifacts.map((artifact) => [artifact._id, artifact] as const),
          );
          const currentlyOpenIds = new Set(
            useSpectraContextStore
              .getState()
              .openObjects.filter((object) => object.type === "artifact")
              .map((object) => object.id),
          );
          // The overview is deliberately bounded. An Inbox artifact opened from
          // a result card can be absent from a later refresh while it remains a
          // real, canonical object. Preserve only actively mounted artifacts so
          // a run completion cannot make the editor look like a temporary tab.
          for (const artifact of current)
            if (currentlyOpenIds.has(artifact._id) && !next.has(artifact._id))
              next.set(artifact._id, artifact);
          return [...next.values()];
        });
        setContextLoadError(false);
        spectraBus.emit("threads.changed", {});
      });
      if (nextThreadId) {
        // Keep supplementary failures recoverable beside authoritative messages.
        // Handle this promise immediately so a faster rejection cannot escape.
        void catalogs.catch(() => {
          if (isCurrentLoad()) setContextLoadError(true);
        });
      } else {
        // A new-chat route has no primary detail read; catalogs own its load.
        await catalogs;
      }
      const selected = nextThreadId ? await getSpectraThread(nextThreadId) : null;
      if (!isCurrentLoad()) return { threadFound: true, stale: true };
      setDetail(selected);
      return { threadFound: !nextThreadId || Boolean(selected), stale: false };
    },
    [],
  );

  const startRouteLoad = useCallback(
    (nextThreadId: string | null, clearDetail: boolean) => {
      const generation = loadGenerationRef.current + 1;
      loadGenerationRef.current = generation;
      activeThreadRef.current = nextThreadId;
      if (clearDetail) setDetail(null);
      setLoading(Boolean(nextThreadId));
      setLoadError(null);
      setContextLoadError(false);
      void refresh(nextThreadId, generation)
        .then(({ threadFound, stale }) => {
          if (
            stale ||
            generation !== loadGenerationRef.current ||
            activeThreadRef.current !== nextThreadId
          )
            return;
          if (threadFound || !nextThreadId) return;
          activeThreadRef.current = null;
          setThreadId(null);
          setDetail(null);
          setComposerThread(null);
          router.replace(HOME_PATH);
          toast.message(
            "That thread is no longer available. Opened a new thread instead.",
          );
        })
        .catch(() => {
          if (
            generation !== loadGenerationRef.current ||
            activeThreadRef.current !== nextThreadId
          )
            return;
          setLoadError(chatLoadErrorMessage(nextThreadId));
        })
        .finally(() => {
          if (
            generation === loadGenerationRef.current &&
            activeThreadRef.current === nextThreadId
          )
            setLoading(false);
        });
    },
    [refresh, router, setComposerThread],
  );

  const refreshActiveThread = useCallback(async () => {
    const currentThreadId = activeThreadRef.current;
    const currentGeneration = loadGenerationRef.current;
    try {
      const result = await refresh(currentThreadId, currentGeneration);
      if (
        !result.stale &&
        loadGenerationRef.current === currentGeneration &&
        activeThreadRef.current === currentThreadId
      )
        setLoadError(null);
    } catch {
      // Background updates must leave the last known thread rendered;
      // surface the failure beside those messages instead of replacing them
      // with the new-thread welcome.
      if (
        loadGenerationRef.current === currentGeneration &&
        activeThreadRef.current === currentThreadId
      )
        setLoadError(chatLoadErrorMessage(currentThreadId));
    }
  }, [refresh]);

  useEffect(() => {
    if (syncedRequestedThreadRef.current === requestedThreadId) return;
    syncedRequestedThreadRef.current = requestedThreadId;
    setThreadId(requestedThreadId);
    // URL changes own navigation state. Do not subscribe this effect to the
    // composer thread: a new run publishes its thread before router.replace()
    // completes, and feeding that update back here repeatedly cleared the new
    // thread and caused a request storm.
    setComposerThread(
      requestedThreadId
        ? { id: requestedThreadId, title: "Thread" }
        : null,
    );
    startRouteLoad(requestedThreadId, true);
  }, [requestedThreadId, setComposerThread, startRouteLoad]);

  useEffect(() => {
    if (
      !threadId ||
      !detail?.traces.some(
        (trace) =>
          trace.run.status === "queued" ||
          trace.run.status === "running" ||
          trace.run.status === "awaiting_confirmation" ||
          trace.run.status === "awaiting_resolution",
      )
    )
      return;
    const pollingThreadId = threadId;
    const pollingGeneration = loadGenerationRef.current;
    const timer = window.setInterval(() => {
      void getSpectraThread(pollingThreadId)
        .then((nextDetail) => {
          if (
            activeThreadRef.current === pollingThreadId &&
            loadGenerationRef.current === pollingGeneration
          )
            setDetail(nextDetail);
        })
        .catch(() => undefined);
    }, 750);
    return () => window.clearInterval(timer);
  }, [detail?.traces, threadId]);

  const retryRouteLoad = useCallback(() => {
    startRouteLoad(requestedThreadId, false);
  }, [requestedThreadId, startRouteLoad]);

  const closeRuns = useCallback(() => {
    setRunsOpen(false);
    window.requestAnimationFrame(() => runsOpenerRef.current?.focus());
  }, []);

  const selectThread = useCallback(
    (id: string | null, knownTitle?: string) => {
      // Reselecting the active thread does not change the URL or reload it.
      // Preserve its loaded messages rather than clearing them indefinitely.
      if (id && id === activeThreadRef.current) return;
      setThreadId(id);
      activeThreadRef.current = id;
      setDetail(null);
      setChatWorkspaceId(null);
      setComposerThread(id ? { id, title: knownTitle ?? "Thread" } : null);
      closePresentation("thread-panel");
      router.replace(
        id ? threadHref(id) : HOME_PATH,
      );
    },
    [closePresentation, router, setComposerThread],
  );

  const threadActions = useThreadActions({
    threadId,
    pinned: Boolean(detail?.thread.pinned),
    onChanged: () => refresh(threadId),
    onRenamed: (title) => {
      setRenaming(false);
      if (threadId && composerThread?.id === threadId) setComposerThread({ id: threadId, title });
    },
    onSelect: selectThread,
  });

  const selectWorkspaceContext = useCallback((workspaceId: string | null) => {
    setChatWorkspaceId(workspaceId);
  }, []);

  const studio = useArtifactStudioState(
    "spectra.shared.artifactStudio",
    artifacts,
  );
  const clearedWorkspaceArtifactRef = useRef(false);
  useEffect(() => {
    if (clearedWorkspaceArtifactRef.current) return;
    clearedWorkspaceArtifactRef.current = true;
    studio.closeStudio();
    closePresentation("split");
    closePresentation("tab");
    closePresentation("tile");
    closePresentation("thread-panel");
  }, [closePresentation, studio]);
  const openArtifact = useCallback(
    (artifactId: string) => {
      // A user-chosen open ends spectating; a follow-dispatched open does not.
      if (!isProgrammaticOpen() && !isProgrammaticFollowOpen()) {
        disengageFollowAi();
        disengageFollow("user_input");
      }
      const artifact = artifacts.find((item) => item._id === artifactId);
      if (!artifact || artifact.content === undefined) {
        // Result cards can arrive before the broad overview projection includes a
        // newly created Inbox artifact, and the overview carries no content, so
        // an editor seeded from it would open blank. Resolve the canonical
        // object directly so the primary action always opens the real work.
        void getSpectraArtifact(artifactId)
          .then(({ artifact: resolved }) => {
            setArtifacts((current) => [
              ...current.filter((item) => item._id !== resolved._id),
              resolved,
            ]);
            setRunsOpen(false);
            studio.openSplit(resolved);
          })
          .catch(() => toast.error("That work is no longer available."));
        return;
      }
      setRunsOpen(false);
      if (artifact.blueprintKey === "thread_reference") {
        const content =
          artifact.content && typeof artifact.content === "object"
            ? (artifact.content as Record<string, unknown>)
            : {};
        const targetThreadId =
          typeof content.threadId === "string" ? content.threadId : "";
        if (
          targetThreadId === threadId ||
          targetThreadId === composerThread?.id
        )
          return;
        if (targetThreadId) {
          selectThread(targetThreadId);
          return;
        }
      }
      studio.openSplit(artifact);
    },
    [artifacts, composerThread?.id, selectThread, studio, threadId],
  );

  const applicationCommandDispatcher = useMemo(
    () =>
      createApplicationCommandDispatcher({
        openArtifact: (artifactId, surface) => {
          return requestViewportAction({
            targetId: artifactId,
            view: "artifact",
            navigate: () => {
              if (surface === "full") {
                requestFullView(artifactId);
                router.push(`/library/${encodeURIComponent(artifactId)}`);
              }
              else openArtifact(artifactId);
            },
          });
        },
        addComment: ({ artifactId, body, regionId }) => postSpectra({
          action: "createArtifactComment",
          artifactId,
          commentBody: body,
          regionId: regionId ?? "artifact:structure",
          fallbackExcerpt: regionId ?? "artifact structure",
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
        preferences,
        replacePreferences,
      }),
    [openArtifact, preferences, replacePreferences, router],
  );

  const focusedArtifact = studio.activeArtifact;
  useEffect(() => {
    setVisibleArtifactIds(focusedArtifact ? [focusedArtifact._id] : []);
  }, [focusedArtifact, setVisibleArtifactIds]);
  const scopedWorkspaceId = chatWorkspaceId ?? detail?.thread.workspaceId;

  const openAfterSendRef = useRef(preferences.ai?.openConversationAfterSend ?? false);
  openAfterSendRef.current = preferences.ai?.openConversationAfterSend ?? false;
  const [homeQuiet, setHomeQuiet] = useState(false);
  const runEngine = useSpectraRun({
    surface: "chat",
    workspaceId: scopedWorkspaceId,
    artifactId: focusedArtifact?._id,
    threadId: composerThread?.id,
    open: openPointers,
    currentView: "conversation",
    initialCards: [],
    onThreadReady: async (id) => {
      // Sent from Home with "Open the thread when I send" off: Home stays where
      // it is and the answer rises from its tab on the island (ISLAND.md, "Sending").
      if (!activeThreadRef.current && !openAfterSendRef.current) {
        setHomeQuiet(true);
        setComposerThread(null);
        return;
      }
      setComposerThread({
        id,
        title:
          id === threadId
            ? (detail?.thread.title ?? "Thread")
            : "New thread",
      });
      if (id !== threadId) {
        setThreadId(id);
        activeThreadRef.current = id;
        router.replace(threadHref(id));
      }
      await refreshActiveThread();
    },
    onContinuationConflict: () => selectThread(null),
    onDataChanged: refreshActiveThread,
    onOpenArtifact: openArtifact,
  });

  useEffect(() => {
    const removeWork = spectraBus.handle("work.open", ({ workId, region }) => {
      expectLanding(workId, region);
      return openArtifact(workId);
    });
    const removeConversation = spectraBus.handle(
      "run.openConversation",
      async ({ runId, threadId }) => {
        const resolvedThreadId =
          threadId?.trim() || (await getSpectraRunDetail(runId)).run.threadId;
        if (!resolvedThreadId) throw new Error("RUN_THREAD_NOT_FOUND");
        const readiness = await requestViewportAction({
          targetId: resolvedThreadId,
          view: "conversation",
          navigate: () => selectThread(resolvedThreadId),
        });
        return {
          status: readiness.status === "ready" ? "completed" : "failed",
          message: readiness.status === "ready" ? "Thread opened." : readiness.reason ?? "Thread could not be opened.",
          readiness,
        } satisfies SpectraCommandOutcome;
      },
    );
    const removeStop = spectraBus.handle("run.stopRequested", async ({ runId }) => {
      if (runId && runEngine.activeRunId && runEngine.activeRunId !== runId) return;
      await runEngine.stop(runId);
      return {
        status: "completed",
        message: "Stop requested. Committed work remains available.",
      } satisfies SpectraCommandOutcome;
    });
    return () => {
      removeWork();
      removeConversation();
      removeStop();
    };
  }, [openArtifact, runEngine, selectThread]);

  useEffect(() => {
    if (requestedThreadId && !detail) return;
    const frame = requestAnimationFrame(() => acknowledgeViewportReady({
      targetId: requestedThreadId ?? "chat",
      view: "conversation",
    }));
    return () => cancelAnimationFrame(frame);
  }, [detail, requestedThreadId]);

  useEffect(() => {
    const prompt = requestedPrompt?.trim();
    if (!prompt || consumedPromptRef.current === prompt) return;
    // A prompt opened from another surface must wait until the URL-owned
    // continuation has been reconciled. Otherwise the first render can
    // accidentally append it to whichever thread was previously selected.
    if ((composerThread?.id ?? null) !== requestedThreadId) return;
    consumedPromptRef.current = prompt;
    void runEngine.run(prompt);
    router.replace(
      threadId
        ? threadHref(threadId)
        : HOME_PATH,
    );
  }, [
    composerThread?.id,
    requestedPrompt,
    requestedThreadId,
    router,
    runEngine,
    threadId,
  ]);

  // The name Spectra gives a thread arrives live, as fast as the sidebar shows it.
  const liveName = useQuery(
    api.spectraThreads.liveName,
    useAuthedArgs(threadId ? { threadId: threadId as Id<"spectraThreads"> } : "skip", "account"),
  );
  const liveThread = liveName?._id === threadId ? liveName : undefined;
  const visibleTitle =
    (liveThread ? threadName(liveThread) : undefined) ??
    (detail ? threadName(detail.thread) : undefined) ??
    (threadId ? (loading ? "Opening thread…" : "Thread") : "New thread");
  // The thread on screen is named the way its row and header name it.
  const title =
    liveThread && composerThread?.id === liveThread._id
      ? threadName(liveThread)
      : detail && composerThread?.id === detail.thread._id
        ? threadName(detail.thread)
        : (composerThread?.title ?? visibleTitle);
  const activeWorkspace = workspaces.find(
    (workspace) =>
      workspace._id === (chatWorkspaceId ?? detail?.thread.workspaceId),
  );
  useEffect(
    () =>
      setActiveWorkspaceContext(
        activeWorkspace
          ? { id: activeWorkspace._id, title: activeWorkspace.title }
          : null,
      ),
    [activeWorkspace, setActiveWorkspaceContext],
  );
  const activeCards = useMemo(() => runEngine.cards, [runEngine.cards]);
  // The island is this page's composer: it rests as the reply bar for the open thread.
  useProvideIslandEngine(
    useMemo(
      () => ({
        engine: runEngine,
        focus: composerThread ? { threadId: composerThread.id, title } : null,
        bindsThread: true,
        startNewThread: () => selectThread(null),
        openThread: (_runId: string, id: string, threadTitle: string) => selectThread(id, threadTitle),
      }),
      [composerThread, runEngine, selectThread, title],
    ),
  );

  const studioBeside = studio.isOpen && studio.mode !== "tab";
  useEffect(() => {
    if (!studioBeside) return;
    const root = document.documentElement;
    root.style.setProperty("--spectra-side-width", `${Math.round(studioPanelWidth)}px`);
    return () => void root.style.removeProperty("--spectra-side-width");
  }, [studioBeside, studioPanelWidth]);
  const column = useThreadColumn(studioBeside);
  // Home is this page before a thread: the day lifts away once one is sent or opened, and comes back with a new one.
  // A run left to answer in the background from Home does not take the page.
  const quietLive = homeQuiet && (!threadId || (runEngine.liveExchange?.threadId !== undefined && runEngine.liveExchange.threadId !== threadId));
  const started = Boolean(threadId || detail || (runEngine.liveExchange && !quietLive) || loading);
  const [leadState, setLeadState] = useState<"shown" | "leaving" | "gone">(requestedThreadId ? "gone" : "shown");
  useEffect(() => {
    if (started && leadState === "shown") setLeadState("leaving");
    if (!started && leadState === "gone") setLeadState("shown");
  }, [leadState, started]);
  const atHome = leadState === "shown";
  const showColumn = column.setOpen;
  // "Search threads" from anywhere lands in this page's own column.
  useEffect(
    () =>
      spectraBus.on("threads.open", ({ query }) => {
        showColumn(true);
        window.requestAnimationFrame(() => threadsRef.current?.focusSearch(query));
      }),
    [showColumn],
  );

  function toggleRuns() {
    if (studio.activeArtifact && studio.dirtyIds.has(studio.activeArtifact._id)) {
      toast.message("Save or discard your open work before opening Runs.");
      return;
    }
    studio.closeStudio();
    if (!runsOpen)
      runsOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRunsOpen((value) => !value);
  }
  const chatCommands: BarCommand[] = [
    {
      id: "search",
      icon: "search",
      label: "Search",
      pinned: true,
      render: () => (
        <GlobalSearch
          trigger="icon"
          onOpenArtifact={(artifactId) => openArtifact(artifactId)}
          onOpenWorkspace={(workspace) => selectWorkspaceContext(workspace._id)}
        />
      ),
    },
    { id: "runs", icon: "activity", label: "Runs", active: runsOpen, onSelect: toggleRuns },
    ...(threadId
      ? ([
          {
            id: "rename",
            icon: "edit",
            label: "Rename thread",
            labelPolicy: "never",
            onSelect: () => setRenaming(true),
          },
          {
            id: "pin",
            icon: "pin",
            label: detail?.thread.pinned ? "Unpin thread" : "Pin thread",
            labelPolicy: "never",
            active: Boolean(detail?.thread.pinned),
            disabled: threadActions.busy === "pin",
            onSelect: () => void threadActions.togglePinned(),
          },
          {
            id: "delete",
            icon: "trash",
            label: "Delete thread",
            labelPolicy: "never",
            disabled: !threadActions.canTrash || threadActions.busy === "trash",
            onSelect: () => void threadActions.trash(),
          },
        ] satisfies BarCommand[])
      : []),
  ];
  return (
    <div className="relative isolate flex h-full min-h-0">
      {column.open && studio.mode !== "tab" ? (
        <ChatThreadColumn
          ref={threadsRef}
          selectedId={threadId}
          onChoose={(thread) => selectThread(thread._id, threadName(thread))}
          onNewThread={() => spectraBus.emit("island.compose", { fresh: true })}
          onHide={() => column.setOpen(false)}
        />
      ) : null}
      <section
        aria-label="Thread"
        className={
          studio.mode === "tab" ? "hidden" : "chat-conversation relative flex min-w-0 flex-1 flex-col"
        }
      >
        <div className={atHome ? "hidden" : "shrink-0 px-6 pt-2.5"}>
          <PageHeader
            level="nested"
            lead={
              column.open ? null : (
                <IconButton icon="sidebar" label="Show threads" onClick={() => column.setOpen(true)} />
              )
            }
            title={<CrossfadeText value={visibleTitle} primitive="reveal" className="chat-thread-title block truncate" />}
            commands={chatCommands}
            plan={CHAT_BAR_PLAN}
            barLabel="Thread commands"
          />
        </div>
        {renaming && threadId ? (
          <ThreadRenameField
            initial={visibleTitle}
            saving={threadActions.busy === "title"}
            onSave={(next) => void threadActions.rename(next)}
            onCancel={() => setRenaming(false)}
          />
        ) : null}
        <ConversationSurface
          detail={detail}
          artifacts={artifacts}
          threadId={threadId ?? undefined}
          loading={loading}
          lead={
            leadState === "gone" ? undefined : (
              <HomeLead leaving={leadState === "leaving"} onGone={() => setLeadState("gone")}>
                <HomeDay onAllThreads={() => column.setOpen(true)} />
              </HomeLead>
            )
          }
          loadError={
            detail && (loadError || contextLoadError) ? (
              <ProductErrorState
                title={
                  loadError
                    ? requestedThreadId
                      ? "This thread could not refresh"
                      : "Threads could not refresh"
                    : "Your work could not load"
                }
                detail={
                  loadError
                    ? "The messages shown below are the last loaded copy. Try again to refresh this thread."
                    : "Your messages are here. Works and workspaces could not load beside them. Try again."
                }
                className="mb-5 min-h-0 items-start rounded-card border border-[color-mix(in_oklab,var(--danger)_22%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_4%,var(--bg-primary))] px-4 py-3 text-left"
                action={
                  <Button variant="primary" size="sm" onClick={retryRouteLoad}>
                    Try again
                  </Button>
                }
              />
            ) : undefined
          }
          liveExchange={quietLive ? null : runEngine.liveExchange}
          workspaces={workspaces}
          onOpenArtifact={openArtifact}
          onOpenWorkspace={(workspaceId) =>
            router.push(
              `/workspace?workspaceId=${encodeURIComponent(workspaceId)}&threadId=${encodeURIComponent(threadId ?? "")}`,
            )
          }
          onChoice={(choice) =>
            {
              if (!threadId?.trim()) {
                toast.error(
                  "This clarification is no longer linked to a conversation. Reload it before answering.",
                );
                return;
              }
              void runEngine.run(
                choice.title === "Skipped"
                  ? "Skip that question and continue with reasonable defaults."
                  : choice.description
                    ? `${choice.title}: ${choice.description}`
                    : choice.title,
                [],
                {
                  threadId,
                  clarificationId: choice.clarificationId,
                  choiceKey: choice.key,
                  choiceMessageId: choice.choiceMessageId,
                  executionId: choice.executionId,
                  batchSelections: choice.batchSelections,
                },
              );
            }
          }
          activeCards={activeCards}
          onCardAction={(card, action, target) =>
            void runEngine.onCardAction(card, action, target)
          }
          onCardRevise={(card, revision) => runEngine.revise(card, revision)}
          onRetryRun={runEngine.retry}
          onAnswer={runEngine.answer}
          empty={
            loadError ? (
              <ProductErrorState
                title={
                  requestedThreadId
                    ? "This thread could not load"
                    : "Threads could not load"
                }
                detail={loadError}
                className="mx-auto min-h-[clamp(420px,50vh,620px)] w-full max-w-[820px]"
                action={
                  <Button variant="primary" size="sm" onClick={retryRouteLoad}>
                    Try again
                  </Button>
                }
              />
            ) : null
          }
        />
      </section>

      {studio.isOpen && studio.activeArtifact ? (
        <ArtifactStudio
          mode={studio.mode === "tab" ? "tab" : "split"}
          artifact={studio.activeArtifact}
          artifacts={artifacts}
          tabs={studio.tabs}
          dirtyIds={studio.dirtyIds}
          panelWidth={studioPanelWidth}
          sourceLabel="Chat"
          onPanelWidthChange={setStudioPanelWidth}
          onClose={studio.closeStudio}
          onExpand={studio.openTab}
          onActivateTab={studio.activateTab}
          onCloseTab={studio.closeTab}
          onDirtyChange={studio.setDirty}
          executeApplicationCommand={applicationCommandDispatcher}
        />
      ) : null}
      {runsOpen ? <ChatRunsPanel onClose={closeRuns} /> : null}
    </div>
  );
}
