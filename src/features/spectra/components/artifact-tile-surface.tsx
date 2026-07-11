"use client";

import { GripVertical, Maximize2, PanelRightClose, Plus, Scaling, X } from "lucide-react";
import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import type { ArtifactPayload } from "./artifact-blueprint-sheet";
import { ArtifactStudio } from "./artifact-studio";
import type { SpectraArtifact } from "../data/api";

type ArtifactTileSurfaceProps = {
  artifacts: SpectraArtifact[];
  allArtifacts: SpectraArtifact[];
  dirtyIds: Set<string>;
  busyArtifactId?: string | null;
  sourceLabel: string;
  isolated?: boolean;
  actionSlot?: ReactNode;
  continuedThreadId?: string | null;
  onCloseArtifact: (artifactId: string) => void;
  onCloseAll: () => void;
  onAddArtifact?: (artifactId: string) => void;
  onFocusSet: () => void;
  onExitFocusSet: () => void;
  onSave: (artifactId: string, payload: ArtifactPayload) => Promise<void> | void;
  onRevert: (artifactId: string, versionId: string) => Promise<void> | void;
  onArchive?: (artifact: SpectraArtifact) => Promise<void> | void;
  onDirtyChange: (artifactId: string, dirty: boolean) => void;
  onContinueThread?: (threadId: string, title: string) => void;
};

