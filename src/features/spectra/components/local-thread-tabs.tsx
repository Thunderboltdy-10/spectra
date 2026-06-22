"use client";

import { Loader2, MessageSquare, MessageSquarePlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useSpectraSession } from "@/context/spectra-session-context";
import { postSpectra } from "../data/api";

type ContinuedThread = { threadId: string; title: string; runId: string };

export function LocalThreadTabs({
  activeThreadId,
  activeRunId,
  onContinue,
  onOpen,
}: {
  activeThreadId?: string | null;
  activeRunId?: string | null;
  onContinue?: (thread: ContinuedThread | null) => void;
  onOpen?: (runId: string) => void;
}) {
  const session = useSpectraSession();
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [threadIds, setThreadIds] = useState<Record<string, string>>({});
  if (session.localThreads.length === 0) return null;

  async function toggleContinuation(runId: string, title: string) {
    const knownThreadId = threadIds[runId];
    if ((knownThreadId && activeThreadId === knownThreadId) || activeRunId === runId) {
      onContinue?.(null);
      return;
    }
    setBusyRunId(runId);
    try {
      const threadId = knownThreadId ?? (await postSpectra<{ threadId: string }>({
        action: "keepRunAsThread",
        runId,
        placeInWorkspace: false,
        createReference: false,
        localMessages: session.localThreads.find((thread) => thread.runId === runId)?.messages ?? [],
      })).threadId;
      setThreadIds((current) => ({ ...current, [runId]: threadId }));
      onContinue?.({ threadId, title, runId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not continue this chat.");
    } finally {
      setBusyRunId(null);
    }
  }

  return (
    <div className="mb-1.5 ml-[52px] flex max-w-[calc(100%-52px)] gap-1.5 overflow-x-auto pb-1">
      {session.localThreads.map((thread) => {
        const continued = activeRunId === thread.runId || Boolean(threadIds[thread.runId] && threadIds[thread.runId] === activeThreadId);
        const panelOpen = session.activeLocalThreadRunId === thread.runId;
        return (
          <div
            key={thread.runId}
            className={`group flex h-8 min-w-[140px] max-w-[270px] animate-in items-center gap-1 rounded-[8px] px-1 text-[10px] transition-all duration-200 fade-in slide-in-from-bottom-1 ${continued ? "bg-[color-mix(in_oklab,#8b6ff0_10%,var(--bg-elevated))] text-[var(--text-primary)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,#8b6ff0_28%,transparent),0_2px_10px_rgba(27,20,12,0.06)]" : panelOpen ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "bg-[color-mix(in_oklab,var(--bg-elevated)_60%,transparent)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"}`}
          >
            <button type="button" onClick={() => onOpen ? onOpen(thread.runId) : session.activateLocalThread(thread.runId)} className="flex min-w-0 flex-1 items-center gap-2 px-1.5" title={`Open ${thread.title}`}>
              <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${continued ? "text-[#8b6ff0]" : "text-[var(--text-tertiary)]"}`} />
              <span className="min-w-0 flex-1 truncate text-left">{thread.title}</span>
            </button>
            {onContinue ? (
              <button
                type="button"
                disabled={busyRunId === thread.runId}
                onClick={() => void toggleContinuation(thread.runId, thread.title)}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] transition ${continued ? "bg-[color-mix(in_oklab,#8b6ff0_14%,transparent)] text-[#7256dc]" : "text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"}`}
                aria-label={continued ? "Stop continuing this chat" : "Continue chat"}
                title={continued ? "Stop continuing chat" : "Continue chat"}
              >
                {busyRunId === thread.runId ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquarePlus className="h-3 w-3" />}
              </button>
            ) : null}
            <button type="button" onClick={() => session.closeLocalThread(thread.runId)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]" aria-label="Close temporary conversation" title="Close">
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
