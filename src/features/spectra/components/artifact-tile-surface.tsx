"use client";

import dynamic from "next/dynamic";
import { GripVertical, Maximize2, Plus, X } from "@/components/icons/glyph-icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { StudioSplitPlaceholder } from "./artifact-studio-shell";
import type { SpectraArtifact } from "../data/api";
import type { ApplicationCommandDispatcher } from "../commands/application-dispatcher";
import { getWorkDefinition } from "../work/registry";
import { isArtifactTypeKey } from "../artifacts/registry";
import { presentWork, type PresentedWorkType } from "../artifacts/presentation";
import { spectraBus } from "../events";
import {
  createAutomaticWorkbenchLayout,
  collectWorkbenchTabs,
  enforceWorkbenchMinimums,
  firstWorkbenchPaneId,
  readSharedWorkbenchSession,
  swapWorkbenchPanes,
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
  onArchive?: (artifact: SpectraArtifact) => Promise<void> | void;
  onDirtyChange: (artifactId: string, dirty: boolean) => void;
  onContinueThread?: (threadId: string, title: string) => void;
  onOpenChats?: () => void;
  executeApplicationCommand?: ApplicationCommandDispatcher;
};

const ArtifactStudio = dynamic(
  () => import("./artifact-studio").then((module) => module.ArtifactStudio),
  { loading: () => <StudioSplitPlaceholder /> },
);

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
  onArchive,
  onDirtyChange,
  onContinueThread,
  onOpenChats,
  executeApplicationCommand,
}: ArtifactTileSurfaceProps) {
  const uniqueArtifacts = useMemo(
    () =>
      artifacts.filter(
        (artifact, index, rows) =>
          rows.findIndex((row) => row._id === artifact._id) === index,
      ),
    [artifacts],
  );
  const order = useSpectraContextStore((state) => state.tileArtifactIds);
  const moveTileBefore = useSpectraContextStore(
    (state) => state.moveTileBefore,
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const stageRef = useRef<HTMLElement | null>(null);
  const [inlineSize, setInlineSize] = useState(1200);
  const visibleArtifacts = useMemo(
    () =>
      [...uniqueArtifacts].sort(
        (a, b) =>
          (order.indexOf(a._id) < 0 ? 999 : order.indexOf(a._id)) -
          (order.indexOf(b._id) < 0 ? 999 : order.indexOf(b._id)),
      ),
    [order, uniqueArtifacts],
  );
  const workbenchTabs = useMemo(
    () =>
      visibleArtifacts.map((artifact) => {
        const responsive = isArtifactTypeKey(artifact.blueprintKey)
          ? getWorkDefinition(artifact.blueprintKey).responsive
          : { minInlineSize: 320, preferredInlineSize: 640 };
        return {
          id: artifact._id,
          title: artifact.title,
          minInlineSize: responsive.minInlineSize,
          preferredInlineSize: responsive.preferredInlineSize,
        };
      }),
    [visibleArtifacts],
  );
  const automaticLayout = useMemo(
    () => createAutomaticWorkbenchLayout(workbenchTabs),
    [workbenchTabs],
  );
  // Which works are laid out, not their order: a tile moved by hand keeps the layout it was moved in.
  const tabSignature = workbenchTabs.map((tab) => tab.id).sort().join(":");
  const [layout, setLayout] = useState<WorkbenchNode | null>(null);
  const [fallbackLayout, setFallbackLayout] = useState<WorkbenchNode | null>(
    null,
  );
  useEffect(() => {
    const session = readSharedWorkbenchSession(window.localStorage);
    const storedIds = session.openPanes
      ? collectWorkbenchTabs(session.openPanes)
          .map((tab) => tab.id)
          .sort()
          .join(":")
      : "";
    const nextIds = workbenchTabs
      .map((tab) => tab.id)
      .sort()
      .join(":");
    setLayout(
      session.openPanes &&
        storedIds === nextIds &&
        validateWorkbenchTree(session.openPanes).length === 0
        ? session.openPanes
        : automaticLayout,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the works laid out are represented by tabSignature
  }, [tabSignature]);
  useEffect(() => {
    if (!layout) return;
    const session = readSharedWorkbenchSession(window.localStorage);
    writeSharedWorkbenchSession(window.localStorage, {
      ...session,
      openPanes: layout,
      activePaneId: firstWorkbenchPaneId(layout),
    });
  }, [layout]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setInlineSize(entry?.contentRect.width ?? 1200),
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  const fittedLayout = useMemo(
    () => (layout ? enforceWorkbenchMinimums(layout, inlineSize) : null),
    [inlineSize, layout],
  );
  const minimumFallback = Boolean(
    layout?.type === "split" && fittedLayout?.type === "pane",
  );
  const renderedLayout =
    minimumFallback && fallbackLayout ? fallbackLayout : fittedLayout;
  useEffect(() => setFallbackLayout(null), [inlineSize, layout]);

  // A tile dropped on another trades places with it, and the order follows.
  function dropOn(event: DragEvent, targetId: string) {
    if (!draggingId) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTargetId(null);
    if (draggingId === targetId) return;
    setLayout((current) => (current ? swapWorkbenchPanes(current, draggingId, targetId) : current));
    moveTileBefore(draggingId, targetId);
  }

  function safeClose(artifactId: string) {
    if (dirtyIds.has(artifactId)) {
      void spectraBus.command("work.requestClose", { workId: artifactId });
      return;
    }
    onCloseArtifact(artifactId);
  }

  function safeCloseAll() {
    const dirty = visibleArtifacts.find((artifact) =>
      dirtyIds.has(artifact._id),
    );
    if (dirty) {
      void spectraBus.command("work.requestClose", { workId: dirty._id });
      return;
    }
    onCloseAll();
  }

  if (visibleArtifacts.length === 0) return null;

  return (
    <section
      ref={stageRef}
      className={
        isolated
          ? "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-primary)]"
          : "absolute inset-0 z-panel flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--bg-primary)]"
      }
      aria-label={isolated ? "Focused work set" : "Workbench split layout"}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-spectra-artifact"))
          event.preventDefault();
      }}
      onDrop={(event) => {
        const artifactId =
          event.dataTransfer.getData("application/x-spectra-artifact") ||
          event.dataTransfer.getData("text/plain");
        if (
          artifactId &&
          allArtifacts.some((artifact) => artifact._id === artifactId)
        ) {
          event.preventDefault();
          onAddArtifact?.(artifactId);
        }
      }}
    >
      <div className="flex h-10 shrink-0 items-center justify-end gap-1 border-b border-[var(--border-default)] bg-[var(--bg-elevated)] px-2">
        {actionSlot}
        {onAddArtifact ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setAddOpen((value) => !value)}
              className="flex h-9 w-9 items-center justify-center rounded-control text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="Add work to tiled set"
              aria-expanded={addOpen}
            >
              <Plus className="h-4 w-4" />
            </button>
            {addOpen ? (
              <AddWorkPicker
                artifacts={allArtifacts.filter((artifact) => !visibleArtifacts.some((visible) => visible._id === artifact._id))}
                onPick={(artifactId) => {
                  onAddArtifact(artifactId);
                  setAddOpen(false);
                }}
                onClose={() => setAddOpen(false)}
              />
            ) : null}
          </div>
        ) : null}
        {isolated ? null : (
          <button
            type="button"
            onClick={onFocusSet}
            className="flex h-9 items-center gap-1.5 rounded-control px-2.5 text-ui font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title="Give these works their own tab"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Expand tiles
          </button>
        )}
        <button
          type="button"
          onClick={safeCloseAll}
          className="flex h-9 w-9 items-center justify-center rounded-control text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          aria-label="Close tiled set"
          title="Close tiled set"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div
        className="flex h-full min-h-0 min-w-0 flex-1"
        data-workbench-valid={
          renderedLayout
            ? validateWorkbenchTree(renderedLayout).length === 0
            : true
        }
      >
        {renderedLayout ? (
          <WorkbenchSplitTree
            node={renderedLayout}
            onChange={minimumFallback ? setFallbackLayout : setLayout}
            showPaneFocus={false}
            chrome="none"
            renderTab={(tab) => {
              const artifact = visibleArtifacts.find(
                (item) => item._id === tab.id,
              )!;
              return (
                <div
                  onDragOver={(event) => {
                    if (!draggingId) return;
                    event.preventDefault();
                    setDropTargetId(artifact._id === draggingId ? null : artifact._id);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTargetId(null);
                  }}
                  onDrop={(event) => dropOn(event, artifact._id)}
                  data-dragging={draggingId === artifact._id || undefined}
                  data-drop-target={dropTargetId === artifact._id || undefined}
                  className="tile-slot relative flex h-full min-h-0 min-w-0 flex-1"
                >
                  {visibleArtifacts.length > 1 ? (
                    <span
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("application/x-spectra-tile", artifact._id);
                        const tile = event.currentTarget.parentElement;
                        if (tile) event.dataTransfer.setDragImage(tile, 24, 24);
                        setDraggingId(artifact._id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDropTargetId(null);
                      }}
                      className="tile-grip"
                      title="Drag onto another work to trade places"
                      aria-hidden
                    >
                      <GripVertical className="h-3.5 w-3.5 rotate-90" />
                    </span>
                  ) : null}
                  <ArtifactStudio
                    mode="tab"
                    compact={false}
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
                    onArchive={onArchive}
                    onDirtyChange={onDirtyChange}
                  onContinueThread={onContinueThread}
                  onOpenChats={onOpenChats}
                    continuedThreadId={continuedThreadId}
                    executeApplicationCommand={executeApplicationCommand}
                  />
                </div>
              );
            }}
          />
        ) : null}
      </div>
    </section>
  );
}