export function ArtifactTileSurface({
  artifacts,
  allArtifacts,
  dirtyIds,
  busyArtifactId,
  sourceLabel,
  isolated = false,
  actionSlot,
  continuedThreadId,
  onCloseArtifact,
  onCloseAll,
  onAddArtifact,
  onFocusSet,
  onExitFocusSet,
  onSave,
  onRevert,
  onArchive,
  onDirtyChange,
  onContinueThread,
}: ArtifactTileSurfaceProps) {
  const uniqueArtifacts = useMemo(
    () => artifacts.filter((artifact, index, rows) => rows.findIndex((row) => row._id === artifact._id) === index),
    [artifacts],
  );
  const order = useSpectraContextStore((state) => state.tileArtifactIds);
  const sizes = useSpectraContextStore((state) => state.tileSizes);
  const moveTileBefore = useSpectraContextStore((state) => state.moveTileBefore);
  const cycleTileSize = useSpectraContextStore((state) => state.cycleTileSize);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const visibleArtifacts = useMemo(() => [...uniqueArtifacts].sort((a, b) => (order.indexOf(a._id) < 0 ? 999 : order.indexOf(a._id)) - (order.indexOf(b._id) < 0 ? 999 : order.indexOf(b._id))), [order, uniqueArtifacts]);

  function moveBefore(event: DragEvent, targetId: string) {
    event.preventDefault();
    if (!draggingId || draggingId === targetId) return;
    moveTileBefore(draggingId, targetId);
  }

  function safeClose(artifactId: string) {
    if (dirtyIds.has(artifactId)) {
      window.dispatchEvent(new CustomEvent("spectra:request-artifact-close", { detail: { artifactId } }));
      return;
    }
    onCloseArtifact(artifactId);
  }

  function safeCloseAll() {
    const dirty = visibleArtifacts.find((artifact) => dirtyIds.has(artifact._id));
    if (dirty) {
      window.dispatchEvent(new CustomEvent("spectra:request-artifact-close", { detail: { artifactId: dirty._id } }));
      return;
    }
    onCloseAll();
  }

  if (visibleArtifacts.length === 0) return null;

  return (
    <section
      className={isolated
        ? "relative min-w-0 flex-1 overflow-hidden bg-[var(--bg-primary)]"
        : "fixed inset-2 z-[70] flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-[0_24px_70px_rgba(27,20,12,0.18)] md:absolute md:inset-y-3 md:left-auto md:right-3 md:w-[min(72vw,1120px)] xl:inset-y-0 xl:right-0 xl:w-[min(62vw,1120px)] xl:rounded-none xl:border-y-0 xl:border-r-0"}
      aria-label={isolated ? "Focused work set" : "Tiled artifact set"}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-spectra-artifact")) event.preventDefault(); }}
      onDrop={(event) => { const artifactId = event.dataTransfer.getData("application/x-spectra-artifact") || event.dataTransfer.getData("text/plain"); if (artifactId && allArtifacts.some((artifact) => artifact._id === artifactId)) { event.preventDefault(); onAddArtifact?.(artifactId); } }}
    >
      <div className="absolute right-3 top-3 z-50 flex items-center gap-1 rounded-[9px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_92%,transparent)] p-1 shadow-[0_8px_24px_rgba(27,20,12,0.12)] backdrop-blur-xl">
        {actionSlot}
        {onAddArtifact ? <div className="relative"><button type="button" onClick={() => setAddOpen((value) => !value)} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" aria-label="Add artifact to tiled set" aria-expanded={addOpen}><Plus className="h-4 w-4" /></button>{addOpen ? <div className="absolute right-0 top-[calc(100%+7px)] max-h-[280px] w-[260px] overflow-y-auto rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_16px_38px_rgba(27,20,12,0.15)]">{allArtifacts.filter((artifact) => !visibleArtifacts.some((visible) => visible._id === artifact._id)).map((artifact) => <button key={artifact._id} type="button" onClick={() => { onAddArtifact(artifact._id); setAddOpen(false); }} className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left hover:bg-[var(--bg-hover)]"><span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-primary)]">{artifact.title}</span><span className="text-[9px] capitalize text-[var(--text-tertiary)]">{artifact.blueprintKey.replaceAll("_", " ")}</span></button>)}{allArtifacts.every((artifact) => visibleArtifacts.some((visible) => visible._id === artifact._id)) ? <div className="px-2.5 py-3 text-[11px] text-[var(--text-tertiary)]">Every available artifact is already open.</div> : null}</div> : null}</div> : null}
        <button type="button" onClick={isolated ? onExitFocusSet : onFocusSet} className="flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" title={isolated ? "Return to workspace with these tiles still available" : "Expand tiled workspace"}>
          {isolated ? <PanelRightClose className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          {isolated ? "Return" : "Expand tiles"}
        </button>
        <button type="button" onClick={safeCloseAll} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" aria-label="Close tiled set" title="Close tiled set">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-[minmax(420px,1fr)] grid-cols-1 gap-2 overflow-auto p-2 pt-14 md:grid-cols-12">
        {visibleArtifacts.map((artifact) => (
          <div key={artifact._id} draggable onDragStart={() => setDraggingId(artifact._id)} onDragEnd={() => setDraggingId(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => moveBefore(event, artifact._id)} className={`relative flex min-h-[420px] min-w-0 overflow-hidden rounded-[9px] border bg-[var(--bg-primary)] shadow-[0_8px_28px_rgba(27,20,12,0.05)] transition ${sizes[artifact._id] === "wide" ? "md:col-span-12" : "md:col-span-6"} ${sizes[artifact._id] === "tall" ? "md:row-span-2" : ""} ${draggingId === artifact._id ? "scale-[0.985] border-[var(--accent-cyan)] opacity-65" : "border-[var(--border-default)]"}`}>
            <span className="absolute left-2 top-2 z-30 flex h-7 w-7 cursor-grab items-center justify-center rounded-[7px] bg-[color-mix(in_oklab,var(--bg-primary)_88%,transparent)] text-[var(--text-tertiary)] shadow-[0_4px_12px_rgba(27,20,12,0.08)]" title="Drag to rearrange"><GripVertical className="h-3.5 w-3.5" /></span>
            <button type="button" onClick={() => cycleTileSize(artifact._id)} className="absolute right-10 top-2 z-30 flex h-7 w-7 items-center justify-center rounded-[7px] bg-[color-mix(in_oklab,var(--bg-primary)_88%,transparent)] text-[var(--text-tertiary)] shadow-[0_4px_12px_rgba(27,20,12,0.08)] hover:bg-[var(--bg-hover)]" aria-label={`Resize ${artifact.title}`} title="Cycle tile size"><Scaling className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => safeClose(artifact._id)} className="absolute right-2 top-2 z-30 flex h-7 w-7 items-center justify-center rounded-[7px] bg-[color-mix(in_oklab,var(--bg-primary)_88%,transparent)] text-[var(--text-tertiary)] shadow-[0_4px_12px_rgba(27,20,12,0.08)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" aria-label={`Close ${artifact.title}`} title={`Close ${artifact.title}`}>
              <X className="h-3.5 w-3.5" />
            </button>
            <ArtifactStudio
              mode="tab"
              artifact={artifact}
              artifacts={allArtifacts}
              tabs={[]}
              dirtyIds={dirtyIds}
              busy={busyArtifactId === artifact._id}
              sourceLabel={sourceLabel}
              onClose={() => safeClose(artifact._id)}
              onExpand={() => undefined}
              onActivateTab={() => undefined}
              onCloseTab={onCloseArtifact}
              onSave={onSave}
              onRevert={onRevert}
              onArchive={onArchive}
              onDirtyChange={onDirtyChange}
              onContinueThread={onContinueThread}
              continuedThreadId={continuedThreadId}
            />
          </div>
        ))}
        {visibleArtifacts.length < 2 ? (
          <div className="flex min-h-[220px] items-center justify-center rounded-[9px] border border-dashed border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_48%,transparent)] text-[12px] text-[var(--text-secondary)]">
            <Plus className="mr-2 h-4 w-4 text-[var(--text-tertiary)]" />
            Select more artifacts to expand this set.
          </div>
        ) : null}
      </div>
    </section>
  );
}
