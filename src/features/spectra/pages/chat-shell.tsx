"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useSearchParams } from "next/navigation";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import { ArrowRight, Clock3, CheckCircle2, FolderPlus, MessageSquare } from "@/components/icons/glyph-icons";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import type { BarCommand, CollapseStep } from "@/components/ui/adaptive-bar";
import { PageHeader } from "@/components/ui/page-header";
import { describeFailure } from "@/components/ui/truthful-state";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { SpectraMark } from "@/components/spectra-mark";
import { useSpectraRun } from "../ai/use-spectra-run";
import { useSpectraContext } from "../hooks/use-spectra-context";
import { spectraBus } from "../events";
import type { SpectraCommandOutcome } from "../events/contracts";
import { createApplicationCommandDispatcher } from "../commands/application-dispatcher";
import { ConversationSurface } from "../components/conversation-surface";
import { ProductErrorState } from "../components/product-state";
import { useProvideIslandEngine } from "../island/engine";
import { CrossfadeText } from "../motion";
import { ComposerArtifactDock } from "../components/composer-artifact-dock";
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
  getSpectraResultCards,
  getSpectraRunDetail,
  getSpectraThread,
  getSpectraThreads,
  postSpectra,
  type SpectraArtifact,
  type SpectraResultCard,
  type SpectraThread,
  type SpectraThreadDetail,
  type SpectraWorkspace,
} from "../data/api";
import { useSpectraPreferences } from "../settings/preference-store";
import { useTreeActions, useTreePlacement } from "../organization/tree-client";
import {
  acknowledgeViewportReady,
  requestViewportAction,
} from "../viewport-readiness";

const ArtifactStudio = dynamic(
  () =>
    import("../components/artifact-studio").then(
      (module) => module.ArtifactStudio,
    ),
  { loading: () => <StudioSplitPlaceholder /> },
);

const CHAT_BAR_PLAN: readonly CollapseStep[] = [{ hideLabel: "runs" }, { toMenu: "delete" }, { toMenu: "rename" }, { toMenu: "pin" }, { hideLabel: "new" }, { toMenu: "runs" }];

function chatLoadErrorMessage(threadId: string | null) {
  return threadId
    ? "This conversation could not load. Try again."
    : "Chat could not load. Try again.";
}

