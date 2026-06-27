"use client";

import { Layers3, Maximize2, PanelRightClose, Plus, X } from "lucide-react";
import { useMemo, type ReactNode } from "react";
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
  onFocusSet: () => void;
  onExitFocusSet: () => void;
  onSave: (artifactId: string, payload: ArtifactPayload) => Promise<void> | void;
  onRevert: (artifactId: string, versionId: string) => Promise<void> | void;
  onArchive?: (artifact: SpectraArtifact) => Promise<void> | void;
  onDirtyChange: (artifactId: string, dirty: boolean) => void;
  onContinueThread?: (threadId: string, title: string) => void;
};

function gridClass(count: number) {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 2xl:grid-cols-2";
  return "grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3";
}

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
  onFocusSet,
  onExitFocusSet,
  onSave,
  onRevert,
  onArchive,
  onDirtyChange,
  onContinueThread,
}: ArtifactTileSurfaceProps) {
  const visibleArtifacts = useMemo(
    () => artifacts.filter((artifact, index, rows) => rows.findIndex((row) => row._id === artifact._id) === index).slice(0, 8),
    [artifacts],
  );

  if (visibleArtifacts.length === 0) return null;

  return (
    <section
      className={isolated
        ? "min-w-0 flex-1 overflow-hidden bg-[var(--bg-primary)]"
        : "hidden min-w-[520px] max-w-[62vw] flex-[0_0_56vw] overflow-hidden border-l border-[var(--border-default)] bg-[var(--bg-primary)] shadow-[-18px_0_40px_rgba(27,20,12,0.06)] xl:flex xl:flex-col"}
      aria-label={isolated ? "Focused work set" : "Tiled artifact set"}
    >
      <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_64%,var(--bg-primary))] px-3.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-primary))] text-[var(--accent-cyan)]">
          <Layers3 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{isolated ? "Focused work set" : "Tiled selection"}</div>
          <div className="truncate text-[10px] text-[var(--text-tertiary)]">{visibleArtifacts.length} artifact{visibleArtifacts.length === 1 ? "" : "s"} open together</div>
        </div>
        {actionSlot}
        <button type="button" onClick={isolated ? onExitFocusSet : onFocusSet} className="flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" title={isolated ? "Return to workspace with this set still available" : "Focus this set"}>
          {isolated ? <PanelRightClose className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          {isolated ? "Return" : "Focus this set"}
        </button>
        <button type="button" onClick={onCloseAll} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" aria-label="Close tiled set" title="Close tiled set">
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className={`grid min-h-0 flex-1 gap-2 overflow-auto p-2 ${gridClass(visibleArtifacts.length)}`}>
        {visibleArtifacts.map((artifact) => (
          <div key={artifact._id} className="relative flex min-h-[520px] min-w-0 overflow-hidden rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-[0_8px_28px_rgba(27,20,12,0.05)]">
            <button type="button" onClick={() => onCloseArtifact(artifact._id)} className="absolute right-2 top-2 z-30 flex h-7 w-7 items-center justify-center rounded-[7px] bg-[color-mix(in_oklab,var(--bg-primary)_88%,transparent)] text-[var(--text-tertiary)] shadow-[0_4px_12px_rgba(27,20,12,0.08)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" aria-label={`Close ${artifact.title}`} title={`Close ${artifact.title}`}>
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
              onClose={() => onCloseArtifact(artifact._id)}
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
