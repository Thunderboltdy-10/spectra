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
  PanelRight,
  PanelRightClose,
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
  Presentation,
  Table2,
  Code2,
  Workflow,
  CalendarDays,
  Bot,
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
import { useNow } from "@/hooks/use-now";
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
import {
  CommandBar,
  CommandBarMenuItem,
  CommandBarSubmenu,
} from "../components/command-bar";
import {
  ContextFocusControl,
  GlobalSearch,
  SelectionActionBar,
  type ComposerFocusMode,
} from "../components/context-controls";
import { DurableRunTabs } from "../components/durable-run-tabs";
import { RunDetailPanel } from "../components/run-detail-panel";
import { LiveThreadPanel } from "../components/live-thread-panel";
import {
  disengageFollowAi,
  isProgrammaticOpen,
} from "../collaboration/follow-ai";
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
  exportSpectraWorkspaceManifest,
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

type ViewMode = "list" | "board" | "canvas";
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

const AI_EDITED_FLASH_FALLBACK_MS = 90_000;

function liveAiIsActive(
  artifact?:
    | Pick<SpectraArtifact, "aiState" | "aiEffects">
    | Pick<SpectraWorkspace, "aiState">
    | null,
) {
  if (!artifact) return false;
  if (artifact.aiState === "creating" || artifact.aiState === "updating")
    return true;
  return (
    "aiEffects" in artifact &&
    (artifact.aiEffects ?? []).some((effect) => effect.state === "active")
  );
}

function aiEditedExpiresAt(
  artifact?: Pick<
    SpectraArtifact,
    "aiState" | "aiStateExpiresAt" | "updatedAt"
  > | null,
) {
  if (!artifact || artifact.aiState !== "edited") return undefined;
  if (artifact.aiStateExpiresAt) return artifact.aiStateExpiresAt;
  if (artifact.updatedAt)
    return artifact.updatedAt + AI_EDITED_FLASH_FALLBACK_MS;
  return undefined;
}

function expireLiveAiChrome<T extends SpectraArtifact>(
  artifact: T,
  now = Date.now(),
): T {
  const effects = (artifact.aiEffects ?? []).filter(
    (effect) => !effect.expiresAt || effect.expiresAt > now,
  );
  const activeEffects = effects.filter((effect) => effect.state === "active");
  const working =
    artifact.aiState === "creating" || artifact.aiState === "updating";
  // Failed / abandoned runs must not leave cards and studios pulsing forever.
  // Promote leftover settling ink to a quiet edited flash, or clear entirely.
  // Stuck creating/updating with an orphan aiRunId (no live effects) also clears —
  // otherwise list cards keep the infinite cyan sweep after the run already stopped.
  if (working && activeEffects.length === 0) {
    if (effects.length > 0) {
      const expiresAt =
        effects
          .map((effect) => effect.expiresAt)
          .filter((value): value is number => typeof value === "number")
          .sort((left, right) => left - right)[0] ??
        now + AI_EDITED_FLASH_FALLBACK_MS;
      return {
        ...artifact,
        aiState: "edited",
        aiProgress: undefined,
        aiStateExpiresAt: expiresAt,
        aiEffects: effects,
      };
    }
    return {
      ...artifact,
      aiState: undefined,
      aiRunId: undefined,
      aiExecutionId: undefined,
      aiProgress: undefined,
      aiPreview: undefined,
      aiStateExpiresAt: undefined,
      aiEffects: undefined,
    };
  }
  const editedExpiry = aiEditedExpiresAt(artifact);
  const editedExpired =
    artifact.aiState === "edited" && (!editedExpiry || editedExpiry <= now);
  if (!editedExpired && effects.length === (artifact.aiEffects ?? []).length)
    return artifact;
  return {
    ...artifact,
    ...(editedExpired
      ? {
          aiState: undefined,
          aiProgress: undefined,
          aiPreview: undefined,
          aiStateExpiresAt: undefined,
        }
      : {}),
    aiEffects: effects.length ? effects : undefined,
  };
}

function visibleArtifactCardAiState(
  artifact:
    | Pick<
        SpectraArtifact,
        "aiState" | "aiStateExpiresAt" | "updatedAt" | "aiEffects" | "aiRunId"
      >
    | null
    | undefined,
  now: number,
): "creating" | "updating" | "edited" | "failed" | "normal" {
  if (!artifact) return "normal";
  const expired = expireLiveAiChrome(artifact as SpectraArtifact, now);
  const state = expired.aiState;
  if (state === "creating" || state === "updating") return state;
  if (state === "failed") return "failed";
  if (state === "edited") {
    const expires = aiEditedExpiresAt(expired);
    return expires && expires > now ? "edited" : "normal";
  }
  return "normal";
}

function useLiveAiExpiryClock(
  artifacts: Array<
    | Pick<
        SpectraArtifact,
        "aiState" | "aiStateExpiresAt" | "updatedAt" | "aiEffects"
      >
    | null
    | undefined
  >,
) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const expiryTimes = artifacts.flatMap((artifact) => {
      if (!artifact) return [] as number[];
      const times: number[] = [];
      const editedExpiry = aiEditedExpiresAt(artifact);
      if (editedExpiry && editedExpiry > now) times.push(editedExpiry);
      for (const effect of artifact.aiEffects ?? []) {
        if (effect.expiresAt && effect.expiresAt > now)
          times.push(effect.expiresAt);
      }
      return times;
    });
    const nextExpiry = expiryTimes.sort((a, b) => a - b)[0];
    if (!nextExpiry) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(16, nextExpiry - Date.now() + 24),
    );
    return () => window.clearTimeout(timer);
  }, [artifacts, now]);
  return now;
}

function mergeLiveAiArtifact(
  previous: SpectraArtifact | undefined,
  next: SpectraArtifact,
): SpectraArtifact {
  const now = Date.now();
  const settledNext = expireLiveAiChrome(next, now);
  if (!previous || previous._id !== settledNext._id) return settledNext;
  const settledPrevious = expireLiveAiChrome(previous, now);
  if (
    !liveAiIsActive(settledNext) &&
    settledNext.aiState !== "edited" &&
    (settledNext.updatedAt ?? 0) > (settledPrevious.updatedAt ?? 0)
  ) {
    // A strictly newer server revision without AI chrome means the write
    // finished (or never started on the server). Same-timestamp overview
    // polls must not wipe optimistic focused-edit SSE chrome — otherwise
    // mid-edit studios lose aiState=updating and data-ai-region stays 0.
    return settledNext;
  }
  if (
    !liveAiIsActive(settledNext) &&
    settledNext.aiState !== "edited" &&
    typeof settledNext.summary === "string" &&
    settledNext.summary.includes("Incomplete draft preserved")
  ) {
    return settledNext;
  }
  if (liveAiIsActive(settledNext)) return settledNext;
  if (!liveAiIsActive(settledPrevious)) return settledNext;
  if ((settledNext.updatedAt ?? 0) > (settledPrevious.updatedAt ?? 0))
    return settledNext;
  if (
    settledPrevious.aiStateExpiresAt &&
    settledPrevious.aiStateExpiresAt <= now
  ) {
    return settledNext;
  }
  // Overview/poll snapshots lag the live SSE patch stream. Keep the client's
  // active AI chrome until the server reports the same working state.
  return {
    ...settledNext,
    aiState: settledPrevious.aiState,
    aiProgress: settledPrevious.aiProgress ?? settledNext.aiProgress,
    aiEffects: settledPrevious.aiEffects ?? settledNext.aiEffects,
    aiPreview: settledPrevious.aiPreview ?? settledNext.aiPreview,
    aiStateExpiresAt:
      settledPrevious.aiStateExpiresAt ?? settledNext.aiStateExpiresAt,
    ...(settledPrevious.aiState === "creating"
      ? {
          title: settledPrevious.title || settledNext.title,
          summary: settledPrevious.summary ?? settledNext.summary,
          content: settledPrevious.content ?? settledNext.content,
        }
      : {}),
  };
}

function mergeLiveAiArtifacts(
  previous: SpectraArtifact[] | undefined,
  next: SpectraArtifact[],
) {
  if (!previous?.length) return next;
  const previousById = new Map(
    previous.map((artifact) => [artifact._id, artifact]),
  );
  return next.map((artifact) =>
    mergeLiveAiArtifact(previousById.get(artifact._id), artifact),
  );
}

function mergeLiveAiWorkspaceBundle(
  previous:
    | {
        workspace: SpectraWorkspace;
        items: SpectraWorkspaceItem[];
      }
    | null
    | undefined,
  next:
    | {
        workspace: SpectraWorkspace;
        items: SpectraWorkspaceItem[];
      }
    | null
    | undefined,
) {
  if (!next) return next;
  if (!previous) return next;
  const previousWorkspace = previous.workspace;
  const nextWorkspace = next.workspace;
  const preserveWorkspaceAi =
    liveAiIsActive(previousWorkspace) && !liveAiIsActive(nextWorkspace);
  return {
    workspace: preserveWorkspaceAi
      ? {
          ...nextWorkspace,
          aiState: previousWorkspace.aiState,
          aiPreview: previousWorkspace.aiPreview ?? nextWorkspace.aiPreview,
        }
      : nextWorkspace,
    items: next.items.map((item) => {
      if (!item.artifact) return item;
      const prior =
        previous.items.find(
          (candidate) => candidate.artifact?._id === item.artifact?._id,
        )?.artifact ?? undefined;
      const merged = mergeLiveAiArtifact(prior, item.artifact);
      return merged === item.artifact ? item : { ...item, artifact: merged };
    }),
  };
}

