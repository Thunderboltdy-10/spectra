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
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  FolderPlus,
  History,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { SpectraMark } from "@/components/spectra-mark";
import { useSpectraRun } from "../ai/use-spectra-run";
import { useSpectraContext } from "../hooks/use-spectra-context";
import { spectraBus } from "../events";
import { createApplicationCommandDispatcher } from "../commands/application-dispatcher";
import { ConversationSurface } from "../components/conversation-surface";
import { ProductErrorState } from "../components/product-state";
import { CommandBar } from "../components/command-bar";
import { ShellActivityField } from "../components/shell-activity-field";
import { CrossfadeText } from "../motion";
import { ComposerArtifactDock } from "../components/composer-artifact-dock";
import {
  ContextFocusControl,
  GlobalSearch,
  type ComposerFocusMode,
} from "../components/context-controls";
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

const ArtifactStudio = dynamic(
  () =>
    import("../components/artifact-studio").then(
      (module) => module.ArtifactStudio,
    ),
  { loading: () => <StudioSplitPlaceholder /> },
);

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
  const [loading, setLoading] = useState(Boolean(requestedThreadId));
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [chatWorkspaceId, setChatWorkspaceId] = useState<string | null>(null);
  const [focusModeOverride, setFocusModeOverride] =
    useState<ComposerFocusMode | null>(null);
  const [welcome, setWelcome] = useState("Welcome back.");
  const [studioPanelWidth, setStudioPanelWidth] = useState(700);
  const activeThreadRef = useRef<string | null>(requestedThreadId);
  const loadGenerationRef = useRef(0);
  const historyToggleRef = useRef<HTMLButtonElement | null>(null);
  const historyOpenerRef = useRef<HTMLButtonElement | null>(null);
  const syncedRequestedThreadRef = useRef<string | null | undefined>(undefined);
  const consumedPromptRef = useRef<string | null>(null);
  const closePresentation = useSpectraContextStore(
    (state) => state.closePresentation,
  );
  const {
    composerThread,
    setComposerThread,
    explicitContextIds: selectedContextIds,
    contextArtifactIds,
    explicitContextObjects,
    clearExplicitContext,
    toggleExplicitArtifact,
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
    async (nextThreadId?: string | null, generation?: number) => {
      const [threadRows, overview] = await Promise.all([
        getSpectraThreads({ limit: 100 }),
        getSpectraOverview(),
      ]);
      // A failed detail read is not a missing thread. Let the caller render a
      // retryable error instead of replacing a recoverable conversation with a
      // misleading new-chat state.
      const selected = nextThreadId
        ? await getSpectraThread(nextThreadId)
        : null;
      // Route loads are allowed to finish in the background, but an old
      // request must never publish its data into a newer route. Non-route
      // refreshes omit the generation and retain their existing semantics.
      if (
        generation !== undefined &&
        generation !== loadGenerationRef.current
      )
        return { threadFound: true, stale: true };
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
      if (nextThreadId === activeThreadRef.current) setDetail(selected);
      spectraBus.emit("threads.changed", {});
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
          .catch(() => toast.error("That artifact is no longer available."));
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
          if (surface === "full") {
            router.push(`/library/${encodeURIComponent(artifactId)}`);
            return;
          }
          return openArtifact(artifactId);
        },
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
  const naturalFocusMode: ComposerFocusMode = composerThread
    ? "thread"
    : focusedArtifact
      ? "artifact"
      : selectedContextIds.size > 0
        ? "selection"
        : scopedWorkspaceId
          ? "workspace"
          : "global";
  const effectiveFocusMode =
    focusModeOverride === "thread" && !composerThread
      ? naturalFocusMode
      : focusModeOverride === "artifact" && !focusedArtifact
        ? naturalFocusMode
        : focusModeOverride === "workspace" && !scopedWorkspaceId
          ? naturalFocusMode
          : focusModeOverride === "selection" && selectedContextIds.size === 0
            ? naturalFocusMode
            : (focusModeOverride ?? naturalFocusMode);
  // Continuation is independent from additive artifact/workspace context.
  // Starting a new thread is an explicit thread action, not a side effect of focus.
  const continuingThread = Boolean(composerThread);

  const toggleContextArtifact = useCallback(
    (artifact: SpectraArtifact) => {
      toggleExplicitArtifact(artifact);
      setFocusModeOverride("selection");
    },
    [toggleExplicitArtifact],
  );

  const runEngine = useSpectraRun({
    surface: "chat",
    workspaceId: scopedWorkspaceId,
    artifactId: focusedArtifact?._id,
    threadId: composerThread?.id,
    focusMode: effectiveFocusMode,
    selectedArtifactIds: contextArtifactIds,
    explicitContextObjects,
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
        selectThread(resolvedThreadId);
      },
    );
    return () => {
      removeWork();
      removeConversation();
    };
  }, [openArtifact, selectThread]);

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

  const visibleTitle = detail?.thread.title ?? "New conversation";
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
  const pageComposer = (
    <CommandBar
      placeholder={
        continuingThread
          ? `Continue ${title}…`
          : selectedContextIds.size
            ? `Ask with ${selectedContextIds.size} selected work items…`
            : activeWorkspace
              ? `Ask with ${activeWorkspace.title} context…`
              : focusedArtifact
                ? `Ask about ${focusedArtifact.title}…`
                : "Ask Spectra anything…"
      }
      busy={runEngine.submitting}
      allowConcurrent={!continuingThread}
      allowAttachments
      onStop={runEngine.stop}
      activeRunId={
        runEngine.liveExchange?.runId ??
        detail?.traces.find((trace) =>
          [
            "queued",
            "running",
            "awaiting_confirmation",
            "awaiting_resolution",
          ].includes(trace.run.status),
        )?.run._id
      }
      onSteer={runEngine.steer}
      onStartNewThread={() => selectThread(null)}
      onSubmit={(value, attachments) => runEngine.run(value, attachments)}
      menu={
        <>
          <button
            type="button"
            onClick={() => selectThread(null)}
            className="flex w-full items-center gap-2 rounded-chip px-2.5 py-2 text-left text-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <Plus className="h-4 w-4" />
            New conversation
          </button>
          {selectedContextIds.size ? (
            <button
              type="button"
              onClick={() => {
                clearExplicitContext();
                setFocusModeOverride(null);
              }}
              className="flex w-full items-center gap-2 rounded-chip px-2.5 py-2 text-left text-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <X className="h-4 w-4" />
              Clear selected context
            </button>
          ) : null}
          <div className="my-1 h-px bg-[var(--border-subtle)]" />
          {workspaces.slice(0, 6).map((workspace) => (
            <button
              key={workspace._id}
              type="button"
              onClick={() => selectWorkspaceContext(workspace._id)}
              className="flex w-full items-center gap-2 rounded-chip px-2.5 py-2 text-left text-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <FolderPlus className="h-4 w-4" />
              <span className="min-w-0 flex-1 truncate">
                Use {workspace.title}
              </span>
              {activeWorkspace?._id === workspace._id ? (
                <Check className="h-3.5 w-3.5 text-[var(--success)]" />
              ) : null}
            </button>
          ))}
        </>
      }
      context={
        <ContextFocusControl
          mode={effectiveFocusMode}
          onModeChange={setFocusModeOverride}
          workspace={activeWorkspace}
          artifact={focusedArtifact}
          selectedCount={contextArtifactIds.length}
          threadTitle={threadId ? title : undefined}
        />
      }
    />
  );

  return (
    <div className="spectra-wave-y relative isolate flex h-full min-h-0 bg-[var(--bg-primary)]">
      <ShellActivityField liveExchange={runEngine.liveExchange} />
      <section
        className={
          studio.mode === "tab" ? "hidden" : "flex min-w-0 flex-1 flex-col"
        }
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5 sm:px-7">
          <div className="min-w-0">
            <CrossfadeText
              value={visibleTitle}
              primitive="reveal"
              className="truncate font-display text-ui font-semibold text-[var(--text-primary)]"
            />
            <div className="text-micro uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Chat · Shared Spectra conversation
            </div>
          </div>
          <div className="flex items-center gap-1">
            <GlobalSearch
              trigger="icon"
              onOpenArtifact={(artifact) => openArtifact(artifact._id)}
              onOpenWorkspace={(workspace) =>
                selectWorkspaceContext(workspace._id)
              }
              selectedIds={selectedContextIds}
              onToggleSelected={toggleContextArtifact}
            />
            {threadId ? (
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(visibleTitle);
                  setRenaming(true);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-control text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
                aria-label="Rename chat"
                title="Rename chat"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {threadId ? (
              <button
                type="button"
                onClick={() =>
                  void postSpectra({
                    action: "updateThread",
                    threadId,
                    pinned: !detail?.thread.pinned,
                  }).then(() => refresh(threadId))
                }
                className="flex h-8 w-8 items-center justify-center rounded-control text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
                aria-label={
                  detail?.thread.pinned ? "Unpin chat" : "Pin chat"
                }
                title={detail?.thread.pinned ? "Unpin chat" : "Pin chat"}
              >
                <Pin
                  className={`h-3.5 w-3.5 ${detail?.thread.pinned ? "fill-current text-[var(--accent-cyan)]" : ""}`}
                />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => selectThread(null)}
              className="flex h-8 w-8 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              aria-label="New chat"
              title="New chat"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  studio.activeArtifact &&
                  studio.dirtyIds.has(studio.activeArtifact._id)
                ) {
                  toast.message(
                    "Save or discard the open artifact before opening Runs.",
                  );
                  return;
                }
                studio.closeStudio();
                if (!historyOpen)
                  historyOpenerRef.current = historyToggleRef.current;
                setHistoryOpen((value) => !value);
                if (!historyOpen)
                  void getSpectraResultCards({
                    includeHidden: true,
                    limit: 50,
                  }).then((result) => setHistory(result.resultCards));
              }}
              className="flex h-8 w-8 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              aria-label="Open runs"
              aria-expanded={historyOpen}
              title="Runs"
              ref={historyToggleRef}
            >
              <History className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>
        {renaming && threadId ? (
          <div className="absolute left-5 top-12 z-modal flex w-[min(420px,calc(100vw-40px))] items-center gap-1.5 rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2 shadow-hover sm:left-7">
            <input
              autoFocus
              value={titleDraft}
              maxLength={64}
              onChange={(event) => setTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setRenaming(false);
                if (event.key === "Enter" && titleDraft.trim())
                  void postSpectra({
                    action: "updateThread",
                    threadId,
                    title: titleDraft.trim(),
                  })
                    .then(() => refresh(threadId))
                    .then(() => setRenaming(false));
              }}
              className="h-9 min-w-0 flex-1 bg-transparent px-2 text-ui font-medium text-[var(--text-primary)] outline-none"
            />
            <button
              type="button"
              onClick={() =>
                void postSpectra({
                  action: "updateThread",
                  threadId,
                  title: titleDraft.trim(),
                })
                  .then(() => refresh(threadId))
                  .then(() => setRenaming(false))
              }
              className="flex h-8 w-8 items-center justify-center rounded-control text-[var(--success)] hover:bg-[var(--bg-hover)]"
              aria-label="Save title"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setRenaming(false)}
              className="flex h-8 w-8 items-center justify-center rounded-control text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
              aria-label="Cancel rename"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        <ConversationSurface
          detail={detail}
          threadId={threadId ?? undefined}
          loading={loading}
          loadError={
            detail && loadError ? (
              <ProductErrorState
                title={
                  requestedThreadId
                    ? "This conversation could not refresh"
                    : "Chat could not refresh"
                }
                detail="The messages shown below are the last loaded copy. Try again to refresh this conversation."
                className="mb-5 min-h-0 items-start rounded-card border border-[color-mix(in_oklab,var(--danger)_22%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_4%,var(--bg-primary))] px-4 py-3 text-left"
                action={
                  <button
                    type="button"
                    onClick={retryRouteLoad}
                    className="h-8 rounded-control bg-[var(--text-primary)] px-3 text-micro font-semibold text-[var(--bg-primary)]"
                  >
                    Try again
                  </button>
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
            void runEngine.run(
              choice.title === "Skipped"
                ? "Skip that question and continue with reasonable defaults."
                : choice.description
                  ? `${choice.title}: ${choice.description}`
                  : choice.title,
            )
          }
          activeCards={activeCards}
          onCardAction={(card, action, target) =>
            void runEngine.onCardAction(card, action, target)
          }
          onCardRevise={(card, revision) => runEngine.revise(card, revision)}
          onRetryRun={runEngine.retry}
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
                  <button
                    type="button"
                    onClick={retryRouteLoad}
                    className="h-9 rounded-control bg-[var(--text-primary)] px-3 text-micro font-semibold text-[var(--bg-primary)]"
                  >
                    Try again
                  </button>
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
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-modal bg-transparent px-5 pb-5 pt-2 sm:px-8">
        <div className="pointer-events-auto mx-auto max-w-[820px] spectra-live-stack">
          <ComposerArtifactDock
            artifacts={artifacts}
            cards={runEngine.cards}
            explicitIds={[...selectedContextIds]}
            threadId={composerThread?.id ?? threadId ?? undefined}
            assistantContent={
              runEngine.liveExchange?.content ?? runEngine.cards[0]?.summary
            }
            onOpen={openArtifact}
          />
          {pageComposer}
        </div>
      </div>

      {historyOpen ? (
        <aside className="absolute inset-y-14 right-0 z-chrome w-[min(360px,92vw)] overflow-y-auto border-l border-[var(--border-default)] bg-[var(--bg-primary)] p-4 shadow-soft">
          <div className="mb-4 flex items-center justify-between">
            <div>
          <h2 className="text-ui font-semibold">Runs & chats</h2>
              <p className="text-micro text-[var(--text-tertiary)]">
                Hidden results remain inspectable.
              </p>
            </div>
            <button
              type="button"
              onClick={closeHistory}
              className="flex h-8 w-8 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              aria-label="Close runs"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
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
          <div className="border-t border-[var(--border-subtle)] pt-3 text-micro font-semibold uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
            All runs
          </div>
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
