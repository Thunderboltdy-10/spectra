"use client";

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
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { useSpectraRun } from "../ai/use-spectra-run";
import { useSpectraContext } from "../hooks/use-spectra-context";
import { ConversationSurface } from "../components/conversation-surface";
import { CommandBar } from "../components/command-bar";
import {
  ContextFocusControl,
  GlobalSearch,
  type ComposerFocusMode,
} from "../components/context-controls";
import {
  ArtifactStudio,
  useArtifactStudioState,
} from "../components/artifact-studio";
import { LiveThreadPanel } from "../components/live-thread-panel";
import {
  disengageFollowAi,
  isProgrammaticOpen,
} from "../collaboration/follow-ai";
import {
  getSpectraArtifact,
  getSpectraOverview,
  getSpectraResultCards,
  getSpectraThread,
  getSpectraThreads,
  postSpectra,
  type SpectraArtifact,
  type SpectraResultCard,
  type SpectraThread,
  type SpectraThreadDetail,
  type SpectraWorkspace,
} from "../data/api";

export function ChatShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedThreadId = searchParams.get("threadId");
  const requestedPrompt = searchParams.get("prompt");
  const [threadId, setThreadId] = useState<string | null>(requestedThreadId);
  const [threads, setThreads] = useState<SpectraThread[]>([]);
  const [detail, setDetail] = useState<SpectraThreadDetail | null>(null);
  const [workspaces, setWorkspaces] = useState<SpectraWorkspace[]>([]);
  const [artifacts, setArtifacts] = useState<SpectraArtifact[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SpectraResultCard[]>([]);
  const [loading, setLoading] = useState(Boolean(requestedThreadId));
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [chatWorkspaceId, setChatWorkspaceId] = useState<string | null>(null);
  const [focusModeOverride, setFocusModeOverride] =
    useState<ComposerFocusMode | null>(null);
  const [welcome, setWelcome] = useState("Welcome back.");
  const [welcomeKicker, setWelcomeKicker] = useState(
    "A calm place to think clearly",
  );
  const [studioPanelWidth, setStudioPanelWidth] = useState(700);
  const [liveThreadPanelWidth, setLiveThreadPanelWidth] = useState(560);
  const activeThreadRef = useRef<string | null>(requestedThreadId);
  const syncedRequestedThreadRef = useRef<string | null | undefined>(undefined);
  const consumedPromptRef = useRef<string | null>(null);
  const openObjects = useSpectraContextStore((state) => state.openObjects);
  const openObject = useSpectraContextStore((state) => state.openObject);
  const closePresentation = useSpectraContextStore(
    (state) => state.closePresentation,
  );
  const threadPanelObject =
    openObjects.find(
      (object) =>
        object.type === "thread" && object.presentation === "thread-panel",
    ) ?? null;
  const liveThread = threadPanelObject
    ? { id: threadPanelObject.id, title: threadPanelObject.label }
    : null;
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
    setWelcomeKicker(
      `${new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(now)} · Your study room is ready`,
    );
  }, []);

  const refresh = useCallback(async (nextThreadId?: string | null) => {
    const [threadRows, overview] = await Promise.all([
      getSpectraThreads({ limit: 100 }),
      getSpectraOverview(),
    ]);
    const selected = nextThreadId
      ? await getSpectraThread(nextThreadId).catch(() => null)
      : null;
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
      // The overview is deliberately bounded. An Inbox artifact opened from a
      // result card can be absent from a later refresh while it remains a real,
      // canonical object. Preserve only actively mounted artifacts so a run
      // completion cannot make the editor look like a temporary tab.
      for (const artifact of current)
        if (currentlyOpenIds.has(artifact._id) && !next.has(artifact._id))
          next.set(artifact._id, artifact);
      return [...next.values()];
    });
    if (nextThreadId === activeThreadRef.current) setDetail(selected);
    window.dispatchEvent(new Event("spectra:threads-changed"));
    return { threadFound: !nextThreadId || Boolean(selected) };
  }, []);

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
    activeThreadRef.current = requestedThreadId;
    setLoading(Boolean(requestedThreadId));
    void refresh(requestedThreadId)
      .then(({ threadFound }) => {
        if (
          threadFound ||
          !requestedThreadId ||
          activeThreadRef.current !== requestedThreadId
        )
          return;
        activeThreadRef.current = null;
        setThreadId(null);
        setDetail(null);
        setComposerThread(null);
        router.replace("/chat?new=1");
        toast.message(
          "That conversation is no longer available. Opened a new conversation instead.",
        );
      })
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "Could not load chat.",
        ),
      )
      .finally(() => setLoading(false));
  }, [requestedThreadId, refresh, router, setComposerThread]);

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
    const timer = window.setInterval(
      () =>
        void getSpectraThread(threadId)
          .then(setDetail)
          .catch(() => undefined),
      750,
    );
    return () => window.clearInterval(timer);
  }, [detail?.traces, threadId]);

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
      router.replace(
        id ? `/chat?threadId=${encodeURIComponent(id)}` : "/chat?new=1",
      );
    },
    [router, setComposerThread, threads],
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
  }, [closePresentation, studio]);
  const setLiveThread = useCallback(
    (thread: { id: string; title: string } | null) => {
      if (thread)
        openObject({
          type: "thread",
          id: thread.id,
          label: thread.title,
          presentation: "thread-panel",
          workspaceId: chatWorkspaceId ?? undefined,
        });
      else closePresentation("thread-panel");
    },
    [chatWorkspaceId, closePresentation, openObject],
  );
  const openArtifact = useCallback(
    (artifactId: string) => {
      // A user-chosen open ends spectating; a follow-dispatched open does not.
      if (!isProgrammaticOpen()) disengageFollowAi();
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
          setLiveThread({ id: targetThreadId, title: artifact.title });
          return;
        }
      }
      studio.openSplit(artifact);
    },
    [artifacts, composerThread?.id, setLiveThread, studio, threadId],
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
            : "New thread",
      });
      if (id !== threadId) {
        setThreadId(id);
        activeThreadRef.current = id;
        router.replace(`/chat?threadId=${encodeURIComponent(id)}`);
      }
      await refresh(id);
    },
    onContinuationConflict: () => selectThread(null),
    onDataChanged: () => refresh(activeThreadRef.current),
    onOpenArtifact: openArtifact,
  });

  useEffect(() => {
    function onOpenArtifact(event: Event) {
      const artifactId = (event as CustomEvent<{ artifactId?: string }>).detail
        ?.artifactId;
      if (artifactId) openArtifact(artifactId);
    }
    function onOpenWorkspace(event: Event) {
      const workspaceId = (event as CustomEvent<{ workspaceId?: string }>)
        .detail?.workspaceId;
      if (workspaceId) setChatWorkspaceId(workspaceId);
    }
    function onClearSelection() {
      clearExplicitContext();
      setFocusModeOverride(null);
    }
    function onAsk(event: Event) {
      const prompt = (
        event as CustomEvent<{ prompt?: string }>
      ).detail?.prompt?.trim();
      if (prompt) void runEngine.run(prompt);
    }
    function onContinueThread(event: Event) {
      const id = (event as CustomEvent<{ threadId?: string }>).detail?.threadId;
      if (id) selectThread(id);
    }
    window.addEventListener("spectra:open-artifact", onOpenArtifact);
    window.addEventListener("spectra:open-workspace", onOpenWorkspace);
    window.addEventListener("spectra:ask", onAsk);
    window.addEventListener("spectra:clear-selection", onClearSelection);
    window.addEventListener("spectra:continue-thread", onContinueThread);
    return () => {
      window.removeEventListener("spectra:open-artifact", onOpenArtifact);
      window.removeEventListener("spectra:open-workspace", onOpenWorkspace);
      window.removeEventListener("spectra:ask", onAsk);
      window.removeEventListener("spectra:clear-selection", onClearSelection);
      window.removeEventListener("spectra:continue-thread", onContinueThread);
    };
  });

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
            ? `Ask with ${selectedContextIds.size} selected artifacts…`
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
      onStartNewThread={() => selectThread(null)}
      onSubmit={(value, attachments) => runEngine.run(value, attachments)}
      menu={
        <>
          <button
            type="button"
            onClick={() => selectThread(null)}
            className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
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
              className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
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
              className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
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
    <div className="spectra-wave-y relative flex h-full min-h-0 bg-[var(--bg-primary)]">
      <section
        className={
          studio.mode === "tab" ? "hidden" : "flex min-w-0 flex-1 flex-col"
        }
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5 sm:px-7">
          <div className="min-w-0">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={visibleTitle}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.18 }}
                className="truncate font-display text-[18px] font-semibold text-[var(--text-primary)]"
              >
                {visibleTitle}
              </motion.div>
            </AnimatePresence>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Thread · Shared Spectra conversation
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
                className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
                aria-label="Rename thread"
                title="Rename thread"
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
                className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
                aria-label={
                  detail?.thread.pinned ? "Unpin thread" : "Pin thread"
                }
                title={detail?.thread.pinned ? "Unpin thread" : "Pin thread"}
              >
                <Pin
                  className={`h-3.5 w-3.5 ${detail?.thread.pinned ? "fill-current text-[var(--accent-cyan)]" : ""}`}
                />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => selectThread(null)}
              className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
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
                setHistoryOpen((value) => !value);
                if (!historyOpen)
                  void getSpectraResultCards({
                    includeHidden: true,
                    limit: 50,
                  }).then((result) => setHistory(result.resultCards));
              }}
              className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              aria-label="Open runs"
              title="Runs"
            >
              <History className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>
        {renaming && threadId ? (
          <div className="absolute left-5 top-12 z-50 flex w-[min(420px,calc(100vw-40px))] items-center gap-1.5 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2 shadow-[0_16px_40px_rgba(27,20,12,0.14)] sm:left-7">
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
              className="h-9 min-w-0 flex-1 bg-transparent px-2 text-[13px] font-medium text-[var(--text-primary)] outline-none"
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
              className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--success)] hover:bg-[var(--bg-hover)]"
              aria-label="Save title"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setRenaming(false)}
              className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
              aria-label="Cancel rename"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        {threadId && composerThread?.id !== threadId ? (
          <div className="border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-primary))] px-5 py-2 text-[11px] text-[var(--text-secondary)] sm:px-7">
            <span className="font-semibold text-[var(--text-primary)]">
              {composerThread
                ? `Continuing ${composerThread.title}.`
                : "New thread ready."}
            </span>{" "}
            The visible conversation remains open for reference; the next
            message{" "}
            {composerThread
              ? "continues the selected conversation"
              : "starts a separate thread"}{" "}
            with the selected context.
          </div>
        ) : null}
        <ConversationSurface
          detail={detail}
          loading={loading}
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
              choice.description
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
            <div className="mx-auto flex min-h-[clamp(420px,50vh,620px)] w-full max-w-[820px] flex-col justify-center py-8 text-left">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-[11px] bg-[color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-elevated))] text-[var(--accent-cyan)] shadow-[0_8px_28px_rgba(24,20,14,0.06)]">
                  <Sparkles className="h-5 w-5" />
                </span>
                <span className="rounded-full border border-[color-mix(in_oklab,var(--accent-cyan)_16%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--accent-cyan)_4%,transparent)] px-3 py-1.5 text-[10px] font-medium tracking-[0.02em] text-[var(--text-secondary)]">
                  {welcomeKicker}
                </span>
              </div>
              <h1 className="mt-5 max-w-[820px] font-display text-[42px] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--text-primary)]">
                {welcome}
              </h1>
              <p className="mt-3 max-w-[640px] text-[15px] leading-7 text-[var(--text-secondary)]">
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
                            <span className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-primary)]">
                              {workspace.title}
                              {selected ? (
                                <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                              ) : null}
                            </span>
                            <span className="mt-1 line-clamp-2 text-[11px] leading-5 text-[var(--text-secondary)]">
                              {workspace.description ??
                                `${count} objects ready as context`}
                            </span>
                            <span className="mt-2 flex items-center gap-1 text-[10px] font-medium text-[var(--text-tertiary)]">
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
        />
      ) : null}
      <div className="pointer-events-none absolute bottom-0 left-0 right-[var(--spectra-studio-width,0px)] z-50 bg-transparent px-4 pb-5 pt-2 sm:px-8 min-[1920px]:right-0">
        <div className="pointer-events-auto mx-auto max-w-[820px]">
          {pageComposer}
        </div>
      </div>

      {liveThread ? (
        <LiveThreadPanel
          threadId={liveThread.id}
          title={liveThread.title}
          width={liveThreadPanelWidth}
          onWidthChange={setLiveThreadPanelWidth}
          onClose={() => setLiveThread(null)}
          onOpenArtifact={openArtifact}
          onOpenWorkspace={selectWorkspaceContext}
        />
      ) : null}

      {historyOpen ? (
        <aside className="absolute inset-y-14 right-0 z-40 w-[min(360px,92vw)] overflow-y-auto border-l border-[var(--border-default)] bg-[var(--bg-primary)] p-4 shadow-[-12px_0_30px_rgba(22,18,13,0.08)]">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-[13px] font-semibold">Run & thread hub</h2>
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Hidden results remain inspectable.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setHistoryOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
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
                className="flex w-full items-center gap-2 rounded-[7px] px-2 py-2 text-left hover:bg-[var(--bg-hover)]"
              >
                <MessageSquare className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                  {thread.title}
                </span>
                <span className="text-[9px] text-[var(--text-tertiary)]">
                  {thread.messageCount ?? 0}
                </span>
              </button>
            ))}
          </div>
          <div className="border-t border-[var(--border-subtle)] pt-3 text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
            All runs
          </div>
          <div className="mt-2 space-y-1.5">
            {history.map((card) => (
              <div
                key={card._id}
                className="rounded-[7px] border border-[var(--border-default)] px-3 py-2"
              >
                <div className="flex items-center gap-2 text-[11px] font-medium">
                  <Clock3 className="h-3 w-3" />
                  {card.title}
                </div>
                <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-[var(--text-tertiary)]">
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