export function ChatShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { preferences, replace: replacePreferences } = useSpectraPreferences();
  const requestedThreadId = searchParams.get("threadId");
  const requestedPrompt = searchParams.get("prompt");
  const [threadId, setThreadId] = useState<string | null>(requestedThreadId);
  const [threads, setThreads] = useState<SpectraThread[]>([]);
  const [detail, setDetail] = useState<SpectraThreadDetail | null>(null);
  const [workspaces, setWorkspaces] = useState<SpectraWorkspace[]>([]);
  const [artifacts, setArtifacts] = useState<SpectraArtifact[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SpectraResultCard[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contextLoadError, setContextLoadError] = useState(false);
  const [loading, setLoading] = useState(Boolean(requestedThreadId));
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [chatWorkspaceId, setChatWorkspaceId] = useState<string | null>(null);
  const [welcome, setWelcome] = useState("Welcome back.");
  const [studioPanelWidth, setStudioPanelWidth] = useState(700);
  const activeThreadRef = useRef<string | null>(requestedThreadId);
  const loadGenerationRef = useRef(0);
  const historyOpenerRef = useRef<HTMLElement | null>(null);
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

  useEffect(() => {
    const now = new Date();
    const hour = now.getHours();
    setWelcome(
      hour < 5
        ? "A quiet hour for a clearer thought."
        : hour < 12
          ? "Good morning. What shall we make easier?"
          : hour < 18
            ? "Good afternoon. Let’s make something click."
            : "Good evening. Let’s end on a satisfying note.",
    );
  }, []);

  const refresh = useCallback(
    async (nextThreadId?: string | null, generation = loadGenerationRef.current) => {
      const isCurrentLoad = () =>
        generation === loadGenerationRef.current &&
        (nextThreadId ?? null) === activeThreadRef.current;
      // Catalogs hydrate independently; a selected conversation must not wait
      // for the recent-chat list or the work/workspace overview.
      const catalogs = Promise.all([
        getSpectraThreads({ limit: 100 }),
        getSpectraOverview(),
      ]).then(([threadRows, overview]) => {
        if (!isCurrentLoad()) return;
        setThreads(threadRows.threads);
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
          router.replace("/chat?new=1");
          toast.message(
            "That conversation is no longer available. Opened a new conversation instead.",
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
      // Background updates must leave the last known conversation rendered;
      // surface the failure beside those messages instead of replacing them
      // with the empty-chat welcome state.
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
        ? { id: requestedThreadId, title: "Conversation" }
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

  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    window.requestAnimationFrame(() => historyOpenerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!historyOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeHistory();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeHistory, historyOpen]);

  const selectThread = useCallback(
    (id: string | null) => {
      // Reselecting the active thread does not change the URL or reload it.
      // Preserve its loaded messages rather than clearing them indefinitely.
      if (id && id === activeThreadRef.current) return;
      setThreadId(id);
      activeThreadRef.current = id;
      setDetail(null);
      setChatWorkspaceId(null);
      setComposerThread(
        id
          ? {
              id,
              title:
                threads.find((thread) => thread._id === id)?.title ??
                "Conversation",
            }
          : null,
      );
      closePresentation("thread-panel");
      router.replace(
        id ? `/chat?threadId=${encodeURIComponent(id)}` : "/chat?new=1",
      );
    },
    [closePresentation, router, setComposerThread, threads],
  );

  /* Rename, pin and delete answer every time: a failure says so and leaves
     the chat as it was, instead of an unhandled rejection and silence. */
  const [threadBusy, setThreadBusy] = useState<"title" | "pin" | "trash" | null>(
    null,
  );
  const threadPlacement = useTreePlacement("thread", threadId);
  const treeActions = useTreeActions();
  async function saveTitle() {
    const title = titleDraft.trim();
    if (!threadId || !title || threadBusy) return;
    setThreadBusy("title");
    try {
      await postSpectra({ action: "updateThread", threadId, title });
      setRenaming(false);
      if (composerThread?.id === threadId)
        setComposerThread({ id: threadId, title });
      await refresh(threadId).catch(() => undefined);
    } catch (error) {
      toast.error(
        describeFailure(error, {
          fallback: "Could not rename this chat. Try again.",
        }).message,
      );
    } finally {
      setThreadBusy(null);
    }
  }
  async function togglePinned() {
    if (!threadId || threadBusy) return;
    setThreadBusy("pin");
    try {
      await postSpectra({
        action: "updateThread",
        threadId,
        pinned: !detail?.thread.pinned,
      });
      await refresh(threadId).catch(() => undefined);
    } catch (error) {
      toast.error(
        describeFailure(error, {
          fallback: detail?.thread.pinned
            ? "Could not unpin this chat. Try again."
            : "Could not pin this chat. Try again.",
        }).message,
      );
    } finally {
      setThreadBusy(null);
    }
  }
  async function trashThread() {
    const nodeId = threadPlacement?.node.nodeId;
    if (!threadId || !nodeId || threadBusy) return;
    setThreadBusy("trash");
    try {
      await treeActions.trash([nodeId]);
      spectraBus.emit("threads.changed", {});
      selectThread(null);
      toast.success("Chat moved to Trash.", {
        action: {
          label: "Undo",
          onClick: () =>
            void treeActions
              .restore([nodeId])
              .then(() => {
                spectraBus.emit("threads.changed", {});
                selectThread(threadId);
              })
              .catch((error: unknown) =>
                toast.error(
                  describeFailure(error, {
                    fallback:
                      "Could not restore this chat. Find it in the Library Trash.",
                  }).message,
                ),
              ),
        },
      });
    } catch (error) {
      toast.error(
        describeFailure(error, {
          fallback: "Could not delete this chat. Try again.",
        }).message,
      );
    } finally {
      setThreadBusy(null);
    }
  }

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
      if (!artifact) {
        // Result cards can arrive before the broad overview projection includes a
        // newly created Inbox artifact. Resolve the canonical object directly so
        // its primary action never behaves like a dead focus-only click.
        void getSpectraArtifact(artifactId)
          .then(({ artifact: resolved }) => {
            setArtifacts((current) => [
              ...current.filter((item) => item._id !== resolved._id),
              resolved,
            ]);
            setHistoryOpen(false);
            studio.openSplit(resolved);
          })
          .catch(() => toast.error("That work is no longer available."));
        return;
      }
      setHistoryOpen(false);
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
              if (surface === "full")
                router.push(`/library/${encodeURIComponent(artifactId)}`);
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
            router.push(
              targetId
                ? `/workspace/${encodeURIComponent(targetId)}`
                : "/workspace?home=1",
            );
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

  const runEngine = useSpectraRun({
    surface: "chat",
    workspaceId: scopedWorkspaceId,
    artifactId: focusedArtifact?._id,
    threadId: composerThread?.id,
    open: openPointers,
    currentView: "conversation",
    initialCards: [],
    onThreadReady: async (id) => {
      setComposerThread({
        id,
        title:
          id === threadId
            ? (detail?.thread.title ?? "Conversation")
            : "New chat",
      });
      if (id !== threadId) {
        setThreadId(id);
        activeThreadRef.current = id;
        router.replace(`/chat?threadId=${encodeURIComponent(id)}`);
      }
      await refreshActiveThread();
    },
    onContinuationConflict: () => selectThread(null),
    onDataChanged: refreshActiveThread,
    onOpenArtifact: openArtifact,
  });

  useEffect(() => {
    const removeWork = spectraBus.handle("work.open", ({ workId }) =>
      openArtifact(workId),
    );
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
          message: readiness.status === "ready" ? "Conversation opened." : readiness.reason ?? "Conversation could not be opened.",
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
        ? `/chat?threadId=${encodeURIComponent(threadId)}`
        : "/chat?new=1",
    );
  }, [
    composerThread?.id,
    requestedPrompt,
    requestedThreadId,
    router,
    runEngine,
    threadId,
  ]);

  const visibleTitle =
    detail?.thread.title ??
    (threadId
      ? loading ? "Loading conversation…" : "Conversation"
      : "New conversation");
  const title = composerThread?.title ?? visibleTitle;
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
        restAsComposer: true,
        startNewThread: () => selectThread(null),
        openThread: (_runId: string, id: string) => selectThread(id),
      }),
      [composerThread, runEngine, selectThread, title],
    ),
  );

  function toggleRuns() {
    if (studio.activeArtifact && studio.dirtyIds.has(studio.activeArtifact._id)) {
      toast.message("Save or discard your open work before opening Runs.");
      return;
    }
    studio.closeStudio();
    if (!historyOpen)
      historyOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setHistoryOpen((value) => !value);
    if (!historyOpen)
      void getSpectraResultCards({ includeHidden: true, limit: 50 }).then((result) => setHistory(result.resultCards));
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
          onOpenArtifact={(artifact) => openArtifact(artifact._id)}
          onOpenWorkspace={(workspace) => selectWorkspaceContext(workspace._id)}
        />
      ),
    },
    { id: "new", icon: "add", label: "New chat", onSelect: () => selectThread(null) },
    { id: "runs", icon: "activity", label: "Runs", active: historyOpen, onSelect: toggleRuns },
    ...(threadId
      ? ([
          {
            id: "rename",
            icon: "edit",
            label: "Rename chat",
            labelPolicy: "never",
            onSelect: () => {
              setTitleDraft(visibleTitle);
              setRenaming(true);
            },
          },
          {
            id: "pin",
            icon: "pin",
            label: detail?.thread.pinned ? "Unpin chat" : "Pin chat",
            labelPolicy: "never",
            active: Boolean(detail?.thread.pinned),
            disabled: threadBusy === "pin",
            onSelect: () => void togglePinned(),
          },
          {
            id: "delete",
            icon: "trash",
            label: "Delete chat",
            labelPolicy: "never",
            disabled: !threadPlacement || threadBusy === "trash",
            onSelect: () => void trashThread(),
          },
        ] satisfies BarCommand[])
      : []),
  ];
  return (
    <div className="spectra-wave-y relative isolate flex h-full min-h-0">
      <section
        className={
          studio.mode === "tab" ? "hidden" : "flex min-w-0 flex-1 flex-col"
        }
      >
        <div className="shrink-0 px-4 pt-3 sm:px-6 lg:px-8">
          <PageHeader
            title={<CrossfadeText value={visibleTitle} primitive="reveal" className="block truncate" />}
            commands={chatCommands}
            plan={CHAT_BAR_PLAN}
            barLabel="Chat commands"
          />
        </div>
        {renaming && threadId ? (
          <div className="absolute left-5 top-12 z-modal flex w-[min(420px,calc(100vw-40px))] items-center gap-1.5 rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2 shadow-hover sm:left-7">
            <input
              autoFocus
              value={titleDraft}
              maxLength={64}
              onChange={(event) => setTitleDraft(event.target.value)}
              aria-label="Chat name"
              onKeyDown={(event) => {
                if (event.key === "Escape") setRenaming(false);
                if (event.key === "Enter") void saveTitle();
              }}
              className="h-9 min-w-0 flex-1 bg-transparent px-2 text-ui font-medium text-[var(--text-primary)] outline-none"
            />
            <IconButton
              icon="check"
              label="Save name"
              disabled={!titleDraft.trim() || threadBusy === "title"}
              onClick={() => void saveTitle()}
            />
            <IconButton icon="close" label="Cancel" onClick={() => setRenaming(false)} />
          </div>
        ) : null}
        <ConversationSurface
          detail={detail}
          threadId={threadId ?? undefined}
          loading={loading}
          loadError={
            detail && (loadError || contextLoadError) ? (
              <ProductErrorState
                title={
                  loadError
                    ? requestedThreadId
                      ? "This conversation could not refresh"
                      : "Chat could not refresh"
                    : "Chat context could not load"
                }
                detail={
                  loadError
                    ? "The messages shown below are the last loaded copy. Try again to refresh this conversation."
                    : "Your messages are available. Work and workspace information could not load. Try again."
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
          liveExchange={runEngine.liveExchange}
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
                    ? "This conversation could not load"
                    : "Chat could not load"
                }
                detail={loadError}
                className="mx-auto min-h-[clamp(420px,50vh,620px)] w-full max-w-[820px]"
                action={
                  <Button variant="primary" size="sm" onClick={retryRouteLoad}>
                    Try again
                  </Button>
                }
              />
            ) : (
              <div className="mx-auto flex min-h-[clamp(420px,50vh,620px)] w-full max-w-[820px] flex-col justify-center py-8 text-left">
                <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-surface border border-[color-mix(in_oklab,var(--brand-primary)_14%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--brand-primary)_5%,var(--bg-elevated))] shadow-soft">
                  <SpectraMark size={28} />
                </div>
                <h1 className="max-w-[820px] font-display text-title font-semibold leading-[1.12] text-[var(--text-primary)]">
                  {welcome}
                </h1>
                <p className="mt-3 max-w-[640px] text-body leading-6 text-[var(--text-secondary)]">
                  Bring a half-formed question, a difficult topic, or a whole
                  workspace. Spectra can explain, build, and revise alongside you.
                </p>
                {workspaces.length > 0 ? (
                  <div className="mt-8 grid gap-3 sm:grid-cols-2">
                    {workspaces.slice(0, 6).map((workspace) => {
                      const selected = chatWorkspaceId === workspace._id;
                      const count = artifacts.filter((artifact) =>
                        artifact.placements?.some(
                          (placement) => placement.workspaceId === workspace._id,
                        ),
                      ).length;
                      return (
                        <button
                          key={workspace._id}
                          type="button"
                          data-spectra-card="workspace"
                          data-card-state={selected ? "active" : "normal"}
                          data-interactive="true"
                          onClick={() =>
                            selectWorkspaceContext(
                              selected ? null : workspace._id,
                            )
                          }
                          className="group min-h-[112px] p-4 text-left"
                          style={
                            {
                              "--card-accent": "var(--accent-cyan)",
                            } as CSSProperties
                          }
                        >
                          <span className="relative flex items-start gap-3">
                            <span className="spectra-card-type-icon h-9 w-9 text-[var(--accent-cyan)]">
                              <FolderPlus className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2 text-body font-semibold text-[var(--text-primary)]">
                                {workspace.title}
                                {selected ? (
                                  <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                                ) : null}
                              </span>
                              <span className="mt-1 line-clamp-2 text-micro leading-5 text-[var(--text-secondary)]">
                                {workspace.description ??
                                  `${count} objects ready as context`}
                              </span>
                              <span className="mt-2 flex items-center gap-1 text-micro font-medium text-[var(--text-tertiary)]">
                                {selected
                                  ? "Context selected"
                                  : `Start here · ${count} objects`}
                                <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                              </span>
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            )
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
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-chrome bg-transparent px-5 pb-24 pt-2 sm:px-8">
        <div className="pointer-events-auto mx-auto max-w-[820px] spectra-live-stack">
          <ComposerArtifactDock
            artifacts={artifacts}
            cards={runEngine.cards}
            threadId={composerThread?.id ?? threadId ?? undefined}
            onOpen={openArtifact}
          />
        </div>
      </div>

      {historyOpen ? (
        <aside aria-label="Runs and chats" className="absolute inset-y-0 right-0 z-panel w-[min(360px,92vw)] overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4 shadow-[var(--shadow-lg)]">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-ui font-semibold">Runs and chats</h2>
              <p className="text-micro text-[var(--text-tertiary)]">
                Hidden results remain inspectable.
              </p>
            </div>
            <IconButton icon="close" label="Close runs" onClick={closeHistory} />
          </div>
          <div className="mb-5 space-y-1">
            {threads.slice(0, 12).map((thread) => (
              <button
                type="button"
                key={thread._id}
                onClick={() => {
                  selectThread(thread._id);
                  setHistoryOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-control px-2 py-2 text-left hover:bg-[var(--bg-hover)]"
              >
                <MessageSquare className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
                <span className="min-w-0 flex-1 truncate text-micro font-medium">
                  {thread.title}
                </span>
                <span className="text-micro text-[var(--text-tertiary)]">
                  {thread.messageCount ?? 0}
                </span>
              </button>
            ))}
          </div>
          <h3 className="border-t border-[var(--border-subtle)] pt-3 text-caption font-medium text-[var(--text-secondary)]">
            All runs
          </h3>
          <div className="mt-2 space-y-1.5">
            {history.map((card) => (
              <div
                key={card._id}
                className="rounded-control border border-[var(--border-default)] px-3 py-2"
              >
                <div className="flex items-center gap-2 text-micro font-medium">
                  <Clock3 className="h-3 w-3" />
                  {card.title}
                </div>
                <div className="mt-1 line-clamp-2 text-micro leading-4 text-[var(--text-tertiary)]">
                  {card.summary}
                </div>
              </div>
            ))}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
