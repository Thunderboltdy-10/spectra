"use client";

import { MessageSquare, X } from "lucide-react";
import { useSpectraSession } from "@/context/spectra-session-context";

export function LocalThreadTabs() {
  const session = useSpectraSession();
  if (session.localThreads.length === 0) return null;
  return <div className="mb-1.5 ml-[52px] flex max-w-[calc(100%-52px)] gap-1.5 overflow-x-auto pb-1">{session.localThreads.map((thread) => <button key={thread.runId} type="button" onClick={() => session.activateLocalThread(thread.runId)} className={`group flex h-8 min-w-[120px] max-w-[230px] items-center gap-2 rounded-[8px] px-2.5 text-[10px] transition ${session.activeLocalThreadRunId === thread.runId ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_2px_8px_rgba(27,20,12,0.08)]" : "bg-[color-mix(in_oklab,var(--bg-elevated)_60%,transparent)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"}`} title={thread.title}><MessageSquare className="h-3.5 w-3.5 shrink-0 text-[#8b6ff0]" /><span className="min-w-0 flex-1 truncate text-left">{thread.title}</span><span role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); session.closeLocalThread(thread.runId); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); session.closeLocalThread(thread.runId); } }} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"><X className="h-3 w-3" /></span></button>)}</div>;
}
