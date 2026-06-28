"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Check, CheckCircle2, Clock3, FolderPlus, History, MessageSquare, Pencil, Pin, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useSpectraRun } from "../ai/use-spectra-run";
import { ConversationSurface } from "../components/conversation-surface";
import { CommandBar } from "../components/command-bar";
import { ContextFocusControl, GlobalSearch, type ComposerFocusMode } from "../components/context-controls";
import { ArtifactStudio, useArtifactStudioState } from "../components/artifact-studio";
import type { ArtifactPayload } from "../components/artifact-blueprint-sheet";
import { getSpectraOverview, getSpectraResultCards, getSpectraThread, getSpectraThreads, postSpectra, type SpectraArtifact, type SpectraResultCard, type SpectraThread, type SpectraThreadDetail, type SpectraWorkspace } from "../data/api";

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
  const [selectedContextIds, setSelectedContextIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [focusModeOverride, setFocusModeOverride] = useState<ComposerFocusMode | null>(null);
  const [welcome, setWelcome] = useState("Welcome back.");
  const [studioPanelWidth, setStudioPanelWidth] = useState(700);
  const [threadPanelWidth, setThreadPanelWidth] = useState(560);
  const [threadPanelArtifactId, setThreadPanelArtifactId] = useState<string | null>(null);
  const activeThreadRef = useRef<string | null>(requestedThreadId);
  const consumedPromptRef = useRef<string | null>(null);

  useEffect(() => {
    const hour = new Date().getHours();
    setWelcome(hour < 5 ? "Still thinking? Let’s make it lighter." : hour < 12 ? "Good morning. Let’s get one thing moving." : hour < 18 ? "Good afternoon. What can we make clearer?" : "Good evening. Let’s finish something worthwhile.");
  }, []);

  const refresh = useCallback(async (nextThreadId?: string | null) => {
    const [threadRows, overview, selected] = await Promise.all([
      getSpectraThreads({ limit: 100 }),
      getSpectraOverview(),
      nextThreadId ? getSpectraThread(nextThreadId) : Promise.resolve(null),
    ]);
    setThreads(threadRows.threads);
    setWorkspaces(overview.workspaces);
    setArtifacts(overview.artifacts);
    setDetail(selected);
    window.dispatchEvent(new Event("spectra:threads-changed"));
  }, []);

  useEffect(() => {
    setThreadId(requestedThreadId);
    activeThreadRef.current = requestedThreadId;
    setLoading(Boolean(requestedThreadId));
    void refresh(requestedThreadId).catch((error) => toast.error(error instanceof Error ? error.message : "Could not load chat.")).finally(() => setLoading(false));
  }, [requestedThreadId, refresh]);

  const selectThread = useCallback((id: string | null) => {
    setThreadId(id);
    activeThreadRef.current = id;
    setDetail(null);
    setChatWorkspaceId(null);
    router.replace(id ? `/chat?threadId=${encodeURIComponent(id)}` : "/chat?new=1");
  }, [router]);

  const selectWorkspaceContext = useCallback((workspaceId: string | null) => {
    setChatWorkspaceId(workspaceId);
    if (threadId && workspaceId) void postSpectra({ action: "updateThread", threadId, workspaceId }).then(() => refresh(threadId));
  }, [refresh, threadId]);

  const studio = useArtifactStudioState("spectra.shared.artifactStudio", artifacts);
  const threadPanelArtifact = artifacts.find((artifact) => artifact._id === threadPanelArtifactId && artifact.blueprintKey === "thread_reference") ?? null;
  const openArtifact = useCallback((artifactId: string) => {
    const artifact = artifacts.find((item) => item._id === artifactId);
    if (!artifact) { toast.error("That artifact is no longer available."); return; }
    setHistoryOpen(false);
    if (artifact.blueprintKey === "thread_reference") {
      setThreadPanelArtifactId(artifact._id);
      return;
    }
    studio.openSplit(artifact);
  }, [artifacts, studio]);

  const updateArtifact = useCallback(async (artifactId: string, payload: ArtifactPayload) => {
    await postSpectra({ action: "updateArtifact", artifactId, title: payload.title, summary: payload.summary, content: payload.content, tags: payload.tags, source: "manual" });
    toast.success("Artifact updated.");
    await refresh(activeThreadRef.current);
  }, [refresh]);
  const revertArtifactVersion = useCallback(async (artifactId: string, versionId: string) => {
    await postSpectra({ action: "revertArtifactVersion", artifactId, versionId });
    toast.success("Artifact restored to the selected version.");
    await refresh(activeThreadRef.current);
  }, [refresh]);

  const focusedArtifact = studio.activeArtifact ?? threadPanelArtifact;
  const scopedWorkspaceId = chatWorkspaceId ?? detail?.thread.workspaceId;
  const naturalFocusMode: ComposerFocusMode = selectedContextIds.size > 0 ? "selection" : threadId ? "thread" : focusedArtifact ? "artifact" : scopedWorkspaceId ? "workspace" : "global";
  const effectiveFocusMode = focusModeOverride === "thread" && !threadId ? naturalFocusMode : focusModeOverride === "artifact" && !focusedArtifact ? naturalFocusMode : focusModeOverride === "workspace" && !scopedWorkspaceId ? naturalFocusMode : focusModeOverride === "selection" && selectedContextIds.size === 0 ? naturalFocusMode : focusModeOverride ?? naturalFocusMode;
  const continuingThread = Boolean(threadId && effectiveFocusMode === "thread");

  const toggleContextArtifact = useCallback((artifact: SpectraArtifact) => {
    setSelectedContextIds((current) => {
      const next = new Set(current);
      if (next.has(artifact._id)) next.delete(artifact._id);
      else if (next.size < 12) next.add(artifact._id);
      return next;
    });
    setFocusModeOverride("selection");
  }, []);

  const runEngine = useSpectraRun({
    surface: "chat",
    workspaceId: scopedWorkspaceId,
    artifactId: focusedArtifact?._id,
    threadId: continuingThread ? threadId ?? undefined : undefined,
    focusMode: effectiveFocusMode,
    selectedArtifactIds: [...selectedContextIds],
    currentView: "conversation",
    initialCards: [],
    onThreadReady: async (id) => {
      if (id !== threadId) {
        setThreadId(id);
        activeThreadRef.current = id;
        router.replace(`/chat?threadId=${encodeURIComponent(id)}`);
      }
      await refresh(id);
    },
    onDataChanged: () => refresh(activeThreadRef.current),
    onOpenArtifact: openArtifact,
	  });

	  useEffect(() => {
	    function onOpenArtifact(event: Event) {
	      const artifactId = (event as CustomEvent<{ artifactId?: string }>).detail?.artifactId;
	      if (artifactId) openArtifact(artifactId);
	    }
	    function onOpenWorkspace(event: Event) {
	      const workspaceId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId;
	      if (workspaceId) setChatWorkspaceId(workspaceId);
	    }
	    function onClearSelection() {
	      setSelectedContextIds(new Set());
	      setFocusModeOverride(null);
	    }
	    function onAsk(event: Event) {
	      const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt?.trim();
	      if (prompt) void runEngine.run(prompt);
	    }
	    window.addEventListener("spectra:open-artifact", onOpenArtifact);
	    window.addEventListener("spectra:open-workspace", onOpenWorkspace);
	    window.addEventListener("spectra:ask", onAsk);
	    window.addEventListener("spectra:clear-selection", onClearSelection);
	    return () => {
	      window.removeEventListener("spectra:open-artifact", onOpenArtifact);
	      window.removeEventListener("spectra:open-workspace", onOpenWorkspace);
	      window.removeEventListener("spectra:ask", onAsk);
	      window.removeEventListener("spectra:clear-selection", onClearSelection);
	    };
	  });

	  useEffect(() => {
	    const prompt = requestedPrompt?.trim();
	    if (!prompt || consumedPromptRef.current === prompt) return;
	    consumedPromptRef.current = prompt;
	    void runEngine.run(prompt);
	    router.replace(threadId ? `/chat?threadId=${encodeURIComponent(threadId)}` : "/chat?new=1");
	  }, [requestedPrompt, router, runEngine, threadId]);

  const title = detail?.thread.title ?? "New conversation";
  const activeWorkspace = workspaces.find((workspace) => workspace._id === (chatWorkspaceId ?? detail?.thread.workspaceId));
  const activeCards = useMemo(() => runEngine.cards.filter((card) => card.status !== "completed"), [runEngine.cards]);
  const pageComposer = <CommandBar placeholder={continuingThread ? `Continue ${title}…` : selectedContextIds.size ? `Ask with ${selectedContextIds.size} selected artifacts…` : threadId ? "Start a new thread with the selected context…" : activeWorkspace ? `Ask with ${activeWorkspace.title} context…` : focusedArtifact ? `Ask about ${focusedArtifact.title}…` : "Ask Spectra anything…"} busy={runEngine.submitting} allowConcurrent allowAttachments onStop={runEngine.stop} onSubmit={(value, attachments) => { void runEngine.run(value, attachments); return true; }} menu={<><button type="button" onClick={() => selectThread(null)} className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><Plus className="h-4 w-4" />New conversation</button>{selectedContextIds.size ? <button type="button" onClick={() => { setSelectedContextIds(new Set()); setFocusModeOverride(null); }} className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><X className="h-4 w-4" />Clear selected context</button> : null}<div className="my-1 h-px bg-[var(--border-subtle)]" />{workspaces.slice(0, 6).map((workspace) => <button key={workspace._id} type="button" onClick={() => selectWorkspaceContext(workspace._id)} className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><FolderPlus className="h-4 w-4" /><span className="min-w-0 flex-1 truncate">Use {workspace.title}</span>{activeWorkspace?._id === workspace._id ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : null}</button>)}</>} context={<ContextFocusControl mode={effectiveFocusMode} onModeChange={setFocusModeOverride} workspace={activeWorkspace} artifact={focusedArtifact} selectedCount={selectedContextIds.size} threadTitle={threadId ? title : undefined} />} />;

  return (
    <div className="relative flex h-full min-h-0 bg-[var(--bg-primary)]">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5 sm:px-7">
          <div className="min-w-0">
            <div className="truncate font-display text-[18px] font-semibold text-[var(--text-primary)]">{title}</div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Thread · Shared Spectra conversation</div>
          </div>
          <div className="flex items-center gap-1">
            <GlobalSearch
              trigger="icon"
              onOpenArtifact={(artifact) => openArtifact(artifact._id)}
              onOpenWorkspace={(workspace) => selectWorkspaceContext(workspace._id)}
              selectedIds={selectedContextIds}
              onToggleSelected={toggleContextArtifact}
            />
            {threadId ? <button type="button" onClick={() => { setTitleDraft(title); setRenaming(true); }} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]" aria-label="Rename thread" title="Rename thread"><Pencil className="h-3.5 w-3.5" /></button> : null}
            {threadId ? <button type="button" onClick={() => void postSpectra({ action: "updateThread", threadId, pinned: !detail?.thread.pinned }).then(() => refresh(threadId))} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]" aria-label={detail?.thread.pinned ? "Unpin thread" : "Pin thread"} title={detail?.thread.pinned ? "Unpin thread" : "Pin thread"}><Pin className={`h-3.5 w-3.5 ${detail?.thread.pinned ? "fill-current text-[var(--accent-cyan)]" : ""}`} /></button> : null}
            <button type="button" onClick={() => selectThread(null)} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" aria-label="New chat" title="New chat"><Plus className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => {
              if (studio.activeArtifact && studio.dirtyIds.has(studio.activeArtifact._id)) { toast.message("Save or discard the open artifact before opening Runs."); return; }
              studio.closeStudio();
              setThreadPanelArtifactId(null);
              setHistoryOpen((value) => !value);
              if (!historyOpen) void getSpectraResultCards({ includeHidden: true, limit: 50 }).then((result) => setHistory(result.resultCards));
            }} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" aria-label="Open runs" title="Runs"><History className="h-3.5 w-3.5" /></button>
          </div>
        </header>
	        {renaming && threadId ? <div className="absolute left-5 top-12 z-50 flex w-[min(420px,calc(100vw-40px))] items-center gap-1.5 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2 shadow-[0_16px_40px_rgba(27,20,12,0.14)] sm:left-7"><input autoFocus value={titleDraft} maxLength={64} onChange={(event) => setTitleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setRenaming(false); if (event.key === "Enter" && titleDraft.trim()) void postSpectra({ action: "updateThread", threadId, title: titleDraft.trim() }).then(() => refresh(threadId)).then(() => setRenaming(false)); }} className="h-9 min-w-0 flex-1 bg-transparent px-2 text-[13px] font-medium text-[var(--text-primary)] outline-none" /><button type="button" onClick={() => void postSpectra({ action: "updateThread", threadId, title: titleDraft.trim() }).then(() => refresh(threadId)).then(() => setRenaming(false))} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--success)] hover:bg-[var(--bg-hover)]" aria-label="Save title"><Check className="h-4 w-4" /></button><button type="button" onClick={() => setRenaming(false)} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]" aria-label="Cancel rename"><X className="h-4 w-4" /></button></div> : null}
	        {threadId && !continuingThread ? <div className="border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-primary))] px-5 py-2 text-[11px] text-[var(--text-secondary)] sm:px-7"><span className="font-semibold text-[var(--text-primary)]">New thread ready.</span> The current conversation is open for reference; your next message will create a separate thread using the selected context.</div> : null}
	        <ConversationSurface
          detail={detail}
          loading={loading}
          liveExchange={runEngine.liveExchange}
	          workspaces={workspaces}
	          onOpenArtifact={openArtifact}
	          onOpenWorkspace={(workspaceId) => router.push(`/workspace?workspaceId=${encodeURIComponent(workspaceId)}&threadId=${encodeURIComponent(threadId ?? "")}`)}
	          onChoice={(choice) => void runEngine.run(choice.description ? `${choice.title}: ${choice.description}` : choice.title)}
          activeCards={activeCards}
          onCardAction={(card, action, target) => void runEngine.onCardAction(card, action, target)}
          empty={<div className="mx-auto flex min-h-[58vh] w-full max-w-[820px] flex-col justify-center py-10 text-left">
            <span className="flex h-11 w-11 items-center justify-center rounded-[11px] bg-[color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-elevated))] text-[var(--accent-cyan)] shadow-[0_8px_28px_rgba(24,20,14,0.06)]"><Sparkles className="h-5 w-5" /></span>
            <h1 className="mt-5 font-display text-[36px] font-semibold tracking-[-0.025em] text-[var(--text-primary)]">{welcome}</h1>
            <p className="mt-2 max-w-[560px] text-[14px] leading-6 text-[var(--text-secondary)]">Ask directly, or choose a room to give Spectra the right objects and subject context from the first message.</p>
            {workspaces.length > 0 ? <div className="mt-8 grid gap-3 sm:grid-cols-2">{workspaces.slice(0, 6).map((workspace) => { const selected = chatWorkspaceId === workspace._id; const count = artifacts.filter((artifact) => artifact.placements?.some((placement) => placement.workspaceId === workspace._id)).length; return <button key={workspace._id} type="button" data-spectra-card="workspace" data-card-state={selected ? "active" : "normal"} data-interactive="true" onClick={() => selectWorkspaceContext(selected ? null : workspace._id)} className="group min-h-[112px] p-4 text-left" style={{ "--card-accent": "var(--accent-cyan)" } as CSSProperties}><span className="relative flex items-start gap-3"><span className="spectra-card-type-icon h-9 w-9 text-[var(--accent-cyan)]"><FolderPlus className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-primary)]">{workspace.title}{selected ? <CheckCircle2 className="h-4 w-4 text-[var(--success)]" /> : null}</span><span className="mt-1 line-clamp-2 text-[11px] leading-5 text-[var(--text-secondary)]">{workspace.description ?? `${count} objects ready as context`}</span><span className="mt-2 flex items-center gap-1 text-[10px] font-medium text-[var(--text-tertiary)]">{selected ? "Context selected" : `Start here · ${count} objects`}<ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" /></span></span></span></button>; })}</div> : null}
          </div>}
        />
      </section>

      {studio.isOpen && studio.activeArtifact ? <ArtifactStudio mode={studio.mode === "tab" ? "tab" : "split"} artifact={studio.activeArtifact} artifacts={artifacts} tabs={studio.tabs} dirtyIds={studio.dirtyIds} panelWidth={studioPanelWidth} sourceLabel="Chat" onPanelWidthChange={setStudioPanelWidth} onClose={studio.closeStudio} onExpand={studio.openTab} onActivateTab={studio.activateTab} onCloseTab={studio.closeTab} onSave={updateArtifact} onRevert={revertArtifactVersion} onDirtyChange={studio.setDirty} /> : null}
      {threadPanelArtifact ? <ArtifactStudio mode="split" artifact={threadPanelArtifact} artifacts={artifacts} tabs={[]} dirtyIds={new Set()} panelWidth={threadPanelWidth} sourceLabel="Chat" onPanelWidthChange={setThreadPanelWidth} onClose={() => setThreadPanelArtifactId(null)} onExpand={() => undefined} onActivateTab={() => undefined} onCloseTab={() => setThreadPanelArtifactId(null)} onSave={updateArtifact} onRevert={revertArtifactVersion} onDirtyChange={() => undefined} onContinueThread={(continuedId) => selectThread(continuedId === threadId ? null : continuedId)} continuedThreadId={threadId} /> : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-50 bg-[linear-gradient(to_top,var(--bg-primary)_76%,transparent)] px-4 pb-5 pt-14 sm:px-8"><div className="pointer-events-auto mx-auto max-w-[820px]">{pageComposer}</div></div>

      {historyOpen ? <aside className="absolute inset-y-14 right-0 z-40 w-[min(360px,92vw)] overflow-y-auto border-l border-[var(--border-default)] bg-[var(--bg-primary)] p-4 shadow-[-12px_0_30px_rgba(22,18,13,0.08)]">
        <div className="mb-4 flex items-center justify-between"><div><h2 className="text-[13px] font-semibold">Run & thread hub</h2><p className="text-[11px] text-[var(--text-tertiary)]">Hidden results remain inspectable.</p></div><button type="button" onClick={() => setHistoryOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" aria-label="Close runs" title="Close"><X className="h-4 w-4" /></button></div>
        <div className="mb-5 space-y-1">
          {threads.slice(0, 12).map((thread) => <button type="button" key={thread._id} onClick={() => { selectThread(thread._id); setHistoryOpen(false); }} className="flex w-full items-center gap-2 rounded-[7px] px-2 py-2 text-left hover:bg-[var(--bg-hover)]"><MessageSquare className="h-3.5 w-3.5 text-[var(--accent-cyan)]" /><span className="min-w-0 flex-1 truncate text-[11px] font-medium">{thread.title}</span><span className="text-[9px] text-[var(--text-tertiary)]">{thread.messageCount ?? 0}</span></button>)}
        </div>
        <div className="border-t border-[var(--border-subtle)] pt-3 text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--text-tertiary)]">All runs</div>
        <div className="mt-2 space-y-1.5">{history.map((card) => <div key={card._id} className="rounded-[7px] border border-[var(--border-default)] px-3 py-2"><div className="flex items-center gap-2 text-[11px] font-medium"><Clock3 className="h-3 w-3" />{card.title}</div><div className="mt-1 line-clamp-2 text-[10px] leading-4 text-[var(--text-tertiary)]">{card.summary}</div></div>)}</div>
      </aside> : null}
    </div>
  );
}
