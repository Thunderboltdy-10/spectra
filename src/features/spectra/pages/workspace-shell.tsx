"use client";

import {
  BarChart3,
  BookOpen,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  Atom,
  Brain,
  Calculator,
  ExternalLink,
  FileText,
  Files,
  FlaskConical,
  GraduationCap,
  HelpCircle,
  Home,
  List,
  Loader2,
  MessageSquare,
  Maximize2,
  Minus,
  PanelTop,
  PencilLine,
  Pin,
  Plus,
  Rows3,
  Share2,
  Sparkles,
  Sprout,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { useSpectraRun } from "../ai/use-spectra-run";
import { useSpectraContext } from "../hooks/use-spectra-context";
import {
  createDefaultArtifactPayload,
  type ArtifactPayload,
} from "../components/artifact-blueprint-sheet";
import { ArtifactCard, blueprintMeta } from "../components/artifact-card";
import { ThreadCard } from "../components/thread-card";
import {
  ArtifactStudio,
  StudioTabRail,
  useArtifactStudioState,
} from "../components/artifact-studio";
import { ArtifactTileSurface } from "../components/artifact-tile-surface";
import { CommandBar } from "../components/command-bar";
import {
  ContextFocusControl,
  GlobalSearch,
  SelectionActionBar,
  type ComposerFocusMode,
} from "../components/context-controls";
import { DurableRunTabs } from "../components/durable-run-tabs";
import { RunDetailPanel } from "../components/run-detail-panel";
import { LiveThreadPanel } from "../components/live-thread-panel";
import { ShareDialog } from "../components/share-dialog";
import { ObjectLibrary, type LibraryMode } from "../components/object-library";
import { parseWorkspaceHubTabs } from "../components/workspace-tab-state";
import {
  formatRelativeTime,
  formatShortDate,
  artifactPlacements,
  linkedArtifacts,
  sortSpectraWorkspaces,
  workspaceAccent,
  workspaceArtifactCount,
  workspaceThreadCount,
  workspaceItemToCard,
} from "../components/spectra-view-model";
import {
  getSpectraArtifact,
  getSpectraOverview,
  getSpectraRunDetail,
  getSpectraThread,
  peekSpectraWorkspace,
  getSpectraWorkspace,
  postSpectra,
  type SpectraArtifact,
  type SpectraBlueprintKey,
  type SpectraOverview,
  type SpectraRun,
  type SpectraThread,
  type SpectraWorkspace,
  type SpectraWorkspaceItem,
} from "../data/api";
import type { ArtifactTypeKey } from "../artifacts/types";

type ViewMode = "list" | "board" | "timeline" | "canvas";
type WorkspaceSort = "updated" | "created" | "title" | "type";
type WorkspaceObjectType = SpectraBlueprintKey | "thread";
type Selection =
  | { type: "artifact"; itemId: string; artifactId: string }
  | { type: "thread"; itemId: string; threadId: string }
  | { type: "run"; runId: string }
  | null;
type WorkspaceEntry = {
  item: SpectraWorkspaceItem;
  artifact?: SpectraArtifact;
  thread?: SpectraThread;
  card?: NonNullable<ReturnType<typeof workspaceItemToCard>>;
};
type WorkspaceHubTab = { id: string; label: string; workspaceId?: string };
const EMPTY_ARTIFACTS: SpectraArtifact[] = [];

function workspaceEntryTitle(entry: WorkspaceEntry) {
  return (
    entry.item.viewData.titleOverride ??
    entry.artifact?.title ??
    entry.thread?.title ??
    "Untitled object"
  );
}
function workspaceEntrySummary(entry: WorkspaceEntry) {
  return (
    entry.item.viewData.compactSummary ??
    entry.artifact?.summary ??
    entry.thread?.summaryShort ??
    "No summary yet."
  );
}
function workspaceEntryType(entry: WorkspaceEntry): WorkspaceObjectType {
  return entry.thread ? "thread" : (entry.artifact?.blueprintKey ?? "document");
}
function workspaceEntryCreatedAt(entry: WorkspaceEntry) {
  return (
    entry.artifact?.createdAt ?? entry.thread?.createdAt ?? entry.item.createdAt
  );
}
function workspaceEntryUpdatedAt(entry: WorkspaceEntry) {
  return (
    entry.artifact?.updatedAt ??
    entry.thread?.lastMessageAt ??
    entry.thread?.updatedAt ??
    entry.item.updatedAt
  );
}

function workspaceHubTab(
  label = "Home",
  workspaceId?: string,
): WorkspaceHubTab {
  return {
    id: `workspace-hub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label,
    workspaceId,
  };
}

const createTypes: Array<{
  key: ArtifactTypeKey;
  label: string;
  icon: LucideIcon;
}> = [
  { key: "document", label: "Document", icon: FileText },
  { key: "flashcard_deck", label: "Deck", icon: BookOpen },
  { key: "quiz", label: "Quiz", icon: HelpCircle },
  { key: "planner_task", label: "Task", icon: CalendarCheck2 },
];

const viewModes: Array<{ key: ViewMode; label: string; icon: LucideIcon }> = [
  { key: "list", label: "List", icon: List },
  { key: "board", label: "Board", icon: PanelTop },
  { key: "timeline", label: "Timeline", icon: Rows3 },
  { key: "canvas", label: "Canvas", icon: Sparkles },
];

function iconForWorkspace(workspace: SpectraWorkspace, index: number) {
  if (workspace.icon === "Atom") return Atom;
  if (workspace.icon === "Brain") return Brain;
  if (workspace.icon === "Calculator") return Calculator;
  if (workspace.icon === "FlaskConical") return FlaskConical;
  if (workspace.icon === "GraduationCap") return GraduationCap;
  if (workspace.icon === "Sprout") return Sprout;
  if (workspace.icon === "BookOpen") return BookOpen;
  if (workspace.icon === "BarChart3") return BarChart3;
  if (workspace.icon === "Sparkles") return Sparkles;
  const accent = workspaceAccent(workspace, index);
  if (accent.icon === "leaf") return Sprout;
  if (accent.icon === "bar") return BarChart3;
  if (accent.icon === "book") return BookOpen;
  if (accent.icon === "spark") return Sparkles;
  return Plus;
}

const workspaceIconChoices = [
  ["Sparkles", Sparkles],
  ["BookOpen", BookOpen],
  ["GraduationCap", GraduationCap],
  ["Atom", Atom],
  ["FlaskConical", FlaskConical],
  ["Calculator", Calculator],
  ["Brain", Brain],
  ["Sprout", Sprout],
  ["BarChart3", BarChart3],
] as const;

function smallButtonClass(tone: "normal" | "dark" | "danger" = "normal") {
  if (tone === "dark")
    return "inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[var(--text-primary)] px-3 text-[13px] font-medium text-[var(--bg-primary)] disabled:opacity-45";
  if (tone === "danger")
    return "inline-flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[12px] font-medium text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-elevated))] disabled:opacity-45";
  return "inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45";
}

function menuItemClass() {
  return "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-45";
}

function useOutsideClick<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose, open]);
  return ref;
}

function WorkspaceHome({
  overview,
  onSelect,
  onOpenArtifact,
  onAddArtifactToWorkspace,
  onMoveArtifactToWorkspace,
  onMoveArtifactToInbox,
  onCreateArtifact,
  onDeleteArtifact,
  selectionMode,
  selectedContextIds,
  selectedObjectKeys,
  onToggleContext,
  onToggleSelection,
  searchControl,
}: {
  overview: SpectraOverview | null;
  onSelect: (workspaceId: string) => void;
  onOpenArtifact: (artifact: SpectraArtifact) => void;
  onAddArtifactToWorkspace: (
    artifact: SpectraArtifact,
    workspaceId: string,
  ) => void;
  onMoveArtifactToWorkspace: (
    artifact: SpectraArtifact,
    workspaceId: string,
  ) => void;
  onMoveArtifactToInbox: (artifact: SpectraArtifact) => void;
  onCreateArtifact: (
    blueprintKey: ArtifactTypeKey,
    workspaceId?: string,
  ) => void;
  onDeleteArtifact: (artifact: SpectraArtifact) => void;
  selectionMode: boolean;
  selectedContextIds: Set<string>;
  selectedObjectKeys: Set<string>;
  onToggleContext: (artifact: SpectraArtifact) => void;
  onToggleSelection: () => void;
  searchControl: ReactNode;
}) {
  const selectedObjects = useSpectraContextStore(
    (state) => state.selectionDraft,
  );
  const toggleSelectionObject = useSpectraContextStore(
    (state) => state.toggleSelection,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [dropWorkspaceId, setDropWorkspaceId] = useState<string | null>(null);
  const createRef = useOutsideClick<HTMLDivElement>(createOpen, () =>
    setCreateOpen(false),
  );
  useEffect(() => {
    setPinnedOpen(
      window.localStorage.getItem("spectra.home.pinned.open") !== "false",
    );
  }, []);
  useEffect(() => {
    window.localStorage.setItem("spectra.home.pinned.open", String(pinnedOpen));
  }, [pinnedOpen]);
  const workspaces = overview?.workspaces ?? [];
  const artifacts = overview?.artifacts ?? [];
  const unplacedArtifacts = artifacts.filter(
    (artifact) => artifactPlacements(artifact).length === 0,
  );
  const unplacedCount = unplacedArtifacts.length;
  const pinnedArtifacts = artifacts.filter((artifact) =>
    artifactPlacements(artifact).some((placement) => placement.pinned),
  );
  const activity = artifacts
    .map((artifact) => ({
      id: artifact._id,
      time: artifact.updatedAt,
      title: artifact.title,
      detail:
        Math.abs(artifact.updatedAt - artifact.createdAt) < 1_000
          ? "Created"
          : "Updated",
      artifact,
    }))
    .sort((a, b) => b.time - a.time)
    .slice(0, 6);

  function artifactFromDrag(event: DragEvent<HTMLElement>) {
    const artifactId =
      event.dataTransfer.getData("application/x-spectra-artifact") ||
      event.dataTransfer.getData("text/plain");
    return artifacts.find((artifact) => artifact._id === artifactId);
  }

  function allowWorkspaceDrop(
    event: DragEvent<HTMLElement>,
    workspaceId: string,
  ) {
    const artifact = artifactFromDrag(event);
    if (!artifact) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropWorkspaceId(workspaceId);
  }

  return (
    <main
      data-selection-count={selectedObjectKeys.size}
      className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_22%_-5%,color-mix(in_oklab,var(--accent-cyan)_7%,transparent),transparent_34%),var(--bg-primary)] px-4 pb-[150px] pt-16 sm:px-8 sm:pt-8"
      style={{ containerType: "inline-size" }}
    >
      <div className="mx-auto max-w-[1320px]">
        <div className="flex flex-col items-start justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              Spectra / Workspace
            </div>
            <h1 className="font-display text-[36px] font-semibold leading-[1.15] text-[var(--text-primary)]">
              Mission control
            </h1>
            <p className="mt-2 text-[14px] text-[var(--text-secondary)]">
              Every workspace and object, from one working surface.
            </p>
          </div>
          <div
            className="flex max-w-full flex-wrap items-center gap-2 sm:gap-4"
            ref={createRef}
          >
            <div className="hidden items-center gap-4 text-[11px] text-[var(--text-secondary)] lg:flex">
              <span>{workspaces.length} workspaces</span>
              <span>{artifacts.length} objects</span>
              <span>{unplacedCount} unplaced</span>
            </div>
            {searchControl}
            <button
              type="button"
              onClick={onToggleSelection}
              className={`flex h-9 items-center gap-2 rounded-[8px] border px-3 text-[12px] font-medium transition ${selectionMode ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)]" : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"}`}
              aria-pressed={selectionMode}
            >
              <Files className="h-4 w-4" />
              {selectionMode
                ? `${selectedObjects.length} selected`
                : "Select objects"}
            </button>
            <div className="relative">
              <button
                type="button"
                className={smallButtonClass("dark")}
                onClick={() => setCreateOpen((open) => !open)}
              >
                <Plus className="h-4 w-4" />
                Create artifact
              </button>
              {createOpen ? (
                <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-[230px] rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_16px_38px_rgba(27,20,12,0.14)]">
                  {createTypes.map((type) => {
                    const Icon = type.icon;
                    return (
                      <button
                        key={type.key}
                        type="button"
                        className={menuItemClass()}
                        onClick={() => {
                          setCreateOpen(false);
                          onCreateArtifact(type.key);
                        }}
                      >
                        <Icon className="h-4 w-4" />
                        New {type.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="spectra-workspace-home-grid mt-8 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">
                  Workspaces
                </h2>
                <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                  Enter a focused working room
                </p>
              </div>
            </div>
            <div className="spectra-workspace-card-grid grid content-start gap-3 md:grid-cols-2">
              {workspaces.map((workspace, index) => {
                const accent = workspaceAccent(workspace, index);
                const Icon = iconForWorkspace(workspace, index);
                const count = workspaceArtifactCount(workspace, artifacts);
                const workspaceSelected = selectedObjects.some(
                  (item) =>
                    item.type === "workspace" && item.id === workspace._id,
                );
                return (
                  <div
                    key={workspace._id}
                    data-spectra-card="workspace"
                    data-card-state={
                      dropWorkspaceId === workspace._id
                        ? "drop-target"
                        : workspaceSelected
                          ? "multi-selected"
                          : workspace.aiState === "creating"
                            ? "creating"
                            : workspace.aiState === "updating"
                              ? "updating"
                              : workspace.aiState === "edited"
                                ? "edited"
                                : "normal"
                    }
                    data-interactive="true"
                    className="group relative min-h-[150px] overflow-hidden p-4 text-left"
                    style={{ "--card-accent": accent.color } as CSSProperties}
                    onDragOver={(event) =>
                      allowWorkspaceDrop(event, workspace._id)
                    }
                    onDragLeave={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as Node | null,
                        )
                      )
                        setDropWorkspaceId(null);
                    }}
                    onDrop={(event) => {
                      const artifact = artifactFromDrag(event);
                      setDropWorkspaceId(null);
                      if (!artifact) return;
                      event.preventDefault();
                      onMoveArtifactToWorkspace(artifact, workspace._id);
                    }}
                  >
                    <button
                      type="button"
                      className="absolute inset-0 z-[3]"
                      onClick={() => {
                        if (selectionMode)
                          toggleSelectionObject({
                            type: "workspace",
                            id: workspace._id,
                            label: workspace.title,
                            source: "selected",
                            capability: "context",
                          });
                        else onSelect(workspace._id);
                      }}
                      aria-label={
                        selectionMode
                          ? `${workspaceSelected ? "Remove" : "Add"} ${workspace.title} ${workspaceSelected ? "from" : "to"} selection`
                          : `Open ${workspace.title} workspace`
                      }
                      aria-pressed={
                        selectionMode ? workspaceSelected : undefined
                      }
                    />
                    <div className="relative z-[2] flex items-start gap-3">
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-[color-mix(in_oklab,var(--card-accent)_22%,var(--card-border))] bg-[color-mix(in_oklab,var(--card-accent)_9%,var(--card-paper))]"
                        style={{ color: accent.color }}
                      >
                        {workspaceSelected ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Icon className="h-4 w-4" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-display text-[22px] font-semibold leading-tight text-[var(--text-primary)]">
                            {workspace.title}
                          </span>
                          {workspace.isShared ? (
                            <Share2
                              className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]"
                              aria-label="Shared workspace"
                            />
                          ) : null}
                          {workspace.aiState === "creating" ||
                          workspace.aiState === "updating" ? (
                            <span className="rounded-full bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-elevated))] px-2 py-0.5 text-[9px] font-semibold text-[var(--accent-cyan)]">
                              {workspace.aiState === "creating"
                                ? "Creating"
                                : "Updating"}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-[12px] leading-5 text-[var(--text-secondary)]">
                          {workspace.description}
                        </span>
                        <span className="mt-4 flex items-center gap-3 text-[11px] text-[var(--text-tertiary)]">
                          <span>{count} artifacts</span>
                          <span>
                            Updated{" "}
                            {formatRelativeTime(workspace.lastActivityAt)}
                          </span>
                        </span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          <aside className="self-start rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
                Recent activity
              </h2>
              <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
            </div>
            <div className="mt-3 grid gap-1 sm:grid-cols-2">
              {activity.map((entry) => {
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className="flex min-h-12 w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                    onClick={() => onOpenArtifact(entry.artifact)}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-tertiary)]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                        {entry.title}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        {entry.detail} · {formatRelativeTime(entry.time)}
                      </div>
                    </div>
                  </button>
                );
              })}
              {activity.length === 0 ? (
                <div className="text-[13px] text-[var(--text-secondary)]">
                  No activity yet.
                </div>
              ) : null}
            </div>
          </aside>
        </div>

        {pinnedArtifacts.length > 0 ? (
          <section className="mt-9">
            <button
              type="button"
              onClick={() => setPinnedOpen((open) => !open)}
              className="mb-4 flex w-full items-center gap-2 text-left"
            >
              <ChevronDown
                className={`h-4 w-4 text-[var(--text-tertiary)] transition ${pinnedOpen ? "" : "-rotate-90"}`}
              />
              <Pin className="h-4 w-4 text-[#b67616]" />
              <h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">
                Pinned work
              </h2>
              <span className="rounded-[6px] bg-[var(--bg-secondary)] px-1.5 text-[12px] text-[var(--text-secondary)]">
                {pinnedArtifacts.length}
              </span>
              <span className="ml-1 text-[12px] text-[var(--text-tertiary)]">
                Important objects across your workspaces
              </span>
            </button>
            {pinnedOpen ? (
              <PinnedArtifactShelf
                artifacts={pinnedArtifacts}
                onSelect={onOpenArtifact}
              />
            ) : null}
          </section>
        ) : null}

        <div className="mt-8">
          <ObjectLibrary
            entries={unplacedArtifacts.map((artifact) => ({ artifact }))}
            workspaces={workspaces}
            groupBy="workspace"
            showHeader={false}
            showToolbar={false}
            showGroups={false}
            onOpen={(entry) => onOpenArtifact(entry.artifact!)}
            onAddToWorkspace={(entry, workspaceId) =>
              onAddArtifactToWorkspace(entry.artifact!, workspaceId)
            }
            onMoveToWorkspace={(entry, workspaceId) =>
              onMoveArtifactToWorkspace(entry.artifact!, workspaceId)
            }
            onMoveToInbox={(entry) => onMoveArtifactToInbox(entry.artifact!)}
            onDelete={(entry) => onDeleteArtifact(entry.artifact!)}
            selectionMode={selectionMode}
            selectedContextIds={selectedContextIds}
            onToggleContext={(entry) => onToggleContext(entry.artifact!)}
          />
        </div>

        <div className="mt-10 border-t border-[var(--border-default)] pt-7">
          <ObjectLibrary
            entries={artifacts.map((artifact) => ({ artifact }))}
            workspaces={workspaces}
            groupBy="workspace"
            title="All work"
            subtitle="Artifacts and conversations across your workspaces"
            showInbox={false}
            onOpen={(entry) => onOpenArtifact(entry.artifact!)}
            onAddToWorkspace={(entry, workspaceId) =>
              onAddArtifactToWorkspace(entry.artifact!, workspaceId)
            }
            onMoveToWorkspace={(entry, workspaceId) =>
              onMoveArtifactToWorkspace(entry.artifact!, workspaceId)
            }
            onMoveToInbox={(entry) => onMoveArtifactToInbox(entry.artifact!)}
            onCreateArtifact={onCreateArtifact}
            onDelete={(entry) => onDeleteArtifact(entry.artifact!)}
            selectionMode={selectionMode}
            selectedContextIds={selectedContextIds}
            onToggleContext={(entry) => onToggleContext(entry.artifact!)}
          />
        </div>
      </div>
    </main>
  );
}

function WorkspaceHeader({
  workspace,
  items,
  runs,
  optimisticActive,
  optimisticRunId,
  busy,
  onCreateArtifact,
  onEditWorkspace,
  onShareWorkspace,
  onArchiveWorkspace,
}: {
  workspace: SpectraWorkspace | null;
  items: SpectraWorkspaceItem[];
  runs: SpectraRun[];
  optimisticActive?: boolean;
  optimisticRunId?: string;
  busy: string | null;
  onCreateArtifact: (type: ArtifactTypeKey) => void;
  onEditWorkspace: () => void;
  onShareWorkspace: () => void;
  onArchiveWorkspace: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const createRef = useOutsideClick<HTMLDivElement>(createOpen, () =>
    setCreateOpen(false),
  );
  const artifactCount = items.filter((item) => item.artifact).length;
  const threadCount = workspaceThreadCount(items);
  const cardCount = items.filter((item) => item.viewData.pinned).length;
  const persistedActiveRuns = runs.filter(
    (run) =>
      run.status === "running" ||
      run.status === "queued" ||
      run.status === "awaiting_confirmation" ||
      run.status === "awaiting_resolution",
  ).length;
  const activeRuns =
    persistedActiveRuns +
    (optimisticActive &&
    (!optimisticRunId || !runs.some((run) => run._id === optimisticRunId))
      ? 1
      : 0);

  return (
    <header className="border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-8 pb-3 pt-7">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate pb-1 font-display text-[34px] font-semibold leading-[1.15] text-[var(--text-primary)]">
              {workspace?.title ?? "Workspace"}
            </h1>
            {workspace?.isShared ? (
              <Share2
                className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]"
                aria-label="Shared workspace"
              />
            ) : null}
            {workspace?.accessLevel !== "read" ? (
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                onClick={onEditWorkspace}
                aria-label="Edit workspace"
                title="Edit workspace"
              >
                <PencilLine className="h-4 w-4" />
              </button>
            ) : null}
            {workspace?.ownership !== "shared" ? (
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                onClick={onShareWorkspace}
                aria-label="Share workspace"
                title="Share workspace"
              >
                <Share2 className="h-4 w-4" />
              </button>
            ) : null}
            {workspace?.ownership !== "shared" ? (
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] text-[var(--danger)] transition hover:bg-[color-mix(in_oklab,var(--danger)_9%,transparent)]"
                onClick={onArchiveWorkspace}
                aria-label="Delete workspace permanently"
                title="Delete workspace permanently"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <p className="mt-3 text-[14px] text-[var(--text-secondary)]">
            {workspace?.description ?? "All your work, organized and ready."}
          </p>
        </div>
        <div className="relative" ref={createRef}>
          <button
            type="button"
            disabled={workspace?.accessLevel === "read"}
            className={smallButtonClass("dark")}
            onClick={() => setCreateOpen((open) => !open)}
          >
            {busy?.startsWith("artifact:") ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            New
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {createOpen ? (
            <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[250px] rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_18px_42px_rgba(27,20,12,0.14)]">
              {createTypes.map((type) => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.key}
                    type="button"
                    className={menuItemClass()}
                    disabled={busy === `artifact:${type.key}`}
                    onClick={() => {
                      setCreateOpen(false);
                      onCreateArtifact(type.key);
                    }}
                  >
                    {busy === `artifact:${type.key}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                    New {type.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-8 text-[12px] text-[var(--text-secondary)]">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          <strong className="text-[var(--text-primary)]">
            {artifactCount}
          </strong>
          <span>Artifacts</span>
        </div>
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          <strong className="text-[var(--text-primary)]">{threadCount}</strong>
          <span>Threads</span>
        </div>
        <div className="flex items-center gap-2">
          <Pin className="h-4 w-4" />
          <strong className="text-[var(--text-primary)]">{cardCount}</strong>
          <span>Pinned</span>
        </div>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          <strong className="text-[var(--text-primary)]">{activeRuns}</strong>
          <span>{activeRuns === 1 ? "Active run" : "Active runs"}</span>
        </div>
      </div>
    </header>
  );
}

