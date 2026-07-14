"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FolderPlus,
  List,
  Loader2,
  MessageSquare,
  PanelTop,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { RichText } from "@/components/chat/rich-text";
import { blueprintMeta } from "./artifact-card";
import { CardTypeIcon, IconAction } from "./card-system";
import { FloatingMenu } from "./floating-menu";
import {
  artifactPlacements,
  formatRelativeTime,
  workspaceAccent,
} from "./spectra-view-model";
import type {
  SpectraArtifact,
  SpectraBlueprintKey,
  SpectraThread,
  SpectraWorkspace,
  SpectraWorkspaceItem,
} from "../data/api";
import type { ArtifactTypeKey } from "../artifacts/types";

export type ObjectLibraryEntry = {
  artifact?: SpectraArtifact;
  thread?: SpectraThread;
  item?: SpectraWorkspaceItem;
};
type GroupBy = "workspace" | "type";
export type LibraryMode = "list" | "board";
type ObjectType = SpectraBlueprintKey | "thread";
type SortMode =
  | "updated"
  | "created"
  | "alphabetical"
  | "type"
  | "pinned"
  | "workspace"
  | "activity";

const types: Array<{ key: "all" | ObjectType; label: string }> = [
  { key: "all", label: "All" },
  { key: "document", label: "Documents" },
  { key: "flashcard_deck", label: "Decks" },
  { key: "quiz", label: "Quizzes" },
  { key: "planner_task", label: "Tasks" },
  { key: "thread", label: "Threads" },
];

const threadMeta = { label: "Conversation", icon: MessageSquare, color: "#8b6ff0" };

function objectId(entry: ObjectLibraryEntry) { return entry.artifact?._id ?? entry.thread?._id ?? entry.item?._id ?? "unknown"; }
function objectTitle(entry: ObjectLibraryEntry) { return entry.artifact?.title ?? entry.thread?.title ?? "Untitled object"; }
function objectSummary(entry: ObjectLibraryEntry) {
  if (entry.artifact?.aiState === "creating") {
    const progress = entry.artifact.aiProgress ?? 0;
    if (progress < 0.12) return "Draft shell ready · reading the request…";
    if (progress < 0.72) return "Writing the artifact’s first sections…";
    if (progress < 0.96) return "Filling in the remaining details…";
    return "Checking the completed artifact…";
  }
  if (entry.artifact?.aiState === "updating")
    return "Applying the requested changes…";
  return entry.artifact?.summary ?? entry.thread?.summaryShort ?? "Continue this conversation.";
}
function objectUpdatedAt(entry: ObjectLibraryEntry) { return entry.artifact?.updatedAt ?? entry.thread?.lastMessageAt ?? entry.thread?.updatedAt ?? entry.item?.updatedAt ?? 0; }
function objectCreatedAt(entry: ObjectLibraryEntry) { return entry.artifact?.createdAt ?? entry.thread?.createdAt ?? entry.item?.createdAt ?? 0; }
function objectType(entry: ObjectLibraryEntry): ObjectType { return entry.thread ? "thread" : entry.artifact?.blueprintKey ?? "document"; }
function objectMeta(entry: ObjectLibraryEntry) { return entry.thread ? threadMeta : blueprintMeta[entry.artifact?.blueprintKey ?? "document"]; }
function objectAiState(entry: ObjectLibraryEntry) {
  const state = entry.artifact?.aiState;
  if (
    state === "edited" &&
    entry.artifact?.aiStateExpiresAt &&
    entry.artifact.aiStateExpiresAt <= Date.now()
  )
    return "normal";
  return state === "creating" || state === "updating"
    ? state
    : state === "edited"
      ? "edited"
      : "normal";
}

