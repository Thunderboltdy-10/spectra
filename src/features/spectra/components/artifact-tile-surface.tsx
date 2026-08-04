"use client";

import { GripVertical, Maximize2, PanelRightClose, Plus, Scaling, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { ArtifactStudio } from "./artifact-studio";
import type { SpectraArtifact } from "../data/api";
import { getWorkDefinition } from "../work/registry";
import { isArtifactTypeKey } from "../artifacts/registry";
import {
  createAutomaticWorkbenchLayout,
  collectWorkbenchTabs,
  enforceWorkbenchMinimums,
  firstWorkbenchPaneId,
  readSharedWorkbenchSession,
  writeSharedWorkbenchSession,
  validateWorkbenchTree,
  type WorkbenchNode,
} from "../workbench";
import { WorkbenchSplitTree } from "./workbench-split-tree";

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
  onArchive,
  onDirtyChange,
  onContinueThread,
}: ArtifactTileSurfaceProps) {
  const uniqueArtifacts = useMemo(
    () => artifacts.filter((artifact, index, rows) => rows.findIndex((row) => row._id === artifact._id) === index),
    [artifacts],
  );
  const order = useSpectraContextStore((state) => state.tileArtifactIds);
  const moveTileBefore = useSpectraContextStore((state) => state.moveTileBefore);
  const cycleTileSize = useSpectraContextStore((state) => state.cycleTileSize);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const stageRef = useRef<HTMLElement | null>(null);
  const [inlineSize, setInlineSize] = useState(1200);
  const visibleArtifacts = useMemo(() => [...uniqueArtifacts].sort((a, b) => (order.indexOf(a._id) < 0 ? 999 : order.indexOf(a._id)) - (order.indexOf(b._id) < 0 ? 999 : order.indexOf(b._id))), [order, uniqueArtifacts]);
  const workbenchTabs = useMemo(
    () => visibleArtifacts.map((artifact) => {
      const responsive = isArtifactTypeKey(artifact.blueprintKey)
        ? getWorkDefinition(artifact.blueprintKey).responsive
        : { minInlineSize: 320, preferredInlineSize: 640 };
      return { id: artifact._id, title: artifact.title, minInlineSize: responsive.minInlineSize, preferredInlineSize: responsive.preferredInlineSize };
    }),
    [visibleArtifacts],
  );
  const automaticLayout = useMemo(() => createAutomaticWorkbenchLayout(workbenchTabs), [workbenchTabs]);
  const tabSignature = workbenchTabs.map((tab) => tab.id).join(":");
  const [layout, setLayout] = useState<WorkbenchNode | null>(null);
  const [fallbackLayout, setFallbackLayout] = useState<WorkbenchNode | null>(null);
  useEffect(() => {
    const session = readSharedWorkbenchSession(window.localStorage);
    const storedIds = session.openPanes ? collectWorkbenchTabs(session.openPanes).map((tab) => tab.id).sort().join(":") : "";
    const nextIds = workbenchTabs.map((tab) => tab.id).sort().join(":");
    setLayout(session.openPanes && storedIds === nextIds && validateWorkbenchTree(session.openPanes).length === 0 ? session.openPanes : automaticLayout);
  }, [automaticLayout, tabSignature]);
  useEffect(() => {
    if (!layout) return;
    const session = readSharedWorkbenchSession(window.localStorage);
    writeSharedWorkbenchSession(window.localStorage, { ...session, openPanes: layout, activePaneId: firstWorkbenchPaneId(layout) });
  }, [layout]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setInlineSize(entry?.contentRect.width ?? 1200));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  const fittedLayout = useMemo(() => layout ? enforceWorkbenchMinimums(layout, inlineSize) : null, [inlineSize, layout]);
  const minimumFallback = Boolean(layout?.type === "split" && fittedLayout?.type === "pane");
  const renderedLayout = minimumFallback && fallbackLayout ? fallbackLayout : fittedLayout;
  useEffect(() => setFallbackLayout(null), [inlineSize, layout]);

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
      ref={stageRef}
      className={isolated
        ? "relative min-w-0 flex-1 overflow-hidden bg-[var(--bg-primary)]"
        : "fixed inset-2 z-[70] flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-[0_24px_70px_rgba(27,20,12,0.18)] md:absolute md:inset-y-3 md:left-auto md:right-3 md:w-[min(72vw,1120px)] xl:inset-y-0 xl:right-0 xl:w-[min(62vw,1120px)] xl:rounded-none xl:border-y-0 xl:border-r-0"}
      aria-label={isolated ? "Focused work set" : "Workbench split layout"}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-spectra-artifact")) event.preventDefault(); }}
      onDrop={(event) => { const artifactId = event.dataTransfer.getData("application/x-spectra-artifact") || event.dataTransfer.getData("text/plain"); if (artifactId && allArtifacts.some((artifact) => artifact._id === artifactId)) { event.preventDefault(); onAddArtifact?.(artifactId); } }}
    >
      <div className="absolute right-3 top-3 z-50 flex items-center gap-1 rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[0_8px_24px_rgba(27,20,12,0.12)]">
        {actionSlot}
        {onAddArtifact ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setAddOpen((value) => !value)}
              className="flex h-9 w-9 items-center justify-center rounded-[8px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="Add work to tiled set"
              aria-expanded={addOpen}
            >
              <Plus className="h-4 w-4" />
            </button>
            {addOpen ? (
              <div className="absolute right-0 top-[calc(100%+7px)] max-h-[280px] w-[260px] overflow-y-auto rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_16px_38px_rgba(27,20,12,0.15)]">
                {allArtifacts
                  .filter(
                    (artifact) =>
                      !visibleArtifacts.some(
                        (visible) => visible._id === artifact._id,
                      ),
                  )
                  .map((artifact) => (
                    <button
                      key={artifact._id}
                      type="button"
                      onClick={() => {
                        onAddArtifact(artifact._id);
                        setAddOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left transition hover:bg-[var(--bg-hover)]"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-primary)]">
                        {artifact.title}
                      </span>
                      <span className="text-[11px] capitalize text-[var(--text-tertiary)]">
                        {artifact.blueprintKey.replaceAll("_", " ")}
                      </span>
                    </button>
                  ))}
                {allArtifacts.every((artifact) =>
                  visibleArtifacts.some(
                    (visible) => visible._id === artifact._id,
                  ),
                ) ? (
                  <div className="px-2.5 py-3 text-[12px] text-[var(--text-tertiary)]">
                    All available work is already open.
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          onClick={isolated ? onExitFocusSet : onFocusSet}
          className="flex h-9 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          title={
            isolated
              ? "Return to workspace with these tiles still available"
              : "Expand tiled workspace"
          }
        >
          {isolated ? (
            <PanelRightClose className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
          {isolated ? "Return" : "Expand tiles"}
        </button>
        <button
          type="button"
          onClick={safeCloseAll}
          className="flex h-9 w-9 items-center justify-center rounded-[8px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          aria-label="Close tiled set"
          title="Close tiled set"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 pt-12" data-workbench-valid={renderedLayout ? validateWorkbenchTree(renderedLayout).length === 0 : true}>
        {renderedLayout ? (
          <WorkbenchSplitTree
            node={renderedLayout}
            onChange={minimumFallback ? setFallbackLayout : setLayout}
            renderTab={(tab) => {
              const artifact = visibleArtifacts.find((item) => item._id === tab.id)!;
              return (
                <div draggable onDragStart={() => setDraggingId(artifact._id)} onDragEnd={() => setDraggingId(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => moveBefore(event, artifact._id)} className={`relative flex h-full min-h-0 min-w-0 ${draggingId === artifact._id ? "opacity-60" : ""}`}>
                  <span className="absolute left-2 top-2 z-30 flex h-7 w-7 cursor-grab items-center justify-center rounded-[7px] bg-[color-mix(in_oklab,var(--bg-primary)_88%,transparent)] text-[var(--text-tertiary)]" title="Drag to rearrange"><GripVertical className="h-3.5 w-3.5" /></span>
                  <button type="button" onClick={() => cycleTileSize(artifact._id)} className="absolute right-2 top-2 z-30 flex h-7 w-7 items-center justify-center rounded-[7px] bg-[var(--bg-primary)] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]" aria-label={`Resize ${artifact.title}`}><Scaling className="h-3.5 w-3.5" /></button>
                  <ArtifactStudio mode="tab" compact artifact={artifact} artifacts={allArtifacts} tabs={[]} dirtyIds={dirtyIds} busy={busyArtifactId === artifact._id} sourceLabel={sourceLabel} onClose={() => safeClose(artifact._id)} onExpand={() => undefined} onActivateTab={() => undefined} onCloseTab={onCloseArtifact} onArchive={onArchive} onDirtyChange={onDirtyChange} onContinueThread={onContinueThread} continuedThreadId={continuedThreadId} />
                </div>
              );
            }}
          />
        ) : null}
      </div>
    </section>
  );
}
