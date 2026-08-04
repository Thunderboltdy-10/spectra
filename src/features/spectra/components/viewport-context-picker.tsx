"use client";

import { Check, Crosshair, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { contextSourceRegistry, type ContextSourceRegistration } from "../context";
import { spectraBus } from "../events";

export function ViewportContextPicker() {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<{ kind: "context" } | { kind: "reference"; hostWorkId: string }>({ kind: "context" });
  const [entries, setEntries] = useState<ContextSourceRegistration[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const addExplicit = useSpectraContextStore((state) => state.addExplicit);
  const selected = useSpectraContextStore((state) => state.explicit);

  useEffect(() => contextSourceRegistry.subscribe(() => setEntries(contextSourceRegistry.listEligible())), []);
  useEffect(() => spectraBus.handle("context.beginPicking", () => { setIntent({ kind: "context" }); setEntries(contextSourceRegistry.listEligible()); setOpen(true); }), []);
  useEffect(() => spectraBus.handle("reference.beginPicking", ({ hostWorkId }) => { setIntent({ kind: "reference", hostWorkId }); setEntries(contextSourceRegistry.listEligible().filter((entry) => entry.anchor.workId !== hostWorkId)); setOpen(true); }), []);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);
  useEffect(() => {
    const entry = hovered ? contextSourceRegistry.get(hovered) : null;
    const element = entry?.element?.();
    if (!element) return;
    const priorOutline = element.style.outline;
    const priorOffset = element.style.outlineOffset;
    element.style.outline = "2px solid var(--accent-cyan)";
    element.style.outlineOffset = "2px";
    return () => { element.style.outline = priorOutline; element.style.outlineOffset = priorOffset; };
  }, [hovered]);

  async function selectEntry(entry: ContextSourceRegistration) {
    if (intent.kind === "reference") {
      spectraBus.command("reference.insert", { hostWorkId: intent.hostWorkId, target: entry.anchor });
      setOpen(false);
      return;
    }
    const summary = await entry.contextSummary().catch(() => ({ title: entry.label, text: entry.label }));
    addExplicit({
      type: "artifact",
      id: entry.anchor.workId,
      label: entry.label,
      workspaceId: entry.workspaceId,
      source: "explicit",
      capability: "context",
      semanticTargetId: entry.id,
      semanticAnchor: {
        workId: entry.anchor.workId,
        workType: entry.anchor.workType,
        kind: entry.anchor.kind,
        path: [...entry.anchor.path],
        ...(entry.anchor.stableIds ? { stableIds: { ...entry.anchor.stableIds } } : {}),
        ...(entry.anchor.fallbackExcerpt ? { fallbackExcerpt: entry.anchor.fallbackExcerpt } : {}),
        ...(entry.anchor.relativePosition ? { relativePosition: Array.from(entry.anchor.relativePosition) } : {}),
        schemaVersion: entry.anchor.schemaVersion,
      },
      contextSummary: summary.text.slice(0, 4_000),
    });
    setOpen(false);
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[130] bg-[color-mix(in_oklab,var(--text-primary)_10%,transparent)]" role="dialog" aria-modal="true" aria-label={intent.kind === "reference" ? "Pick referenced work from page" : "Pick context from page"} onPointerDown={() => setOpen(false)}>
      <div className="absolute bottom-5 left-1/2 w-[min(520px,calc(100vw-24px))] -translate-x-1/2 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[0_20px_60px_rgba(27,20,12,.2)]" onPointerDown={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2"><Crosshair className="h-4 w-4 text-[var(--accent-cyan)]" /><strong className="text-[12px]">{intent.kind === "reference" ? "Reference visible work" : "Pick from page"}</strong><span className="ml-auto text-micro text-[var(--text-tertiary)]">Esc to cancel</span><button type="button" onClick={() => setOpen(false)} aria-label="Cancel semantic picking"><X className="h-4 w-4" /></button></div>
        <div className="mt-2 max-h-[280px] space-y-1 overflow-y-auto">
          {entries.map((entry) => {
            const included = intent.kind === "context" && selected.some((item) => item.semanticTargetId === entry.id);
            return <button key={entry.id} type="button" onPointerEnter={() => setHovered(entry.id)} onPointerLeave={() => setHovered(null)} onClick={() => void selectEntry(entry)} className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left hover:bg-[var(--bg-hover)]"><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium text-[var(--text-primary)]">{entry.label}</span><span className="block truncate text-micro text-[var(--text-tertiary)]">{entry.type}</span></span>{included ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : null}</button>;
          })}
          {entries.length === 0 ? <p className="px-3 py-6 text-center text-micro text-[var(--text-secondary)]">No eligible semantic targets are visible.</p> : null}
        </div>
      </div>
    </div>
  );
}