function mergeLiveAiOverview(
  previous: SpectraOverview | null | undefined,
  next: SpectraOverview,
): SpectraOverview {
  if (!previous) return next;
  return {
    ...next,
    artifacts: mergeLiveAiArtifacts(previous.artifacts, next.artifacts),
    workspace:
      mergeLiveAiWorkspaceBundle(previous.workspace, next.workspace) ?? null,
  };
}

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
  { key: "agent", label: "Agent", icon: Bot },
  { key: "presentation", label: "Presentation", icon: Presentation },
  { key: "sheets", label: "Sheet", icon: Table2 },
  { key: "code", label: "Code & visualisation", icon: Code2 },
  { key: "whiteboard", label: "Whiteboard", icon: Workflow },
  { key: "timetable", label: "Timetable", icon: CalendarDays },
];

const viewModes: Array<{ key: ViewMode; label: string; icon: LucideIcon }> = [
  { key: "list", label: "List", icon: List },
  { key: "board", label: "Board", icon: PanelTop },
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
  hideActivityRail = false,
  activityRailCollapsed = false,
  onToggleActivityRail,
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
  hideActivityRail?: boolean;
  activityRailCollapsed?: boolean;
  onToggleActivityRail?: () => void;
}) {
  const selectedObjects = useSpectraContextStore(
    (state) => state.selectionDraft,
  );
  const toggleSelectionObject = useSpectraContextStore(
    (state) => state.toggleSelection,
  );
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [dropWorkspaceId, setDropWorkspaceId] = useState<string | null>(null);
  const now = useNow(60_000);
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
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const byType = (key: string) =>
    artifacts.filter((artifact) => artifact.blueprintKey === key);
  const freshThisWeek = (list: typeof artifacts) =>
    list.filter((artifact) => artifact.updatedAt >= weekAgo).length;
  const metricCards = [
    {
      label: "Artifacts",
      count: artifacts.length,
      delta: freshThisWeek(artifacts),
      icon: FileText,
      color: "#15946d",
    },
    {
      label: "Flashcards",
      count: byType("flashcard_deck").length,
      delta: freshThisWeek(byType("flashcard_deck")),
      icon: BookOpen,
      color: "#735ce7",
    },
    {
      label: "Quizzes",
      count: byType("quiz").length,
      delta: freshThisWeek(byType("quiz")),
      icon: HelpCircle,
      color: "#e56b3e",
    },
    {
      label: "Documents",
      count: byType("document").length,
      delta: freshThisWeek(byType("document")),
      icon: FileText,
      color: "#168fd2",
    },
    {
      label: "Decks",
      count: byType("presentation").length,
      delta: freshThisWeek(byType("presentation")),
      icon: Sparkles,
      color: "#d69222",
    },
    {
      label: "Tasks",
      count: byType("planner_task").length,
      delta: freshThisWeek(byType("planner_task")),
      icon: CalendarCheck2,
      color: "#6f6962",
    },
  ];
  const visibleTags = Array.from(
    new Set(artifacts.flatMap((artifact) => artifact.tags ?? [])),
  ).slice(0, 8);

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
      className="spectra-mission-control flex min-h-0 flex-1 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden"
    >
      <div className="min-w-0 flex-1 px-6 pb-[170px] pt-6 sm:px-9 xl:h-full xl:overflow-y-auto">
        <div className="spectra-mission-control-primary">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[#e8f7f1] text-[#15946d]">
              <Sprout className="h-[18px] w-[18px]" />
            </span>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--text-tertiary)]">
                Workspace
              </div>
              <h1 className="font-display text-[34px] font-semibold leading-[1.05] tracking-[-.025em] text-[var(--text-primary)]">
                Mission Control
              </h1>
              <p className="mt-2 max-w-[46ch] text-[14px] leading-relaxed text-[var(--text-secondary)]">
                Your overview of work, artifacts, and activity across Spectra.
              </p>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {metricCards.map(
              ({ label, count, delta, icon: MetricIcon, color }) => (
                <div
                  key={label}
                  className="flex min-h-[80px] items-center gap-3 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3.5"
                >
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-[8px]"
                    style={{
                      background: `color-mix(in oklab, ${color} 11%, white)`,
                      color,
                    }}
                  >
                    <MetricIcon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] text-[var(--text-secondary)]">
                      {label}
                    </span>
                    <strong className="block font-sans text-[20px] font-normal leading-6 tracking-[-0.01em] text-[var(--text-primary)]">
                      {count}
                    </strong>
                    <span className="block text-[11px] font-medium text-[var(--success)]">
                      {delta ? `+${delta} this week` : "No change this week"}
                    </span>
                  </span>
                </div>
              ),
            )}
          </div>
        </div>

        <div className="spectra-workspace-home-grid mt-8">
          <section className="spectra-mission-control-workspaces">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[12px] font-semibold text-[var(--text-primary)]">
                Workspace at a glance
              </h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Scroll workspaces left"
                  onClick={(event) =>
                    event.currentTarget
                      .closest("section")
                      ?.querySelector(".spectra-workspace-card-grid")
                      ?.scrollBy({ left: -320, behavior: "smooth" })
                  }
                  className="grid size-6 place-items-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <ChevronDown className="h-3.5 w-3.5 rotate-90" />
                </button>
                <button
                  type="button"
                  aria-label="Scroll workspaces right"
                  onClick={(event) =>
                    event.currentTarget
                      .closest("section")
                      ?.querySelector(".spectra-workspace-card-grid")
                      ?.scrollBy({ left: 320, behavior: "smooth" })
                  }
                  className="grid size-6 place-items-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
                </button>
              </div>
            </div>
            <div className="spectra-workspace-card-grid grid content-start gap-2 md:grid-cols-2 xl:grid-cols-3">
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
                    className="group relative min-h-[140px] overflow-hidden p-3 text-left"
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
                    <span className="pointer-events-none absolute right-3 top-3 z-[2] rounded-full bg-[color-mix(in_oklab,var(--success)_10%,var(--bg-elevated))] px-2 py-0.5 text-[8.5px] font-semibold text-[var(--success)]">
                      Active
                    </span>
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
                        <span className="flex items-center gap-2 pr-12">
                          <span className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold leading-tight text-[var(--text-primary)]">
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
                        <span className="mt-0.5 block text-[9px] font-medium text-[var(--brand-primary)]">
                          {index === 0 ? "Primary workspace" : "Secondary"}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-[9.5px] leading-4 text-[var(--text-secondary)]">
                          {workspace.description}
                        </span>
                        <span className="mt-2.5 flex items-center gap-1.5 text-[8.5px] text-[var(--text-tertiary)]">
                          <span className="font-normal text-[var(--text-secondary)]">
                            {count} artifacts
                          </span>
                          <span aria-hidden="true">·</span>
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
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(new Event("spectra:create-workspace"))
                }
                className="flex min-h-[140px] items-center justify-center gap-3 rounded-[9px] border border-[var(--border-default)] text-left text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <span className="grid size-8 place-items-center rounded-[7px] bg-[var(--bg-secondary)]">
                  <Plus size={15} />
                </span>
                <span>
                  <strong className="block text-[10px] font-semibold text-[var(--text-primary)]">
                    New workspace
                  </strong>
                  <span className="text-[8px]">Create a new workspace</span>
                </span>
              </button>
            </div>
          </section>

          <div
            id="spectra-mission-all-work"
            className="spectra-mission-control-library mt-9 scroll-mt-6"
          >
            <ObjectLibrary
              entries={artifacts.map((artifact) => ({ artifact }))}
              workspaces={workspaces}
              groupBy="workspace"
              title="All work"
              subtitle="Artifacts and conversations across your workspaces"
              showHeader={false}
              flatTable
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
      </div>

      {hideActivityRail ? null : activityRailCollapsed ? (
        <div className="hidden shrink-0 border-t border-[var(--border-default)] bg-[var(--mission-rail)] xl:flex xl:h-full xl:w-10 xl:flex-col xl:items-center xl:border-l xl:border-t-0 xl:pt-4">
          <button
            type="button"
            aria-label="Show recent activity"
            title="Show recent activity"
            onClick={onToggleActivityRail}
            className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <PanelRight className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <aside className="spectra-mission-control-rail w-full shrink-0 space-y-6 border-t border-[var(--border-default)] bg-[var(--mission-rail)] px-5 py-6 xl:h-full xl:w-[320px] xl:overflow-y-auto xl:border-l xl:border-t-0">
          <section>
            <div className="flex items-center justify-between px-1">
              <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
                Recent activity
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-[12px] font-medium text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)]"
                  onClick={() => {
                    document
                      .getElementById("spectra-mission-all-work")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  View all
                </button>
                {onToggleActivityRail ? (
                  <button
                    type="button"
                    aria-label="Hide recent activity"
                    title="Hide recent activity"
                    onClick={onToggleActivityRail}
                    className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  >
                    <PanelRightClose className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-2 grid gap-0.5">
              {activity.map((entry) => {
                const meta = blueprintMeta[entry.artifact.blueprintKey];
                const ActivityIcon = meta.icon;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className="flex min-h-10 w-full items-start gap-2.5 rounded-[7px] px-1.5 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                    onClick={() => onOpenArtifact(entry.artifact)}
                  >
                    <span
                      className="mt-0.5 grid size-5.5 shrink-0 place-items-center rounded-[6px]"
                      style={{
                        background: `color-mix(in oklab, ${meta.color} 10%, var(--bg-elevated))`,
                        color: meta.color,
                      }}
                    >
                      <ActivityIcon size={12} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">
                        {entry.title}
                      </div>
                      <div className="mt-px text-[11px] text-[var(--text-secondary)]">
                        You {entry.detail.toLowerCase()}{" "}
                        {meta.label
                          ? `a ${meta.label.toLowerCase()}`
                          : "an artifact"}
                      </div>
                    </div>
                    <span className="mt-0.5 shrink-0 text-[11px] tabular-nums text-[var(--text-tertiary)]">
                      {formatRelativeTime(entry.time)}
                    </span>
                  </button>
                );
              })}
              {activity.length === 0 ? (
                <div className="px-1.5 text-[10px] text-[var(--text-secondary)]">
                  No activity yet.
                </div>
              ) : null}
            </div>
          </section>
          {pinnedArtifacts.length ? (
            <section>
              <div className="flex items-center justify-between px-1">
                <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
                  Pinned
                </h2>
                <button
                  type="button"
                  className="text-[12px] font-medium text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)]"
                  onClick={() => {
                    document
                      .getElementById("spectra-mission-all-work")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    const firstPinned = pinnedArtifacts[0];
                    if (firstPinned) onOpenArtifact(firstPinned);
                  }}
                >
                  Manage
                </button>
              </div>
              <div className="mt-2 space-y-0.5">
                {pinnedArtifacts.slice(0, 4).map((artifact) => {
                  const meta = blueprintMeta[artifact.blueprintKey];
                  const ArtifactIcon = meta.icon;
                  return (
                    <button
                      type="button"
                      key={artifact._id}
                      onClick={() => onOpenArtifact(artifact)}
                      className="flex w-full items-center gap-2.5 rounded-[7px] px-1.5 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                    >
                      <span
                        className="grid size-5.5 shrink-0 place-items-center rounded-[6px]"
                        style={{
                          background: `color-mix(in oklab, ${meta.color} 10%, var(--bg-elevated))`,
                          color: meta.color,
                        }}
                      >
                        <ArtifactIcon size={12} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold text-[var(--text-primary)]">
                          {artifact.title}
                        </span>
                        <span className="block text-[11px] text-[var(--text-tertiary)]">
                          {meta.label}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}
          <section>
            <div className="flex items-center justify-between px-1">
              <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
                Tags
              </h2>
              <button
                type="button"
                className="text-[12px] font-medium text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)]"
                onClick={() => {
                  document
                    .getElementById("spectra-mission-all-work")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                Manage
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 px-1">
              {visibleTags.length ? (
                visibleTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)]"
                  >
                    {tag}
                  </span>
                ))
              ) : (
                <span className="text-[12px] text-[var(--text-tertiary)]">
                  Tags appear as you organise work.
                </span>
              )}
            </div>
          </section>
          <section>
            <h2 className="px-1 text-[13px] font-semibold text-[var(--text-primary)]">
              Quick actions
            </h2>
            <div className="mt-2 space-y-0.5">
              {createTypes.map(({ key, label, icon: QuickIcon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onCreateArtifact(key)}
                  className="flex h-9 w-full items-center gap-2.5 rounded-[8px] px-1.5 text-[13px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <QuickIcon
                    size={14}
                    className="text-[var(--text-tertiary)]"
                  />
                  New {label.toLowerCase()}
                </button>
              ))}
            </div>
          </section>
        </aside>
      )}
    </main>
  );
}

function WorkspaceHeader({
  workspace,
  items,
  runs,
  optimisticActive,
  optimisticRunId,
  viewMode,
  busy,
  onCreateArtifact,
  onEditWorkspace,
  onShareWorkspace,
  onExportWorkspace: _onExportWorkspace,
  onArchiveWorkspace: _onArchiveWorkspace,
  onViewModeChange,
}: {
  workspace: SpectraWorkspace | null;
  items: SpectraWorkspaceItem[];
  runs: SpectraRun[];
  optimisticActive?: boolean;
  optimisticRunId?: string;
  viewMode: ViewMode;
  busy: string | null;
  onCreateArtifact: (type: ArtifactTypeKey) => void;
  onEditWorkspace: () => void;
  onShareWorkspace: () => void;
  onExportWorkspace: () => void;
  onArchiveWorkspace: () => void;
  onViewModeChange: (view: ViewMode) => void;
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
  const primaryLabel =
    viewMode === "list" ? "Library" : viewMode === "board" ? "Board" : "Canvas";

  return (
    <header
      className="spectra-workspace-header border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-5 pb-0 pt-4"
      aria-label={`${artifactCount} artifacts, ${threadCount} threads, ${cardCount} pinned, ${activeRuns} active runs`}
    >
      <div className="flex items-start justify-between gap-5">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-[10px] bg-[color-mix(in_oklab,var(--accent-violet)_10%,var(--bg-elevated))] text-[var(--accent-violet)]">
            <Sprout className="size-7" />
          </span>
          <div className="min-w-0 pt-0.5">
            <div className="flex items-center gap-2">
              <h1 className="truncate font-display text-[29px] font-semibold leading-[1.12] tracking-[-.02em] text-[var(--text-primary)]">
                {workspace?.title ?? "Workspace"}
              </h1>
              {workspace?.isShared ? (
                <Share2
                  className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]"
                  aria-label="Shared workspace"
                />
              ) : null}
              <button
                type="button"
                onClick={onEditWorkspace}
                aria-label="Favorite workspace"
                className="grid size-7 place-items-center rounded-[6px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <Sparkles className="size-3.5" />
              </button>
            </div>
            <p className="mt-1.5 max-w-[52ch] text-[14px] leading-relaxed text-[var(--text-secondary)]">
              {workspace?.description ?? "All your work, organized and ready."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
          <button
            type="button"
            onClick={onEditWorkspace}
            aria-label="Workspace settings"
            title="Workspace settings"
            className="grid size-9 place-items-center rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <PencilLine className="size-4" />
          </button>
        </div>
      </div>
      <nav
        className="mt-2 flex min-w-0 items-center gap-7 overflow-x-auto"
        aria-label="Workspace sections"
      >
        <button
          type="button"
          className="relative h-11 shrink-0 text-[13px] font-semibold text-[var(--brand-primary)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--brand-primary)]"
          onClick={() => onViewModeChange(viewMode)}
          aria-current="page"
        >
          {primaryLabel}
        </button>
        <button
          type="button"
          className="flex h-11 shrink-0 items-center gap-1.5 text-[13px] font-medium text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
          onClick={onShareWorkspace}
        >
          People
          {workspace?.sharedWithCount ? (
            <span className="rounded-full bg-[color-mix(in_oklab,var(--accent-violet)_12%,var(--bg-secondary))] px-1.5 py-0.5 text-[11px] text-[var(--accent-violet)]">
              {workspace.sharedWithCount}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className="h-10 shrink-0 text-[12px] font-medium text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
          onClick={onEditWorkspace}
        >
          Settings
        </button>
      </nav>
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
  compact = false,
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
  compact?: boolean;
}) {
  const [sortOpen, setSortOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const ref = useOutsideClick<HTMLDivElement>(sortOpen, () =>
    setSortOpen(false),
  );
  const typeRef = useOutsideClick<HTMLDivElement>(typeOpen, () =>
    setTypeOpen(false),
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
    { key: "agent", label: "Agents" },
    { key: "presentation", label: "Presentations" },
    { key: "sheets", label: "Sheets" },
    { key: "code", label: "Code" },
    { key: "whiteboard", label: "Whiteboards" },
    { key: "timetable", label: "Timetable" },
    { key: "thread", label: "Threads" },
  ];
  return (
    <div
      className="spectra-workspace-toolbar flex flex-wrap items-center gap-2"
      aria-label="Workspace library controls"
    >
      {!compact ? (
        <div className="ml-auto flex items-center gap-2">
          {searchControl}
          <div className="relative" ref={typeRef}>
            <button
              type="button"
              onClick={() => setTypeOpen((open) => !open)}
              className="flex h-9 items-center gap-2 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <Rows3 className="size-3.5" />
              {type === "all"
                ? "Filter"
                : types.find((option) => option.key === type)?.label}
            </button>
            {typeOpen ? (
              <div className="absolute left-0 top-[calc(100%+7px)] z-40 w-[180px] rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_14px_32px_rgba(27,20,12,0.13)]">
                {types.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={menuItemClass()}
                    onClick={() => {
                      onTypeChange(option.key);
                      setTypeOpen(false);
                    }}
                  >
                    {option.label}
                    {type === option.key ? (
                      <CheckCircle2 className="ml-auto size-3.5 text-[var(--success)]" />
                    ) : null}
                  </button>
                ))}
                <div className="my-1 border-t border-[var(--border-default)]" />
                <button
                  type="button"
                  className={menuItemClass()}
                  onClick={() => {
                    onToggleSelection();
                    setTypeOpen(false);
                  }}
                >
                  <Files className="size-3.5" />
                  {selectionMode ? "Done selecting" : "Select objects"}
                </button>
              </div>
            ) : null}
          </div>
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
      ) : null}
      {!compact ? (
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
              {(
                Object.entries(sortLabels) as Array<[WorkspaceSort, string]>
              ).map(([key, label]) => (
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
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
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

function _TimelineView({
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
    <div className="relative space-y-4 pb-3 pl-8 pt-3 before:absolute before:bottom-4 before:left-[7px] before:top-[18px] before:w-px before:bg-[linear-gradient(to_bottom,var(--text-primary),color-mix(in_oklab,var(--text-primary)_18%,var(--border-default)),transparent)]">
      {dateGroups.map((group, groupIndex) => (
        <section key={group.key} className="relative">
          <span className="absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--bg-primary)] ring-4 ring-[var(--bg-primary)]">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-[var(--accent-cyan)] bg-[var(--bg-elevated)]" />
          </span>
          <header className="mb-2 flex items-baseline gap-3">
            <h2 className="font-display text-[12px] font-semibold text-[var(--text-primary)]">
              {group.label}
            </h2>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {new Date(Number(group.key)).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
            <span className="ml-auto text-[9px] text-[var(--text-tertiary)]">
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
                row.kind === "thread"
                  ? "min-h-[78px] border-l-[3px] border-l-[#8b6ff0]"
                  : "min-h-[78px]";
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
                      : entry?.artifact?.aiState === "creating"
                        ? "creating"
                        : entry?.artifact?.aiState === "updating"
                          ? "updating"
                          : row.kind === "run" &&
                              (row.run.status === "queued" ||
                                row.run.status === "running")
                            ? "creating"
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
                  className={`group relative overflow-hidden p-3 text-left ${hierarchy} ${surface}`}
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
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[var(--bg-primary)]">
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
                      <span className="mt-1 block truncate text-[11px] font-semibold text-[var(--text-primary)]">
                        {entry
                          ? workspaceEntryTitle(entry)
                          : row.kind === "run"
                            ? row.run.userPrompt
                            : row.title}
                      </span>
                      <span className="mt-1 block truncate text-[9px] text-[var(--text-secondary)]">
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
  workspaces: _workspaces,
  mode,
  selected: _selected,
  onSelect,
  onTogglePin: _onTogglePin,
  onRemove: _onRemove,
  onDelete: _onDelete,
  onMoveArtifactToWorkspace: _onMoveArtifactToWorkspace,
  onMoveArtifactToInbox: _onMoveArtifactToInbox,
  busy: _busy,
  onCreateArtifact: _onCreateArtifact,
  selectionMode,
  selectedContextIds: _selectedContextIds,
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
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const aiClock = useLiveAiExpiryClock(entries.map((entry) => entry.artifact));

  if (entries.length === 0) {
    return (
      <EmptyWorkspaceState
        title="No library items here"
        message="Add artifacts to this workspace to group them by type."
      />
    );
  }

  const groupOrder: Array<{
    key: SpectraBlueprintKey | "thread";
    label: string;
  }> = [
    { key: "document", label: "Documents" },
    { key: "flashcard_deck", label: "Flashcard Decks" },
    { key: "quiz", label: "Quizzes" },
    { key: "planner_task", label: "Planner Tasks" },
    { key: "agent", label: "Agents" },
    { key: "presentation", label: "Presentations" },
    { key: "sheets", label: "Sheets" },
    { key: "code", label: "Code & Visualisations" },
    { key: "whiteboard", label: "Whiteboards" },
    { key: "timetable", label: "Timetable Items" },
    { key: "thread", label: "Threads" },
  ];
  const groups = groupOrder
    .map((group) => ({
      ...group,
      entries: entries.filter((entry) =>
        group.key === "thread"
          ? Boolean(entry.thread)
          : entry.artifact?.blueprintKey === group.key,
      ),
    }))
    .filter((group) => group.entries.length > 0);

  if (mode === "list") {
    const allExpanded =
      groups.length > 0 && groups.every((group) => expandedKeys.has(group.key));

    return (
      <div>
        <div className="mb-3 mt-5 flex items-center justify-between">
          <h2 className="font-display text-[16px] font-semibold text-[var(--text-primary)]">
            All artifacts
          </h2>
          <button
            type="button"
            className="text-[12px] font-medium text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)]"
            onClick={() => {
              if (allExpanded) {
                setExpandedKeys(new Set());
                return;
              }
              setExpandedKeys(new Set(groups.map((group) => group.key)));
            }}
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>
        <div className="spectra-workspace-type-index overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)]">
          {groups.map((group) => (
            <WorkspaceTypeGroupRow
              key={group.key}
              group={group}
              aiClock={aiClock}
              expanded={expandedKeys.has(group.key)}
              onExpandedChange={(next) => {
                setExpandedKeys((current) => {
                  const copy = new Set(current);
                  if (next) copy.add(group.key);
                  else copy.delete(group.key);
                  return copy;
                });
              }}
              onSelect={onSelect}
              selectionMode={selectionMode}
              selectedObjectKeys={selectedObjectKeys}
              onToggleContext={onToggleContext}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 overflow-x-auto pb-4">
      <main
        className="grid gap-4 pr-2"
        style={{
          gridTemplateColumns: `repeat(${Math.max(groups.length, 1)}, clamp(300px, 28vw, 400px))`,
          width: "max-content",
        }}
      >
        {groups.map((group) => {
          const meta =
            group.key === "thread"
              ? { color: "#8b6ff0", label: group.label }
              : { color: blueprintMeta[group.key].color, label: group.label };
          return (
            <section
              key={group.key}
              data-board-column={group.key}
              className="min-h-[520px] rounded-[12px] border p-3 shadow-[0_10px_28px_rgba(27,20,12,0.04)]"
              style={
                {
                  "--card-accent": meta.color,
                  borderColor: `color-mix(in oklab, ${meta.color} 24%, var(--border-default))`,
                  background: `color-mix(in oklab, ${meta.color} 3%, var(--bg-primary))`,
                } as CSSProperties
              }
            >
              <div className="mb-3 flex items-center gap-2 px-1 text-[13px] font-semibold text-[var(--text-primary)]">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: meta.color }}
                />
                {group.label}
                <span className="text-[12px] text-[var(--text-tertiary)]">
                  {group.entries.length}
                </span>
              </div>
              <div className="space-y-2.5">
                {group.entries.map((entry) => {
                  if (entry.artifact && entry.card) {
                    return (
                      <ArtifactCard
                        key={entry.item._id}
                        artifact={entry.card}
                        quiet
                        className="spectra-card--board"
                        onSelect={() =>
                          selectionMode
                            ? onToggleContext(entry)
                            : onSelect(entry)
                        }
                        selectionMode={selectionMode}
                        contextSelected={selectedObjectKeys.has(
                          `artifact:${entry.artifact._id}`,
                        )}
                        onToggleContext={() => onToggleContext(entry)}
                      />
                    );
                  }
                  return (
                    <button
                      key={entry.item._id}
                      type="button"
                      onClick={() =>
                        selectionMode ? onToggleContext(entry) : onSelect(entry)
                      }
                      className="flex min-h-[72px] w-full flex-col rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2.5 text-left"
                    >
                      <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                        {workspaceEntryTitle(entry)}
                      </span>
                      <span className="mt-1 line-clamp-2 text-[11px] text-[var(--text-secondary)]">
                        {workspaceEntrySummary(entry)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}

function WorkspaceTypeGroupRow({
  group,
  aiClock,
  expanded,
  onExpandedChange,
  onSelect,
  selectionMode = false,
  selectedObjectKeys,
  onToggleContext,
}: {
  group: {
    key: SpectraBlueprintKey | "thread";
    label: string;
    entries: WorkspaceEntry[];
  };
  aiClock: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSelect: (entry: WorkspaceEntry) => void;
  selectionMode?: boolean;
  selectedObjectKeys?: Set<string>;
  onToggleContext?: (entry: WorkspaceEntry) => void;
}) {
  const meta =
    group.key === "thread"
      ? { icon: MessageSquare, color: "#8b6ff0" }
      : blueprintMeta[group.key];
  const GroupIcon = meta.icon;
  const entryChip = (entry: WorkspaceEntry, full?: boolean) => {
    const objectKey = `${entry.thread ? "thread" : "artifact"}:${entry.thread?._id ?? entry.artifact?._id ?? ""}`;
    const contextSelected = Boolean(
      selectedObjectKeys?.has(objectKey) ||
      (entry.artifact &&
        selectedObjectKeys?.has(`artifact:${entry.artifact._id}`)),
    );
    const aiState = visibleArtifactCardAiState(entry.artifact, aiClock);
    return (
      <button
        key={entry.item._id}
        type="button"
        data-spectra-card={entry.thread ? "thread" : "artifact"}
        data-card-state={contextSelected ? "multi-selected" : aiState}
        onClick={() =>
          selectionMode && onToggleContext
            ? onToggleContext(entry)
            : onSelect(entry)
        }
        aria-pressed={selectionMode ? contextSelected : undefined}
        className={`relative flex h-8 min-w-0 items-center gap-1.5 overflow-hidden rounded-[6px] border px-2.5 text-left text-[12px] text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)] ${full ? "w-full" : "flex-1"} ${
          contextSelected
            ? "border-[var(--text-primary)] bg-[color-mix(in_oklab,var(--text-primary)_8%,var(--bg-primary))]"
            : "border-[var(--border-default)] bg-[var(--bg-primary)]"
        }`}
      >
        <GroupIcon
          className="size-3.5 shrink-0"
          style={{ color: meta.color }}
        />
        <span className="truncate">{workspaceEntryTitle(entry)}</span>
      </button>
    );
  };
  return (
    <div className="border-b border-[var(--card-border-soft)] px-3 last:border-0">
      <div className="grid min-h-[48px] grid-cols-[220px_minmax(0,1fr)_36px] items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <GroupIcon
            className="size-4 shrink-0"
            style={{ color: meta.color }}
          />
          <span className="truncate font-display text-[13px] font-semibold text-[var(--text-primary)]">
            {group.label}
          </span>
          <span className="rounded-[5px] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
            {group.entries.length}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          {expanded
            ? null
            : group.entries.slice(0, 3).map((entry) => entryChip(entry))}
          {!expanded && group.entries.length > 3 ? (
            <button
              type="button"
              onClick={() => onExpandedChange(true)}
              className="shrink-0 rounded-[6px] bg-[var(--bg-secondary)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              +{group.entries.length - 3}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onExpandedChange(!expanded)}
          aria-expanded={expanded}
          aria-label={
            expanded ? `Collapse ${group.label}` : `Expand ${group.label}`
          }
          className="grid size-8 place-items-center rounded-[6px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
        >
          <ChevronDown
            className={`size-4 transition-transform ${expanded ? "" : "-rotate-90"}`}
          />
        </button>
      </div>
      {expanded ? (
        <div className="grid gap-1.5 pb-3 pl-1 sm:grid-cols-2 xl:grid-cols-3">
          {group.entries.map((entry) => entryChip(entry, true))}
        </div>
      ) : null}
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
    <section className="spectra-workspace-pinned-shelf mb-2 mt-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mb-3 flex w-full min-w-0 items-center gap-2 text-left"
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition ${open ? "" : "-rotate-90"}`}
        />
        <Pin className="h-4 w-4 shrink-0 text-[#b67616]" />
        <h2 className="min-w-0 truncate font-display text-[14px] font-semibold text-[var(--text-primary)]">
          Pinned
        </h2>
        <span className="shrink-0 rounded-[6px] bg-[var(--bg-secondary)] px-1.5 text-[12px] text-[var(--text-secondary)]">
          {pinned.length}
        </span>
        <span className="ml-auto hidden text-[9px] text-[var(--text-tertiary)] min-[720px]:inline">
          Manage pinned
        </span>
      </button>
      {open ? (
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
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
      className="spectra-workspace-canvas relative h-full min-h-full overflow-auto bg-[radial-gradient(color-mix(in_oklab,var(--border-default)_62%,transparent)_0.65px,transparent_0.8px)] p-4 pb-20 [background-size:18px_18px] sm:p-5 sm:pb-20"
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
              className={`self-start rounded-[8px] border p-2.5 lg:col-span-1 ${layouts[index % layouts.length]}`}
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
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {group.entries.slice(0, 6).map((entry) => {
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
                {group.entries.length > 6 ? (
                  <div className="col-span-full flex h-8 items-center justify-center rounded-[6px] border border-dashed border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_72%,transparent)] font-sans text-[10px] font-normal text-[var(--text-tertiary)]">
                    {group.entries.length - 6} more in this cluster
                  </div>
                ) : null}
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
  collapsed = false,
  onToggleCollapsed,
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
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  if (collapsed) {
    // Fully free the main column — no residual right rail. The reopen control
    // is rendered by the parent as an overlay when details are hidden.
    return null;
  }

  const collapseControl = onToggleCollapsed ? (
    <button
      type="button"
      aria-label="Hide details panel"
      title="Hide details panel"
      onClick={onToggleCollapsed}
      className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
    >
      <PanelRightClose className="h-3.5 w-3.5" />
    </button>
  ) : null;

  if (selectedRun) {
    const affected =
      artifacts.find((artifact) => artifact._id === selectedRun.artifactId) ??
      null;
    return (
      <aside className="hidden w-[318px] shrink-0 border-l border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-6 xl:block">
        <InspectorTitle
          title="Selected run"
          onClose={onClose}
          trailing={collapseControl}
        />
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
        <InspectorTitle
          title="Selected artifact"
          onClose={onClose}
          trailing={collapseControl}
        />
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
  const recentActivity = [...workspaceArtifacts]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);
  const workspaceTags = Array.from(
    new Set(workspaceArtifacts.flatMap((artifact) => artifact.tags ?? [])),
  ).slice(0, 12);
  const activeRuns = runs.filter(
    (run) => run.status === "queued" || run.status === "running",
  ).length;
  const sharedWithCount = workspace?.sharedWithCount ?? 0;

  return (
    <aside className="hidden w-[320px] shrink-0 border-l border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-6 xl:block">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
          {workspace?.title ?? "Workspace"} details
        </h2>
        <div className="flex items-center gap-1.5">
          {workspace?.status === "active" ? (
            <span className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
              Active
            </span>
          ) : null}
          {collapseControl}
        </div>
      </div>

      <section className="mt-5 space-y-3 text-[13px]">
        {workspace?.description ? (
          <p className="leading-5 text-[var(--text-secondary)]">
            {workspace.description}
          </p>
        ) : null}
        <MetricRow
          label="Created"
          value={workspace ? formatShortDate(workspace.createdAt) : "—"}
        />
        {sharedWithCount > 0 ? (
          <MetricRow label="Shared with" value={String(sharedWithCount)} />
        ) : null}
        <MetricRow
          label="Artifacts"
          value={String(workspaceArtifacts.length)}
        />
        <MetricRow label="Active runs" value={String(activeRuns)} />
      </section>

      <InspectorSection title="Recent activity">
        <div className="space-y-1">
          {recentActivity.map((artifact) => {
            const meta = blueprintMeta[artifact.blueprintKey];
            return (
              <button
                key={artifact._id}
                type="button"
                className="flex w-full items-start gap-2.5 rounded-[8px] px-1.5 py-1.5 text-left transition hover:bg-[var(--bg-hover)]"
                onClick={() => onOpenArtifact(artifact)}
              >
                <span className="mt-0.5 min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">
                    {artifact.title}
                  </span>
                  <span className="block text-[11px] text-[var(--text-tertiary)]">
                    {meta.label} · updated{" "}
                    {formatRelativeTime(artifact.updatedAt)}
                  </span>
                </span>
              </button>
            );
          })}
          {recentActivity.length === 0 ? (
            <p className="text-[13px] text-[var(--text-secondary)]">
              No activity yet.
            </p>
          ) : null}
        </div>
      </InspectorSection>

      {workspaceTags.length ? (
        <InspectorSection title="Tags">
          <div className="flex flex-wrap gap-1.5">
            {workspaceTags.map((tag) => (
              <span
                key={tag}
                className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)]"
              >
                {tag}
              </span>
            ))}
          </div>
        </InspectorSection>
      ) : null}

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
  trailing,
}: {
  title: string;
  onClose: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
        {title}
      </h2>
      <div className="flex items-center gap-1">
        {trailing}
        <button
          type="button"
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
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
      <strong className="font-sans font-normal text-[var(--text-primary)]">
        {value}
      </strong>
    </div>
  );
}

function _PinnedArtifactShelf({
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
  const requestedHome = searchParams.get("home") === "1";
  const [overview, setOverview] = useState<SpectraOverview | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<
    string | undefined
  >();
  const [selection, setSelection] = useState<Selection>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [attachmentsHost, setAttachmentsHost] = useState<HTMLDivElement | null>(
    null,
  );
  const [focusModeOverride, setFocusModeOverride] =
    useState<ComposerFocusMode | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [workspaceSort, setWorkspaceSort] = useState<WorkspaceSort>("updated");
  const [workspaceType, setWorkspaceType] = useState<
    "all" | WorkspaceObjectType
  >("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setWorkspaceLoading] = useState(false);
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
  const [homeActivityRailCollapsed, setHomeActivityRailCollapsed] =
    useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [navCursor, setNavCursor] = useState(-1);
  const navStackRef = useRef<
    Array<{
      kind: "hub" | "artifact-split" | "artifact-tab";
      hubTabId: string | null;
      workspaceId?: string;
      artifactId?: string;
    }>
  >([]);
  const restoringNavRef = useRef(false);
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
  const workspaceImportInputRef = useRef<HTMLInputElement | null>(null);
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
        setOverview((current) => mergeLiveAiOverview(current, next));
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
                workspace:
                  mergeLiveAiWorkspaceBundle(current.workspace, cached) ??
                  cached,
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
                workspace:
                  mergeLiveAiWorkspaceBundle(
                    current.workspace,
                    result.workspace,
                  ) ?? result.workspace,
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
    if (!hubTabsRestored || navStackRef.current.length > 0) return;
    const seed = {
      kind: "hub" as const,
      hubTabId: activeHubTabId,
      workspaceId: selectedWorkspaceId,
    };
    navStackRef.current = [seed];
    setNavCursor(0);
  }, [activeHubTabId, hubTabsRestored, selectedWorkspaceId]);
  useEffect(() => {
    try {
      setHomeActivityRailCollapsed(
        window.localStorage.getItem("spectra.home.activityRail.collapsed") ===
          "true",
      );
      setInspectorCollapsed(
        window.localStorage.getItem("spectra.workspace.inspector.collapsed") ===
          "true",
      );
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    window.localStorage.setItem(
      "spectra.home.activityRail.collapsed",
      String(homeActivityRailCollapsed),
    );
  }, [homeActivityRailCollapsed]);
  useEffect(() => {
    window.localStorage.setItem(
      "spectra.workspace.inspector.collapsed",
      String(inspectorCollapsed),
    );
  }, [inspectorCollapsed]);
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
    if (!workspace) return;
    window.dispatchEvent(
      new CustomEvent("spectra:page-context", {
        detail: { source: "Workspaces", title: workspace.title },
      }),
    );
    return () => {
      window.dispatchEvent(new Event("spectra:clear-page-context"));
    };
  }, [workspace]);

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
    if (saved === "list" || saved === "board" || saved === "canvas")
      setViewMode(saved);
    else if (saved === "timeline") setViewMode("list");
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
    if (!requestedHome) return;
    goToHomeHub();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hub bootstrap once per requestedHome
  }, [requestedHome]);

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
  const workspaceHeader = useMemo(
    () =>
      workspaceIndexEntry &&
      (!workspace || workspaceIndexEntry.updatedAt >= workspace.updatedAt)
        ? { ...workspace, ...workspaceIndexEntry }
        : (workspace ?? workspaceIndexEntry),
    [workspace, workspaceIndexEntry],
  );
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
  const selectedRun =
    selection?.type === "run"
      ? (runs.find((run) => run._id === selection.runId) ?? null)
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
  // Open studio artifact must beat workspace scope — otherwise QC thinks the
  // workspace is focused while the sheet/doc editor is visibly open, and
  // focused edits drift into create/other-type work (E-03 sheets regression).
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
    // An open studio artifact always owns focus unless the user explicitly
    // pinned selection/thread. Sticky workspace override was silencing sheets.
    commandFocusArtifact &&
    focusModeOverride !== "selection" &&
    focusModeOverride !== "thread"
      ? "artifact"
      : focusModeOverride === "selection" && contextualArtifactIds.length === 0
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
                    item._id === canonical._id
                      ? mergeLiveAiArtifact(item, canonical)
                      : item,
                  )
                : [canonical, ...current.artifacts],
              workspace: current.workspace
                ? {
                    ...current.workspace,
                    items: current.workspace.items.map((item) =>
                      item.artifact?._id === canonical._id
                        ? {
                            ...item,
                            artifact: mergeLiveAiArtifact(
                              item.artifact,
                              canonical,
                            ),
                          }
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
        if (patch.clearAi === true) {
          return {
            ...artifact,
            aiState: undefined,
            aiEffects: undefined,
            aiPreview: undefined,
            aiProgress: undefined,
            aiStateExpiresAt: undefined,
          };
        }
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
        const patchRegionIds = Array.isArray(patch.regionIds)
          ? patch.regionIds.filter(
              (regionId): regionId is string => typeof regionId === "string",
            )
          : Array.isArray(patch.effectRegionIds)
            ? patch.effectRegionIds.filter(
                (regionId): regionId is string => typeof regionId === "string",
              )
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
                regionIds: patchRegionIds ?? existingEffect?.regionIds ?? [],
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
          : patchRegionIds && artifact.aiEffects?.length
            ? artifact.aiEffects.map((effect, index, list) =>
                index === list.length - 1
                  ? {
                      ...effect,
                      regionIds: patchRegionIds,
                      updatedAt: Date.now(),
                    }
                  : effect,
              )
            : artifact.aiEffects;
        if (artifact.aiState === "creating") {
          // Creates write content onto the pending shell immediately. Mirror
          // Convex patchPendingContent by keeping aiPreview.changedPaths set so
          // studios can light data-ai-region before the query catch-up arrives.
          const creatingChangedPaths =
            Array.isArray(patch.changedPaths) && patch.changedPaths.length > 0
              ? patch.changedPaths.filter(
                  (path): path is string => typeof path === "string",
                )
              : artifact.aiPreview?.changedPaths?.length
                ? artifact.aiPreview.changedPaths
                : // Sheets stay cell-exact; other creates default to whole-artifact.
                  artifact.blueprintKey === "sheets"
                  ? []
                  : ["/"];
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
            aiEffects: liveEffects?.map((effect) =>
              effect.changedPaths.length
                ? effect
                : creatingChangedPaths.length
                  ? { ...effect, changedPaths: creatingChangedPaths }
                  : effect,
            ),
            aiPreview: {
              ...(artifact.aiPreview ?? { startedAt: Date.now() }),
              ...(previewContent !== undefined
                ? { content: previewContent }
                : {}),
              ...(creatingChangedPaths.length
                ? { changedPaths: creatingChangedPaths }
                : artifact.aiPreview?.changedPaths
                  ? {}
                  : { changedPaths: [] }),
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
          };
        }
        // Existing artifacts keep their canonical baseline stable while the
        // streamed proposal is rendered as a region-scoped overlay. This lets
        // the editor preserve unrelated local typing and prevents a preview from
        // masquerading as a committed revision.
        //
        // Focused edits publish an early SSE patch with changedPaths: [] so the
        // card paints "updating" before exact regions exist. Mirror create
        // behavior: keep prior paths or default to `/` (sheets stay cell-exact)
        // so studios can light data-ai-region before the query catch-up arrives.
        const updatingChangedPaths =
          Array.isArray(patch.changedPaths) && patch.changedPaths.length > 0
            ? patch.changedPaths.filter(
                (path): path is string => typeof path === "string",
              )
            : artifact.aiPreview?.changedPaths?.length
              ? artifact.aiPreview.changedPaths
              : artifact.blueprintKey === "sheets"
                ? []
                : ["/"];
        return {
          ...artifact,
          aiState: "updating",
          aiProgress:
            typeof patch.progress === "number"
              ? patch.progress
              : artifact.aiProgress,
          aiEffects: liveEffects?.map((effect) =>
            effect.changedPaths.length
              ? effect
              : updatingChangedPaths.length
                ? { ...effect, changedPaths: updatingChangedPaths }
                : effect,
          ),
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
            ...(updatingChangedPaths.length
              ? { changedPaths: updatingChangedPaths }
              : artifact.aiPreview?.changedPaths
                ? {}
                : Array.isArray(patch.changedPaths)
                  ? { changedPaths: [] }
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
      let missing = true;
      setOverview((current) => {
        if (!current) return current;
        const exists =
          current.artifacts.some((item) => item._id === artifactId) ||
          Boolean(
            current.workspace?.items.some(
              (item) => item.artifact?._id === artifactId,
            ),
          );
        if (!exists) return current;
        missing = false;
        return {
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
        };
      });
      // Pending creates can stream patches a beat before overview includes the
      // shell. Seed from the canonical artifact endpoint so list/timeline AI
      // states light up instead of silently dropping the patch.
      if (missing) {
        void getSpectraArtifact(artifactId)
          .then(({ artifact }) => {
            setOverview((current) => {
              if (!current) return current;
              if (
                current.artifacts.some((item) => item._id === artifactId) ||
                current.workspace?.items.some(
                  (item) => item.artifact?._id === artifactId,
                )
              ) {
                return {
                  ...current,
                  artifacts: current.artifacts.map((item) =>
                    item._id === artifactId ? apply(item) : item,
                  ),
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
                };
              }
              return {
                ...current,
                artifacts: [apply(artifact), ...current.artifacts],
              };
            });
          })
          .catch(() => undefined);
      }
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
      // Workspace QC has no ConversationSurface of its own. Open the live
      // thread panel so progress traces stay visible outside /chat.
      setLiveThread({ id: threadId, title: "Current conversation" });
      setActiveRunPanelId(null);
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
    const exchange = runEngine.liveExchange;
    if (!exchange?.runId || exchange.status !== "failed") return;
    const runId = exchange.runId;
    setOverview((current) => {
      if (!current) return current;
      const clearChrome = (artifact: SpectraArtifact): SpectraArtifact => {
        if (
          artifact.aiRunId !== runId &&
          !(artifact.aiEffects ?? []).some((effect) => effect.runId === runId)
        )
          return artifact;
        if (
          artifact.aiState !== "creating" &&
          artifact.aiState !== "updating" &&
          !(artifact.aiEffects ?? []).some(
            (effect) => effect.state === "active",
          )
        )
          return artifact;
        return {
          ...artifact,
          aiState: undefined,
          aiEffects: undefined,
          aiPreview: undefined,
          aiProgress: undefined,
          aiStateExpiresAt: undefined,
          aiRunId: undefined,
        };
      };
      return {
        ...current,
        artifacts: current.artifacts.map(clearChrome),
        workspace: current.workspace
          ? {
              ...current.workspace,
              items: current.workspace.items.map((item) =>
                item.artifact
                  ? { ...item, artifact: clearChrome(item.artifact) }
                  : item,
              ),
            }
          : current.workspace,
      };
    });
    void loadOverview(selectedWorkspaceId, true);
  }, [
    loadOverview,
    runEngine.liveExchange,
    runEngine.liveExchange?.runId,
    runEngine.liveExchange?.status,
    selectedWorkspaceId,
  ]);

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
    const createWorkspaceFromShell = () => setWorkspaceCreateOpen(true);
    const navigateWorkspaceHome = () => goToHomeHub();
    const shareFromShell = () => {
      if (studio.activeArtifact) return;
      if (selectedWorkspaceId && workspaceHeader) setWorkspaceShareOpen(true);
      else toast.info("Open a workspace to share it with school members.");
    };
    window.addEventListener("spectra:open-artifact", onOpenArtifact);
    window.addEventListener("spectra:open-workspace", onOpenWorkspace);
    window.addEventListener("spectra:ask", onAsk);
    window.addEventListener("spectra:tile-selected", tile);
    window.addEventListener("spectra:focus-set", focusSet);
    window.addEventListener("spectra:clear-selection", clear);
    window.addEventListener("spectra:refresh", refresh);
    window.addEventListener(
      "spectra:create-workspace",
      createWorkspaceFromShell,
    );
    window.addEventListener(
      "spectra:navigate-workspace-home",
      navigateWorkspaceHome,
    );
    window.addEventListener("spectra:page-share", shareFromShell);
    return () => {
      window.removeEventListener("spectra:open-artifact", onOpenArtifact);
      window.removeEventListener("spectra:open-workspace", onOpenWorkspace);
      window.removeEventListener("spectra:ask", onAsk);
      window.removeEventListener("spectra:tile-selected", tile);
      window.removeEventListener("spectra:focus-set", focusSet);
      window.removeEventListener("spectra:clear-selection", clear);
      window.removeEventListener("spectra:refresh", refresh);
      window.removeEventListener(
        "spectra:create-workspace",
        createWorkspaceFromShell,
      );
      window.removeEventListener(
        "spectra:navigate-workspace-home",
        navigateWorkspaceHome,
      );
      window.removeEventListener("spectra:page-share", shareFromShell);
    };
    // Event handlers intentionally read the current shell closures after each render.
  });

  async function _openRunPanel(runId: string, title: string) {
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
    // A user-chosen open ends spectating; a follow-dispatched open does not.
    if (!isProgrammaticOpen()) disengageFollowAi();
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
    // Prefer the open artifact over a sticky workspace focus override so QC
    // focused edits target the studio surface the user is looking at.
    setFocusModeOverride(null);
    // Open beside existing work by default; expand to full-page via Maximize.
    studio.openSplit(artifact);
    pushShellNav({
      kind: "artifact-split",
      hubTabId: activeHubTabId,
      workspaceId: selectedWorkspaceId,
      artifactId: artifact._id,
    });
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

  function pushShellNav(entry: {
    kind: "hub" | "artifact-split" | "artifact-tab";
    hubTabId: string | null;
    workspaceId?: string;
    artifactId?: string;
  }) {
    if (restoringNavRef.current) return;
    const stack = navStackRef.current.slice(0, Math.max(0, navCursor + 1));
    const last = stack[stack.length - 1];
    if (
      last &&
      last.kind === entry.kind &&
      last.hubTabId === entry.hubTabId &&
      last.workspaceId === entry.workspaceId &&
      last.artifactId === entry.artifactId
    ) {
      return;
    }
    stack.push(entry);
    navStackRef.current = stack.slice(-100);
    setNavCursor(navStackRef.current.length - 1);
  }

  function applyShellNav(entry: {
    kind: "hub" | "artifact-split" | "artifact-tab";
    hubTabId: string | null;
    workspaceId?: string;
    artifactId?: string;
  }) {
    restoringNavRef.current = true;
    try {
      if (
        (entry.kind === "artifact-split" || entry.kind === "artifact-tab") &&
        entry.artifactId
      ) {
        const artifact = allArtifacts.find(
          (item) => item._id === entry.artifactId,
        );
        if (!artifact) return;
        if (entry.hubTabId) setActiveHubTabId(entry.hubTabId);
        if (entry.workspaceId) {
          setSelectedWorkspaceId(entry.workspaceId);
          replaceWorkspaceLocation(entry.workspaceId);
          void loadWorkspace(entry.workspaceId);
        }
        if (entry.kind === "artifact-tab") studio.openTab(artifact);
        else studio.openSplit(artifact);
        return;
      }
      studio.closeStudio();
      setSelection(null);
      if (entry.hubTabId && hubTabs.some((tab) => tab.id === entry.hubTabId)) {
        const tab = hubTabs.find((item) => item.id === entry.hubTabId);
        if (!tab) return;
        setActiveHubTabId(tab.id);
        replaceWorkspaceLocation(tab.workspaceId);
        if (tab.workspaceId) {
          setSelectedWorkspaceId(tab.workspaceId);
          void loadWorkspace(tab.workspaceId);
        } else {
          setSelectedWorkspaceId(undefined);
        }
        return;
      }
      if (entry.workspaceId) {
        setActiveHubDestination(
          workspaces.find((item) => item._id === entry.workspaceId)?.title ??
            "Workspace",
          entry.workspaceId,
        );
        setSelectedWorkspaceId(entry.workspaceId);
        void loadWorkspace(entry.workspaceId);
        return;
      }
      setActiveHubDestination("Home");
      setSelectedWorkspaceId(undefined);
    } finally {
      requestAnimationFrame(() => {
        restoringNavRef.current = false;
      });
    }
  }

  function navigateShellBack() {
    if (navCursor <= 0) return;
    const nextIndex = navCursor - 1;
    const entry = navStackRef.current[nextIndex];
    if (!entry) return;
    setNavCursor(nextIndex);
    applyShellNav(entry);
  }

  function navigateShellForward() {
    if (navCursor < 0 || navCursor >= navStackRef.current.length - 1) return;
    const nextIndex = navCursor + 1;
    const entry = navStackRef.current[nextIndex];
    if (!entry) return;
    setNavCursor(nextIndex);
    applyShellNav(entry);
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
      pushShellNav({
        kind: "hub",
        hubTabId: activeHubTabId,
        workspaceId,
      });
      return;
    }
    const next = workspaceHubTab(label, workspaceId);
    setHubTabs((current) => [...current, next]);
    setActiveHubTabId(next.id);
    pushShellNav({
      kind: "hub",
      hubTabId: next.id,
      workspaceId,
    });
  }

  function goToWorkspaceHub(workspaceId: string) {
    const target = workspaces.find((item) => item._id === workspaceId);
    const next = workspaceHubTab(target?.title ?? "Workspace", workspaceId);
    setHubTabs((current) => [...current, next]);
    setActiveHubTabId(next.id);
    studio.closeStudio();
    replaceWorkspaceLocation(workspaceId);
    setSelection(null);
    setViewMode("list");
    setSelectedWorkspaceId(workspaceId);
    void loadWorkspace(workspaceId);
    pushShellNav({
      kind: "hub",
      hubTabId: next.id,
      workspaceId,
    });
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
    pushShellNav({
      kind: "hub",
      hubTabId: tabId,
      workspaceId: tab.workspaceId,
    });
  }

  function addHomeHubTab() {
    const next = workspaceHubTab();
    setHubTabs((current) => [...current, next]);
    setActiveHubTabId(next.id);
    studio.closeStudio();
    setSelection(null);
    setSelectedWorkspaceId(undefined);
    replaceWorkspaceLocation();
    pushShellNav({
      kind: "hub",
      hubTabId: next.id,
    });
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
        studio.openSplit(created);
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

  async function importWorkspaceManifest(file: File) {
    if (file.size > 750_000) {
      toast.error("Workspace manifests must be 750 KB or smaller.");
      return;
    }
    setBusyKey("workspace:import");
    try {
      const bytes = await file.arrayBuffer();
      const manifest = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const result = await postSpectra<
        | { status: "quarantined"; reason: string }
        | {
            status: "imported";
            workspaceId: string;
            report: {
              placed: number;
              skipped: number;
              unsupported: string[];
              warnings: string[];
            };
          }
      >({
        action: "importWorkspaceManifest",
        fileName: file.name,
        sha256,
        manifest,
      });
      if (result.status === "quarantined") {
        toast.error(`Import quarantined: ${result.reason}`);
        return;
      }
      const detail = result.report.skipped
        ? `${result.report.placed} placed; ${result.report.skipped} unavailable reference${result.report.skipped === 1 ? "" : "s"} skipped.`
        : `${result.report.placed} artifact reference${result.report.placed === 1 ? "" : "s"} placed.`;
      toast.success(`Workspace imported. ${detail}`);
      setSelection(null);
      setViewMode("list");
      const refreshed = await loadOverview(result.workspaceId, true);
      const imported = refreshed?.workspaces.find(
        (item) => item._id === result.workspaceId,
      );
      setActiveHubDestination(
        imported?.title ?? "Imported workspace",
        result.workspaceId,
      );
    } catch (error) {
      toast.error(
        error instanceof SyntaxError
          ? "This file is not valid JSON and has been left unchanged."
          : error instanceof Error
            ? error.message
            : "Could not import this workspace.",
      );
    } finally {
      setBusyKey(null);
      if (workspaceImportInputRef.current)
        workspaceImportInputRef.current.value = "";
    }
  }

  async function exportWorkspaceManifest() {
    if (!workspaceHeader) return;
    setBusyKey(`workspace:export:${workspaceHeader._id}`);
    try {
      const result = await exportSpectraWorkspaceManifest(workspaceHeader._id);
      const blob = new Blob([JSON.stringify(result.manifest, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${
        workspaceHeader.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "workspace"
      }.spectra-workspace.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      const warningCount =
        result.report.warnings.length + result.report.unsupported.length;
      toast.success(
        warningCount
          ? `Workspace exported with ${warningCount} fidelity note${warningCount === 1 ? "" : "s"}.`
          : "Portable workspace manifest exported.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not export workspace.",
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
      <input
        ref={workspaceImportInputRef}
        type="file"
        accept=".spectra-workspace.json,.json,application/json"
        className="sr-only"
        aria-label="Import a Spectra workspace manifest"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importWorkspaceManifest(file);
        }}
      />
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
          onActivateTab={(artifactId) => {
            studio.activateTab(artifactId);
            pushShellNav({
              kind: "artifact-tab",
              hubTabId: null,
              artifactId,
            });
          }}
          onCloseTab={closeArtifactTab}
          canGoBack={navCursor > 0}
          canGoForward={
            navCursor >= 0 && navCursor < navStackRef.current.length - 1
          }
          onGoBack={navigateShellBack}
          onGoForward={navigateShellForward}
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
                role="dialog"
                aria-modal="true"
                aria-labelledby="workspace-delete-title"
                className="w-[min(480px,calc(100vw-32px))] rounded-[12px] border border-[color-mix(in_oklab,var(--danger)_28%,var(--border-default))] bg-[var(--bg-elevated)] p-5 shadow-[0_24px_70px_rgba(27,20,12,0.22)]"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <h2
                  id="workspace-delete-title"
                  className="font-display text-[21px] font-semibold text-[var(--text-primary)]"
                >
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
                  aria-label="Workspace deletion confirmation"
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
                role="dialog"
                aria-modal="true"
                aria-labelledby="workspace-edit-title"
                className="w-full max-w-[430px] rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[0_24px_70px_rgba(27,20,12,0.2)]"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <h2
                  id="workspace-edit-title"
                  className="font-display text-[21px] font-semibold text-[var(--text-primary)]"
                >
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
                  aria-label="Workspace name"
                  value={workspaceEditTitle}
                  onChange={(event) =>
                    setWorkspaceEditTitle(event.target.value)
                  }
                  className="mt-4 h-10 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] text-[var(--text-primary)] outline-none"
                />
                <textarea
                  aria-label="Workspace description"
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
                role="dialog"
                aria-modal="true"
                aria-labelledby="artifact-delete-title"
                className="w-full max-w-[440px] rounded-[12px] border border-[color-mix(in_oklab,var(--danger)_24%,var(--border-default))] bg-[var(--bg-elevated)] p-5 shadow-[0_24px_70px_rgba(27,20,12,0.2)]"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <h2
                  id="artifact-delete-title"
                  className="font-display text-[21px] font-semibold text-[var(--text-primary)]"
                >
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
              compact={false}
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
                hideActivityRail={studio.isOpen}
                activityRailCollapsed={homeActivityRailCollapsed}
                onToggleActivityRail={() =>
                  setHomeActivityRailCollapsed((value) => !value)
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
                  panelWidth={studioPanelWidth}
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
                  compact={false}
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
                <div className="relative flex min-w-0 flex-1 flex-col">
                  <WorkspaceHeader
                    workspace={workspaceHeader}
                    items={entries.map((entry) => entry.item)}
                    runs={workspaceRuns}
                    optimisticActive={Boolean(
                      runEngine.liveExchange &&
                      runEngine.liveExchange.status !== "failed",
                    )}
                    optimisticRunId={runEngine.liveExchange?.runId}
                    viewMode={viewMode}
                    busy={busyKey}
                    onCreateArtifact={openCreateArtifact}
                    onEditWorkspace={openWorkspaceEdit}
                    onShareWorkspace={() => setWorkspaceShareOpen(true)}
                    onExportWorkspace={() => void exportWorkspaceManifest()}
                    onViewModeChange={setViewMode}
                    onArchiveWorkspace={() => {
                      setWorkspaceDeleteConfirmation("");
                      setWorkspaceDeleteOpen(true);
                    }}
                  />
                  {workspace && viewMode !== "list" ? (
                    <section
                      className={`spectra-workspace-shell-controls spectra-workspace-shell-controls--${viewMode}`}
                    >
                      <WorkspaceLibraryToolbar
                        compact
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
                          if (selectionCount) setFocusModeOverride("selection");
                        }}
                        searchControl={
                          <GlobalSearch
                            onOpenArtifact={openArtifactPanel}
                            onOpenWorkspace={(target) =>
                              goToWorkspaceHub(target._id)
                            }
                            selectedIds={selectedContextIds}
                            onToggleSelected={toggleContextArtifact}
                            placementWorkspaceId={workspace._id}
                            placementLabel={workspace.title}
                            onPlaceArtifact={(artifact) =>
                              void addArtifactToWorkspace(
                                artifact,
                                workspace._id,
                              )
                            }
                          />
                        }
                      />
                    </section>
                  ) : null}
                  <main
                    className={
                      viewMode === "canvas"
                        ? "spectra-workspace-content relative z-[2] min-h-0 flex-1 overflow-hidden px-3 pb-[110px] pt-2 sm:px-5 lg:px-8 lg:pt-2"
                        : "spectra-workspace-content relative z-[2] min-h-0 flex-1 overflow-y-auto px-3 pb-[150px] pt-2 sm:px-5 lg:px-8 lg:pt-2"
                    }
                  >
                    {!workspace ? <WorkspaceContentSkeleton /> : null}
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
                        {viewMode === "list" ? (
                          <section className="spectra-workspace-library-controls spectra-workspace-library-controls--list">
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
                        ) : null}
                        {viewMode === "list" ? (
                          <WorkspacePinnedShelf
                            entries={entries}
                            workspaceTitle={workspace.title}
                            onSelect={openWorkspaceEntry}
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
                {!studio.isOpen &&
                !liveThread &&
                tiledArtifacts.length === 0 ? (
                  <>
                    <Inspector
                      workspace={workspace}
                      artifacts={allArtifacts}
                      selectedArtifact={selectedArtifact}
                      selectedRun={selectedRun}
                      runs={workspaceRuns}
                      onClose={() => setSelection(null)}
                      onHide={() => {
                        if (selection?.type === "artifact")
                          void hideWorkspaceItem(selection.itemId);
                      }}
                      onCreateArtifact={openCreateArtifact}
                      onArchiveWorkspace={() => {
                        setWorkspaceDeleteConfirmation("");
                        setWorkspaceDeleteOpen(true);
                      }}
                      onOpenArtifact={openArtifactPanel}
                      collapsed={inspectorCollapsed}
                      onToggleCollapsed={() =>
                        setInspectorCollapsed((value) => !value)
                      }
                    />
                    {inspectorCollapsed ? (
                      <button
                        type="button"
                        aria-label="Show workspace details"
                        title="Show workspace details"
                        onClick={() => setInspectorCollapsed(false)}
                        className="absolute right-3 top-3 z-30 hidden h-8 w-8 items-center justify-center rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[0_6px_18px_-14px_rgba(20,26,32,0.45)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] xl:flex"
                      >
                        <PanelRight className="h-4 w-4" />
                      </button>
                    ) : null}
                  </>
                ) : null}
                {studio.mode === "tab" && studio.activeArtifact ? (
                  <ArtifactStudio
                    mode="tab"
                    artifact={studio.activeArtifact}
                    artifacts={allArtifacts}
                    tabs={studio.tabs}
                    dirtyIds={studio.dirtyIds}
                    busy={
                      busyKey === `artifact:update:${studio.activeArtifact._id}`
                    }
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
                    compact={false}
                  />
                ) : null}
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
                    panelWidth={studioPanelWidth}
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
                    compact={false}
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
              <div ref={setAttachmentsHost} />
              <DurableRunTabs
                workspaceId={selectedWorkspaceId}
                optimistic={runEngine.liveExchange}
                openThreadId={liveThread?.id}
                onOpen={(_runId, threadId, title, artifactId) => {
                  setActiveRunPanelId(null);
                  setLiveThread({ id: threadId, title });
                  setComposerThread({
                    id: threadId,
                    title,
                    runId: _runId,
                    workspaceId: selectedWorkspaceId,
                  });
                  if (artifactId) {
                    const artifact = allArtifacts.find(
                      (item) => item._id === artifactId,
                    );
                    if (artifact) openArtifactPanel(artifact);
                  }
                }}
                onDeselect={() => {
                  setComposerThread(null);
                  setLiveThread(null);
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
                  allowAttachments
                  attachmentsPortalTarget={attachmentsHost}
                  placeholder={
                    composerThread
                      ? `Continue ${composerThread.title}...`
                      : commandFocusArtifact
                        ? `Ask Spectra anything about this ${blueprintMeta[commandFocusArtifact.blueprintKey]?.label?.toLowerCase() ?? "artifact"}...`
                        : workspace
                          ? `Ask Spectra anything about this workspace...`
                          : "Ask Spectra anything..."
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
                      <CommandBarMenuItem
                        onClick={() => setComposerThread(null)}
                      >
                        <MessageSquare className="h-4 w-4" />
                        New chat
                      </CommandBarMenuItem>
                      <CommandBarSubmenu label="New artifact" icon={Plus}>
                        {createTypes.map((type) => {
                          const Icon = type.icon;
                          return (
                            <CommandBarMenuItem
                              key={type.key}
                              disabled={busyKey === `artifact:${type.key}`}
                              onClick={() => openCreateArtifact(type.key)}
                            >
                              {busyKey === `artifact:${type.key}` ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Icon className="h-4 w-4" />
                              )}
                              {type.label}
                            </CommandBarMenuItem>
                          );
                        })}
                      </CommandBarSubmenu>
                      <CommandBarMenuItem
                        onClick={() => {
                          setMultiSelectMode(true);
                          if (selectionCount === 0) restoreLatestSelection();
                          if (selectionCount) setFocusModeOverride("selection");
                        }}
                      >
                        <Files className="h-4 w-4" />
                        Select objects
                      </CommandBarMenuItem>
                      {!selectedWorkspaceId ? (
                        <CommandBarMenuItem
                          onClick={() => setWorkspaceCreateOpen(true)}
                        >
                          <Plus className="h-4 w-4" />
                          New workspace
                        </CommandBarMenuItem>
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
              liveExchange={
                runEngine.liveExchange &&
                (!runEngine.liveExchange.runId ||
                  composerThread?.id === liveThread.id ||
                  !composerThread)
                  ? runEngine.liveExchange
                  : null
              }
              width={liveThreadPanelWidth}
              onWidthChange={setLiveThreadPanelWidth}
              continuing={composerThread?.id === liveThread.id}
              onContinue={() => {
                void (async () => {
                  // Blue/active icon toggles off so the next message starts fresh.
                  if (composerThread?.id === liveThread.id) {
                    setComposerThread(null);
                    try {
                      await postSpectra({
                        action: "selectRunTab",
                        runId: undefined,
                      });
                      window.dispatchEvent(
                        new Event("spectra:threads-changed"),
                      );
                    } catch {
                      // Local deselect already applied.
                    }
                    return;
                  }
                  try {
                    const result = await postSpectra<{
                      runId?: string;
                      selected?: boolean;
                    }>({
                      action: "selectRunTab",
                      threadId: liveThread.id,
                    });
                    if (!result.selected || !result.runId) {
                      setComposerThread(null);
                      return;
                    }
                    setComposerThread({
                      id: liveThread.id,
                      title: liveThread.title,
                      runId: result.runId,
                      workspaceId: selectedWorkspaceId,
                    });
                    window.dispatchEvent(new Event("spectra:threads-changed"));
                  } catch (error) {
                    toast.message(
                      error instanceof Error
                        ? error.message
                        : "Could not select this thread for continuation.",
                    );
                  }
                })();
              }}
              onClose={() => {
                setLiveThread(null);
                // Closing the side panel does not force-deselect continuation;
                // the run-tab icon remains the source of truth for QC.
              }}
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