export function ObjectLibrary({
  entries,
  workspaces = [],
  groupBy,
  title = "Object library",
  subtitle,
  selectedArtifactId,
  busyKey,
  onOpen,
  onTogglePin,
  onRemove,
  onDelete,
  onAddToWorkspace,
  onMoveToWorkspace,
  onMoveToInbox,
  onCreateArtifact,
  mode: controlledMode,
  onModeChange,
  showModeSwitcher = true,
  showInbox = true,
  showGroups = true,
  showHeader = true,
  showToolbar = true,
  selectionMode = false,
  selectedContextIds,
  selectedObjectKeys,
  onToggleContext,
}: {
  entries: ObjectLibraryEntry[];
  workspaces?: SpectraWorkspace[];
  groupBy: GroupBy;
  title?: string;
  subtitle?: string;
  selectedArtifactId?: string;
  busyKey?: string | null;
  onOpen: (entry: ObjectLibraryEntry) => void;
  onTogglePin?: (entry: ObjectLibraryEntry) => void;
  onRemove?: (entry: ObjectLibraryEntry) => void;
  onDelete?: (entry: ObjectLibraryEntry) => void;
  onAddToWorkspace?: (entry: ObjectLibraryEntry, workspaceId: string) => void;
  onMoveToWorkspace?: (entry: ObjectLibraryEntry, workspaceId: string) => void;
  onMoveToInbox?: (entry: ObjectLibraryEntry) => void;
  onCreateArtifact?: (
    blueprintKey: ArtifactTypeKey,
    workspaceId?: string,
  ) => void;
  mode?: LibraryMode;
  onModeChange?: (mode: LibraryMode) => void;
  showModeSwitcher?: boolean;
  showInbox?: boolean;
  showGroups?: boolean;
  showHeader?: boolean;
  showToolbar?: boolean;
  selectionMode?: boolean;
  selectedContextIds?: Set<string>;
  selectedObjectKeys?: Set<string>;
  onToggleContext?: (entry: ObjectLibraryEntry) => void;
}) {
  const [internalMode, setInternalMode] = useState<LibraryMode>("list");
  const mode = controlledMode ?? internalMode;
  const setMode = (next: LibraryMode) => {
    setInternalMode(next);
    onModeChange?.(next);
  };
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<"all" | ObjectType>(
    "all",
  );
  const [sort, setSort] = useState<SortMode>("updated");
  const [sortOpen, setSortOpen] = useState(false);
  const [placementMenuId, setPlacementMenuId] = useState<string | null>(null);
  const [placementAnchor, setPlacementAnchor] = useState<DOMRect | null>(null);
  const [createMenuKey, setCreateMenuKey] = useState<string | null>(null);
  const [unplacedOpen, setUnplacedOpen] = useState(false);
  const [draggingArtifactId, setDraggingArtifactId] = useState<string | null>(
    null,
  );
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const sortRef = useRef<HTMLDivElement | null>(null);
  const activateEntry = (entry: ObjectLibraryEntry) =>
    selectionMode && onToggleContext ? onToggleContext(entry) : onOpen(entry);

  useEffect(() => {
    if (!sortOpen) return;
    function close(event: PointerEvent) {
      if (!sortRef.current?.contains(event.target as Node)) setSortOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [sortOpen]);

  useEffect(() => {
    if (groupBy !== "workspace") return;
    setUnplacedOpen(
      window.localStorage.getItem("spectra.library.unplaced.open") === "true",
    );
  }, [groupBy]);

  useEffect(() => {
    if (groupBy === "workspace")
      window.localStorage.setItem(
        "spectra.library.unplaced.open",
        String(unplacedOpen),
      );
  }, [groupBy, unplacedOpen]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries
      .filter(
        (entry) =>
          activeType === "all" || objectType(entry) === activeType,
      )
      .filter(
        (entry) =>
          !needle ||
          `${objectTitle(entry)} ${objectSummary(entry)} ${entry.artifact?.tags.join(" ") ?? "conversation thread"}`
            .toLowerCase()
            .includes(needle),
      )
      .sort((a, b) => {
        if (sort === "pinned")
          return (
            Number(Boolean(b.item?.viewData.pinned)) -
              Number(Boolean(a.item?.viewData.pinned)) ||
            objectUpdatedAt(b) - objectUpdatedAt(a)
          );
        if (sort === "workspace")
          return (
            (a.artifact ? artifactPlacements(a.artifact)[0]?.workspaceTitle : workspaces.find((workspace) => workspace._id === a.thread?.workspaceId)?.title) ?? "Unplaced"
          ).localeCompare(
            (b.artifact ? artifactPlacements(b.artifact)[0]?.workspaceTitle : workspaces.find((workspace) => workspace._id === b.thread?.workspaceId)?.title) ?? "Unplaced",
          );
        if (sort === "activity")
          return (
            (b.item?.updatedAt ?? objectUpdatedAt(b)) -
            (a.item?.updatedAt ?? objectUpdatedAt(a))
          );
        if (sort === "alphabetical")
          return objectTitle(a).localeCompare(objectTitle(b));
        if (sort === "created")
          return objectCreatedAt(b) - objectCreatedAt(a);
        if (sort === "type")
          return (
            objectType(a).localeCompare(objectType(b)) ||
            objectTitle(a).localeCompare(objectTitle(b))
          );
        return objectUpdatedAt(b) - objectUpdatedAt(a);
      });
  }, [activeType, entries, search, sort, workspaces]);

  const unplaced =
    groupBy === "workspace"
      ? visible.filter(
          (entry) => entry.artifact ? artifactPlacements(entry.artifact).length === 0 : !entry.thread?.workspaceId,
        )
      : [];
  const groups =
    groupBy === "workspace"
      ? workspaces.map((workspace, index) => ({
          key: workspace._id,
          label: workspace.title,
          color: workspaceAccent(workspace, index).color,
          soft: workspaceAccent(workspace, index).soft,
          border: workspaceAccent(workspace, index).border,
          workspace,
          entries: visible.filter((entry) => entry.thread ? entry.thread.workspaceId === workspace._id : entry.artifact ?
            artifactPlacements(entry.artifact).some(
              (placement) => placement.workspaceId === workspace._id,
            ) : false,
          ),
        }))
      : types.slice(1).map((type) => {
          const meta = type.key === "thread" ? threadMeta : blueprintMeta[type.key as SpectraBlueprintKey];
          return {
            key: type.key,
            label: type.label,
            color: meta.color,
            soft: `color-mix(in oklab, ${meta.color} 7%, var(--bg-elevated))`,
            border: `color-mix(in oklab, ${meta.color} 18%, var(--border-default))`,
            workspace: undefined,
            entries: visible.filter(
              (entry) => objectType(entry) === type.key,
            ),
          };
        });
  const populatedGroups = groups.filter((group) => group.entries.length > 0);
  const canDragMove = Boolean(onMoveToWorkspace || onMoveToInbox);

  function beginDrag(
    event: DragEvent<HTMLElement>,
    entry: ObjectLibraryEntry,
  ) {
    if (selectionMode || !canDragMove || !entry.artifact) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", entry.artifact._id);
    event.dataTransfer.setData("application/x-spectra-artifact", entry.artifact._id);
    setDraggingArtifactId(entry.artifact._id);
  }

  function draggedEntry(event: DragEvent<HTMLElement>) {
    const id =
      event.dataTransfer.getData("application/x-spectra-artifact") ||
      event.dataTransfer.getData("text/plain") ||
      draggingArtifactId;
    return id ? entries.find((entry) => entry.artifact?._id === id) : undefined;
  }

  function allowDrop(event: DragEvent<HTMLElement>, targetKey: string) {
    if (!canDragMove) return;
    const entry = draggedEntry(event);
    if (!entry) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetKey(targetKey);
  }

  function finishDrop(
    event: DragEvent<HTMLElement>,
    target: { workspaceId?: string; inbox?: boolean },
  ) {
    const entry = draggedEntry(event);
    setDropTargetKey(null);
    setDraggingArtifactId(null);
    if (!entry) return;
    event.preventDefault();
    if (target.inbox) {
      onMoveToInbox?.(entry);
      return;
    }
    if (target.workspaceId) {
      if (!entry.artifact) return;
      const placements = artifactPlacements(entry.artifact);
      const alreadyPlaced = placements.some(
        (placement) => placement.workspaceId === target.workspaceId,
      );
      if (!alreadyPlaced) {
        onMoveToWorkspace?.(entry, target.workspaceId);
        onAddToWorkspace?.(entry, target.workspaceId);
      }
    }
  }

  function CompactSummary({
    value,
    fallback,
    className,
  }: {
    value?: string;
    fallback: string;
    className?: string;
  }) {
    return (
      <RichText
        content={value?.trim() || fallback}
        className={`min-w-0 overflow-hidden text-[var(--text-secondary)] [&_*]:inline [&_a_svg]:hidden [&_code]:px-1 [&_p]:m-0 [&_p]:leading-normal ${className ?? ""}`}
      />
    );
  }

  function actions(entry: ObjectLibraryEntry) {
    const pinned = Boolean(entry.item?.viewData.pinned);
    return (
      <div className="flex items-center gap-2">
        <IconAction
          icon={ExternalLink}
          label={entry.thread ? "Open conversation" : "Open artifact"}
          onClick={() => onOpen(entry)}
        />
        {onTogglePin ? (
          <IconAction
            icon={pinned ? PinOff : Pin}
            label={pinned ? "Remove from important" : "Mark important"}
            active={pinned}
            onClick={() => onTogglePin(entry)}
          />
        ) : null}
        {onRemove && entry.item ? (
          <IconAction
            icon={busyKey === `hide:${entry.item._id}` ? Loader2 : X}
            label="Remove from workspace; the artifact remains available"
            danger
            disabled={busyKey === `hide:${entry.item._id}`}
            onClick={() => onRemove(entry)}
            className={busyKey === `hide:${entry.item._id}` ? "animate-spin" : undefined}
          />
        ) : null}
        {onDelete && entry.artifact ? (
          <IconAction
            icon={busyKey === `delete:${entry.artifact._id}` ? Loader2 : Trash2}
            label="Delete artifact permanently"
            danger
            disabled={busyKey === `delete:${entry.artifact._id}`}
            onClick={() => onDelete(entry)}
            className={busyKey === `delete:${entry.artifact._id}` ? "animate-spin" : undefined}
          />
        ) : null}
      </div>
    );
  }

  function placementAction(entry: ObjectLibraryEntry) {
    if (!entry.artifact || !onAddToWorkspace || workspaces.length === 0) return actions(entry);
    const artifact = entry.artifact;
    const open = placementMenuId === artifact._id;
    const placements = artifactPlacements(artifact);
    const hasVisiblePlacement = placements.length > 0;
    return (
      <div className="flex items-center gap-2">
        {actions(entry)}
        <div>
          <IconAction
            icon={FolderPlus}
            label="Add to workspace"
            onClick={(event) => {
              setPlacementAnchor(event.currentTarget.getBoundingClientRect());
              setPlacementMenuId(open ? null : artifact._id);
            }}
          />
          <FloatingMenu
            open={open}
            anchor={placementAnchor}
            onClose={() => setPlacementMenuId(null)}
          >
            {onMoveToInbox && hasVisiblePlacement ? (
              <button
                type="button"
                className="mb-1 flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                onClick={() => {
                  setPlacementMenuId(null);
                  onMoveToInbox(entry);
                }}
              >
                <span className="min-w-0 flex-1 truncate">Move to Inbox</span>
              </button>
            ) : null}
            {workspaces.map((workspace) => {
              const alreadyPlaced = placements.some(
                (placement) => placement.workspaceId === workspace._id,
              );
              const moveAvailable = Boolean(onMoveToWorkspace && hasVisiblePlacement && !alreadyPlaced);
              return (
                <button
                  key={workspace._id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-45"
                  disabled={alreadyPlaced}
                  onClick={() => {
                    setPlacementMenuId(null);
                    if (moveAvailable) onMoveToWorkspace?.(entry, workspace._id);
                    else onAddToWorkspace(entry, workspace._id);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {moveAvailable ? `Move to ${workspace.title}` : workspace.title}
                  </span>
                  {alreadyPlaced ? (
                    <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                  ) : null}
                </button>
              );
            })}
          </FloatingMenu>
        </div>
      </div>
    );
  }

  function creationAction(groupKey: string, workspaceId?: string) {
    if (!onCreateArtifact) return null;
    const open = createMenuKey === groupKey;
    return (
      <div className="relative">
        <button
          type="button"
          className="flex h-8 items-center gap-2 rounded-[7px] px-1 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          onClick={() => setCreateMenuKey(open ? null : groupKey)}
        >
          <Plus className="h-3.5 w-3.5" />
          New artifact
        </button>
        {open ? (
          <div className="absolute bottom-[calc(100%+7px)] left-0 z-30 w-[210px] rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_14px_32px_rgba(27,20,12,0.13)]">
            {types.slice(1).filter((type) => type.key !== "thread").map((type) => {
              const meta = blueprintMeta[type.key as SpectraBlueprintKey];
              const Icon = meta.icon;
              return (
                <button
                  key={type.key}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  onClick={() => {
                    setCreateMenuKey(null);
                    onCreateArtifact(
                      type.key as ArtifactTypeKey,
                      workspaceId,
                    );
                  }}
                >
                  <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
                  {type.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  function unplacedCard(entry: ObjectLibraryEntry) {
    const meta = objectMeta(entry);
    const Icon = meta.icon;
    const id = objectId(entry);
    const selected = selectedObjectKeys?.has(`${entry.thread ? "thread" : "artifact"}:${id}`) ?? selectedContextIds?.has(id);
    return (
      <article
        key={id}
        data-spectra-card="inbox"
        data-card-state={dropTargetKey === "inbox" ? "drop-target" : draggingArtifactId === entry.artifact?._id ? "drag-preview" : selected ? "multi-selected" : objectAiState(entry)}
        data-interactive="true"
        draggable={Boolean(entry.artifact) && canDragMove && !selectionMode}
        className="relative min-h-[118px] overflow-hidden p-3"
        style={{ "--card-accent": meta.color } as CSSProperties}
        onDragStart={(event) => beginDrag(event, entry)}
        onDragEnd={() => {
          setDraggingArtifactId(null);
          setDropTargetKey(null);
        }}
      >
        {selectionMode ? (
          <span
            className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-[6px] border transition ${selected ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)]" : "border-[var(--border-default)] text-transparent"}`}
          >
            <Check className="h-3.5 w-3.5" />
          </span>
        ) : null}
        <button
          type="button"
          className="flex w-full items-start gap-2.5 pl-1 text-left"
          onClick={() => activateEntry(entry)}
        >
          <CardTypeIcon icon={Icon} color={meta.color} className="h-8 w-8" />
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
              {objectTitle(entry)}
            </span>
            <CompactSummary
              value={objectSummary(entry)}
              fallback={meta.label}
              className="mt-0.5 block truncate text-[11px]"
            />
            <span className="mt-1 block text-[10px] text-[var(--text-tertiary)]">
              {meta.label} · {formatRelativeTime(objectUpdatedAt(entry))}
            </span>
          </div>
        </button>
        <div
          className="mt-2 flex justify-end"
          onClick={(event) => event.stopPropagation()}
        >
          {selectionMode ? null : placementAction(entry)}
        </div>
      </article>
    );
  }

  return (
    <section>
      {showHeader ? (
        <div>
          <h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
              {subtitle}
            </p>
          ) : null}
        </div>
      ) : null}

      {showToolbar ? (
        <div className="mt-5 flex flex-wrap items-center gap-2 pb-1">
          <div className="flex shrink-0 gap-1 overflow-x-auto">
            {types.map((type) => (
              <button
                key={type.key}
                type="button"
                onClick={() => setActiveType(type.key)}
                className={`inline-flex h-9 items-center rounded-[8px] px-3 text-[13px] font-medium transition-all ${activeType === type.key ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_1px_7px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--bg-elevated)_68%,transparent)]"}`}
              >
                {type.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative w-[210px] shrink-0">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-9 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-9 pr-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                placeholder="Search objects"
              />
            </div>
            <div className="relative shrink-0" ref={sortRef}>
              <button
                type="button"
                className="flex h-9 min-w-[164px] items-center justify-between gap-3 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[12px] font-medium text-[var(--text-primary)] shadow-[0_1px_4px_rgba(27,20,12,0.04)] hover:bg-[var(--bg-hover)]"
                onClick={() => setSortOpen((open) => !open)}
              >
                <span>
                  {sort === "updated"
                    ? "Recently updated"
                    : sort === "created"
                      ? "Recently created"
                      : sort === "alphabetical"
                        ? "Title A–Z"
                        : sort === "type"
                          ? "Artifact type"
                          : sort === "pinned"
                            ? "Pinned first"
                            : sort === "workspace"
                              ? "Workspace"
                              : "Activity"}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 text-[var(--text-tertiary)] transition ${sortOpen ? "rotate-180" : ""}`}
                />
              </button>
              {sortOpen ? (
                <div className="absolute right-0 top-[calc(100%+7px)] z-30 w-[190px] rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_14px_32px_rgba(27,20,12,0.13)]">
                  {(
                    [
                      ["updated", "Recently updated"],
                      ["created", "Recently created"],
                      ["alphabetical", "Title A–Z"],
                      ["type", "Artifact type"],
                      ["pinned", "Pinned first"],
                      ["workspace", "Workspace"],
                      ["activity", "Activity"],
                    ] as Array<[SortMode, string]>
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className="flex w-full items-center justify-between rounded-[7px] px-2.5 py-2 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                      onClick={() => {
                        setSort(key);
                        setSortOpen(false);
                      }}
                    >
                      <span>{label}</span>
                      {sort === key ? (
                        <Check className="h-3.5 w-3.5 text-[var(--success)]" />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {showModeSwitcher ? (
              <div className="flex shrink-0 rounded-[10px] bg-[color-mix(in_oklab,var(--bg-elevated)_74%,transparent)] p-1 shadow-[inset_0_0_0_1px_var(--border-default)]">
                {[
                  { key: "list" as const, label: "List", icon: List },
                  { key: "board" as const, label: "Board", icon: PanelTop },
                ].map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className={`inline-flex h-8 items-center gap-2 rounded-[7px] px-3 text-[12px] font-medium transition-all duration-200 ${mode === option.key ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_1px_6px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--bg-primary)_52%,transparent)] hover:text-[var(--text-primary)]"}`}
                      onClick={() => setMode(option.key)}
                    >
                      <Icon className="h-4 w-4" />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {showInbox && groupBy === "workspace" ? (
        <section className="mt-7">
          <button
            type="button"
            onClick={() => setUnplacedOpen((open) => !open)}
            className="mb-4 flex w-full items-center gap-2 text-left"
          >
            <ChevronDown
              className={`h-4 w-4 text-[var(--text-tertiary)] transition ${unplacedOpen ? "" : "-rotate-90"}`}
            />
            <h3 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">
              Inbox
            </h3>
            <span className="rounded-[6px] bg-[var(--bg-secondary)] px-1.5 text-[12px] text-[var(--text-secondary)]">
              {unplaced.length}
            </span>
            <span className="ml-1 text-[12px] text-[var(--text-tertiary)]">
              Not placed in a workspace
            </span>
          </button>
          {unplacedOpen ? (
            <div
              className="grid gap-3 xl:grid-cols-3"
              data-card-state={dropTargetKey === "inbox" ? "drop-target" : undefined}
              onDragOver={(event) => allowDrop(event, "inbox")}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTargetKey(null);
              }}
              onDrop={(event) => finishDrop(event, { inbox: true })}
            >
              {unplaced.slice(0, 6).map(unplacedCard)}
              {unplaced.length === 0 ? (
                <div className="rounded-[8px] border border-dashed border-[var(--border-default)] px-4 py-7 text-[13px] text-[var(--text-secondary)]">
                  Inbox is clear.
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {showGroups && mode === "list" ? (
        <main className="mt-8">
          <section>
            <div className="mb-4">
              <h3 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">
                {groupBy === "workspace" ? "In workspaces" : "By type"}
              </h3>
              <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                {groupBy === "workspace"
                  ? "Objects grouped by their workspace."
                  : "Objects grouped by artifact type."}
              </p>
            </div>
            <div className="space-y-4">
              {populatedGroups.map((group) => (
                <section
                  key={group.key}
                  data-spectra-group="true"
                  data-card-state={dropTargetKey === group.key ? "drop-target" : "normal"}
                  className="overflow-hidden rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)]"
                  onDragOver={(event) => allowDrop(event, group.key)}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTargetKey(null);
                  }}
                  onDrop={(event) => finishDrop(event, { workspaceId: group.workspace?._id })}
                >
                  <div
                    className="flex h-11 items-center justify-between border-b border-[var(--border-default)] px-4"
                    style={{ background: group.soft }}
                  >
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: group.color }}
                      />
                      {group.label}
                      <span className="rounded-[5px] bg-[color-mix(in_oklab,var(--bg-elevated)_70%,transparent)] px-1.5 text-[11px] text-[var(--text-secondary)]">
                        {group.entries.length}
                      </span>
                    </div>
                    {group.workspace ? (
                      <span className="text-[12px] text-[var(--text-secondary)]">
                        Workspace <ExternalLink className="inline h-3 w-3" />
                      </span>
                    ) : null}
                  </div>
                  {group.entries
                    .slice(
                      0,
                      expandedGroups.has(group.key) ? group.entries.length : 6,
                    )
                    .map((entry) => {
                      const meta = objectMeta(entry);
                      const Icon = meta.icon;
                      const workspaceName =
                        group.workspace?.title ??
                        (entry.artifact ? artifactPlacements(entry.artifact)[0]?.workspaceTitle : workspaces.find((workspace) => workspace._id === entry.thread?.workspaceId)?.title) ??
                        "Unplaced";
                      const id = objectId(entry);
                      const contextSelected = selectedObjectKeys?.has(`${entry.thread ? "thread" : "artifact"}:${id}`) ?? selectedContextIds?.has(id);
                      return (
                        <div
                          key={`${group.key}:${entry.item?._id ?? id}`}
                          data-object-row="true"
                          data-card-state={draggingArtifactId === entry.artifact?._id ? "drag-preview" : selectedArtifactId === id ? "focused" : contextSelected ? "multi-selected" : objectAiState(entry)}
                          data-interactive="true"
                          draggable={Boolean(entry.artifact) && canDragMove && !selectionMode}
                          className="grid min-h-[58px] cursor-pointer grid-cols-[minmax(260px,1.2fr)_minmax(130px,0.6fr)_minmax(130px,0.5fr)_auto] items-center gap-4 border-b border-[var(--card-border-soft)] px-4 py-2.5 transition-colors last:border-b-0 hover:bg-[color-mix(in_oklab,var(--bg-hover)_58%,transparent)] data-[card-state=context]:bg-[color-mix(in_oklab,var(--card-focus)_5%,transparent)] data-[card-state=focused]:bg-[color-mix(in_oklab,var(--card-focus)_5%,transparent)]"
                          role="button"
                          tabIndex={0}
                          onDragStart={(event) => beginDrag(event, entry)}
                          onDragEnd={() => {
                            setDraggingArtifactId(null);
                            setDropTargetKey(null);
                          }}
                          onClick={() => activateEntry(entry)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ")
                              activateEntry(entry);
                          }}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            {selectionMode ? <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border transition ${contextSelected ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)]" : "border-[var(--border-default)] text-transparent"}`}><Check className="h-3 w-3" /></span> : null}
                            <Icon
                              className="h-5 w-5 shrink-0"
                              style={{ color: meta.color }}
                            />
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                                {objectTitle(entry)}
                              </div>
                              <div className="text-[11px] text-[var(--text-secondary)]">
                                {meta.label}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                            {groupBy === "workspace" ? <>
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ background: group.color }}
                              />
                              {workspaceName}
                            </> : <span className="truncate">{objectSummary(entry)}</span>}
                          </div>
                          <div className="text-[12px] text-[var(--text-secondary)]">
                            Updated{" "}
                            {formatRelativeTime(objectUpdatedAt(entry))}
                          </div>
                          <div onClick={(event) => event.stopPropagation()}>
                            {selectionMode ? null : actions(entry)}
                          </div>
                        </div>
                      );
                    })}
                  {group.entries.length > 6 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedGroups((current) => {
                          const next = new Set(current);
                          if (next.has(group.key)) next.delete(group.key);
                          else next.add(group.key);
                          return next;
                        })
                      }
                      className="flex h-9 w-full items-center justify-center text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                    >
                      {expandedGroups.has(group.key)
                        ? "Show less"
                        : `Show ${group.entries.length - 6} more`}
                    </button>
                  ) : null}
                  {onCreateArtifact ? (
                    <div className="border-t border-[var(--border-default)] px-4 py-1.5">
                      {creationAction(
                        `list-${group.key}`,
                        group.workspace?._id,
                      )}
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
          </section>
        </main>
      ) : null}

      {showGroups && mode === "board" ? (
        <div className="mt-8 overflow-x-auto pb-6">
          <main
            className="grid w-full gap-3 pr-2"
            style={{
              gridTemplateColumns: `repeat(${Math.max(populatedGroups.length, 1)}, minmax(260px, 1fr))`,
              minWidth: `${Math.max(populatedGroups.length, 1) * 276}px`,
            }}
          >
            {populatedGroups.map((group) => {
              const expanded = expandedGroups.has(`board:${group.key}`);
              return (
                <section
                  key={group.key}
                  className="self-start rounded-[10px] border p-2.5 shadow-[0_10px_28px_rgba(27,20,12,0.04)]"
                  data-board-column={group.key}
                  style={{ "--card-accent": group.color, borderColor: group.border, background: group.soft } as CSSProperties}
                >
                  <div className="mb-2 flex h-8 items-center justify-between px-1">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: group.color }}
                      />
                      {group.label}
                      <span className="text-[12px] text-[var(--text-tertiary)]">
                        {group.entries.length}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {group.entries
                      .slice(0, expanded ? group.entries.length : 6)
                      .map((entry) => {
                        const meta = objectMeta(entry);
                        const Icon = meta.icon;
                        const id = objectId(entry);
                        const contextSelected = selectedObjectKeys?.has(`${entry.thread ? "thread" : "artifact"}:${id}`) ?? selectedContextIds?.has(id);
                        return (
                          <button
                            key={`${group.key}:${entry.item?._id ?? id}`}
                            type="button"
                            data-spectra-card="board"
                            data-card-state={contextSelected ? "context" : selectedArtifactId === id ? "focused" : objectAiState(entry)}
                            data-interactive="true"
                            className="flex min-h-[82px] w-full items-start gap-3 px-3 py-3 text-left"
                            style={{ "--card-accent": meta.color } as CSSProperties}
                            onClick={() => activateEntry(entry)}
                          >
                            {selectionMode ? <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border transition ${contextSelected ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)]" : "border-[var(--border-default)] text-transparent"}`}><Check className="h-3 w-3" /></span> : null}
                            <Icon
                              className="h-4 w-4 shrink-0"
                              style={{ color: meta.color }}
                            />
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
                                {objectTitle(entry)}
                              </span>
                              <CompactSummary
                                value={objectSummary(entry)}
                                fallback={meta.label}
                                className="block truncate text-[10px]"
                              />
                            </div>
                            <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">
                              {formatRelativeTime(objectUpdatedAt(entry))}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                  {group.entries.length > 6 ? (
                    <button
                      type="button"
                      className="mt-2 h-8 px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      onClick={() =>
                        setExpandedGroups((current) => {
                          const next = new Set(current);
                          if (expanded) next.delete(`board:${group.key}`);
                          else next.add(`board:${group.key}`);
                          return next;
                        })
                      }
                    >
                      {expanded
                        ? "Show fewer"
                        : `Show ${group.entries.length - 6} more`}
                    </button>
                  ) : null}
                  {onCreateArtifact ? (
                    <div className="mt-1.5 border-t border-[color-mix(in_oklab,var(--border-default)_72%,transparent)] px-1 pt-1">
                      {creationAction(
                        `board-${group.key}`,
                        group.workspace?._id,
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </main>
        </div>
      ) : null}
    </section>
  );
}
