"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Clock3, History, MessageSquare, Pencil, Pin, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useSpectraRun } from "../ai/use-spectra-run";
import { ConversationSurface } from "../components/conversation-surface";
import { CommandBar } from "../components/command-bar";
import { RunDetailPanel } from "../components/run-detail-panel";
import { LocalThreadTabs } from "../components/local-thread-tabs";
import { useSpectraSession } from "@/context/spectra-session-context";
import { ArtifactStudio, useArtifactStudioState } from "../components/artifact-studio";
import type { ArtifactPayload } from "../components/artifact-blueprint-sheet";
import { getSpectraOverview, getSpectraResultCards, getSpectraThread, getSpectraThreads, postSpectra, type SpectraArtifact, type SpectraResultCard, type SpectraThread, type SpectraThreadDetail, type SpectraWorkspace } from "../data/api";

export function ChatShell() {
  const spectraSession = useSpectraSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedThreadId = searchParams.get("threadId");
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
  const activeThreadRef = useRef<string | null>(requestedThreadId);

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
    router.replace(id ? `/chat?threadId=${encodeURIComponent(id)}` : "/chat?new=1");
  }, [router]);

  const studio = useArtifactStudioState("spectra.shared.artifactStudio", artifacts);
  const openArtifact = useCallback((artifactId: string) => {
    const artifact = artifacts.find((item) => item._id === artifactId);
    if (!artifact) { toast.error("That artifact is no longer available."); return; }
    setHistoryOpen(false);
    studio.openSplit(artifact);
  }, [artifacts, studio]);

  const updateArtifact = useCallback(async (artifactId: string, payload: ArtifactPayload) => {
    await postSpectra({ action: "updateArtifact", artifactId, title: payload.title, summary: payload.summary, content: payload.content, tags: payload.tags, source: "manual" });
    toast.success("Artifact updated.");
    await refresh(activeThreadRef.current);
  }, [refresh]);

  const runEngine = useSpectraRun({
    surface: "chat",
    threadId: threadId ?? undefined,
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

  const title = detail?.thread.title ?? "New conversation";
  const activeCards = useMemo(() => runEngine.cards.filter((card) => card.status !== "completed"), [runEngine.cards]);

  return (
    <div className="relative flex h-full min-h-0 bg-[var(--bg-primary)]">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5 sm:px-7">
          <div className="min-w-0">
            <div className="truncate font-display text-[18px] font-semibold text-[var(--text-primary)]">{title}</div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Persistent thread · Spectra run foundation</div>
          </div>
          <div className="flex items-center gap-1">
            {threadId ? <button type="button" onClick={() => { setTitleDraft(title); setRenaming(true); }} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]" aria-label="Rename thread" title="Rename thread"><Pencil className="h-3.5 w-3.5" /></button> : null}
            {threadId ? <button type="button" onClick={() => void postSpectra({ action: "updateThread", threadId, pinned: !detail?.thread.pinned }).then(() => refresh(threadId))} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]" aria-label={detail?.thread.pinned ? "Unpin thread" : "Pin thread"}><Pin className={`h-3.5 w-3.5 ${detail?.thread.pinned ? "fill-current text-[var(--accent-cyan)]" : ""}`} /></button> : null}
            <button type="button" onClick={() => selectThread(null)} className="flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><Plus className="h-3.5 w-3.5" />New</button>
            <button type="button" onClick={() => {
              if (studio.activeArtifact && studio.dirtyIds.has(studio.activeArtifact._id)) { toast.message("Save or discard the open artifact before opening Runs."); return; }
              studio.closeStudio();
              setHistoryOpen((value) => !value);
              if (!historyOpen) void getSpectraResultCards({ includeHidden: true, limit: 50 }).then((result) => setHistory(result.resultCards));
            }} className="flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><History className="h-3.5 w-3.5" />Runs</button>
          </div>
        </header>
        {renaming && threadId ? <div className="absolute left-5 top-12 z-50 flex w-[min(420px,calc(100vw-40px))] items-center gap-1.5 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2 shadow-[0_16px_40px_rgba(27,20,12,0.14)] sm:left-7"><input autoFocus value={titleDraft} maxLength={64} onChange={(event) => setTitleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setRenaming(false); if (event.key === "Enter" && titleDraft.trim()) void postSpectra({ action: "updateThread", threadId, title: titleDraft.trim() }).then(() => refresh(threadId)).then(() => setRenaming(false)); }} className="h-9 min-w-0 flex-1 bg-transparent px-2 text-[13px] font-medium text-[var(--text-primary)] outline-none" /><button type="button" onClick={() => void postSpectra({ action: "updateThread", threadId, title: titleDraft.trim() }).then(() => refresh(threadId)).then(() => setRenaming(false))} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--success)] hover:bg-[var(--bg-hover)]" aria-label="Save title"><Check className="h-4 w-4" /></button><button type="button" onClick={() => setRenaming(false)} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]" aria-label="Cancel rename"><X className="h-4 w-4" /></button></div> : null}
        <ConversationSurface
          detail={detail}
          loading={loading}
          liveExchange={runEngine.liveExchange}
          workspaces={workspaces}
          onOpenArtifact={openArtifact}
          activeCards={activeCards}
          onCardOpen={(card) => { if (studio.activeArtifact && studio.dirtyIds.has(studio.activeArtifact._id)) { toast.message("Save or discard the open artifact before opening run details."); return; } studio.closeStudio(); spectraSession.openLocalThread(card.runId, card.summary ?? card.title); }}
          onCardAction={(card, action, target) => void runEngine.onCardAction(card, action, target)}
          empty={<div className="flex min-h-[58vh] flex-col items-center justify-center text-center">
            <span className="mb-6 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--accent-cyan)] shadow-[0_8px_28px_rgba(24,20,14,0.08)]"><Sparkles className="h-5 w-5" /></span>
            <h1 className="font-display text-[34px] font-semibold tracking-[-0.025em] text-[var(--text-primary)]">What are you working through?</h1>
            <p className="mt-3 max-w-[520px] text-[13px] leading-6 text-[var(--text-secondary)]">Ask a question, develop an idea, or create a study object. Conversations persist as threads; artifacts stay in your library until you place them.</p>
            {threads.length > 0 ? <div className="mt-8 grid w-full max-w-[680px] gap-2 text-left sm:grid-cols-2">{threads.slice(0, 4).map((thread) => <button key={thread._id} type="button" onClick={() => selectThread(thread._id)} className="group rounded-[10px] bg-[color-mix(in_oklab,var(--bg-elevated)_72%,transparent)] px-3.5 py-3 transition hover:bg-[var(--bg-hover)]"><span className="block truncate text-[12px] font-semibold text-[var(--text-primary)]">{thread.title}</span><span className="mt-1 block truncate text-[10px] text-[var(--text-tertiary)]">{thread.summaryShort ?? `${thread.messageCount ?? 0} messages`}</span></button>)}</div> : null}
            {workspaces.length > 0 ? <div className="mt-5 flex flex-wrap justify-center gap-2">{workspaces.slice(0, 5).map((workspace) => <button key={workspace._id} type="button" onClick={() => router.push(`/workspace?workspaceId=${encodeURIComponent(workspace._id)}`)} className="rounded-full bg-[var(--bg-secondary)] px-3 py-1.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">{workspace.title}</button>)}</div> : null}
          </div>}
          composer={studio.activeArtifact?.blueprintKey === "thread_reference" ? undefined : <div><LocalThreadTabs /><CommandBar placeholder="Ask Spectra anything…" busy={runEngine.submitting} allowAttachments onStop={runEngine.stop} onSubmit={(value, attachments) => { void runEngine.run(value, attachments); return true; }} menu={<button type="button" onClick={() => selectThread(null)} className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><Plus className="h-4 w-4" />New conversation</button>} context={<span className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]"><MessageSquare className="h-3.5 w-3.5" />{threadId ? "Continue" : "New thread"}</span>} /></div>}
        />
      </section>

      {studio.isOpen && studio.activeArtifact ? <ArtifactStudio mode={studio.mode === "tab" ? "tab" : "split"} artifact={studio.activeArtifact} artifacts={artifacts} tabs={studio.tabs} dirtyIds={studio.dirtyIds} panelWidth={700} sourceLabel="Chat" onClose={studio.closeStudio} onExpand={studio.openTab} onActivateTab={studio.activateTab} onCloseTab={studio.closeTab} onSave={updateArtifact} onDirtyChange={studio.setDirty} /> : null}

      {historyOpen ? <aside className="absolute inset-y-14 right-0 z-40 w-[min(360px,92vw)] overflow-y-auto border-l border-[var(--border-default)] bg-[var(--bg-primary)] p-4 shadow-[-12px_0_30px_rgba(22,18,13,0.08)]">
        <div className="mb-4 flex items-center justify-between"><div><h2 className="text-[13px] font-semibold">Run & thread hub</h2><p className="text-[11px] text-[var(--text-tertiary)]">Hidden results remain inspectable.</p></div><button type="button" onClick={() => setHistoryOpen(false)} className="text-[11px] text-[var(--text-secondary)]">Close</button></div>
        <div className="mb-5 space-y-1">
          {threads.slice(0, 12).map((thread) => <button type="button" key={thread._id} onClick={() => { selectThread(thread._id); setHistoryOpen(false); }} className="flex w-full items-center gap-2 rounded-[7px] px-2 py-2 text-left hover:bg-[var(--bg-hover)]"><MessageSquare className="h-3.5 w-3.5 text-[var(--accent-cyan)]" /><span className="min-w-0 flex-1 truncate text-[11px] font-medium">{thread.title}</span><span className="text-[9px] text-[var(--text-tertiary)]">{thread.messageCount ?? 0}</span></button>)}
        </div>
        <div className="border-t border-[var(--border-subtle)] pt-3 text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--text-tertiary)]">All runs</div>
        <div className="mt-2 space-y-1.5">{history.map((card) => <div key={card._id} className="rounded-[7px] border border-[var(--border-default)] px-3 py-2"><div className="flex items-center gap-2 text-[11px] font-medium"><Clock3 className="h-3 w-3" />{card.title}</div><div className="mt-1 line-clamp-2 text-[10px] leading-4 text-[var(--text-tertiary)]">{card.summary}</div></div>)}</div>
      </aside> : null}
      {spectraSession.activeLocalThreadRunId ? <RunDetailPanel runId={spectraSession.activeLocalThreadRunId} card={runEngine.cards.find((card) => card.runId === spectraSession.activeLocalThreadRunId)} onClose={() => spectraSession.closeLocalThread(spectraSession.activeLocalThreadRunId!)} onSaved={() => spectraSession.closeLocalThread(spectraSession.activeLocalThreadRunId!)} onAction={(card, action, target) => { if (action === "open") spectraSession.clearActivePanel(); void runEngine.onCardAction(card, action, target); }} /> : null}
    </div>
  );
}