function WorkspaceLibraryToolbar({
  viewMode,
  onViewModeChange,
  sort,
  onSortChange,
  type,
  onTypeChange,
  selectionMode,
  onToggleSelection,
  searchControl,
}: {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  sort: WorkspaceSort;
  onSortChange: (sort: WorkspaceSort) => void;
  type: "all" | WorkspaceObjectType;
  onTypeChange: (type: "all" | WorkspaceObjectType) => void;
  selectionMode: boolean;
  onToggleSelection: () => void;
  searchControl: ReactNode;
}) {
  const [sortOpen, setSortOpen] = useState(false);
  const ref = useOutsideClick<HTMLDivElement>(sortOpen, () =>
    setSortOpen(false),
  );
  const sortLabels: Record<WorkspaceSort, string> = {
    updated: "Recently updated",
    created: "Recently created",
    title: "Title A–Z",
    type: "Artifact type",
  };
  const types: Array<{ key: "all" | WorkspaceObjectType; label: string }> = [
    { key: "all", label: "All" },
    { key: "document", label: "Documents" },
    { key: "flashcard_deck", label: "Decks" },
    { key: "quiz", label: "Quizzes" },
    { key: "planner_task", label: "Tasks" },
    { key: "thread", label: "Threads" },
  ];
  return (
    <div
      className="mt-5 flex flex-wrap items-center gap-2 pb-1"
      aria-label="Workspace library controls"
    >
      <div className="flex shrink-0 gap-1 overflow-x-auto">
        {types.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onTypeChange(option.key)}
            className={`inline-flex h-9 items-center rounded-[8px] px-3 text-[13px] font-medium transition ${type === option.key ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_1px_7px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--bg-elevated)_68%,transparent)]"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {searchControl}
        <button
          type="button"
          onClick={onToggleSelection}
          className={`flex h-9 items-center gap-2 rounded-[8px] border px-3 text-[12px] font-medium transition ${selectionMode ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)]" : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"}`}
          aria-pressed={selectionMode}
        >
          <Files className="h-4 w-4" />
          {selectionMode ? "Done selecting" : "Select objects"}
        </button>
      </div>
      <div className="relative" ref={ref}>
        <button
          type="button"
          className="flex h-9 min-w-[164px] items-center justify-between gap-3 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[12px] font-medium text-[var(--text-primary)] shadow-[0_1px_4px_rgba(27,20,12,0.04)] hover:bg-[var(--bg-hover)]"
          onClick={() => setSortOpen((open) => !open)}
        >
          {sortLabels[sort]}
          <ChevronDown
            className={`h-3.5 w-3.5 text-[var(--text-tertiary)] transition ${sortOpen ? "rotate-180" : ""}`}
          />
        </button>
        {sortOpen ? (
          <div className="absolute right-0 top-[calc(100%+7px)] z-40 w-[190px] rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_14px_32px_rgba(27,20,12,0.13)]">
            {(Object.entries(sortLabels) as Array<[WorkspaceSort, string]>).map(
              ([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={menuItemClass()}
                  onClick={() => {
                    onSortChange(key);
                    setSortOpen(false);
                  }}
                >
                  {label}
                  {sort === key ? (
                    <CheckCircle2 className="ml-auto h-4 w-4 text-[var(--success)]" />
                  ) : null}
                </button>
              ),
            )}
          </div>
        ) : null}
      </div>
      <nav className="flex items-center gap-1 rounded-[10px] bg-[color-mix(in_oklab,var(--bg-elevated)_72%,transparent)] p-1">
        {viewModes.map((view) => {
          const Icon = view.icon;
          return (
            <button
              key={view.key}
              type="button"
              className={`flex h-8 items-center gap-2 rounded-[7px] px-3 text-[12px] font-medium transition ${viewMode === view.key ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_1px_6px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"}`}
              onClick={() => onViewModeChange(view.key)}
            >
              <Icon className="h-4 w-4" />
              {view.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function WorkspaceContentSkeleton() {
  return (
    <div
      className="absolute inset-0 z-20 bg-[var(--bg-primary)] px-8 pt-6"
      aria-label="Loading workspace"
    >
      <div className="ml-auto h-9 w-[520px] max-w-full animate-pulse rounded-[9px] bg-[var(--bg-secondary)]" />
      <div className="mt-7 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-[116px] animate-pulse rounded-[10px] bg-[linear-gradient(110deg,var(--bg-secondary),color-mix(in_oklab,var(--bg-elevated)_70%,var(--bg-secondary)),var(--bg-secondary))] [background-size:220%_100%]"
            style={{ animationDelay: `${index * 55}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function applyPreviewContentPatch(source: unknown, patch: unknown) {
  if (
    !patch ||
    typeof patch !== "object" ||
    !Array.isArray((patch as { changes?: unknown }).changes)
  )
    return undefined;
  let root: unknown =
    source && typeof source === "object" ? structuredClone(source) : {};
  for (const raw of (patch as { changes: unknown[] }).changes) {
    if (!raw || typeof raw !== "object") continue;
    const { path, value } = raw as { path?: unknown; value?: unknown };
    if (typeof path !== "string" || !path.startsWith("/")) continue;
    const segments = path
      .split("/")
      .slice(1)
      .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
    if (segments.length === 0) {
      root = structuredClone(value);
      continue;
    }
    let cursor = root as Record<string, unknown>;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index]!;
      const nextSegment = segments[index + 1]!;
      if (!cursor[segment] || typeof cursor[segment] !== "object")
        cursor[segment] = /^\d+$/.test(nextSegment) ? [] : {};
      cursor = cursor[segment] as Record<string, unknown>;
    }
    cursor[segments.at(-1)!] = structuredClone(value);
  }
  return root;
}

function WorkspaceHomeSkeleton() {
  return (
    <main
      className="min-h-0 flex-1 overflow-hidden bg-[var(--bg-primary)] px-4 pt-16 sm:px-8 sm:pt-8"
      aria-label="Loading workspace home"
    >
      <div className="mx-auto max-w-[1320px] animate-pulse motion-reduce:animate-none">
        <div className="h-3 w-32 rounded bg-[var(--bg-secondary)]" />
        <div className="mt-4 h-10 w-64 rounded bg-[var(--bg-secondary)]" />
        <div className="mt-3 h-4 w-96 max-w-full rounded bg-[var(--bg-secondary)]" />
        <div className="mt-10 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className="h-36 rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
              />
            ))}
          </div>
          <div className="h-48 rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]" />
        </div>
      </div>
    </main>
  );
}

function WorkspaceEntryCard({
  entry,
  selected,
  compact = false,
  selectionMode = false,
  contextSelected = false,
  continuedThreadId,
  onSelect,
  onToggleContext,
  actions,
}: {
  entry: WorkspaceEntry;
  selected?: boolean;
  compact?: boolean;
  selectionMode?: boolean;
  contextSelected?: boolean;
  continuedThreadId?: string | null;
  onSelect: (entry: WorkspaceEntry) => void;
  onToggleContext?: (entry: WorkspaceEntry) => void;
  actions?: ReactNode;
}) {
  if (entry.thread)
    return (
      <ThreadCard
        thread={entry.thread}
        workspaceLabel="Workspace"
        pinned={entry.item.viewData.pinned}
        continued={continuedThreadId === entry.thread._id}
        selected={contextSelected || selected}
        selectionMode={selectionMode}
        compact={compact}
        onOpen={() => onSelect(entry)}
        onToggleSelection={
          onToggleContext ? () => onToggleContext(entry) : undefined
        }
        actions={actions}
      />
    );
  if (!entry.artifact || !entry.card) return null;
  return (
    <ArtifactCard
      artifact={entry.card}
      selected={selected}
      size={compact ? "compact" : "normal"}
      selectionMode={selectionMode}
      contextSelected={contextSelected}
      onToggleContext={
        onToggleContext ? () => onToggleContext(entry) : undefined
      }
      onSelect={() => onSelect(entry)}
      actions={actions}
    />
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CardsView({
  entries,
  selected,
  onSelect,
  onHide,
  busy,
}: {
  entries: WorkspaceEntry[];
  selected: Selection;
  onSelect: (entry: WorkspaceEntry) => void;
  onHide: (itemId: string) => void;
  busy: string | null;
}) {
  if (entries.length === 0) {
    return (
      <EmptyWorkspaceState
        title="No workspace cards yet"
        message="Create or add an artifact to start building this workspace."
      />
    );
  }

  const pinned = entries
    .filter((entry) => entry.item.viewData.pinned)
    .slice(0, 5);
  const activeEntries = (pinned.length > 0 ? pinned : entries).slice(0, 5);
  const documents = entries
    .filter((entry) => entry.artifact?.blueprintKey === "document")
    .slice(0, 4);
  const practice = entries
    .filter(
      (entry) =>
        entry.artifact?.blueprintKey === "quiz" ||
        entry.artifact?.blueprintKey === "flashcard_deck" ||
        entry.artifact?.blueprintKey === "planner_task",
    )
    .slice(0, 4);

  return (
    <div className="space-y-7">
      <section>
        <div className="mb-4">
          <h2 className="font-display text-[17px] font-semibold text-[var(--text-primary)]">
            Pinned / Active
          </h2>
          <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
            Your most important items at a glance
          </p>
        </div>
        <div className="grid gap-3 xl:grid-cols-[minmax(300px,1.1fr)_minmax(360px,1.4fr)]">
          {activeEntries[0] ? (
            <WorkspaceEntryCard
              entry={activeEntries[0]}
              selected={
                (selected?.type === "artifact" ||
                  selected?.type === "thread") &&
                selected.itemId === activeEntries[0].item._id
              }
              onSelect={onSelect}
            />
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {activeEntries.slice(1, 5).map((entry) => (
              <WorkspaceEntryCard
                key={entry.item._id}
                entry={entry}
                selected={
                  (selected?.type === "artifact" ||
                    selected?.type === "thread") &&
                  selected.itemId === entry.item._id
                }
                onSelect={onSelect}
                actions={
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
                    onClick={() => onHide(entry.item._id)}
                    aria-label="Remove from workspace"
                    title="Remove from workspace"
                  >
                    {busy === `hide:${entry.item._id}` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                }
              />
            ))}
          </div>
        </div>
      </section>
      <CompactShelf
        title="Documents"
        entries={documents}
        selected={selected}
        onSelect={onSelect}
      />
      <CompactShelf
        title="Practice"
        entries={practice}
        selected={selected}
        onSelect={onSelect}
      />
    </div>
  );
}

function CompactShelf({
  title,
  entries,
  selected,
  onSelect,
}: {
  title: string;
  entries: WorkspaceEntry[];
  selected: Selection;
  onSelect: (entry: WorkspaceEntry) => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-4">
        <h2 className="font-display text-[16px] font-semibold text-[var(--text-primary)]">
          {title}
        </h2>
        <button
          type="button"
          className="text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          See all
        </button>
      </div>
      <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-4">
        {entries.map((entry) => {
          if (!entry.card) return null;
          const meta = blueprintMeta[entry.card.blueprintKey];
          const Icon = meta.icon;
          return (
            <button
              key={entry.item._id}
              type="button"
              data-spectra-card="artifact"
              data-card-state={
                selected?.type === "artifact" &&
                selected.itemId === entry.item._id
                  ? "focused"
                  : entry.card.aiState === "creating"
                    ? "creating"
                    : entry.card.aiState === "updating"
                      ? "updating"
                      : entry.card.aiState === "edited" ||
                          entry.card.aiState === "generated"
                        ? "edited"
                        : "normal"
              }
              data-interactive="true"
              className="flex min-h-[62px] items-center gap-3 px-3 py-2 text-left"
              style={{ "--card-accent": meta.color } as CSSProperties}
              onClick={() => onSelect(entry)}
            >
              <Icon
                className="h-5 w-5 shrink-0"
                style={{ color: meta.color }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
                  {entry.card.title}
                </span>
                <span className="block truncate text-[11px] text-[var(--text-secondary)]">
                  {formatRelativeTime(entry.item.updatedAt)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function TimelineView({
  entries,
  runs,
  selected,
  onSelectRun,
  onSelectEntry,
  selectionMode,
  selectedObjectKeys,
  onToggleContext,
}: {
  entries: WorkspaceEntry[];
  runs: SpectraRun[];
  selected: Selection;
  onSelectRun: (run: SpectraRun) => void;
  onSelectEntry: (entry: WorkspaceEntry) => void;
  selectionMode: boolean;
  selectedObjectKeys: Set<string>;
  onToggleContext: (entry: WorkspaceEntry) => void;
}) {
  type TimelineRow =
    | {
        id: string;
        kind: "run";
        run: SpectraRun;
        entry?: WorkspaceEntry;
        title: string;
        summary: string;
        time: number;
      }
    | {
        id: string;
        kind: "artifact" | "edit" | "thread";
        entry: WorkspaceEntry;
        title: string;
        summary: string;
        time: number;
      };
  const runRows: TimelineRow[] = runs.slice(0, 8).map((run) => ({
    id: `run:${run._id}`,
    kind: "run" as const,
    run,
    entry: entries.find(
      (candidate) =>
        candidate.artifact?._id === run.artifactId ||
        candidate.thread?._id === run.threadId,
    ),
    title:
      run.status === "completed"
        ? "AI run completed"
        : `AI run ${run.status.replace("_", " ")}`,
    summary: run.finalSummary ?? run.error ?? "Workspace run activity.",
    time: run.createdAt,
  }));
  const artifactRows: TimelineRow[] = entries.slice(0, 12).map((entry) => {
    const created =
      workspaceEntryCreatedAt(entry) === workspaceEntryUpdatedAt(entry);
    const kind = entry.thread
      ? ("thread" as const)
      : created
        ? ("artifact" as const)
        : ("edit" as const);
    return {
      id: `${kind === "thread" ? "thread" : "artifact"}:${entry.item._id}`,
      kind,
      entry,
      title:
        kind === "thread"
          ? "Conversation active"
          : created && entry.artifact
            ? `${blueprintMeta[entry.artifact.blueprintKey].label} created`
            : "Artifact edited",
      summary: workspaceEntrySummary(entry),
      time: entry.item.updatedAt,
    };
  });
  const rows = [...runRows, ...artifactRows].sort((a, b) => b.time - a.time);
  const selectedId =
    selected?.type === "artifact"
      ? `artifact:${selected.itemId}`
      : selected?.type === "thread"
        ? `thread:${selected.itemId}`
        : selected?.type === "run"
          ? `run:${selected.runId}`
          : null;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dateGroups = rows.reduce<
    Array<{ key: string; label: string; rows: TimelineRow[] }>
  >((groups, row) => {
    const date = new Date(row.time);
    date.setHours(0, 0, 0, 0);
    const days = Math.max(
      0,
      Math.round((todayStart.getTime() - date.getTime()) / 86_400_000),
    );
    const key = String(date.getTime());
    const label =
      days === 0
        ? "Today"
        : days === 1
          ? "Yesterday"
          : days < 7
            ? `${days} days ago`
            : date.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              });
    const group = groups.find((candidate) => candidate.key === key);
    if (group) group.rows.push(row);
    else groups.push({ key, label, rows: [row] });
    return groups;
  }, []);
  if (rows.length === 0) {
    return (
      <EmptyWorkspaceState
        title="No activity yet"
        message="Runs and object changes will appear here as the workspace becomes active."
      />
    );
  }

  return (
    <div className="relative space-y-7 pb-3 pl-8 before:absolute before:bottom-4 before:left-[7px] before:top-[74px] before:w-px before:bg-[linear-gradient(to_bottom,var(--text-primary),color-mix(in_oklab,var(--text-primary)_18%,var(--border-default)),transparent)]">
      <div className="grid grid-cols-2 overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] sm:grid-cols-4">
        <div className="px-4 py-3">
          <strong className="block font-display text-[20px] text-[var(--text-primary)]">
            {rows.length}
          </strong>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Recent events
          </span>
        </div>
        <div className="border-l border-[var(--border-subtle)] px-4 py-3">
          <strong className="block font-display text-[20px] text-[var(--text-primary)]">
            {rows.filter((row) => row.kind === "run").length}
          </strong>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            AI runs
          </span>
        </div>
        <div className="border-l border-[var(--border-subtle)] px-4 py-3">
          <strong className="block font-display text-[20px] text-[var(--text-primary)]">
            {rows.filter((row) => row.kind === "edit").length}
          </strong>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Artifact edits
          </span>
        </div>
        <div className="border-l border-[var(--border-subtle)] px-4 py-3">
          <strong className="block font-display text-[20px] text-[var(--text-primary)]">
            {dateGroups.length}
          </strong>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Active days
          </span>
        </div>
      </div>
      {dateGroups.map((group, groupIndex) => (
        <section key={group.key} className="relative">
          <span className="absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--bg-primary)] ring-4 ring-[var(--bg-primary)]">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-[var(--accent-cyan)] bg-[var(--bg-elevated)]" />
          </span>
          <header className="mb-3 flex items-baseline gap-3">
            <h2 className="font-display text-[18px] font-semibold text-[var(--text-primary)]">
              {group.label}
            </h2>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {new Date(Number(group.key)).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
            <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
              {group.rows.length} {group.rows.length === 1 ? "item" : "items"}
            </span>
          </header>
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {group.rows.map((row) => {
              const entry = row.entry;
              const contextKey = entry
                ? `${entry.thread ? "thread" : "artifact"}:${entry.thread?._id ?? entry.artifact?._id ?? ""}`
                : "";
              const active =
                row.id === selectedId ||
                Boolean(contextKey && selectedObjectKeys.has(contextKey));
              const meta =
                row.kind !== "run" && entry?.artifact
                  ? blueprintMeta[entry.artifact.blueprintKey]
                  : null;
              const RowIcon =
                row.kind === "edit"
                  ? PencilLine
                  : row.kind === "thread"
                    ? MessageSquare
                    : meta?.icon;
              const important =
                row.kind === "run"
                  ? [
                      "running",
                      "queued",
                      "failed",
                      "awaiting_confirmation",
                      "awaiting_resolution",
                    ].includes(row.run.status)
                  : Boolean(entry?.item.viewData.pinned);
              const hierarchy =
                row.kind === "run"
                  ? important
                    ? "min-h-[118px] sm:col-span-2"
                    : "min-h-[98px]"
                  : row.kind === "thread"
                    ? "min-h-[108px] border-l-[3px] border-l-[#8b6ff0]"
                    : row.kind === "edit"
                      ? "min-h-[82px]"
                      : important
                        ? "min-h-[112px] sm:col-span-2 2xl:col-span-1"
                        : "min-h-[98px]";
              const surface =
                row.kind === "run"
                  ? "border-[color-mix(in_oklab,var(--accent-cyan)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_6%,var(--bg-elevated))]"
                  : row.kind === "thread"
                    ? "border-[color-mix(in_oklab,#8b6ff0_22%,var(--border-default))] bg-[color-mix(in_oklab,#8b6ff0_5%,var(--bg-elevated))]"
                    : row.kind === "edit"
                      ? "border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-elevated)_68%,var(--bg-primary))]"
                      : important
                        ? "border-[color-mix(in_oklab,#b67616_24%,var(--border-default))] bg-[color-mix(in_oklab,#b67616_6%,var(--bg-elevated))]"
                        : "border-[var(--border-default)] bg-[var(--bg-elevated)]";
              return (
                <button
                  key={row.id}
                  type="button"
                  data-spectra-card="timeline"
                  data-card-state={
                    active
                      ? "focused"
                      : row.kind === "run" && row.run.status === "failed"
                        ? "failed"
                        : row.kind === "run" &&
                            (row.run.status === "awaiting_confirmation" ||
                              row.run.status === "awaiting_resolution")
                          ? "confirmation"
                          : "normal"
                  }
                  data-interactive="true"
                  data-timeline-kind={row.kind}
                  className={`group relative overflow-hidden p-3.5 text-left ${hierarchy} ${surface}`}
                  style={
                    {
                      animationDelay: `${groupIndex * 35}ms`,
                      "--card-accent":
                        row.kind === "run"
                          ? "var(--accent-cyan)"
                          : row.kind === "thread"
                            ? "#df7623"
                            : row.kind === "edit"
                              ? "#8b6ff0"
                              : meta?.color,
                    } as CSSProperties
                  }
                  onClick={() =>
                    row.kind === "run"
                      ? onSelectRun(row.run)
                      : entry
                        ? selectionMode
                          ? onToggleContext(entry)
                          : onSelectEntry(entry)
                        : undefined
                  }
                >
                  <span className="relative flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] bg-[var(--bg-primary)]">
                      {RowIcon ? (
                        <RowIcon
                          className="h-4 w-4"
                          style={{
                            color:
                              row.kind === "thread"
                                ? "#8b6ff0"
                                : row.kind === "edit"
                                  ? "var(--text-secondary)"
                                  : meta?.color,
                          }}
                        />
                      ) : (
                        <Sparkles className="h-4 w-4 text-[var(--accent-cyan)]" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className="flex items-center gap-1.5 text-[11px] font-medium"
                        style={{
                          color:
                            row.kind === "thread"
                              ? "#7256dc"
                              : (meta?.color ?? "var(--accent-cyan)"),
                        }}
                      >
                        {row.title}
                        <span className="text-[var(--text-tertiary)]">
                          · {formatRelativeTime(row.time)}
                        </span>
                      </span>
                      <span className="mt-1.5 block truncate text-[14px] font-semibold text-[var(--text-primary)]">
                        {entry
                          ? workspaceEntryTitle(entry)
                          : row.kind === "run"
                            ? row.run.userPrompt
                            : row.title}
                      </span>
                      <span className="mt-1.5 block line-clamp-2 text-[11px] leading-5 text-[var(--text-secondary)]">
                        {row.summary}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function LibraryView({
  entries,
  workspaces,
  mode,
  selected,
  onSelect,
  onTogglePin,
  onRemove,
  onDelete,
  onMoveArtifactToWorkspace,
  onMoveArtifactToInbox,
  busy,
  onCreateArtifact,
  selectionMode,
  selectedContextIds,
  selectedObjectKeys,
  onToggleContext,
}: {
  entries: WorkspaceEntry[];
  workspaces: SpectraWorkspace[];
  mode: LibraryMode;
  selected: Selection;
  onSelect: (entry: WorkspaceEntry) => void;
  onTogglePin: (item: SpectraWorkspaceItem) => void;
  onRemove: (item: SpectraWorkspaceItem) => void;
  busy: string | null;
  onCreateArtifact: (blueprintKey: ArtifactTypeKey) => void;
  onDelete: (artifact: SpectraArtifact) => void;
  onMoveArtifactToWorkspace: (
    artifact: SpectraArtifact,
    workspaceId: string,
  ) => void;
  onMoveArtifactToInbox: (artifact: SpectraArtifact) => void;
  selectionMode: boolean;
  selectedContextIds: Set<string>;
  selectedObjectKeys: Set<string>;
  onToggleContext: (entry: WorkspaceEntry) => void;
}) {
  if (entries.length === 0) {
    return (
      <EmptyWorkspaceState
        title="No library items here"
        message="Add artifacts to this workspace to group them by type."
      />
    );
  }

  return (
    <div className="space-y-7">
      <ObjectLibrary
        entries={entries}
        workspaces={workspaces}
        groupBy="type"
        mode={mode}
        showModeSwitcher={false}
        showHeader={false}
        showToolbar={false}
        selectedArtifactId={
          selected?.type === "artifact"
            ? selected.artifactId
            : selected?.type === "thread"
              ? selected.threadId
              : undefined
        }
        busyKey={busy}
        onOpen={(entry) => {
          const target = entry.item
            ? entries.find(
                (candidate) => candidate.item._id === entry.item?._id,
              )
            : undefined;
          if (target) onSelect(target);
        }}
        onTogglePin={(entry) => entry.item && onTogglePin(entry.item)}
        onRemove={(entry) => entry.item && onRemove(entry.item)}
        onDelete={(entry) => {
          if (entry.artifact) onDelete(entry.artifact);
        }}
        onAddToWorkspace={(entry, workspaceId) => {
          if (entry.artifact)
            onMoveArtifactToWorkspace(entry.artifact, workspaceId);
        }}
        onMoveToWorkspace={(entry, workspaceId) => {
          if (entry.artifact)
            onMoveArtifactToWorkspace(entry.artifact, workspaceId);
        }}
        onMoveToInbox={(entry) => {
          if (entry.artifact) onMoveArtifactToInbox(entry.artifact);
        }}
        onCreateArtifact={(blueprintKey) => onCreateArtifact(blueprintKey)}
        selectionMode={selectionMode}
        selectedContextIds={selectedContextIds}
        selectedObjectKeys={selectedObjectKeys}
        onToggleContext={(entry) => {
          const target = entry.item
            ? entries.find(
                (candidate) => candidate.item._id === entry.item?._id,
              )
            : undefined;
          if (target) onToggleContext(target);
        }}
      />
    </div>
  );
}

function WorkspacePinnedShelf({
  entries,
  workspaceTitle,
  onSelect,
}: {
  entries: WorkspaceEntry[];
  workspaceTitle: string;
  onSelect: (entry: WorkspaceEntry) => void;
}) {
  const pinned = entries.filter((entry) => entry.item.viewData.pinned);
  const storageKey = `spectra.workspace.pinned.${workspaceTitle}.open`;
  const [open, setOpen] = useState(true);
  useEffect(() => {
    setOpen(window.localStorage.getItem(storageKey) !== "false");
  }, [storageKey]);
  useEffect(() => {
    window.localStorage.setItem(storageKey, String(open));
  }, [open, storageKey]);
  if (pinned.length === 0) return null;
  return (
    <section className="mb-2 mt-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mb-3 flex w-full min-w-0 items-center gap-2 text-left"
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition ${open ? "" : "-rotate-90"}`}
        />
        <Pin className="h-4 w-4 shrink-0 text-[#b67616]" />
        <h2 className="min-w-0 truncate font-display text-[20px] font-semibold text-[var(--text-primary)]">
          Pinned in {workspaceTitle}
        </h2>
        <span className="shrink-0 rounded-[6px] bg-[var(--bg-secondary)] px-1.5 text-[12px] text-[var(--text-secondary)]">
          {pinned.length}
        </span>
        <span className="ml-1 hidden text-[12px] text-[var(--text-tertiary)] min-[720px]:inline">
          Important workspace objects
        </span>
      </button>
      {open ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">
          {pinned.map((entry) => (
            <WorkspaceEntryCard
              key={entry.item._id}
              entry={entry}
              compact
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CanvasView({
  entries,
  selected,
  onSelect,
  selectionMode,
  selectedObjectKeys,
  onToggleContext,
}: {
  entries: WorkspaceEntry[];
  selected: Selection;
  onSelect: (entry: WorkspaceEntry) => void;
  selectionMode: boolean;
  selectedObjectKeys: Set<string>;
  onToggleContext: (entry: WorkspaceEntry) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const groups = [
    ...createTypes.map((type) => ({
      ...type,
      color: blueprintMeta[type.key].color,
      entries: entries.filter(
        (entry) => entry.artifact?.blueprintKey === type.key,
      ),
    })),
    {
      key: "thread" as const,
      label: "Conversations",
      icon: MessageSquare,
      color: "#8b6ff0",
      entries: entries.filter((entry) => Boolean(entry.thread)),
    },
  ].filter((group) => group.entries.length > 0);
  const layouts = [
    "xl:col-span-4",
    "xl:col-span-4 xl:col-start-5 xl:mt-12",
    "xl:col-span-4 xl:col-start-9 xl:mt-4",
    "xl:col-span-4 xl:col-start-2",
    "xl:col-span-4 xl:col-start-6 xl:mt-10",
    "xl:col-span-4 xl:col-start-9",
  ];

  function resetCanvas(nextZoom = 1) {
    setZoom(nextZoom);
    requestAnimationFrame(() =>
      canvasRef.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" }),
    );
  }

  return (
    <div
      ref={canvasRef}
      className="relative h-full min-h-full overflow-auto bg-[radial-gradient(color-mix(in_oklab,var(--border-default)_62%,transparent)_0.65px,transparent_0.8px)] p-4 pb-20 [background-size:18px_18px] sm:p-5 sm:pb-20"
    >
      <div className="sticky top-0 z-20 ml-auto mb-5 flex w-fit items-center gap-1 rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[0_10px_28px_-22px_rgba(27,20,12,.45)]">
        <button
          type="button"
          onClick={() => resetCanvas(1)}
          className="flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          title="Reset clustered layout"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Auto arrange
        </button>
        <span className="h-5 w-px bg-[var(--border-subtle)]" />
        <button
          type="button"
          onClick={() =>
            setZoom((value) => Math.max(0.65, Number((value - 0.1).toFixed(2))))
          }
          disabled={zoom <= 0.65}
          className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-35"
          aria-label="Zoom canvas out"
          title="Zoom out"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-11 text-center text-[10px] tabular-nums text-[var(--text-secondary)]">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() =>
            setZoom((value) => Math.min(1.35, Number((value + 0.1).toFixed(2))))
          }
          disabled={zoom >= 1.35}
          className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-35"
          aria-label="Zoom canvas in"
          title="Zoom in"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => resetCanvas(0.8)}
          className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          aria-label="Fit canvas to view"
          title="Fit to view"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <span className="h-5 w-px bg-[var(--border-subtle)]" />
        <span className="px-2 text-[10px] text-[var(--text-tertiary)]">
          Clustered by type
        </span>
      </div>
      <div
        className="grid min-h-full auto-rows-min gap-5 transition-transform duration-200 motion-reduce:transition-none lg:grid-cols-2 xl:grid-cols-12"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "top left",
          width: `${100 / zoom}%`,
        }}
      >
        {groups.map((group, index) => {
          const Icon = group.icon;
          return (
            <section
              key={group.key}
              data-canvas-cluster={group.key}
              className={`self-start rounded-[18px] border p-3.5 lg:col-span-1 ${layouts[index % layouts.length]}`}
              style={{
                borderColor: `color-mix(in oklab, ${group.color} 24%, var(--border-default))`,
                background: `color-mix(in oklab, ${group.color} 5%, var(--bg-primary))`,
                boxShadow: `0 20px 45px -38px color-mix(in oklab, ${group.color} 42%, transparent)`,
              }}
            >
              <header className="mb-3 flex items-center gap-2 px-1">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold"
                  style={{
                    color: group.color,
                    background: `color-mix(in oklab, ${group.color} 10%, var(--bg-elevated))`,
                  }}
                >
                  {index + 1}
                </span>
                <Icon className="h-4 w-4" style={{ color: group.color }} />
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {group.label}
                </span>
                <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
                  {group.entries.length}
                </span>
              </header>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                {group.entries.map((entry) => {
                  const objectKey = `${entry.thread ? "thread" : "artifact"}:${entry.thread?._id ?? entry.artifact?._id ?? ""}`;
                  return (
                    <WorkspaceEntryCard
                      key={entry.item._id}
                      entry={entry}
                      compact
                      selected={
                        selectedObjectKeys.has(objectKey) ||
                        ((selected?.type === "artifact" ||
                          selected?.type === "thread") &&
                          selected.itemId === entry.item._id)
                      }
                      onSelect={selectionMode ? onToggleContext : onSelect}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div
        className="sticky bottom-24 z-20 ml-auto hidden h-24 w-36 overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_94%,transparent)] p-2 shadow-[0_12px_30px_rgba(27,20,12,.12)] backdrop-blur sm:block"
        aria-label="Canvas minimap"
      >
        <div className="grid h-full grid-cols-3 gap-1.5">
          {groups.slice(0, 6).map((group, index) => (
            <span
              key={`mini:${String(group.key)}`}
              className={`${index === 3 ? "col-start-1" : ""} rounded-[4px] border`}
              style={{
                borderColor: `color-mix(in oklab, ${group.color} 28%, var(--border-default))`,
                background: `color-mix(in oklab, ${group.color} 10%, var(--bg-primary))`,
              }}
            />
          ))}
        </div>
        <span className="pointer-events-none absolute inset-3 rounded-[5px] border border-[color-mix(in_oklab,var(--accent-cyan)_55%,transparent)]" />
      </div>
      <div className="fixed bottom-[132px] left-1/2 z-10 hidden -translate-x-1/2 items-center gap-4 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-2 text-[10px] text-[var(--text-tertiary)] shadow-[0_12px_32px_-20px_rgba(27,20,12,.38)] lg:flex">
        <span>Pastel fields group related object types</span>
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-primary)]" />{" "}
        <span>
          {selectionMode
            ? "Choose objects, then add them to context"
            : "Open any object without leaving the canvas"}
        </span>
      </div>
    </div>
  );
}

function EmptyWorkspaceState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="flex min-h-[360px] items-center justify-center rounded-[8px] border border-dashed border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_44%,transparent)]">
      <div className="max-w-sm text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
          <Sparkles className="h-4 w-4" />
        </div>
        <h2 className="mt-4 font-display text-[20px] font-semibold text-[var(--text-primary)]">
          {title}
        </h2>
        <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">
          {message}
        </p>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function Inspector({
  workspace,
  artifacts,
  selectedArtifact,
  selectedRun,
  runs,
  onClose,
  onHide,
  onCreateArtifact,
  onArchiveWorkspace,
  onOpenArtifact,
}: {
  workspace: SpectraWorkspace | null;
  artifacts: SpectraArtifact[];
  selectedArtifact: SpectraArtifact | null;
  selectedRun: SpectraRun | null;
  runs: SpectraRun[];
  onClose: () => void;
  onHide: () => void;
  onCreateArtifact: (type: ArtifactTypeKey) => void;
  onArchiveWorkspace: () => void;
  onOpenArtifact: (artifact: SpectraArtifact) => void;
}) {
  if (selectedRun) {
    const affected =
      artifacts.find((artifact) => artifact._id === selectedRun.artifactId) ??
      null;
    return (
      <aside className="hidden w-[318px] shrink-0 border-l border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-6 xl:block">
        <InspectorTitle title="Selected run" onClose={onClose} />
        <div className="mt-5 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <div className="flex items-center justify-between text-[12px] text-[var(--text-secondary)]">
            <span>{formatShortDate(selectedRun.createdAt)}</span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />
              {selectedRun.status}
            </span>
          </div>
          <h2 className="mt-5 font-display text-[20px] font-semibold leading-tight text-[var(--text-primary)]">
            {selectedRun.userPrompt}
          </h2>
          <p className="mt-4 text-[13px] leading-6 text-[var(--text-secondary)]">
            {selectedRun.finalSummary}
          </p>
        </div>
        {affected ? (
          <InspectorSection title="Affected objects">
            <InspectorObject artifact={affected} />
          </InspectorSection>
        ) : null}
      </aside>
    );
  }

  if (selectedArtifact) {
    const meta = blueprintMeta[selectedArtifact.blueprintKey];
    const Icon = meta.icon;
    const links = linkedArtifacts(selectedArtifact, artifacts);
    const selectedPlacements = artifactPlacements(selectedArtifact);
    return (
      <aside className="hidden w-[318px] shrink-0 border-l border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-6 xl:block">
        <InspectorTitle title="Selected artifact" onClose={onClose} />
        <div className="mt-5">
          <Icon
            className="h-8 w-8 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5"
            style={{ color: meta.color }}
          />
          <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            {meta.label}
          </div>
          <h2 className="mt-2 font-display text-[22px] font-semibold leading-tight text-[var(--text-primary)]">
            {selectedArtifact.title}
          </h2>
          <div className="mt-2 text-[12px] text-[var(--text-secondary)]">
            Updated {formatRelativeTime(selectedArtifact.updatedAt)}
          </div>
        </div>
        <InspectorSection title="Summary">
          <p className="text-[13px] leading-6 text-[var(--text-secondary)]">
            {selectedArtifact.summary}
          </p>
        </InspectorSection>
        <InspectorSection title="Placement">
          <div className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 text-[13px] font-medium text-[var(--text-primary)]">
            {selectedPlacements[0]?.workspaceTitle ??
              workspace?.title ??
              "Unplaced"}
            <div className="mt-1 text-[11px] font-normal text-[var(--text-secondary)]">
              Workspace card
            </div>
          </div>
        </InspectorSection>
        <InspectorSection title="Linked objects">
          <div className="space-y-2">
            {links.slice(0, 5).map(({ artifact }) => (
              <InspectorObject key={artifact._id} artifact={artifact} />
            ))}
            {links.length === 0 ? (
              <div className="text-[13px] text-[var(--text-secondary)]">
                No links yet.
              </div>
            ) : null}
          </div>
        </InspectorSection>
        <InspectorSection title="Quick actions">
          <ActionRow
            icon={ExternalLink}
            label="Open detail"
            onClick={() => onOpenArtifact(selectedArtifact)}
          />
          <button
            type="button"
            className={smallButtonClass("danger")}
            onClick={onHide}
          >
            <Trash2 className="h-4 w-4" />
            Remove from workspace
          </button>
        </InspectorSection>
      </aside>
    );
  }

  const workspaceArtifacts = artifacts.filter(
    (artifact) =>
      !workspace ||
      artifactPlacements(artifact).some(
        (placement) => placement.workspaceId === workspace._id,
      ),
  );
  const activeRuns = runs.filter(
    (run) => run.status === "queued" || run.status === "running",
  ).length;

  return (
    <aside className="hidden w-[318px] shrink-0 border-l border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-6 xl:block">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
          {workspace?.title ?? "Workspace"} overview
        </h2>
        <span className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
          <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
          All systems normal
        </span>
      </div>
      <InspectorSection title="Workspace">
        <div className="space-y-3 text-[13px]">
          <MetricRow
            label="Artifacts"
            value={String(workspaceArtifacts.length)}
          />
          <MetricRow label="Cards" value={String(workspaceArtifacts.length)} />
          <MetricRow
            label="Documents"
            value={String(
              workspaceArtifacts.filter(
                (artifact) => artifact.blueprintKey === "document",
              ).length,
            )}
          />
          <MetricRow label="Active runs" value={String(activeRuns)} />
        </div>
      </InspectorSection>
      <InspectorSection title="Quick actions">
        <ActionRow
          icon={FileText}
          label="New document"
          onClick={() => onCreateArtifact("document")}
        />
        <ActionRow
          icon={HelpCircle}
          label="New quiz"
          onClick={() => onCreateArtifact("quiz")}
        />
        <ActionRow
          icon={BookOpen}
          label="New deck"
          onClick={() => onCreateArtifact("flashcard_deck")}
        />
        <ActionRow
          icon={CalendarCheck2}
          label="New task"
          onClick={() => onCreateArtifact("planner_task")}
        />
        {workspace ? (
          <button
            type="button"
            className={smallButtonClass("danger")}
            onClick={onArchiveWorkspace}
          >
            <Trash2 className="h-4 w-4" />
            Archive workspace
          </button>
        ) : null}
      </InspectorSection>
    </aside>
  );
}

function InspectorTitle({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
        {title}
      </h2>
      <button
        type="button"
        className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        onClick={onClose}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function InspectorSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-6 border-t border-[var(--border-default)] pt-5">
      <h3 className="mb-3 text-[13px] font-semibold text-[var(--text-primary)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function InspectorObject({ artifact }: { artifact: SpectraArtifact }) {
  const meta = blueprintMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-3 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2.5">
      <Icon className="h-4 w-4 shrink-0" style={{ color: meta.color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-[var(--text-primary)]">
          {artifact.title}
        </div>
        <div className="text-[11px] text-[var(--text-secondary)]">
          {meta.label}
        </div>
      </div>
      <ExternalLink className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
    </div>
  );
}

function ActionRow({
  icon: Icon,
  label,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-10 w-full items-center gap-3 rounded-[8px] text-left text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:text-[var(--text-tertiary)] disabled:hover:bg-transparent"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="h-4 w-4 text-[var(--text-secondary)]" />
      {label}
      {disabled ? (
        <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">
          Wave 3
        </span>
      ) : null}
    </button>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <strong className="font-semibold text-[var(--text-primary)]">
        {value}
      </strong>
    </div>
  );
}

function PinnedArtifactShelf({
  artifacts,
  onSelect,
}: {
  artifacts: SpectraArtifact[];
  onSelect: (artifact: SpectraArtifact) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {artifacts.slice(0, 6).map((artifact) => (
        <ArtifactCard
          key={artifact._id}
          artifact={{
            id: artifact._id,
            title: artifact.title,
            blueprintKey: artifact.blueprintKey,
            summary:
              artifact.summary ?? blueprintMeta[artifact.blueprintKey].label,
            meta: formatRelativeTime(artifact.updatedAt),
            placement: artifactPlacements(artifact).length
              ? "workspace"
              : artifact.ownership === "shared"
                ? "shared"
                : "inbox",
            updatedAt: artifact.updatedAt,
            pinned: true,
            shared: artifact.isShared,
            accessLevel: artifact.accessLevel ?? undefined,
            accessExplanation:
              artifact.ownership === "shared"
                ? artifact.accessReason === "workspace_inheritance"
                  ? "Access through this workspace"
                  : "Shared directly with you"
                : undefined,
          }}
          onSelect={() => onSelect(artifact)}
        />
      ))}
    </div>
  );
}

export function WorkspaceShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedWorkspaceId = searchParams.get("workspaceId") ?? undefined;
  const requestedThreadId = searchParams.get("threadId") ?? undefined;
  const [overview, setOverview] = useState<SpectraOverview | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<
    string | undefined
  >();
  const [selection, setSelection] = useState<Selection>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [focusModeOverride, setFocusModeOverride] =
    useState<ComposerFocusMode | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [workspaceSort, setWorkspaceSort] = useState<WorkspaceSort>("updated");
  const [workspaceType, setWorkspaceType] = useState<
    "all" | WorkspaceObjectType
  >("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [newWorkspaceTitle, setNewWorkspaceTitle] = useState("");
  const [newWorkspaceDescription, setNewWorkspaceDescription] = useState("");
  const [newWorkspaceIcon, setNewWorkspaceIcon] = useState("Sparkles");
  const [workspaceEditOpen, setWorkspaceEditOpen] = useState(false);
  const [workspaceEditTitle, setWorkspaceEditTitle] = useState("");
  const [workspaceEditDescription, setWorkspaceEditDescription] = useState("");
  const [workspaceEditIcon, setWorkspaceEditIcon] = useState("Sparkles");
  const [hubTabs, setHubTabs] = useState<WorkspaceHubTab[]>(() => [
    { id: "workspace-home-default", label: "Home" },
  ]);
  const [activeHubTabId, setActiveHubTabId] = useState<string | null>(
    "workspace-home-default",
  );
  const [hubTabsRestored, setHubTabsRestored] = useState(false);
  const [studioPanelWidth, setStudioPanelWidth] = useState(720);
  const [liveThreadPanelWidth, setLiveThreadPanelWidth] = useState(480);
  const [pendingCreateType, setPendingCreateType] =
    useState<ArtifactTypeKey | null>(null);
  const [workspaceDeleteOpen, setWorkspaceDeleteOpen] = useState(false);
  const [workspaceShareOpen, setWorkspaceShareOpen] = useState(false);
  const [artifactDeletePending, setArtifactDeletePending] =
    useState<SpectraArtifact | null>(null);
  const [artifactShareTarget, setArtifactShareTarget] =
    useState<SpectraArtifact | null>(null);
  const [workspaceDeleteConfirmation, setWorkspaceDeleteConfirmation] =
    useState("");
  const workspaceCreateRef = useOutsideClick<HTMLDivElement>(
    workspaceCreateOpen,
    () => setWorkspaceCreateOpen(false),
  );
  const workspaceRequestSequence = useRef(0);
  const overviewRequestSequence = useRef(0);
  const restoredViewWorkspaceId = useRef<string | null>(null);
  const openObjects = useSpectraContextStore((state) => state.openObjects);
  const tileArtifactIds = useSpectraContextStore(
    (state) => state.tileArtifactIds,
  );
  const workSetIsolated = useSpectraContextStore(
    (state) => state.tilesIsolated,
  );
  const openObject = useSpectraContextStore((state) => state.openObject);
  const closePresentation = useSpectraContextStore(
    (state) => state.closePresentation,
  );
  const setTileObjects = useSpectraContextStore(
    (state) => state.setTileObjects,
  );
  const addTileObject = useSpectraContextStore((state) => state.addTileObject);
  const removeTileObject = useSpectraContextStore(
    (state) => state.removeTileObject,
  );
  const clearTiles = useSpectraContextStore((state) => state.clearTiles);
  const setWorkSetIsolated = useSpectraContextStore(
    (state) => state.setTilesIsolated,
  );
  const activeRunPanelId =
    openObjects.find(
      (object) => object.type === "run" && object.presentation === "run-panel",
    )?.id ?? null;
  const threadPanelObject =
    openObjects.find(
      (object) =>
        object.type === "thread" && object.presentation === "thread-panel",
    ) ?? null;
  const liveThread = useMemo(
    () =>
      threadPanelObject
        ? { id: threadPanelObject.id, title: threadPanelObject.label }
        : null,
    [threadPanelObject],
  );

  const loadOverview = useCallback(
    async (workspaceId?: string, quiet = false) => {
      const sequence = ++overviewRequestSequence.current;
      if (!quiet) setLoading(true);
      try {
        const next = await getSpectraOverview(workspaceId, quiet);
        if (sequence !== overviewRequestSequence.current) return null;
        setOverview(next);
        setSelectedWorkspaceId(
          next.workspace
            ? (next.selectedWorkspaceId ?? workspaceId)
            : undefined,
        );
        return next;
      } catch (error) {
        if (sequence !== overviewRequestSequence.current) return null;
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not load Spectra workspace.",
        );
        if (workspaceId) {
          setSelectedWorkspaceId(undefined);
          setSelection(null);
          const fallback = await getSpectraOverview().catch(() => null);
          if (fallback && sequence === overviewRequestSequence.current)
            setOverview(fallback);
        }
        return null;
      } finally {
        if (!quiet && sequence === overviewRequestSequence.current)
          setLoading(false);
      }
    },
    [],
  );

  const loadWorkspace = useCallback(
    async (workspaceId: string, force = false) => {
      const sequence = ++workspaceRequestSequence.current;
      const cached = !force ? peekSpectraWorkspace(workspaceId) : null;
      if (cached) {
        if (sequence !== workspaceRequestSequence.current) return;
        setSelectedWorkspaceId(workspaceId);
        setOverview((current) =>
          current
            ? {
                ...current,
                selectedWorkspaceId: workspaceId,
                workspace: cached,
              }
            : current,
        );
        return;
      }
      setWorkspaceLoading(true);
      try {
        const result = await getSpectraWorkspace(workspaceId, force);
        if (sequence !== workspaceRequestSequence.current) return;
        setSelectedWorkspaceId(workspaceId);
        setOverview((current) =>
          current
            ? {
                ...current,
                selectedWorkspaceId: workspaceId,
                workspace: result.workspace,
              }
            : {
                workspaces: [],
                selectedWorkspaceId: workspaceId,
                workspace: result.workspace,
                artifacts: [],
                runs: [],
                resultCards: [],
              },
        );
      } catch (error) {
        if (sequence !== workspaceRequestSequence.current) return;
        setSelectedWorkspaceId(undefined);
        setSelection(null);
        const message =
          error instanceof Error ? error.message : "Could not load workspace.";
        toast.error(
          message.includes("Workspace not found")
            ? "That workspace is no longer available. Refreshed workspace home."
            : message,
        );
        const fallback = await getSpectraOverview().catch(() => null);
        if (fallback && sequence === workspaceRequestSequence.current)
          setOverview(fallback);
      } finally {
        if (sequence === workspaceRequestSequence.current)
          setWorkspaceLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadOverview(requestedWorkspaceId).then((next) => {
      if (!requestedWorkspaceId || next?.workspace) return;
      router.replace("/workspace");
      toast.message(
        "That workspace is no longer available. Opened workspace home instead.",
      );
    });
  }, [loadOverview, requestedWorkspaceId, router]);

  useEffect(() => {
    if (searchParams.get("create") !== "1") return;
    setWorkspaceCreateOpen(true);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("create");
    const query = next.toString();
    router.replace(query ? `/workspace?${query}` : "/workspace", {
      scroll: false,
    });
  }, [router, searchParams]);

  useEffect(() => {
    try {
      const saved = parseWorkspaceHubTabs(
        JSON.parse(
          window.localStorage.getItem("spectra.workspace.hubTabs.v1") ?? "null",
        ),
      );
      if (saved.tabs.length) {
        setHubTabs(saved.tabs);
        setActiveHubTabId(saved.activeId);
      }
    } catch {
      window.localStorage.removeItem("spectra.workspace.hubTabs.v1");
    }
    setHubTabsRestored(true);
  }, []);
  useEffect(() => {
    if (hubTabsRestored)
      window.localStorage.setItem(
        "spectra.workspace.hubTabs.v1",
        JSON.stringify({ tabs: hubTabs, activeId: activeHubTabId }),
      );
  }, [activeHubTabId, hubTabs, hubTabsRestored]);
  useEffect(() => {
    if (!hubTabsRestored || !overview || selectedWorkspaceId) return;
    const validWorkspaceIds = new Set(
      overview.workspaces.map((item) => item._id),
    );
    const sanitized = parseWorkspaceHubTabs(
      { tabs: hubTabs, activeId: activeHubTabId },
      validWorkspaceIds,
    );
    if (
      sanitized.tabs.length !== hubTabs.length ||
      sanitized.activeId !== activeHubTabId
    ) {
      const fallback = sanitized.tabs.length
        ? sanitized.tabs
        : [{ id: "workspace-home-recovered", label: "Home" }];
      setHubTabs(fallback);
      setActiveHubTabId(sanitized.activeId ?? fallback[0]!.id);
      return;
    }
    const active = sanitized.tabs.find((tab) => tab.id === sanitized.activeId);
    if (active?.workspaceId) void loadWorkspace(active.workspaceId);
  }, [
    activeHubTabId,
    hubTabs,
    hubTabsRestored,
    loadWorkspace,
    overview,
    selectedWorkspaceId,
  ]);

  const workspace =
    selectedWorkspaceId &&
    overview?.workspace?.workspace?._id === selectedWorkspaceId
      ? overview.workspace.workspace
      : null;

  useEffect(() => {
    if (
      !selectedWorkspaceId ||
      restoredViewWorkspaceId.current === selectedWorkspaceId
    )
      return;
    restoredViewWorkspaceId.current = selectedWorkspaceId;
    const saved = window.localStorage.getItem(
      `spectra.workspace.view.${selectedWorkspaceId}`,
    );
    if (
      saved === "list" ||
      saved === "board" ||
      saved === "timeline" ||
      saved === "canvas"
    )
      setViewMode(saved);
  }, [selectedWorkspaceId]);
  useEffect(() => {
    if (
      !selectedWorkspaceId ||
      restoredViewWorkspaceId.current !== selectedWorkspaceId
    )
      return;
    window.localStorage.setItem(
      `spectra.workspace.view.${selectedWorkspaceId}`,
      viewMode,
    );
  }, [selectedWorkspaceId, viewMode]);
  const allArtifacts = overview?.artifacts ?? EMPTY_ARTIFACTS;
  const runs = overview?.runs ?? [];
  const studio = useArtifactStudioState(
    "spectra.shared.artifactStudio",
    allArtifacts,
  );

  useEffect(() => {
    if (
      !hubTabsRestored ||
      !activeHubTabId ||
      selectedWorkspaceId !== requestedWorkspaceId
    )
      return;
    const target = requestedWorkspaceId
      ? overview?.workspaces.find((item) => item._id === requestedWorkspaceId)
      : undefined;
    if (requestedWorkspaceId && !target) return;
    const label = target?.title ?? "Home";
    setHubTabs((current) => {
      const active = current.find((tab) => tab.id === activeHubTabId);
      if (
        !active ||
        (active.label === label && active.workspaceId === requestedWorkspaceId)
      )
        return current;
      return current.map((tab) =>
        tab.id === activeHubTabId
          ? { ...tab, label, workspaceId: requestedWorkspaceId }
          : tab,
      );
    });
  }, [
    activeHubTabId,
    hubTabsRestored,
    overview?.workspaces,
    requestedWorkspaceId,
    selectedWorkspaceId,
  ]);
  const setActiveRunPanelId = useCallback(
    (runId: string | null, label = "Run details") => {
      if (runId)
        openObject({
          type: "run",
          id: runId,
          label,
          presentation: "run-panel",
          workspaceId: selectedWorkspaceId,
        });
      else closePresentation("run-panel");
    },
    [closePresentation, openObject, selectedWorkspaceId],
  );
  const setLiveThread = useCallback(
    (thread: { id: string; title: string } | null) => {
      if (thread)
        openObject({
          type: "thread",
          id: thread.id,
          label: thread.title,
          presentation: "thread-panel",
          workspaceId: selectedWorkspaceId,
        });
      else closePresentation("thread-panel");
    },
    [closePresentation, openObject, selectedWorkspaceId],
  );
  const tiledArtifacts = useMemo(
    () =>
      tileArtifactIds.flatMap((id) => {
        const artifact = allArtifacts.find((item) => item._id === id);
        return artifact ? [artifact] : [];
      }),
    [allArtifacts, tileArtifactIds],
  );
  const workspaceRuns = selectedWorkspaceId
    ? runs.filter((run) => run.workspaceId === selectedWorkspaceId)
    : runs;
  const workspaces = useMemo(
    () => sortSpectraWorkspaces(overview?.workspaces ?? []),
    [overview?.workspaces],
  );
  const {
    composerThread,
    setComposerThread,
    selectedContextIds,
    selectedObjectKeys,
    selectionCount,
    contextArtifactIds,
    explicitContextObjects,
    setSelectedContextIds,
    toggleSelectedObject,
    commitSelection,
    clearDraftSelection,
    setVisibleObjects,
    setActiveWorkspaceContext,
  } = useSpectraContext(allArtifacts, workspaces);
  useEffect(() => {
    if (!requestedThreadId) return;
    void getSpectraThread(requestedThreadId)
      .then((value) => {
        setLiveThread({ id: value.thread._id, title: value.thread.title });
      })
      .catch(() => toast.error("That conversation is no longer available."));
  }, [requestedThreadId, setLiveThread]);
  const contextualArtifactIds = useMemo(
    () =>
      [
        ...new Set([
          ...contextArtifactIds,
          ...tiledArtifacts.map((artifact) => artifact._id),
        ]),
      ].slice(0, 24),
    [contextArtifactIds, tiledArtifacts],
  );
  const workspaceIndexEntry =
    workspaces.find((candidate) => candidate._id === selectedWorkspaceId) ??
    null;
  const workspaceHeader =
    workspaceIndexEntry &&
    (!workspace || workspaceIndexEntry.updatedAt >= workspace.updatedAt)
      ? { ...workspace, ...workspaceIndexEntry }
      : (workspace ?? workspaceIndexEntry);
  useEffect(() => {
    if (!workspaceIndexEntry) return;
    setHubTabs((current) =>
      current.map((tab) =>
        tab.workspaceId === workspaceIndexEntry._id &&
        tab.label !== workspaceIndexEntry.title
          ? { ...tab, label: workspaceIndexEntry.title }
          : tab,
      ),
    );
  }, [workspaceIndexEntry]);
  useEffect(
    () =>
      setActiveWorkspaceContext(
        workspaceHeader
          ? { id: workspaceHeader._id, title: workspaceHeader.title }
          : null,
      ),
    [setActiveWorkspaceContext, workspaceHeader],
  );
  const entries = useMemo<WorkspaceEntry[]>(
    () =>
      (selectedWorkspaceId &&
      overview?.workspace?.workspace?._id === selectedWorkspaceId
        ? overview.workspace.items
        : []
      ).flatMap((item): WorkspaceEntry[] => {
        const card = workspaceItemToCard(item);
        if (item.artifact && card)
          return [{ item, artifact: item.artifact, card }];
        if (item.sourceType === "thread" && item.thread)
          return [{ item, thread: item.thread }];
        return [];
      }),
    [overview?.workspace, selectedWorkspaceId],
  );
  const visibleEntries = useMemo(
    () =>
      entries
        .filter(
          (entry) =>
            workspaceType === "all" ||
            workspaceEntryType(entry) === workspaceType,
        )
        .sort((a, b) => {
          if (workspaceSort === "created")
            return workspaceEntryCreatedAt(b) - workspaceEntryCreatedAt(a);
          if (workspaceSort === "title")
            return workspaceEntryTitle(a).localeCompare(workspaceEntryTitle(b));
          if (workspaceSort === "type")
            return (
              workspaceEntryType(a).localeCompare(workspaceEntryType(b)) ||
              workspaceEntryTitle(a).localeCompare(workspaceEntryTitle(b))
            );
          return workspaceEntryUpdatedAt(b) - workspaceEntryUpdatedAt(a);
        }),
    [entries, workspaceSort, workspaceType],
  );
  const selectedArtifact =
    selection?.type === "artifact"
      ? (entries.find((entry) => entry.item._id === selection.itemId)
          ?.artifact ?? null)
      : null;
  const commandFocusArtifact = studio.isOpen
    ? studio.activeArtifact
    : selectedArtifact;
  useEffect(() => {
    setVisibleObjects([
      ...tiledArtifacts.map((artifact) => ({
        type: "artifact" as const,
        id: artifact._id,
        label: artifact.title,
        workspaceId: artifact.placements?.[0]?.workspaceId,
        source: "visible" as const,
        capability: "tile" as const,
      })),
      ...(commandFocusArtifact
        ? [
            {
              type: "artifact" as const,
              id: commandFocusArtifact._id,
              label: commandFocusArtifact.title,
              workspaceId: commandFocusArtifact.placements?.[0]?.workspaceId,
              source: "visible" as const,
              capability: "tile" as const,
            },
          ]
        : []),
      ...(liveThread
        ? [
            {
              type: "thread" as const,
              id: liveThread.id,
              label: liveThread.title,
              workspaceId: selectedWorkspaceId,
              source: "visible" as const,
              capability: "context" as const,
            },
          ]
        : []),
    ]);
  }, [
    commandFocusArtifact,
    liveThread,
    selectedWorkspaceId,
    setVisibleObjects,
    tiledArtifacts,
  ]);
  const naturalFocusMode: ComposerFocusMode = composerThread
    ? "thread"
    : commandFocusArtifact
      ? "artifact"
      : contextualArtifactIds.length > 0
        ? "selection"
        : workspace
          ? "workspace"
          : "global";
  const effectiveFocusMode =
    focusModeOverride === "selection" && contextualArtifactIds.length === 0
      ? naturalFocusMode
      : focusModeOverride === "artifact" && !commandFocusArtifact
        ? naturalFocusMode
        : focusModeOverride === "workspace" && !workspace
          ? naturalFocusMode
          : focusModeOverride === "thread" && !composerThread
            ? naturalFocusMode
            : (focusModeOverride ?? naturalFocusMode);
  const initialResultCards = useMemo(
    () =>
      (overview?.resultCards ?? []).filter(
        (card) => card.run?.sourceSurface !== "chat",
      ),
    [overview?.resultCards],
  );
  const refreshRunData = useCallback(async () => {
    const focusedArtifactId = commandFocusArtifact?._id;
    const [next, focused] = await Promise.all([
      loadOverview(selectedWorkspaceId, true),
      focusedArtifactId
        ? getSpectraArtifact(focusedArtifactId).catch(() => null)
        : Promise.resolve(null),
    ]);
    // The workspace overview and the artifact query travel independently. A
    // run can commit between those reads, leaving an open editor and its card
    // one revision behind even though the operation completed successfully.
    // The focused-artifact read is the authoritative reconciliation boundary.
    if (focused?.artifact) {
      const canonical = focused.artifact;
      setOverview((current) =>
        current
          ? {
              ...current,
              artifacts: current.artifacts.some(
                (item) => item._id === canonical._id,
              )
                ? current.artifacts.map((item) =>
                    item._id === canonical._id ? canonical : item,
                  )
                : [canonical, ...current.artifacts],
              workspace: current.workspace
                ? {
                    ...current.workspace,
                    items: current.workspace.items.map((item) =>
                      item.artifact?._id === canonical._id
                        ? { ...item, artifact: canonical }
                        : item,
                    ),
                  }
                : current.workspace,
            }
          : current,
      );
    }
    return next;
  }, [commandFocusArtifact?._id, loadOverview, selectedWorkspaceId]);
  const applyLiveArtifactPatch = useCallback(
    (artifactId: string, patch: Record<string, unknown>) => {
      const apply = (artifact: SpectraArtifact): SpectraArtifact => {
        if (artifact._id !== artifactId) return artifact;
        const tags = Array.isArray(patch.tags)
          ? patch.tags.filter((tag): tag is string => typeof tag === "string")
          : undefined;
        const patchedContent = applyPreviewContentPatch(
          artifact.content,
          patch.contentPatch,
        );
        const previewContent =
          patchedContent !== undefined
            ? patchedContent
            : patch.content !== undefined && patch.content !== null
              ? patch.content
              : undefined;
        const effectActivity =
          typeof patch.effectActivity === "string" &&
          ["create", "edit", "verify", "other"].includes(patch.effectActivity)
            ? (patch.effectActivity as "create" | "edit" | "verify" | "other")
            : undefined;
        const effectId =
          typeof patch.effectRunId === "string" &&
          typeof patch.effectExecutionId === "string" &&
          typeof patch.effectTitle === "string"
            ? `${patch.effectRunId}:${
                typeof patch.effectOperationIndex === "number"
                  ? patch.effectOperationIndex
                  : `focused:${typeof patch.effectRegionHint === "string" ? patch.effectRegionHint : (effectActivity ?? "other")}`
              }`
            : undefined;
        const existingEffect = effectId
          ? artifact.aiEffects?.find((effect) => effect.effectId === effectId)
          : undefined;
        const liveEffects = effectId
          ? [
              ...(artifact.aiEffects ?? []).filter(
                (effect) => effect.effectId !== effectId,
              ),
              {
                effectId,
                runId: String(patch.effectRunId),
                executionId: String(patch.effectExecutionId),
                ...(typeof patch.effectOperationIndex === "number"
                  ? { operationIndex: patch.effectOperationIndex }
                  : {}),
                title: String(patch.effectTitle),
                ...(typeof patch.effectDetail === "string"
                  ? { detail: patch.effectDetail }
                  : {}),
                activity: effectActivity ?? "other",
                ...(typeof patch.effectRegionHint === "string"
                  ? { regionHint: patch.effectRegionHint }
                  : {}),
                regionIds: existingEffect?.regionIds ?? [],
                changedPaths: Array.isArray(patch.changedPaths)
                  ? patch.changedPaths.filter(
                      (path): path is string => typeof path === "string",
                    )
                  : (existingEffect?.changedPaths ?? []),
                state: "active" as const,
                startedAt: existingEffect?.startedAt ?? Date.now(),
                updatedAt: Date.now(),
              },
            ].slice(-24)
          : artifact.aiEffects;
        if (artifact.aiState === "creating")
          return {
            ...artifact,
            ...(typeof patch.title === "string" ? { title: patch.title } : {}),
            ...(typeof patch.summary === "string"
              ? { summary: patch.summary }
              : {}),
            ...(previewContent !== undefined
              ? { content: previewContent }
              : {}),
            ...(tags ? { tags } : {}),
            aiProgress:
              typeof patch.progress === "number"
                ? patch.progress
                : artifact.aiProgress,
            aiEffects: liveEffects,
            aiPreview: {
              ...(artifact.aiPreview ?? { startedAt: Date.now() }),
              ...(typeof patch.effectTitle === "string"
                ? { effectTitle: patch.effectTitle }
                : {}),
              ...(typeof patch.effectDetail === "string"
                ? { effectDetail: patch.effectDetail }
                : {}),
              ...(typeof patch.effectActivity === "string" &&
              ["create", "edit", "verify", "other"].includes(
                patch.effectActivity,
              )
                ? {
                    effectActivity: patch.effectActivity as
                      "create" | "edit" | "verify" | "other",
                  }
                : {}),
              ...(typeof patch.effectRegionHint === "string"
                ? { effectRegionHint: patch.effectRegionHint }
                : {}),
              ...(typeof patch.effectOperationIndex === "number"
                ? { effectOperationIndex: patch.effectOperationIndex }
                : {}),
            },
            updatedAt: Date.now(),
          };
        // Existing artifacts keep their canonical baseline stable while the
        // streamed proposal is rendered as a region-scoped overlay. This lets
        // the editor preserve unrelated local typing and prevents a preview from
        // masquerading as a committed revision.
        return {
          ...artifact,
          aiState: "updating",
          aiProgress:
            typeof patch.progress === "number"
              ? patch.progress
              : artifact.aiProgress,
          aiEffects: liveEffects,
          aiPreview: {
            ...(artifact.aiPreview ?? { startedAt: Date.now() }),
            ...(typeof patch.title === "string" ? { title: patch.title } : {}),
            ...(typeof patch.summary === "string"
              ? { summary: patch.summary }
              : {}),
            ...(previewContent !== undefined
              ? { content: previewContent }
              : {}),
            ...(tags ? { tags } : {}),
            ...(Array.isArray(patch.changedPaths)
              ? {
                  changedPaths: patch.changedPaths.filter(
                    (path): path is string => typeof path === "string",
                  ),
                }
              : {}),
            ...(typeof patch.effectTitle === "string"
              ? { effectTitle: patch.effectTitle }
              : {}),
            ...(typeof patch.effectDetail === "string"
              ? { effectDetail: patch.effectDetail }
              : {}),
            ...(typeof patch.effectActivity === "string" &&
            ["create", "edit", "verify", "other"].includes(patch.effectActivity)
              ? {
                  effectActivity: patch.effectActivity as
                    "create" | "edit" | "verify" | "other",
                }
              : {}),
            ...(typeof patch.effectRegionHint === "string"
              ? { effectRegionHint: patch.effectRegionHint }
              : {}),
            ...(typeof patch.effectOperationIndex === "number"
              ? { effectOperationIndex: patch.effectOperationIndex }
              : {}),
          },
        };
      };
      setOverview((current) =>
        current
          ? {
              ...current,
              artifacts: current.artifacts.map(apply),
              workspace: current.workspace
                ? {
                    ...current.workspace,
                    items: current.workspace.items.map((item) =>
                      item.artifact?._id === artifactId
                        ? { ...item, artifact: apply(item.artifact) }
                        : item,
                    ),
                  }
                : current.workspace,
            }
          : current,
      );
    },
    [],
  );
  const runEngine = useSpectraRun({
    surface: composerThread
      ? "workspace"
      : commandFocusArtifact
        ? "artifact"
        : "workspace",
    workspaceId: selectedWorkspaceId,
    artifactId: commandFocusArtifact?._id,
    threadId: composerThread?.id,
    focusMode: effectiveFocusMode,
    selectedArtifactIds: contextualArtifactIds,
    explicitContextObjects,
    currentView: viewMode,
    initialCards: initialResultCards,
    onThreadReady: (threadId) => {
      setComposerThread((current) =>
        current?.id === threadId
          ? current
          : { id: threadId, title: "Current conversation" },
      );
      window.dispatchEvent(new Event("spectra:threads-changed"));
    },
    onContinuationConflict: () => setComposerThread(null),
    onDataChanged: refreshRunData,
    onArtifactPatch: applyLiveArtifactPatch,
    onOpenArtifact: async (artifactId) => {
      const refreshed = await loadOverview(selectedWorkspaceId, true);
      const artifact = refreshed?.artifacts.find(
        (item) => item._id === artifactId,
      );
      if (artifact) openArtifactPanel(artifact);
    },
  });

  useEffect(() => {
    function onOpenArtifact(event: Event) {
      const artifactId = (event as CustomEvent<{ artifactId?: string }>).detail
        ?.artifactId;
      const artifact = artifactId
        ? allArtifacts.find((item) => item._id === artifactId)
        : null;
      if (artifact) openArtifactPanel(artifact);
    }
    function onOpenWorkspace(event: Event) {
      const workspaceId = (event as CustomEvent<{ workspaceId?: string }>)
        .detail?.workspaceId;
      if (workspaceId) goToWorkspaceHub(workspaceId);
    }
    function onAsk(event: Event) {
      const prompt = (
        event as CustomEvent<{ prompt?: string }>
      ).detail?.prompt?.trim();
      if (prompt) void runEngine.run(prompt);
    }
    const tile = () => openSelectedArtifactsInTiles();
    const focusSet = () => {
      openSelectedArtifactsInTiles();
      setWorkSetIsolated(true);
    };
    const clear = () => clearSelection();
    const refresh = () => {
      void loadOverview(selectedWorkspaceId, true);
    };
    window.addEventListener("spectra:open-artifact", onOpenArtifact);
    window.addEventListener("spectra:open-workspace", onOpenWorkspace);
    window.addEventListener("spectra:ask", onAsk);
    window.addEventListener("spectra:tile-selected", tile);
    window.addEventListener("spectra:focus-set", focusSet);
    window.addEventListener("spectra:clear-selection", clear);
    window.addEventListener("spectra:refresh", refresh);
    return () => {
      window.removeEventListener("spectra:open-artifact", onOpenArtifact);
      window.removeEventListener("spectra:open-workspace", onOpenWorkspace);
      window.removeEventListener("spectra:ask", onAsk);
      window.removeEventListener("spectra:tile-selected", tile);
      window.removeEventListener("spectra:focus-set", focusSet);
      window.removeEventListener("spectra:clear-selection", clear);
      window.removeEventListener("spectra:refresh", refresh);
    };
    // Event handlers intentionally read the current shell closures after each render.
  });

  async function openRunPanel(runId: string, title: string) {
    try {
      await getSpectraRunDetail(runId);
      setActiveRunPanelId(runId, title);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Could not open ${title}.`,
      );
    }
  }

  function toggleContextArtifact(artifact: SpectraArtifact) {
    setMultiSelectMode(true);
    setSelectedContextIds((current) => {
      const next = new Set(current);
      if (next.has(artifact._id)) next.delete(artifact._id);
      else if (next.size < 24) next.add(artifact._id);
      else
        toast.message(
          "Context can include up to 24 explicitly selected artifacts.",
        );
      return next;
    });
    setFocusModeOverride("selection");
  }

  function toggleContextEntry(entry: WorkspaceEntry) {
    setMultiSelectMode(true);
    if (entry.artifact) {
      toggleContextArtifact(entry.artifact);
      return;
    }
    if (entry.thread) {
      const result = toggleSelectedObject({
        type: "thread",
        id: entry.thread._id,
        label: entry.thread.title,
        workspaceId: entry.thread.workspaceId,
        source: "selected",
        capability: "context",
      });
      if (result.atLimit)
        toast.message("Selection can include up to 24 objects.");
      setFocusModeOverride("selection");
    }
  }

  function openWorkspaceEntry(entry: WorkspaceEntry) {
    if (entry.thread) {
      setSelection({
        type: "thread",
        itemId: entry.item._id,
        threadId: entry.thread._id,
      });
      openThreadPanel(entry.thread);
      return;
    }
    if (entry.artifact) {
      setSelection({
        type: "artifact",
        itemId: entry.item._id,
        artifactId: entry.artifact._id,
      });
      openArtifactPanel(entry.artifact);
    }
  }

  function restoreLatestSelection() {
    if (selectionCount > 0) setFocusModeOverride("selection");
  }

  function clearSelection() {
    clearDraftSelection();
    setFocusModeOverride(null);
  }

  function openSelectedArtifactsInTiles() {
    const selectedIds = [...selectedContextIds]
      .filter((id) => allArtifacts.some((artifact) => artifact._id === id))
      .slice(0, 24);
    if (selectedIds.length === 0) {
      toast.message("Select one or more artifacts first.");
      return;
    }
    setTileObjects(
      selectedIds.flatMap((id) => {
        const artifact = allArtifacts.find((item) => item._id === id);
        return artifact
          ? [
              {
                type: "artifact" as const,
                id,
                label: artifact.title,
                workspaceId: artifact.placements?.[0]?.workspaceId,
                presentation: "tile" as const,
              },
            ]
          : [];
      }),
    );
    studio.closeStudio();
    setWorkSetIsolated(false);
    setMultiSelectMode(false);
  }

  function closeTileArtifact(artifactId: string) {
    removeTileObject(artifactId);
  }

  function addArtifactTile(artifactId: string) {
    const artifact = allArtifacts.find((item) => item._id === artifactId);
    if (artifact)
      addTileObject({
        type: "artifact",
        id: artifact._id,
        label: artifact.title,
        workspaceId: artifact.placements?.[0]?.workspaceId,
        presentation: "tile",
      });
  }

  function closeTileSet() {
    clearTiles();
  }

  function openArtifactPanel(artifact: SpectraArtifact) {
    if (artifact.blueprintKey === "thread_reference") {
      const content =
        artifact.content && typeof artifact.content === "object"
          ? (artifact.content as Record<string, unknown>)
          : {};
      const threadId =
        typeof content.threadId === "string" ? content.threadId : "";
      if (threadId) {
        setLiveThread({ id: threadId, title: artifact.title });
        return;
      }
    }
    studio.openSplit(artifact);
  }

  function openThreadPanel(thread: SpectraThread) {
    setLiveThread({ id: thread._id, title: thread.title });
  }

  function toggleContinuedThread(
    threadId: string,
    title: string,
    runId?: string,
  ) {
    setComposerThread((current) =>
      current?.id === threadId ? null : { id: threadId, title, runId },
    );
  }

  function replaceWorkspaceLocation(workspaceId?: string) {
    const href = workspaceId
      ? `/workspace?workspaceId=${encodeURIComponent(workspaceId)}`
      : "/workspace";
    const current = requestedWorkspaceId
      ? `/workspace?workspaceId=${encodeURIComponent(requestedWorkspaceId)}`
      : "/workspace";
    if (
      href !== current ||
      searchParams.get("create") ||
      searchParams.get("threadId")
    ) {
      router.replace(href, { scroll: false });
    }
  }

  function setActiveHubDestination(label: string, workspaceId?: string) {
    studio.closeStudio();
    replaceWorkspaceLocation(workspaceId);
    if (activeHubTabId && hubTabs.some((tab) => tab.id === activeHubTabId)) {
      setHubTabs((current) =>
        current.map((tab) =>
          tab.id === activeHubTabId ? { ...tab, label, workspaceId } : tab,
        ),
      );
      return;
    }
    const next = workspaceHubTab(label, workspaceId);
    setHubTabs((current) => [...current, next]);
    setActiveHubTabId(next.id);
  }

  function goToWorkspaceHub(workspaceId: string) {
    const target = workspaces.find((item) => item._id === workspaceId);
    setActiveHubDestination(target?.title ?? "Workspace", workspaceId);
    setSelection(null);
    setViewMode("list");
    setSelectedWorkspaceId(workspaceId);
    void loadWorkspace(workspaceId);
  }

  function goToHomeHub() {
    setActiveHubDestination("Home");
    setSelection(null);
    setSelectedWorkspaceId(undefined);
  }

  function activateHubTab(tabId: string) {
    const tab = hubTabs.find((item) => item.id === tabId);
    if (!tab) return;
    setActiveHubTabId(tabId);
    studio.closeStudio();
    setSelection(null);
    replaceWorkspaceLocation(tab.workspaceId);
    if (tab.workspaceId) void loadWorkspace(tab.workspaceId);
    else {
      setSelectedWorkspaceId(undefined);
    }
  }

  function addHomeHubTab() {
    const next = workspaceHubTab();
    setHubTabs((current) => [...current, next]);
    setActiveHubTabId(next.id);
    studio.closeStudio();
    setSelection(null);
    setSelectedWorkspaceId(undefined);
    replaceWorkspaceLocation();
  }

  function closeHubTab(tabId: string) {
    const closingIndex = hubTabs.findIndex((tab) => tab.id === tabId);
    const remaining = hubTabs.filter((tab) => tab.id !== tabId);
    setHubTabs(remaining);
    if (activeHubTabId !== tabId) return;
    const fallbackHub =
      remaining[
        Math.min(closingIndex > 0 ? closingIndex - 1 : 0, remaining.length - 1)
      ];
    if (fallbackHub) {
      activateHubTab(fallbackHub.id);
      return;
    }
    const fallbackArtifact = studio.tabs[studio.tabs.length - 1];
    if (fallbackArtifact) {
      setActiveHubTabId(null);
      studio.activateTab(fallbackArtifact.artifactId);
      return;
    }
    const replacement = workspaceHubTab();
    setHubTabs([replacement]);
    setActiveHubTabId(replacement.id);
    studio.closeStudio();
    setSelectedWorkspaceId(undefined);
    void loadOverview();
  }

  function closeArtifactTab(artifactId: string) {
    const closesFinalArtifact = studio.tabs.length === 1;
    studio.closeTab(artifactId);
    if (closesFinalArtifact && hubTabs.length === 0) {
      const replacement = workspaceHubTab();
      setHubTabs([replacement]);
      setActiveHubTabId(replacement.id);
      setSelectedWorkspaceId(undefined);
      void loadOverview();
    }
  }

  function returnToHub() {
    const target =
      hubTabs.find((tab) => tab.id === activeHubTabId) ??
      hubTabs[hubTabs.length - 1];
    if (target) activateHubTab(target.id);
    else addHomeHubTab();
  }

  function openCreateArtifact(blueprintKey: ArtifactTypeKey) {
    if (!selectedWorkspaceId) {
      setPendingCreateType(blueprintKey);
      return;
    }
    void createArtifact(
      createDefaultArtifactPayload(blueprintKey),
      selectedWorkspaceId,
    );
  }

  async function createArtifact(
    payload: ArtifactPayload,
    targetWorkspaceId = selectedWorkspaceId,
  ) {
    const label = blueprintMeta[payload.blueprintKey].label;
    setBusyKey(`artifact:${payload.blueprintKey}`);
    try {
      const result = await postSpectra<{ artifactId: string }>({
        action: "createArtifact",
        blueprintKey: payload.blueprintKey,
        title: payload.title,
        summary: payload.summary,
        content: payload.content,
        tags: payload.tags,
        workspaceId: targetWorkspaceId,
      });
      const refreshed = await loadOverview(selectedWorkspaceId);
      const created = refreshed?.artifacts.find(
        (artifact) => artifact._id === result.artifactId,
      );
      if (created) {
        studio.openTab(created);
        toast.success(
          targetWorkspaceId
            ? `${label} created in workspace.`
            : `${label} created as unplaced.`,
        );
      } else {
        toast.message(
          `${label} created. It will appear as soon as the workspace finishes syncing.`,
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Could not create ${label.toLowerCase()}.`,
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function archiveArtifact(artifact: SpectraArtifact) {
    setBusyKey(`artifact:archive:${artifact._id}`);
    try {
      await postSpectra({
        action: "archiveArtifact",
        artifactId: artifact._id,
      });
      toast.success("Artifact archived.");
      returnToHub();
      await loadOverview(selectedWorkspaceId, true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not archive artifact.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function permanentlyDeleteArtifact(
    artifact: SpectraArtifact,
    confirmed = false,
  ) {
    if (!confirmed) {
      setArtifactDeletePending(artifact);
      return;
    }
    setBusyKey(`delete:${artifact._id}`);
    try {
      await postSpectra({ action: "deleteArtifact", artifactId: artifact._id });
      toast.success("Artifact permanently deleted.");
      setArtifactDeletePending(null);
      if (studio.activeArtifact?._id === artifact._id) returnToHub();
      await loadOverview(selectedWorkspaceId, true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete artifact.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function hideWorkspaceItem(workspaceItemId: string) {
    setBusyKey(`hide:${workspaceItemId}`);
    const previousOverview = overview;
    setOverview((current) =>
      current?.workspace
        ? {
            ...current,
            workspace: {
              ...current.workspace,
              items: current.workspace.items.filter(
                (item) => item._id !== workspaceItemId,
              ),
            },
          }
        : current,
    );
    try {
      await postSpectra({ action: "hideWorkspaceItem", workspaceItemId });
      toast.success("Removed from workspace. Artifact remains in library.");
      setSelection((current) =>
        current?.type === "artifact" && current.itemId === workspaceItemId
          ? null
          : current,
      );
      if (selectedWorkspaceId) await loadWorkspace(selectedWorkspaceId, true);
    } catch (error) {
      setOverview(previousOverview);
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not remove workspace card.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function addArtifactToWorkspace(
    artifact: SpectraArtifact,
    workspaceId: string,
  ) {
    setBusyKey(`add:${artifact._id}`);
    try {
      await postSpectra({
        action: "addArtifactToWorkspace",
        artifactId: artifact._id,
        workspaceId,
      });
      toast.success("Added to workspace.");
      if (selectedWorkspaceId === workspaceId)
        await loadWorkspace(workspaceId, true);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not add object to workspace.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function moveArtifactToWorkspace(
    artifact: SpectraArtifact,
    workspaceId: string,
  ) {
    setBusyKey(`move:${artifact._id}`);
    try {
      await postSpectra({
        action: "moveArtifactToWorkspace",
        artifactId: artifact._id,
        workspaceId,
      });
      toast.success("Moved to workspace.");
      if (selectedWorkspaceId) await loadWorkspace(selectedWorkspaceId, true);
      else await loadOverview(undefined, true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not move object.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function moveArtifactToInbox(artifact: SpectraArtifact) {
    setBusyKey(`move:${artifact._id}`);
    try {
      await postSpectra({
        action: "moveArtifactToInbox",
        artifactId: artifact._id,
      });
      toast.success("Moved to Inbox.");
      if (selectedWorkspaceId) await loadWorkspace(selectedWorkspaceId, true);
      else await loadOverview(undefined, true);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not move object to Inbox.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleWorkspaceItemPin(item: SpectraWorkspaceItem) {
    setBusyKey(`pin:item:${item._id}`);
    try {
      await postSpectra({
        action: "setWorkspaceItemPinned",
        workspaceItemId: item._id,
        pinned: !item.viewData.pinned,
      });
      if (selectedWorkspaceId) await loadWorkspace(selectedWorkspaceId, true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update pin.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function createWorkspace() {
    const title = newWorkspaceTitle.trim();
    if (!title) return;
    setBusyKey("workspace:create");
    try {
      const result = await postSpectra<{ workspaceId: string }>({
        action: "createWorkspace",
        title,
        description: newWorkspaceDescription.trim() || undefined,
        icon: newWorkspaceIcon,
      });
      toast.success("Workspace created.");
      setWorkspaceCreateOpen(false);
      setNewWorkspaceTitle("");
      setNewWorkspaceDescription("");
      setNewWorkspaceIcon("Sparkles");
      setSelection(null);
      setViewMode("list");
      setActiveHubDestination(title, result.workspaceId);
      await loadOverview(result.workspaceId);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create workspace.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  function openWorkspaceEdit() {
    if (!workspaceHeader) return;
    setWorkspaceEditTitle(workspaceHeader.title);
    setWorkspaceEditDescription(workspaceHeader.description ?? "");
    setWorkspaceEditIcon(workspaceHeader.icon ?? "Sparkles");
    setWorkspaceEditOpen(true);
  }

  async function updateWorkspaceMetadata() {
    if (!workspaceHeader || !workspaceEditTitle.trim()) return;
    setBusyKey(`workspace:update:${workspaceHeader._id}`);
    try {
      await postSpectra({
        action: "updateWorkspace",
        workspaceId: workspaceHeader._id,
        title: workspaceEditTitle.trim(),
        description: workspaceEditDescription.trim(),
        icon: workspaceEditIcon,
      });
      setWorkspaceEditOpen(false);
      await loadOverview(workspaceHeader._id, true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update workspace.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function permanentlyDeleteWorkspace() {
    if (!selectedWorkspaceId || !workspace) return;
    const expected = `Remove ${workspace.title} permanently`;
    if (workspaceDeleteConfirmation !== expected) return;
    setBusyKey(`workspace:delete:${selectedWorkspaceId}`);
    try {
      await postSpectra({
        action: "deleteWorkspace",
        workspaceId: selectedWorkspaceId,
        confirmation: workspaceDeleteConfirmation,
      });
      toast.success("Workspace permanently removed.");
      setWorkspaceDeleteOpen(false);
      setWorkspaceDeleteConfirmation("");
      setSelection(null);
      setViewMode("list");
      setActiveHubDestination("Home");
      await loadOverview(undefined, true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete workspace.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="spectra-wave-y relative flex h-full min-h-0 bg-[var(--bg-primary)]">
      <div className="flex min-w-0 flex-1 flex-col">
        <StudioTabRail
          hubTabs={
            workSetIsolated && activeHubTabId
              ? hubTabs.map((tab) =>
                  tab.id === activeHubTabId
                    ? {
                        ...tab,
                        label: `Work set · ${tiledArtifacts.length} objects`,
                      }
                    : tab,
                )
              : hubTabs
          }
          activeHubTabId={studio.mode === "tab" ? null : activeHubTabId}
          artifacts={allArtifacts}
          tabs={studio.tabs}
          activeArtifactId={
            studio.mode === "tab" ? studio.activeArtifactId : null
          }
          dirtyIds={studio.dirtyIds}
          onActivateHub={activateHubTab}
          onCloseHub={closeHubTab}
          onAddHub={addHomeHubTab}
          onActivateTab={studio.activateTab}
          onCloseTab={closeArtifactTab}
        />
        <div className="relative flex min-h-0 flex-1">
          {pendingCreateType ? (
            <div
              className="absolute inset-0 z-[90] flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-primary)_72%,transparent)] backdrop-blur-[2px]"
              onPointerDown={() => setPendingCreateType(null)}
            >
              <div
                className="w-[min(390px,calc(100vw-32px))] rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[0_24px_70px_rgba(27,20,12,0.2)]"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <h2 className="font-display text-[19px] font-semibold text-[var(--text-primary)]">
                  Where should this{" "}
                  {blueprintMeta[pendingCreateType].label.toLowerCase()} live?
                </h2>
                <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                  Choose a workspace or keep it unplaced.
                </p>
                <div className="mt-4 max-h-[300px] space-y-1 overflow-y-auto">
                  <button
                    type="button"
                    className={menuItemClass()}
                    onClick={() => {
                      const type = pendingCreateType;
                      setPendingCreateType(null);
                      void createArtifact(
                        createDefaultArtifactPayload(type),
                        undefined,
                      );
                    }}
                  >
                    <Home className="h-4 w-4" />
                    Unplaced / inbox
                  </button>
                  {workspaces.map((target) => (
                    <button
                      key={target._id}
                      type="button"
                      className={menuItemClass()}
                      onClick={() => {
                        const type = pendingCreateType;
                        setPendingCreateType(null);
                        void createArtifact(
                          createDefaultArtifactPayload(type),
                          target._id,
                        );
                      }}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: workspaceAccent(target, 0).color }}
                      />
                      {target.title}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          {workspaceDeleteOpen && workspace ? (
            <div
              className="absolute inset-0 z-[95] flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-primary)_76%,transparent)] backdrop-blur-[2px]"
              onPointerDown={() => setWorkspaceDeleteOpen(false)}
            >
              <div
                className="w-[min(480px,calc(100vw-32px))] rounded-[12px] border border-[color-mix(in_oklab,var(--danger)_28%,var(--border-default))] bg-[var(--bg-elevated)] p-5 shadow-[0_24px_70px_rgba(27,20,12,0.22)]"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <h2 className="font-display text-[21px] font-semibold text-[var(--text-primary)]">
                  Permanently remove {workspace.title}?
                </h2>
                <p className="mt-2 text-[13px] leading-5 text-[var(--text-secondary)]">
                  This removes the workspace and its placements. Artifacts,
                  threads, and AI run history remain available and are never
                  deleted with their workspace.
                </p>
                <label className="mt-4 block text-[12px] font-medium text-[var(--text-primary)]">
                  Type{" "}
                  <span className="select-all font-mono">
                    Remove {workspace.title} permanently
                  </span>
                </label>
                <input
                  autoFocus
                  value={workspaceDeleteConfirmation}
                  onChange={(event) =>
                    setWorkspaceDeleteConfirmation(event.target.value)
                  }
                  className="mt-2 h-10 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] text-[var(--text-primary)] outline-none"
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className={smallButtonClass()}
                    onClick={() => setWorkspaceDeleteOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[var(--danger)] px-3 text-[13px] font-medium text-white disabled:opacity-40"
                    disabled={
                      workspaceDeleteConfirmation !==
                        `Remove ${workspace.title} permanently` ||
                      busyKey === `workspace:delete:${selectedWorkspaceId}`
                    }
                    onClick={() => void permanentlyDeleteWorkspace()}
                  >
                    {busyKey === `workspace:delete:${selectedWorkspaceId}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Delete permanently
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {workspaceShareOpen && workspaceHeader ? (
            <ShareDialog
              open
              resourceType="workspace"
              resourceId={workspaceHeader._id}
              title={workspaceHeader.title}
              onClose={() => setWorkspaceShareOpen(false)}
              onChanged={async () => {
                await loadOverview(workspaceHeader._id, true);
              }}
            />
          ) : null}
          {artifactShareTarget ? (
            <ShareDialog
              open
              resourceType={
                artifactShareTarget.blueprintKey === "agent"
                  ? "agent"
                  : "artifact"
              }
              resourceId={artifactShareTarget._id}
              title={artifactShareTarget.title}
              onClose={() => setArtifactShareTarget(null)}
              onChanged={async () => {
                await loadOverview(selectedWorkspaceId, true);
              }}
            />
          ) : null}
          {workspaceEditOpen && workspaceHeader ? (
            <div
              className="absolute inset-0 z-[94] flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-primary)_76%,transparent)] p-5 backdrop-blur-[2px]"
              onPointerDown={() => setWorkspaceEditOpen(false)}
            >
              <div
                className="w-full max-w-[430px] rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[0_24px_70px_rgba(27,20,12,0.2)]"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <h2 className="font-display text-[21px] font-semibold text-[var(--text-primary)]">
                  Edit workspace
                </h2>
                <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                  Icon
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {workspaceIconChoices.map(([key, Icon]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setWorkspaceEditIcon(key)}
                      className={`flex h-10 w-10 items-center justify-center rounded-[9px] border transition ${workspaceEditIcon === key ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-primary))] text-[var(--accent-cyan)]" : "border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                      aria-label={key}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
                <input
                  autoFocus
                  value={workspaceEditTitle}
                  onChange={(event) =>
                    setWorkspaceEditTitle(event.target.value)
                  }
                  className="mt-4 h-10 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] text-[var(--text-primary)] outline-none"
                />
                <textarea
                  value={workspaceEditDescription}
                  onChange={(event) =>
                    setWorkspaceEditDescription(event.target.value)
                  }
                  placeholder="Short description"
                  className="mt-2 min-h-[84px] w-full resize-none rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none"
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className={smallButtonClass()}
                    onClick={() => setWorkspaceEditOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={smallButtonClass("dark")}
                    disabled={
                      !workspaceEditTitle.trim() ||
                      busyKey === `workspace:update:${workspaceHeader._id}`
                    }
                    onClick={() => void updateWorkspaceMetadata()}
                  >
                    {busyKey === `workspace:update:${workspaceHeader._id}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {artifactDeletePending ? (
            <div
              className="absolute inset-0 z-[96] flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-primary)_76%,transparent)] p-5 backdrop-blur-[2px]"
              onPointerDown={() => setArtifactDeletePending(null)}
            >
              <div
                className="w-full max-w-[440px] rounded-[12px] border border-[color-mix(in_oklab,var(--danger)_24%,var(--border-default))] bg-[var(--bg-elevated)] p-5 shadow-[0_24px_70px_rgba(27,20,12,0.2)]"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <h2 className="font-display text-[21px] font-semibold text-[var(--text-primary)]">
                  Delete {artifactDeletePending.title}?
                </h2>
                <p className="mt-2 text-[13px] leading-5 text-[var(--text-secondary)]">
                  The artifact, its placements, version history, and directly
                  linked run history will be permanently removed.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setArtifactDeletePending(null)}
                    className={smallButtonClass()}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busyKey === `delete:${artifactDeletePending._id}`}
                    onClick={() =>
                      void permanentlyDeleteArtifact(
                        artifactDeletePending,
                        true,
                      )
                    }
                    className="flex h-9 items-center gap-2 rounded-[8px] bg-[var(--danger)] px-3 text-[12px] font-medium text-white disabled:opacity-45"
                  >
                    {busyKey === `delete:${artifactDeletePending._id}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Delete permanently
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {workspaceCreateOpen ? (
            <div
              ref={workspaceCreateRef}
              className="absolute left-3 top-5 z-40 w-[min(330px,calc(100vw-24px))] rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[0_18px_44px_rgba(27,20,12,0.16)]"
            >
              <div className="mb-3">
                <div className="font-display text-[18px] font-semibold text-[var(--text-primary)]">
                  New workspace
                </div>
                <div className="mt-1 text-[12px] text-[var(--text-secondary)]">
                  Create a subject space that stays synced with artifacts.
                </div>
              </div>
              <input
                value={newWorkspaceTitle}
                onChange={(event) => setNewWorkspaceTitle(event.target.value)}
                placeholder="Subject or project name"
                className="h-10 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
              />
              <textarea
                value={newWorkspaceDescription}
                onChange={(event) =>
                  setNewWorkspaceDescription(event.target.value)
                }
                placeholder="Short description"
                className="mt-2 min-h-[70px] w-full resize-none rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
              />
              <div className="mt-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                  Icon
                </div>
                <div className="flex flex-wrap gap-2">
                  {workspaceIconChoices.map(([key, Icon]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setNewWorkspaceIcon(key)}
                      className={`flex h-9 w-9 items-center justify-center rounded-[8px] border transition ${newWorkspaceIcon === key ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-primary))] text-[var(--accent-cyan)]" : "border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)]"}`}
                      aria-label={key}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  className={smallButtonClass()}
                  onClick={() => setWorkspaceCreateOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={smallButtonClass("dark")}
                  disabled={
                    !newWorkspaceTitle.trim() || busyKey === "workspace:create"
                  }
                  onClick={() => void createWorkspace()}
                >
                  {busyKey === "workspace:create" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Create
                </button>
              </div>
            </div>
          ) : null}
          {workSetIsolated && tiledArtifacts.length > 0 ? (
            <ArtifactTileSurface
              isolated
              artifacts={tiledArtifacts}
              allArtifacts={allArtifacts}
              dirtyIds={studio.dirtyIds}
              busyArtifactId={
                busyKey?.startsWith("artifact:update:")
                  ? busyKey.replace("artifact:update:", "")
                  : null
              }
              sourceLabel={workspace?.title ?? "Workspace"}
              continuedThreadId={composerThread?.id}
              onCloseArtifact={closeTileArtifact}
              onCloseAll={closeTileSet}
              onAddArtifact={addArtifactTile}
              onFocusSet={() => setWorkSetIsolated(true)}
              onExitFocusSet={() => setWorkSetIsolated(false)}
              onArchive={archiveArtifact}
              onDirtyChange={studio.setDirty}
              onContinueThread={(threadId, title) =>
                toggleContinuedThread(threadId, title)
              }
            />
          ) : studio.mode === "tab" && studio.activeArtifact ? (
            <ArtifactStudio
              mode="tab"
              artifact={studio.activeArtifact}
              artifacts={allArtifacts}
              tabs={studio.tabs}
              dirtyIds={studio.dirtyIds}
              busy={busyKey === `artifact:update:${studio.activeArtifact._id}`}
              sourceLabel={workspace?.title ?? "Workspace"}
              onClose={returnToHub}
              onExpand={studio.openTab}
              onActivateTab={studio.activateTab}
              onCloseTab={closeArtifactTab}
              onArchive={archiveArtifact}
              onShare={
                studio.activeArtifact.ownership !== "shared"
                  ? (artifact) => setArtifactShareTarget(artifact)
                  : undefined
              }
              onDirtyChange={studio.setDirty}
              compact={Boolean(liveThread)}
            />
          ) : !selectedWorkspaceId && loading && !overview ? (
            <section className="flex min-w-0 flex-1">
              <WorkspaceHomeSkeleton />
            </section>
          ) : !selectedWorkspaceId ? (
            <section className="flex min-w-0 flex-1">
              <WorkspaceHome
                overview={overview ? { ...overview, workspaces } : overview}
                onSelect={goToWorkspaceHub}
                onOpenArtifact={openArtifactPanel}
                onAddArtifactToWorkspace={(artifact, workspaceId) =>
                  void addArtifactToWorkspace(artifact, workspaceId)
                }
                onMoveArtifactToWorkspace={(artifact, workspaceId) =>
                  void moveArtifactToWorkspace(artifact, workspaceId)
                }
                onMoveArtifactToInbox={(artifact) =>
                  void moveArtifactToInbox(artifact)
                }
                onCreateArtifact={(blueprintKey, workspaceId) =>
                  workspaceId
                    ? void createArtifact(
                        createDefaultArtifactPayload(blueprintKey),
                        workspaceId,
                      )
                    : openCreateArtifact(blueprintKey)
                }
                onDeleteArtifact={(artifact) =>
                  void permanentlyDeleteArtifact(artifact)
                }
                selectionMode={multiSelectMode}
                selectedContextIds={selectedContextIds}
                selectedObjectKeys={selectedObjectKeys}
                onToggleContext={toggleContextArtifact}
                onToggleSelection={() => {
                  setMultiSelectMode((value) => {
                    const next = !value;
                    if (next && selectionCount === 0) restoreLatestSelection();
                    return next;
                  });
                  if (selectionCount) setFocusModeOverride("selection");
                }}
                searchControl={
                  <GlobalSearch
                    onOpenArtifact={openArtifactPanel}
                    onOpenWorkspace={(target) => goToWorkspaceHub(target._id)}
                    selectedIds={selectedContextIds}
                    onToggleSelected={toggleContextArtifact}
                  />
                }
              />
              {studio.mode === "split" && studio.activeArtifact ? (
                <ArtifactStudio
                  mode="split"
                  artifact={studio.activeArtifact}
                  artifacts={allArtifacts}
                  tabs={studio.tabs}
                  dirtyIds={studio.dirtyIds}
                  busy={
                    busyKey === `artifact:update:${studio.activeArtifact._id}`
                  }
                  panelWidth={
                    liveThread
                      ? Math.max(480, Math.min(studioPanelWidth, 560))
                      : studioPanelWidth
                  }
                  sourceLabel="Workspace Home"
                  onPanelWidthChange={setStudioPanelWidth}
                  onClose={() => {
                    studio.closeStudio();
                    setSelection(null);
                  }}
                  onExpand={studio.openTab}
                  onActivateTab={studio.activateTab}
                  onCloseTab={closeArtifactTab}
                  onArchive={archiveArtifact}
                  onShare={
                    studio.activeArtifact.ownership !== "shared"
                      ? (artifact) => setArtifactShareTarget(artifact)
                      : undefined
                  }
                  onDirtyChange={studio.setDirty}
                  compact={Boolean(liveThread)}
                />
              ) : null}
              {!workSetIsolated && tiledArtifacts.length > 0 ? (
                <ArtifactTileSurface
                  artifacts={tiledArtifacts}
                  allArtifacts={allArtifacts}
                  dirtyIds={studio.dirtyIds}
                  busyArtifactId={
                    busyKey?.startsWith("artifact:update:")
                      ? busyKey.replace("artifact:update:", "")
                      : null
                  }
                  sourceLabel="Workspace Home"
                  continuedThreadId={composerThread?.id}
                  onCloseArtifact={closeTileArtifact}
                  onCloseAll={closeTileSet}
                  onAddArtifact={addArtifactTile}
                  onFocusSet={() => setWorkSetIsolated(true)}
                  onExitFocusSet={() => setWorkSetIsolated(false)}
                  onArchive={archiveArtifact}
                  onDirtyChange={studio.setDirty}
                  onContinueThread={(threadId, title) =>
                    toggleContinuedThread(threadId, title)
                  }
                />
              ) : null}
            </section>
          ) : (
            <section className="flex min-w-0 flex-1">
              <>
                <div className="flex min-w-0 flex-1 flex-col">
                  <WorkspaceHeader
                    workspace={workspaceHeader}
                    items={entries.map((entry) => entry.item)}
                    runs={workspaceRuns}
                    optimisticActive={Boolean(
                      runEngine.liveExchange &&
                      runEngine.liveExchange.status !== "failed",
                    )}
                    optimisticRunId={runEngine.liveExchange?.runId}
                    busy={busyKey}
                    onCreateArtifact={openCreateArtifact}
                    onEditWorkspace={openWorkspaceEdit}
                    onShareWorkspace={() => setWorkspaceShareOpen(true)}
                    onArchiveWorkspace={() => {
                      setWorkspaceDeleteConfirmation("");
                      setWorkspaceDeleteOpen(true);
                    }}
                  />
                  <main
                    className={
                      viewMode === "canvas"
                        ? "relative min-h-0 flex-1 overflow-hidden px-3 pb-[110px] pt-4 sm:px-5 lg:px-8 lg:pt-6"
                        : "relative min-h-0 flex-1 overflow-y-auto px-3 pb-[150px] pt-4 sm:px-5 lg:px-8 lg:pt-6"
                    }
                  >
                    {!workspace ? <WorkspaceContentSkeleton /> : null}
                    {workspace ? (
                      <WorkspacePinnedShelf
                        entries={entries}
                        workspaceTitle={workspace.title}
                        onSelect={openWorkspaceEntry}
                      />
                    ) : null}
                    {workspace ? (
                      <>
                        {busyKey?.startsWith("artifact:") &&
                        !busyKey.startsWith("artifact:update:") ? (
                          <div
                            className="mb-5 flex min-h-[76px] items-center gap-3 rounded-[12px] border border-[color-mix(in_oklab,var(--accent-cyan)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_6%,var(--bg-elevated))] px-4 shadow-[0_12px_34px_-28px_rgba(25,99,132,.42)]"
                            role="status"
                            aria-live="polite"
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_oklab,var(--accent-cyan)_11%,var(--bg-primary))] text-[var(--accent-cyan)]">
                              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                            </span>
                            <span>
                              <strong className="block text-[12px] font-semibold text-[var(--text-primary)]">
                                Creating{" "}
                                {blueprintMeta[
                                  busyKey.slice(
                                    "artifact:".length,
                                  ) as SpectraBlueprintKey
                                ]?.label?.toLowerCase() ?? "artifact"}
                              </strong>
                              <span className="mt-0.5 block text-[11px] text-[var(--text-secondary)]">
                                Preparing the editor and placing it in this
                                workspace…
                              </span>
                            </span>
                          </div>
                        ) : null}
                        <section className="mt-10">
                          <h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">
                            Workspace library
                          </h2>
                          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                            Objects, activity, and working views for this
                            workspace.
                          </p>
                          <WorkspaceLibraryToolbar
                            viewMode={viewMode}
                            onViewModeChange={setViewMode}
                            sort={workspaceSort}
                            onSortChange={setWorkspaceSort}
                            type={workspaceType}
                            onTypeChange={setWorkspaceType}
                            selectionMode={multiSelectMode}
                            onToggleSelection={() => {
                              setMultiSelectMode((value) => {
                                const next = !value;
                                if (next && selectionCount === 0)
                                  restoreLatestSelection();
                                return next;
                              });
                              if (selectionCount)
                                setFocusModeOverride("selection");
                            }}
                            searchControl={
                              <GlobalSearch
                                onOpenArtifact={openArtifactPanel}
                                onOpenWorkspace={(target) =>
                                  goToWorkspaceHub(target._id)
                                }
                                selectedIds={selectedContextIds}
                                onToggleSelected={toggleContextArtifact}
                                placementWorkspaceId={workspace?._id}
                                placementLabel={workspace?.title}
                                onPlaceArtifact={
                                  workspace
                                    ? (artifact) =>
                                        void addArtifactToWorkspace(
                                          artifact,
                                          workspace._id,
                                        )
                                    : undefined
                                }
                              />
                            }
                          />
                        </section>
                        {viewMode === "timeline" ? (
                          <TimelineView
                            entries={visibleEntries}
                            runs={workspaceRuns}
                            selected={selection}
                            onSelectRun={(run) => {
                              const card = runEngine.cards.find(
                                (candidate) => candidate.runId === run._id,
                              );
                              if (
                                studio.activeArtifact &&
                                studio.dirtyIds.has(studio.activeArtifact._id)
                              ) {
                                toast.message(
                                  "Save or discard the open artifact before opening run details.",
                                );
                                return;
                              }
                              setSelection({ type: "run", runId: run._id });
                              void openRunPanel(
                                card?.runId ?? run._id,
                                run.userPrompt,
                              );
                            }}
                            onSelectEntry={openWorkspaceEntry}
                            selectionMode={multiSelectMode}
                            selectedObjectKeys={selectedObjectKeys}
                            onToggleContext={toggleContextEntry}
                          />
                        ) : null}
                        {viewMode === "list" || viewMode === "board" ? (
                          <LibraryView
                            entries={visibleEntries}
                            workspaces={workspaces}
                            mode={viewMode}
                            selected={selection}
                            onSelect={openWorkspaceEntry}
                            onTogglePin={(item) =>
                              void toggleWorkspaceItemPin(item)
                            }
                            onRemove={(item) =>
                              void hideWorkspaceItem(item._id)
                            }
                            onDelete={(artifact) =>
                              void permanentlyDeleteArtifact(artifact)
                            }
                            onMoveArtifactToWorkspace={(
                              artifact,
                              workspaceId,
                            ) =>
                              void moveArtifactToWorkspace(
                                artifact,
                                workspaceId,
                              )
                            }
                            onMoveArtifactToInbox={(artifact) =>
                              void moveArtifactToInbox(artifact)
                            }
                            busy={busyKey}
                            onCreateArtifact={openCreateArtifact}
                            selectionMode={multiSelectMode}
                            selectedContextIds={selectedContextIds}
                            selectedObjectKeys={selectedObjectKeys}
                            onToggleContext={toggleContextEntry}
                          />
                        ) : null}
                        {viewMode === "canvas" ? (
                          <CanvasView
                            entries={visibleEntries}
                            selected={selection}
                            onSelect={openWorkspaceEntry}
                            selectionMode={multiSelectMode}
                            selectedObjectKeys={selectedObjectKeys}
                            onToggleContext={toggleContextEntry}
                          />
                        ) : null}
                      </>
                    ) : null}
                  </main>
                </div>
                {studio.mode === "split" && studio.activeArtifact ? (
                  <ArtifactStudio
                    mode="split"
                    artifact={studio.activeArtifact}
                    artifacts={allArtifacts}
                    tabs={studio.tabs}
                    dirtyIds={studio.dirtyIds}
                    busy={
                      busyKey === `artifact:update:${studio.activeArtifact._id}`
                    }
                    panelWidth={
                      liveThread
                        ? Math.max(480, Math.min(studioPanelWidth, 560))
                        : studioPanelWidth
                    }
                    sourceLabel={workspace?.title ?? "Workspace"}
                    onPanelWidthChange={setStudioPanelWidth}
                    onClose={() => {
                      studio.closeStudio();
                      setSelection(null);
                    }}
                    onExpand={studio.openTab}
                    onActivateTab={studio.activateTab}
                    onCloseTab={closeArtifactTab}
                    onArchive={archiveArtifact}
                    onShare={
                      studio.activeArtifact.ownership !== "shared"
                        ? (artifact) => setArtifactShareTarget(artifact)
                        : undefined
                    }
                    onDirtyChange={studio.setDirty}
                    compact={Boolean(liveThread)}
                  />
                ) : null}
                {!workSetIsolated && tiledArtifacts.length > 0 ? (
                  <ArtifactTileSurface
                    artifacts={tiledArtifacts}
                    allArtifacts={allArtifacts}
                    dirtyIds={studio.dirtyIds}
                    busyArtifactId={
                      busyKey?.startsWith("artifact:update:")
                        ? busyKey.replace("artifact:update:", "")
                        : null
                    }
                    sourceLabel={workspace?.title ?? "Workspace"}
                    continuedThreadId={composerThread?.id}
                    onCloseArtifact={closeTileArtifact}
                    onCloseAll={closeTileSet}
                    onAddArtifact={addArtifactTile}
                    onFocusSet={() => setWorkSetIsolated(true)}
                    onExitFocusSet={() => setWorkSetIsolated(false)}
                    onArchive={archiveArtifact}
                    onDirtyChange={studio.setDirty}
                    onContinueThread={(threadId, title) =>
                      toggleContinuedThread(threadId, title)
                    }
                  />
                ) : null}
              </>
            </section>
          )}
          <div className="pointer-events-none absolute bottom-0 left-0 right-[var(--spectra-studio-width,0px)] z-[220] bg-transparent px-2 pb-3 pt-2 sm:px-5 sm:pb-5 lg:px-8 min-[1920px]:right-0">
            <div className="pointer-events-auto mx-auto max-w-[880px]">
              <DurableRunTabs
                workspaceId={selectedWorkspaceId}
                optimistic={runEngine.liveExchange}
                openThreadId={liveThread?.id}
                onOpen={(_runId, threadId, title) => {
                  setActiveRunPanelId(null);
                  setLiveThread({ id: threadId, title });
                }}
                onStop={(runId) => runEngine.stop(runId)}
                onRetry={(runId) => void runEngine.retry(runId)}
                onAction={(card, action) =>
                  void runEngine.onCardAction(card, action, card.runId)
                }
                onRevise={(card, revision) =>
                  void runEngine.revise(card, revision)
                }
              />
              {multiSelectMode ? (
                <SelectionActionBar
                  count={selectionCount}
                  onClear={clearSelection}
                  onExit={() => {
                    clearSelection();
                    setMultiSelectMode(false);
                  }}
                  onAddToContext={() => {
                    const count = selectionCount;
                    commitSelection();
                    setFocusModeOverride("selection");
                    setMultiSelectMode(false);
                    toast.success(
                      `${count} object${count === 1 ? "" : "s"} added to context.`,
                    );
                  }}
                  onTile={
                    selectedContextIds.size
                      ? openSelectedArtifactsInTiles
                      : undefined
                  }
                />
              ) : null}
              <div className="flex items-center gap-1">
                <CommandBar
                  className="min-w-0 flex-1"
                  placeholder={
                    composerThread
                      ? `Continue ${composerThread.title}...`
                      : commandFocusArtifact
                        ? `Act on ${commandFocusArtifact.title}...`
                        : workspace
                          ? `Work with ${workspace.title}...`
                          : "Ask across all workspaces and objects..."
                  }
                  onSubmit={(prompt, attachments) => {
                    return runEngine.run(prompt, attachments);
                  }}
                  busy={runEngine.submitting}
                  allowConcurrent={!composerThread}
                  onStop={runEngine.stop}
                  onStartNewThread={() => setComposerThread(null)}
                  context={
                    <ContextFocusControl
                      mode={effectiveFocusMode}
                      onModeChange={setFocusModeOverride}
                      workspace={workspace}
                      artifact={commandFocusArtifact}
                      selectedCount={contextualArtifactIds.length}
                      threadTitle={composerThread?.title}
                    />
                  }
                  menu={
                    <div>
                      <button
                        type="button"
                        className={menuItemClass()}
                        onClick={() => setComposerThread(null)}
                      >
                        <MessageSquare className="h-4 w-4" />
                        New chat
                      </button>
                      <div className="my-1 h-px bg-[var(--border-subtle)]" />
                      {createTypes.map((type) => {
                        const Icon = type.icon;
                        return (
                          <button
                            key={type.key}
                            type="button"
                            className={menuItemClass()}
                            disabled={busyKey === `artifact:${type.key}`}
                            onClick={() => openCreateArtifact(type.key)}
                          >
                            {busyKey === `artifact:${type.key}` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Icon className="h-4 w-4" />
                            )}
                            New {type.label}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className={menuItemClass()}
                        onClick={() => {
                          setMultiSelectMode(true);
                          if (selectionCount === 0) restoreLatestSelection();
                          if (selectionCount) setFocusModeOverride("selection");
                        }}
                      >
                        <Files className="h-4 w-4" />
                        Select objects for context
                      </button>
                      {!selectedWorkspaceId ? (
                        <button
                          type="button"
                          className={menuItemClass()}
                          onClick={() => setWorkspaceCreateOpen(true)}
                        >
                          <Plus className="h-4 w-4" />
                          New workspace
                        </button>
                      ) : null}
                    </div>
                  }
                />
              </div>
            </div>
          </div>
          {liveThread ? (
            <LiveThreadPanel
              threadId={liveThread.id}
              title={liveThread.title}
              width={
                studio.activeArtifact
                  ? Math.min(liveThreadPanelWidth, 420)
                  : liveThreadPanelWidth
              }
              onWidthChange={setLiveThreadPanelWidth}
              onClose={() => setLiveThread(null)}
              onOpenArtifact={(artifactId) => {
                const artifact = allArtifacts.find(
                  (item) => item._id === artifactId,
                );
                if (artifact) openArtifactPanel(artifact);
              }}
              onOpenWorkspace={goToWorkspaceHub}
            />
          ) : null}
          {activeRunPanelId ? (
            <RunDetailPanel
              runId={activeRunPanelId}
              card={runEngine.cards.find(
                (card) => card.runId === activeRunPanelId,
              )}
              onClose={() => setActiveRunPanelId(null)}
              onAction={(card, action, targetId) => {
                if (action === "open") runEngine.closeDetails();
                void runEngine.onCardAction(card, action, targetId);
              }}
              onUseThread={(id, title) =>
                toggleContinuedThread(id, title, activeRunPanelId)
              }
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