/** The works that can join the set, found by name; Escape or a click away closes it. */
function AddWorkPicker({
  artifacts,
  onPick,
  onClose,
}: {
  artifacts: SpectraArtifact[];
  onPick: (artifactId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (!rootRef.current?.parentElement?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [onClose]);
  const term = query.trim().toLowerCase();
  const found = term ? artifacts.filter((artifact) => artifact.title.toLowerCase().includes(term)) : artifacts;
  return (
    <div
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="absolute right-0 top-[calc(100%+7px)] z-dropdown flex max-h-[340px] w-[280px] flex-col overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-hover"
    >
      <input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && found[0]) onPick(found[0]._id);
        }}
        placeholder="Find a work to add"
        aria-label="Find a work to add"
        className="h-10 shrink-0 border-b border-[var(--border-subtle)] bg-transparent px-3 text-ui text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {found.map((artifact) => (
          <button
            key={artifact._id}
            type="button"
            onClick={() => onPick(artifact._id)}
            className="flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left transition hover:bg-[var(--bg-hover)]"
          >
            <span className="min-w-0 flex-1 truncate text-ui text-[var(--text-primary)]">{artifact.title}</span>
            <span className="text-micro text-[var(--text-tertiary)]">{presentWork(artifact.blueprintKey as PresentedWorkType, artifact.title)?.label}</span>
          </button>
        ))}
        {found.length === 0 ? (
          <p className="px-2.5 py-3 text-caption text-[var(--text-tertiary)]">
            {artifacts.length ? "No work by that name." : "Every work is already here."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
