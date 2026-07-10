"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, CheckCircle2, Loader2, MessageSquare, ShieldCheck, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { getSpectraRunTabs, postSpectra, type SpectraRunTab } from "../data/api";

const activeStatuses = new Set(["queued", "running", "awaiting_confirmation"]);

export function DurableRunTabs({ workspaceId, onOpen, onStop }: { workspaceId?: string; onOpen?: (runId: string, threadId: string, title: string) => void; onStop?: (runId: string) => void }) {
  const [tabs, setTabs] = useState<SpectraRunTab[]>([]);
  const reduceMotion = useReducedMotion();
  const continuation = useSpectraContextStore((state) => state.continuation);
  const setContinuation = useSpectraContextStore((state) => state.setContinuation);
  const hydratedSelection = useRef(false);
  const refresh = useCallback(() => getSpectraRunTabs({ limit: 120 }).then((value) => setTabs(value.runTabs)).catch(() => undefined), []);
  useEffect(() => { void refresh(); const handler = () => void refresh(); window.addEventListener("spectra:threads-changed", handler); return () => window.removeEventListener("spectra:threads-changed", handler); }, [refresh]);
  useEffect(() => {
    if (hydratedSelection.current || tabs.length === 0) return;
    hydratedSelection.current = true;
    if (continuation) return;
    const selected = tabs.find((tab) => tab.selected && !tab.hiddenAt);
    if (selected) setContinuation({ id: selected.threadId, title: selected.thread.title, runId: selected.runId, workspaceId: selected.workspaceId });
  }, [continuation, setContinuation, tabs]);
  const hasActive = tabs.some((tab) => activeStatuses.has(tab.run.status));
  useEffect(() => { if (!hasActive) return; const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 900); return () => window.clearInterval(timer); }, [hasActive, refresh]);
  const visible = useMemo(() => tabs.filter((tab) => !workspaceId || tab.workspaceId === workspaceId || !tab.workspaceId), [tabs, workspaceId]);
  if (visible.length === 0) return null;
  return <div className="mb-1.5 flex max-h-[82px] flex-wrap gap-1.5 overflow-y-auto px-0.5 py-0.5 [scrollbar-width:thin]" aria-label="Open Spectra runs" aria-live="polite">
    <AnimatePresence initial={false}>{visible.map((tab) => {
      const active = continuation?.id === tab.threadId;
      const running = tab.run.status === "queued" || tab.run.status === "running";
      const approval = tab.run.status === "awaiting_confirmation";
      const failed = tab.run.status === "failed" || tab.run.status === "cancelled";
      const Icon = running ? Loader2 : approval ? ShieldCheck : failed ? AlertCircle : CheckCircle2;
      return <motion.div key={tab._id} layout={!reduceMotion} initial={reduceMotion ? false : { opacity: 0, x: -12, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0, scale: 0.94 }} transition={reduceMotion ? { duration: 0 } : undefined} className={`group relative flex h-9 max-w-[250px] items-center overflow-hidden rounded-[9px] border bg-[color-mix(in_oklab,var(--bg-elevated)_94%,transparent)] shadow-[0_4px_14px_-10px_rgba(14,142,232,0.65)] ${active ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))]" : "border-[var(--border-default)]"}`} data-run-status={tab.run.status}>
        {running ? <span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 animate-[spectra-tab-sweep_1.8s_ease-in-out_infinite] bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--accent-cyan)_12%,transparent),transparent)] motion-reduce:hidden" /> : null}
        <button type="button" onClick={() => { const next = active ? null : { id: tab.threadId, title: tab.thread.title, runId: tab.runId, workspaceId: tab.workspaceId }; setContinuation(next); void postSpectra({ action: "selectRunTab", runId: next ? tab.runId : undefined }).then(refresh); onOpen?.(tab.runId, tab.threadId, tab.thread.title); }} className="relative flex min-w-0 flex-1 items-center gap-2 px-2.5 text-left" aria-pressed={active} title={active ? "Stop continuing this conversation" : `Continue ${tab.thread.title}`}><Icon className={`h-3.5 w-3.5 shrink-0 ${running ? "animate-spin text-[var(--accent-cyan)]" : approval ? "text-[var(--warning)]" : failed ? "text-[var(--danger)]" : "text-[var(--success)]"}`} /><span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-semibold text-[var(--text-primary)]">{tab.thread.title || "New thread"}</span><span className="block truncate text-[8px] capitalize text-[var(--text-tertiary)]">{(tab.run.phase ?? tab.run.status).replaceAll("_", " ")}</span></span>{active ? <MessageSquare className="h-3 w-3 shrink-0 text-[var(--accent-cyan)]" /> : null}</button>
        {running && onStop ? <button type="button" onClick={() => onStop(tab.runId)} className="flex h-9 w-9 items-center justify-center text-[var(--danger)] opacity-70 hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] hover:opacity-100 focus-visible:opacity-100" aria-label={`Stop ${tab.thread.title}`}><Square className="h-3 w-3" /></button> : null}
        <button type="button" onClick={() => { if (active) setContinuation(null); void postSpectra({ action: "hideRunTab", runId: tab.runId }).then(refresh); }} className="flex h-9 w-9 items-center justify-center text-[var(--text-tertiary)] opacity-60 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] hover:opacity-100 focus-visible:opacity-100" aria-label={`Close ${tab.thread.title} tab`}><X className="h-3 w-3" /></button>
      </motion.div>;
    })}</AnimatePresence>
  </div>;
}
