"use client";

import {
  BookOpen,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Bot,
  Clock3,
  Code2,
  ExternalLink,
  Ellipsis,
  FileText,
  Files,
  FolderInput,
  FolderPlus,
  Heart,
  HelpCircle,
  LayoutGrid,
  List,
  Loader2,
  Mail,
  Maximize2,
  MessageSquare,
  Minus,
  PanelTop,
  Plus,
  Search,
  Share2,
  Sparkles,
  Table2,
  Tags,
  Trash2,
  Upload,
  Presentation,
  Workflow,
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
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import { useNow } from "@/hooks/use-now";
import { describeFailure } from "@/components/ui/truthful-state";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { useSpectraRun } from "../ai/use-spectra-run";
import { useSpectraContext } from "../hooks/use-spectra-context";
import {
  createDefaultArtifactPayload,
  type ArtifactPayload,
} from "../components/artifact-blueprint-sheet";
import { ArtifactCard, blueprintMeta } from "../components/artifact-card";
import { previewText } from "../components/preview-text";
import {
  StudioTabRail,
  useArtifactStudioState,
} from "../components/artifact-studio-shell";
import { ArtifactStudio } from "../components/artifact-studio";
import { ArtifactTileSurface } from "../components/artifact-tile-surface";
import {
  CommandBar,
  CommandBarMenuItem,
  CommandBarSubmenu,
} from "../components/command-bar";
import {
  ContextFocusControl,
  SelectionActionBar,
  type ComposerFocusMode,
} from "../components/context-controls";
import { FloatingMenu } from "../components/floating-menu";
import { ProductEmptyState } from "../components/product-state";
import { RunDetailPanel } from "../components/run-detail-panel";
import { LiveThreadPanel } from "../components/live-thread-panel";
import { WorkbenchDockShell } from "./workbench-dock-shell";
import {
  disengageFollowAi,
  isProgrammaticOpen,
} from "../collaboration/follow-ai";
import {
  disengageFollow,
  isProgrammaticFollowOpen,
} from "../collaboration/follow";
import { ShareDialog } from "../components/share-dialog";
import {
  artifactPlacements,
  artifactToCard,
  formatRelativeTime,
  initials,
  sortSpectraWorkspaces,
  workspaceAccent,
} from "../components/spectra-view-model";
import {
  abortArtifactImportUpload,
  beginArtifactImportOriginal,
  completeArtifactImport,
  getSpectraArtifacts,
  getSpectraOverview,
  getSpectraShareInvitations,
  getSpectraThread,
  getSpectraThreads,
  postSpectra,
  uploadArtifactImportOriginal,
  type SpectraArtifact,
  type SpectraBlueprintKey,
  type SpectraWorkspace,
  type SpectraResultCard,
  type SpectraShareInvitation,
  type SpectraThread,
} from "../data/api";
import {
  CREATABLE_ARTIFACT_TYPE_KEYS,
  type ArtifactTypeKey,
} from "../artifacts/types";
import {
  readSharedWorkbenchSession,
  updateWorkbenchSurface,
  writeSharedWorkbenchSession,
} from "../workbench";
import { OverflowMenu } from "@/components/ui/dropdown-menu";
import { SelectField } from "@/components/ui/select";

type ArtifactMode = "list" | "board" | "canvas";
type ArtifactSort =
  "updated" | "created" | "title" | "type" | "workspace" | "activity";
type ArtifactCollection =
  | "all"
  | "threads"
  | "unplaced"
  | "shared"
  | "recent"
  | "favorites"
  | "collections"
  | "invitations";

function compactCollectionCount(value: number) {
  return new Intl.NumberFormat("en", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}
type ArtifactHubTab = { id: string; label: string };

function artifactHubTab(): ArtifactHubTab {
  return {
    id: `artifact-hub-${crypto.randomUUID()}`,
    label: "All",
  };
}

const filters: Array<{
  key: "all" | SpectraBlueprintKey;
  label: string;
  icon: LucideIcon;
}> = [
  { key: "all", label: "All", icon: LayoutGrid },
  { key: "document", label: "Documents", icon: FileText },
  { key: "flashcard_deck", label: "Decks", icon: BookOpen },
  { key: "quiz", label: "Quizzes", icon: HelpCircle },
  { key: "planner_task", label: "Tasks", icon: CalendarCheck2 },
  { key: "agent", label: "Agents", icon: Bot },
  { key: "presentation", label: "Presentations", icon: Presentation },
  { key: "sheets", label: "Sheets", icon: Table2 },
  { key: "code", label: "Code", icon: Code2 },
  { key: "whiteboard", label: "Whiteboards", icon: Workflow },
  // Retired: Calendar owns scheduling now. Present so existing timetable work
  // stays findable and exportable; excluded from every "New work" menu.
  { key: "timetable", label: "Timetables (retired)", icon: CalendarClock },
];

/**
 * "New work" menus derive from the registry's creatable set, so a type that is
 * browsable but not creatable can never leak into a create menu.
 */
function isCreatableFilter(key: (typeof filters)[number]["key"]) {
  return (
    key !== "all" &&
    (CREATABLE_ARTIFACT_TYPE_KEYS as readonly string[]).includes(key)
  );
}

function buttonClass(tone: "normal" | "dark" = "normal") {
  if (tone === "dark")
    return "inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[var(--text-primary)] px-3 text-[13px] font-medium text-[var(--bg-primary)] disabled:opacity-45";
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

export function ArtifactsShell({
  initialArtifactId,
}: { initialArtifactId?: string } = {}) {
  const searchParams = useSearchParams();
  const now = useNow(60_000);
  const requestedArtifactId =
    initialArtifactId ?? searchParams.get("artifactId");
  useEffect(() => {
    const session = readSharedWorkbenchSession(window.localStorage);
    writeSharedWorkbenchSession(
      window.localStorage,
      updateWorkbenchSurface(session, "library"),
    );
  }, []);
  const requestedCollection = searchParams.get("collection");
  const [allArtifacts, setAllArtifacts] = useState<SpectraArtifact[]>([]);
  const [libraryThreads, setLibraryThreads] = useState<SpectraThread[]>([]);
  const [workspaces, setWorkspaces] = useState<SpectraWorkspace[]>([]);
  const [resultCards, setResultCards] = useState<SpectraResultCard[]>([]);
  const [activeFilter, setActiveFilter] = useState<"all" | SpectraBlueprintKey>(
    "all",
  );
  const [collection, setCollection] = useState<ArtifactCollection>(
    [
      "all",
      "unplaced",
      "shared",
      "recent",
      "favorites",
      "collections",
      "invitations",
    ].includes(requestedCollection ?? "")
      ? (requestedCollection as ArtifactCollection)
      : "all",
  );
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [shareInvitations, setShareInvitations] = useState<
    SpectraShareInvitation[]
  >([]);
  const [mode, setMode] = useState<ArtifactMode>("list");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<ArtifactSort>("updated");
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [attachmentsHost, setAttachmentsHost] = useState<HTMLDivElement | null>(
    null,
  );
  const [focusModeOverride, setFocusModeOverride] =
    useState<ComposerFocusMode | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [hubTabs, setHubTabs] = useState<ArtifactHubTab[]>(() => [
    { id: "artifacts-all-default", label: "All" },
  ]);
  const [activeHubTabId, setActiveHubTabId] = useState<string | null>(
    "artifacts-all-default",
  );
  const [hubTabsRestored, setHubTabsRestored] = useState(false);
  const [studioPanelWidth, setStudioPanelWidth] = useState(760);
  const [liveThreadPanelWidth, setLiveThreadPanelWidth] = useState(560);
  const [rowMenuArtifactId, setRowMenuArtifactId] = useState<string | null>(
    null,
  );
  const [rowMenuAnchor, setRowMenuAnchor] = useState<DOMRect | null>(null);
  const [rowMenuWorkspacePicker, setRowMenuWorkspacePicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const metadataLoadedRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const loadPendingRef = useRef(false);
  const openedQueryArtifactRef = useRef<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingCreateType, setPendingCreateType] =
    useState<ArtifactTypeKey | null>(null);
  const [artifactDeletePending, setArtifactDeletePending] =
    useState<SpectraArtifact | null>(null);
  const [shareTarget, setShareTarget] = useState<SpectraArtifact | null>(null);

  useEffect(() => {
    try {
      const value = JSON.parse(
        window.localStorage.getItem("spectra.library.favorites.v1") ?? "[]",
      );
      if (Array.isArray(value))
        setFavoriteIds(
          new Set(value.filter((id): id is string => typeof id === "string")),
        );
    } catch {
      setFavoriteIds(new Set());
    }
  }, []);

  const toggleFavorite = useCallback((workId: string) => {
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (next.has(workId)) next.delete(workId);
      else next.add(workId);
      window.localStorage.setItem(
        "spectra.library.favorites.v1",
        JSON.stringify([...next]),
      );
      return next;
    });
  }, []);
  const createMenuRef = useOutsideClick<HTMLDivElement>(createMenuOpen, () =>
    setCreateMenuOpen(false),
  );
  const sortMenuRef = useOutsideClick<HTMLDivElement>(sortOpen, () =>
    setSortOpen(false),
  );
  const filterMenuRef = useOutsideClick<HTMLDivElement>(filterOpen, () =>
    setFilterOpen(false),
  );
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
  const {
    composerThread,
    setComposerThread,
    selectedContextIds,
    contextArtifactIds,
    explicitContextObjects,
    setSelectedContextIds,
    commitSelection,
    clearDraftSelection,
    setVisibleArtifactIds,
    setActiveWorkspaceContext,
  } = useSpectraContext(allArtifacts, workspaces);
  const skipAutoContinueThreadIdRef = useRef<string | null>(null);
  const studio = useArtifactStudioState(
    "spectra.shared.artifactStudio",
    allArtifacts,
  );
  const setActiveRunPanelId = useCallback(
    (runId: string | null, label = "Run details") => {
      if (runId)
        openObject({
          type: "run",
          id: runId,
          label,
          presentation: "run-panel",
        });
      else closePresentation("run-panel");
    },
    [closePresentation, openObject],
  );
  const setLiveThread = useCallback(
    (thread: { id: string; title: string } | null) => {
      if (thread) {
        if (skipAutoContinueThreadIdRef.current !== thread.id)
          skipAutoContinueThreadIdRef.current = null;
        openObject({
          type: "thread",
          id: thread.id,
          label: thread.title,
          presentation: "thread-panel",
        });
      } else closePresentation("thread-panel");
    },
    [closePresentation, openObject],
  );
  useEffect(() => {
    const focusedArtifactId = studio.activeArtifact?._id;
    if (!composerThread || !focusedArtifactId) return;
    if (!composerThread.artifactId) return;
    let disposed = false;
    void getSpectraThread(composerThread.id)
      .then(({ thread }) => {
        if (disposed) return;
        if (!thread.artifactId) return;
        if (thread.artifactId === focusedArtifactId) {
          if (composerThread.artifactId !== focusedArtifactId)
            setComposerThread((current) =>
              current?.id === thread._id
                ? { ...current, artifactId: focusedArtifactId }
                : current,
            );
          return;
        }
        setComposerThread(null);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [
    composerThread,
    composerThread?.artifactId,
    composerThread?.id,
    setComposerThread,
    studio.activeArtifact?._id,
  ]);
  const tiledArtifacts = useMemo(
    () =>
      tileArtifactIds.flatMap((id) => {
        const artifact = allArtifacts.find((item) => item._id === id);
        return artifact ? [artifact] : [];
      }),
    [allArtifacts, tileArtifactIds],
  );
  const selectedWorkspace =
    workspaces.find((item) => item._id === selectedWorkspaceId) ?? null;
  const workArtifacts = useMemo(
    () =>
      allArtifacts.filter(
        (artifact) => artifact.blueprintKey !== "thread_reference",
      ),
    [allArtifacts],
  );
  const visibleThreads = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return libraryThreads.filter((thread) => {
      if (thread.status === "deleted") return false;
      if (!needle) return true;
      return (
        thread.title.toLowerCase().includes(needle) ||
        (thread.summaryShort ?? "").toLowerCase().includes(needle)
      );
    });
  }, [libraryThreads, search]);
  useEffect(
    () =>
      setActiveWorkspaceContext(
        selectedWorkspace
          ? { id: selectedWorkspace._id, title: selectedWorkspace.title }
          : null,
      ),
    [selectedWorkspace, setActiveWorkspaceContext],
  );
  const contextualArtifactIds = useMemo(
    () =>
      [
        ...new Set([
          ...contextArtifactIds.filter(
            (id) =>
              allArtifacts.find((artifact) => artifact._id === id)
                ?.blueprintKey !== "thread_reference",
          ),
          ...tiledArtifacts
            .filter((artifact) => artifact.blueprintKey !== "thread_reference")
            .map((artifact) => artifact._id),
        ]),
      ].slice(0, 24),
    [allArtifacts, contextArtifactIds, tiledArtifacts],
  );
  const naturalFocusMode: ComposerFocusMode = composerThread
    ? "thread"
    : studio.activeArtifact
      ? "artifact"
      : contextualArtifactIds.length
        ? "selection"
        : selectedWorkspace
          ? "workspace"
          : "global";
  const effectiveFocusMode =
    focusModeOverride === "selection" && contextualArtifactIds.length === 0
      ? naturalFocusMode
      : focusModeOverride === "artifact" && !studio.activeArtifact
        ? naturalFocusMode
        : focusModeOverride === "workspace" && !selectedWorkspace
          ? naturalFocusMode
          : focusModeOverride === "thread" && !composerThread
            ? naturalFocusMode
            : (focusModeOverride ?? naturalFocusMode);

  useEffect(() => {
    setVisibleArtifactIds([
      ...new Set([
        ...tiledArtifacts
          .filter((artifact) => artifact.blueprintKey !== "thread_reference")
          .map((artifact) => artifact._id),
        ...(studio.activeArtifact?.blueprintKey !== "thread_reference" &&
        studio.activeArtifact
          ? [studio.activeArtifact._id]
          : []),
      ]),
    ]);
  }, [setVisibleArtifactIds, studio.activeArtifact, tiledArtifacts]);

  function restoreLatestSelection() {
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem("spectra.artifacts.latest-selection.v1") ??
          "[]",
      );
      if (!Array.isArray(parsed)) return;
      const valid = new Set(allArtifacts.map((artifact) => artifact._id));
      const restored = parsed
        .filter((id): id is string => typeof id === "string" && valid.has(id))
        .slice(0, 24);
      if (restored.length) {
        setSelectedContextIds(new Set(restored));
        setFocusModeOverride("selection");
      }
    } catch {
      window.localStorage.removeItem("spectra.artifacts.latest-selection.v1");
    }
  }

  function clearSelection() {
    clearDraftSelection();
    setFocusModeOverride(null);
    window.localStorage.removeItem("spectra.artifacts.latest-selection.v1");
  }

  function openSelectedArtifactsInTiles() {
    const selectedIds = [...selectedContextIds]
      .filter((id) => allArtifacts.some((artifact) => artifact._id === id))
      .slice(0, 24);
    if (selectedIds.length === 0) {
      toast.message("Select one or more work items first.");
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

  useEffect(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem("spectra.artifacts.hubTabs.v1") ?? "null",
      ) as { tabs?: ArtifactHubTab[]; activeId?: string | null } | null;
      if (saved?.tabs?.length) {
        setHubTabs(saved.tabs.slice(0, 16));
        setActiveHubTabId(saved.activeId ?? saved.tabs[0]?.id ?? null);
      }
    } catch {
      window.localStorage.removeItem("spectra.artifacts.hubTabs.v1");
    }
    setHubTabsRestored(true);
  }, []);
  useEffect(() => {
    if (hubTabsRestored)
      window.localStorage.setItem(
        "spectra.artifacts.hubTabs.v1",
        JSON.stringify({ tabs: hubTabs, activeId: activeHubTabId }),
      );
  }, [activeHubTabId, hubTabs, hubTabsRestored]);

  function activateAllHub(tabId: string) {
    if (!hubTabs.some((tab) => tab.id === tabId)) return;
    setActiveHubTabId(tabId);
    studio.closeStudio();
    setSelectedWorkspaceId("");
    setActiveFilter("all");
  }

  function addAllHubTab() {
    const next = artifactHubTab();
    setHubTabs((current) => [...current, next]);
    setActiveHubTabId(next.id);
    studio.closeStudio();
    setSelectedWorkspaceId("");
    setActiveFilter("all");
  }

  function closeAllHubTab(tabId: string) {
    const closingIndex = hubTabs.findIndex((tab) => tab.id === tabId);
    const remaining = hubTabs.filter((tab) => tab.id !== tabId);
    setHubTabs(remaining);
    if (activeHubTabId !== tabId) return;
    const fallbackHub =
      remaining[
        Math.min(closingIndex > 0 ? closingIndex - 1 : 0, remaining.length - 1)
      ];
    if (fallbackHub) {
      activateAllHub(fallbackHub.id);
      return;
    }
    const fallbackArtifact = studio.tabs[studio.tabs.length - 1];
    if (fallbackArtifact) {
      setActiveHubTabId(null);
      studio.activateTab(fallbackArtifact.artifactId);
      return;
    }
    const replacement = artifactHubTab();
    setHubTabs([replacement]);
    setActiveHubTabId(replacement.id);
    studio.closeStudio();
    setSelectedWorkspaceId("");
    setActiveFilter("all");
  }

  function closeArtifactTab(artifactId: string) {
    const closesFinalArtifact = studio.tabs.length === 1;
    studio.closeTab(artifactId);
    if (closesFinalArtifact && hubTabs.length === 0) {
      const replacement = artifactHubTab();
      setHubTabs([replacement]);
      setActiveHubTabId(replacement.id);
      setSelectedWorkspaceId("");
      setActiveFilter("all");
    }
  }

  function returnToAllHub() {
    const target =
      hubTabs.find((tab) => tab.id === activeHubTabId) ??
      hubTabs[hubTabs.length - 1];
    if (target) activateAllHub(target.id);
    else addAllHubTab();
  }

  const load = useCallback(async (quiet = false) => {
    if (quiet && loadPendingRef.current) return [];
    const sequence = ++loadSequenceRef.current;
    loadPendingRef.current = true;
    if (!quiet) setLoading(true);
    try {
      const [artifactResult, invitationResult, overview, threadResult] =
        await Promise.all([
          getSpectraArtifacts({
            placement: "all",
          }),
          getSpectraShareInvitations(),
          metadataLoadedRef.current
            ? Promise.resolve(null)
            : getSpectraOverview(),
          getSpectraThreads({ limit: 200 }).catch(() => ({ threads: [] })),
        ]);
      // Legacy timetables are retired work, not hidden work. They stay in the
      // dataset so counts are truthful, search finds them, deep links resolve
      // and their events remain exportable. Creation is blocked in the "New
      // work" menus and again in `spectraArtifacts:create`.
      const loadedArtifacts = artifactResult.artifacts;
      if (sequence !== loadSequenceRef.current) return loadedArtifacts;
      setAllArtifacts(loadedArtifacts);
      setLibraryThreads(threadResult.threads);
      setShareInvitations(invitationResult.invitations);
      if (overview) {
        metadataLoadedRef.current = true;
        setWorkspaces(sortSpectraWorkspaces(overview.workspaces));
        setResultCards(
          (overview.resultCards ?? []).filter(
            (card) =>
              card.run?.sourceSurface === "artifact" && !card.run.workspaceId,
          ),
        );
      }
      return loadedArtifacts;
    } catch (error) {
      if (sequence !== loadSequenceRef.current) return [];
      toast.error(
        describeFailure(error, { fallback: "Could not load your library." })
          .message,
      );
      return [];
    } finally {
      if (sequence === loadSequenceRef.current) {
        loadPendingRef.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const interval = window.setInterval(refreshVisible, 8_000);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("spectra:artifacts-changed", refreshVisible);
    window.addEventListener("spectra:threads-changed", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("spectra:artifacts-changed", refreshVisible);
      window.removeEventListener("spectra:threads-changed", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [load]);

  const openArtifactSurface = useCallback(
    (artifact: SpectraArtifact) => {
      // A user-chosen open ends spectating; a follow-dispatched open does not.
      if (!isProgrammaticOpen() && !isProgrammaticFollowOpen()) {
        disengageFollowAi();
        disengageFollow("user_input");
      }
      if (artifact.blueprintKey === "thread_reference") {
        const content =
          artifact.content && typeof artifact.content === "object"
            ? (artifact.content as Record<string, unknown>)
            : {};
        const targetThreadId =
          typeof content.threadId === "string" ? content.threadId : "";
        if (targetThreadId) {
          setLiveThread({ id: targetThreadId, title: artifact.title });
          return;
        }
      }
      studio.openSplit(artifact);
    },
    [setLiveThread, studio],
  );

  const runEngine = useSpectraRun({
    surface: composerThread
      ? "artifacts"
      : studio.activeArtifact
        ? "artifact"
        : "artifacts",
    workspaceId: selectedWorkspaceId || undefined,
    // A visible non-thread artifact is always useful model context, including
    // while a different conversation supplies history. Thread references are
    // the sole exception: viewing one is inert until Add to Live Dock.
    artifactId:
      studio.activeArtifact?.blueprintKey !== "thread_reference"
        ? studio.activeArtifact?._id
        : undefined,
    threadId: composerThread?.id,
    focusMode: effectiveFocusMode,
    selectedArtifactIds: contextualArtifactIds,
    explicitContextObjects,
    currentView: mode,
    initialCards: resultCards,
    onThreadReady: (threadId) => {
      setComposerThread((current) =>
        current?.id === threadId
          ? current
          : {
              id: threadId,
              title: "Current conversation",
              ...(studio.activeArtifact
                ? { artifactId: studio.activeArtifact._id }
                : {}),
            },
      );
      setActiveRunPanelId(null);
      window.dispatchEvent(new Event("spectra:threads-changed"));
    },
    onContinuationConflict: () => setComposerThread(null),
    onDataChanged: () => load(true),
    onOpenArtifact: async (artifactId) => {
      const refreshed = await load(true);
      const artifact = refreshed.find((item) => item._id === artifactId);
      if (artifact) openArtifactSurface(artifact);
    },
  });

  useEffect(() => {
    function onOpenArtifact(event: Event) {
      const artifactId = (event as CustomEvent<{ artifactId?: string }>).detail
        ?.artifactId;
      const artifact = artifactId
        ? allArtifacts.find((item) => item._id === artifactId)
        : null;
      if (artifact) openArtifactSurface(artifact);
    }
    function onOpenWorkspace(event: Event) {
      const workspaceId = (event as CustomEvent<{ workspaceId?: string }>)
        .detail?.workspaceId;
      if (workspaceId) setSelectedWorkspaceId(workspaceId);
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
    const returnToSection = () => returnToAllHub();
    const refresh = () => {
      void load(true);
    };
    window.addEventListener("spectra:open-artifact", onOpenArtifact);
    window.addEventListener("spectra:open-workspace", onOpenWorkspace);
    window.addEventListener("spectra:ask", onAsk);
    window.addEventListener("spectra:tile-selected", tile);
    window.addEventListener("spectra:focus-set", focusSet);
    window.addEventListener("spectra:clear-selection", clear);
    window.addEventListener("spectra:return-to-section", returnToSection);
    window.addEventListener("spectra:refresh", refresh);
    return () => {
      window.removeEventListener("spectra:open-artifact", onOpenArtifact);
      window.removeEventListener("spectra:open-workspace", onOpenWorkspace);
      window.removeEventListener("spectra:ask", onAsk);
      window.removeEventListener("spectra:tile-selected", tile);
      window.removeEventListener("spectra:focus-set", focusSet);
      window.removeEventListener("spectra:clear-selection", clear);
      window.removeEventListener("spectra:return-to-section", returnToSection);
      window.removeEventListener("spectra:refresh", refresh);
    };
  });

  function toggleContinuedThread(
    threadId: string,
    title: string,
    runId?: string,
  ) {
    setComposerThread((current) =>
      current?.id === threadId ? null : { id: threadId, title, runId },
    );
  }

  function toggleContextArtifact(artifact: SpectraArtifact) {
    if (artifact.blueprintKey === "thread_reference") {
      toast.message("Use Add to Live Dock to continue a saved thread.");
      return;
    }
    setMultiSelectMode(true);
    setSelectedContextIds((current) => {
      const next = new Set(current);
      if (next.has(artifact._id)) next.delete(artifact._id);
      else if (next.size < 24) next.add(artifact._id);
      else
        toast.message(
          "Context can include up to 24 explicitly selected work items.",
        );
      window.localStorage.setItem(
        "spectra.artifacts.latest-selection.v1",
        JSON.stringify([...next]),
      );
      return next;
    });
    setFocusModeOverride("selection");
  }

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (
      !requestedArtifactId ||
      openedQueryArtifactRef.current === requestedArtifactId
    )
      return;
    const artifact = allArtifacts.find(
      (item) => item._id === requestedArtifactId,
    );
    if (artifact) {
      openedQueryArtifactRef.current = requestedArtifactId;
      openArtifactSurface(artifact);
      return;
    }
    // Not found. Wait for the first load to finish before judging, then say so:
    // a link that resolves to nothing must not leave the user on an unchanged
    // Library with no explanation.
    if (loading || loadSequenceRef.current === 0) return;
    openedQueryArtifactRef.current = requestedArtifactId;
    toast.error("That work is not available.", {
      description:
        "It may have been deleted, or it may not be shared with your account.",
    });
  }, [allArtifacts, loading, openArtifactSurface, requestedArtifactId]);

  const artifacts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allArtifacts
      .filter((artifact) => {
        if (collection === "invitations") return false;
        if (collection === "threads") return false;
        if (artifact.blueprintKey === "thread_reference") return false;
        if (collection === "shared" && artifact.ownership !== "shared")
          return false;
        if (
          collection === "unplaced" &&
          artifactPlacements(artifact).length > 0
        )
          return false;
        if (
          collection === "recent" &&
          now - artifact.updatedAt > 1000 * 60 * 60 * 24 * 30
        )
          return false;
        if (collection === "favorites" && !favoriteIds.has(artifact._id))
          return false;
        if (collection === "collections" && artifact.tags.length === 0)
          return false;
        if (activeFilter !== "all" && artifact.blueprintKey !== activeFilter)
          return false;
        if (
          selectedWorkspaceId &&
          !artifactPlacements(artifact).some(
            (placement) => placement.workspaceId === selectedWorkspaceId,
          )
        )
          return false;
        if (!needle) return true;
        return `${artifact.title}\n${artifact.summary ?? ""}\n${artifact.tags.join(" ")}`
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => {
        if (sortMode === "created") return b.createdAt - a.createdAt;
        if (sortMode === "title") return a.title.localeCompare(b.title);
        if (sortMode === "type")
          return (
            a.blueprintKey.localeCompare(b.blueprintKey) ||
            a.title.localeCompare(b.title)
          );
        if (sortMode === "workspace")
          return (
            artifactPlacements(a)[0]?.workspaceTitle ?? "General"
          ).localeCompare(
            artifactPlacements(b)[0]?.workspaceTitle ?? "General",
          );
        return b.updatedAt - a.updatedAt;
      });
  }, [
    activeFilter,
    allArtifacts,
    collection,
    favoriteIds,
    now,
    search,
    selectedWorkspaceId,
    sortMode,
  ]);
  const inbox = useMemo(
    () =>
      artifacts.filter((artifact) => artifactPlacements(artifact).length === 0),
    [artifacts],
  );
  const placed = useMemo(
    () =>
      artifacts.filter(
        (artifact) =>
          artifact.placementStatus === "workspace" ||
          artifactPlacements(artifact).length > 0,
      ),
    [artifacts],
  );
  const byWorkspace = useMemo(
    () =>
      workspaces.map((workspace) => ({
        workspace,
        artifacts: placed.filter((artifact) =>
          artifactPlacements(artifact).some(
            (placement) => placement.workspaceId === workspace._id,
          ),
        ),
      })),
    [placed, workspaces],
  );

  function requestCreateArtifact(blueprintKey: ArtifactTypeKey) {
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
    targetWorkspaceId?: string,
  ) {
    setBusyKey(`artifact:create:${payload.blueprintKey}`);
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
      toast.success(
        targetWorkspaceId
          ? "Work created in workspace."
          : "Work created in Library.",
      );
      const refreshed = await load(true);
      const created = refreshed.find(
        (artifact) => artifact._id === result.artifactId,
      );
      if (created) studio.openSplit(created);
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not create this work." })
          .message,
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function importLibraryFile(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const blueprintKey: ArtifactTypeKey = ["ppt", "pptx"].includes(extension)
      ? "presentation"
      : ["xls", "xlsx", "csv", "tsv"].includes(extension)
        ? "sheets"
        : ["js", "jsx", "ts", "tsx", "py", "html", "css", "json"].includes(
              extension,
            )
          ? "code"
          : "document";
    const fallback = createDefaultArtifactPayload(blueprintKey);
    const title = file.name.replace(/\.[^.]+$/, "") || fallback.title;
    let importJobId: string | null = null;
    setBusyKey("library:import");
    try {
      const created = await postSpectra<{ artifactId: string }>({
        action: "createArtifact",
        blueprintKey,
        title,
        summary: `Imported from ${file.name}`,
        content: fallback.content,
        tags: ["imported"],
        source: "manual",
      });
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer(),
      );
      const sha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const beginning = await beginArtifactImportOriginal({
        artifactId: created.artifactId,
        typeKey: blueprintKey,
        format: extension || file.type || "binary",
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: file.size,
        sha256,
      });
      importJobId = beginning.jobId;
      await uploadArtifactImportOriginal(beginning.jobId, file);
      await completeArtifactImport({
        jobId: beginning.jobId,
        typeKey: blueprintKey,
        status: "imported",
        fidelityReport: [
          {
            scope: "original",
            level: "exact",
            message:
              "Original file preserved for the work editor import pipeline.",
          },
        ],
        unsupportedFeatures: [],
        importedContent: fallback.content,
      });
      await postSpectra({
        action: "createArtifactImportVersion",
        artifactId: created.artifactId,
        importJobId: beginning.jobId,
      });
      const refreshed = await load(true);
      const imported = refreshed?.find(
        (work) => work._id === created.artifactId,
      );
      if (imported) openArtifactSurface(imported);
      toast.success(`${title} imported to Library.`);
    } catch (error) {
      if (importJobId)
        await abortArtifactImportUpload(
          importJobId,
          "Library import failed",
        ).catch(() => undefined);
      toast.error(
        describeFailure(error, { fallback: "Could not import this file." })
          .message,
      );
    } finally {
      setBusyKey(null);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function archiveArtifact(artifact: SpectraArtifact) {
    setBusyKey(`artifact:archive:${artifact._id}`);
    try {
      await postSpectra({
        action: "archiveArtifact",
        artifactId: artifact._id,
      });
      toast.success("Work archived.");
      returnToAllHub();
      await load(true);
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not archive this work." })
          .message,
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
      toast.success("Work permanently deleted.");
      setArtifactDeletePending(null);
      if (studio.activeArtifact?._id === artifact._id) returnToAllHub();
      await load(true);
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not delete this work." })
          .message,
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function addToWorkspace(artifactId: string, workspaceId: string) {
    setBusyKey(`add:${artifactId}`);
    try {
      await postSpectra({
        action: "addArtifactToWorkspace",
        artifactId,
        workspaceId,
      });
      const workspaceTitle =
        workspaces.find((workspace) => workspace._id === workspaceId)?.title ??
        "workspace";
      toast.success(`Added to ${workspaceTitle}.`);
      setRowMenuArtifactId(null);
      setRowMenuWorkspacePicker(false);
      await load(true);
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not place this work." })
          .message,
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function removePlacement(workspaceItemId: string) {
    setBusyKey(`remove:${workspaceItemId}`);
    try {
      await postSpectra({ action: "hideWorkspaceItem", workspaceItemId });
      toast.success("Removed from workspace. The work remains in Library.");
      await load(true);
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not remove placement." })
          .message,
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function respondToShareInvitation(
    invitationId: string,
    response: "accept" | "decline",
  ) {
    setBusyKey(`invitation:${invitationId}`);
    try {
      await postSpectra({
        action:
          response === "accept"
            ? "acceptShareInvitation"
            : "declineShareInvitation",
        invitationId,
      });
      window.dispatchEvent(new Event("spectra:notifications-changed"));
      toast.success(
        response === "accept"
          ? "Shared item added to your library."
          : "Invitation declined.",
      );
      await load(true);
      if (response === "accept") setCollection("shared");
    } catch (error) {
      toast.error(
        describeFailure(error, { fallback: "Could not update the invitation." })
          .message,
      );
    } finally {
      setBusyKey(null);
    }
  }

  function rowActions(artifact: SpectraArtifact) {
    const firstPlacement = artifactPlacements(artifact)[0];
    const menuOpen = rowMenuArtifactId === artifact._id;
    const modifiableWorkspaces = workspaces.filter(
      (workspace) => workspace.accessLevel !== "read",
    );
    return (
      <div>
        <button
          type="button"
          className="grid size-8 place-items-center rounded-[8px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          onClick={(event) => {
            setRowMenuAnchor(event.currentTarget.getBoundingClientRect());
            setRowMenuWorkspacePicker(false);
            setRowMenuArtifactId(menuOpen ? null : artifact._id);
          }}
          aria-label={`More actions for ${artifact.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="More actions"
        >
          <Ellipsis className="size-4" />
        </button>
        <FloatingMenu
          open={menuOpen}
          anchor={rowMenuAnchor}
          onClose={() => {
            setRowMenuArtifactId(null);
            setRowMenuWorkspacePicker(false);
          }}
          width={250}
        >
          {rowMenuWorkspacePicker ? (
            <>
              <button
                type="button"
                className={menuItemClass()}
                onClick={() => setRowMenuWorkspacePicker(false)}
              >
                <ChevronLeft className="size-4" />
                Back to work actions
              </button>
              <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                Choose workspace
              </p>
              {modifiableWorkspaces.map((workspace) => {
                const alreadyPlaced = artifactPlacements(artifact).some(
                  (placement) => placement.workspaceId === workspace._id,
                );
                return (
                  <button
                    key={workspace._id}
                    type="button"
                    className={menuItemClass()}
                    disabled={
                      alreadyPlaced || busyKey === `add:${artifact._id}`
                    }
                    onClick={() =>
                      void addToWorkspace(artifact._id, workspace._id)
                    }
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-[var(--bg-secondary)] text-[11px] font-semibold text-[var(--text-secondary)]">
                      {initials(workspace.title)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {workspace.title}
                    </span>
                    {alreadyPlaced ? (
                      <CheckCircle2 className="size-4 text-[var(--success)]" />
                    ) : null}
                  </button>
                );
              })}
            </>
          ) : (
            <>
              <button
                type="button"
                className={menuItemClass()}
                onClick={() => {
                  setRowMenuArtifactId(null);
                  openArtifactSurface(artifact);
                }}
              >
                <ExternalLink className="size-4" />
                Open work
              </button>
              <button
                type="button"
                className={menuItemClass()}
                onClick={() => {
                  toggleFavorite(artifact._id);
                  setRowMenuArtifactId(null);
                }}
              >
                <Heart
                  className={`size-4 ${favoriteIds.has(artifact._id) ? "fill-current text-[#b66c31]" : ""}`}
                />
                {favoriteIds.has(artifact._id)
                  ? "Remove from favorites"
                  : "Add to favorites"}
              </button>
              {artifact.ownership !== "shared" ? (
                <button
                  type="button"
                  className={menuItemClass()}
                  onClick={() => {
                    setRowMenuArtifactId(null);
                    setShareTarget(artifact);
                  }}
                >
                  <Share2 className="size-4" />
                  Share work
                </button>
              ) : null}
              <button
                type="button"
                className={menuItemClass()}
                disabled={modifiableWorkspaces.length === 0}
                onClick={() => setRowMenuWorkspacePicker(true)}
              >
                {firstPlacement ? (
                  <FolderInput className="size-4" />
                ) : (
                  <FolderPlus className="size-4" />
                )}
                {firstPlacement
                  ? "Place in another workspace"
                  : "Add to workspace"}
              </button>
              {firstPlacement ? (
                <button
                  type="button"
                  className={menuItemClass()}
                  disabled={
                    busyKey === `remove:${firstPlacement.workspaceItemId}`
                  }
                  onClick={() => {
                    setRowMenuArtifactId(null);
                    void removePlacement(firstPlacement.workspaceItemId);
                  }}
                >
                  {busyKey === `remove:${firstPlacement.workspaceItemId}` ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <X className="size-4" />
                  )}
                  Remove from workspace
                </button>
              ) : null}
              {artifact.ownership !== "shared" ? (
                <button
                  type="button"
                  className={`${menuItemClass()} mt-1 text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-elevated))]`}
                  onClick={() => {
                    setRowMenuArtifactId(null);
                    void permanentlyDeleteArtifact(artifact);
                  }}
                >
                  <Trash2 className="size-4" />
                  Delete permanently
                </button>
              ) : null}
            </>
          )}
        </FloatingMenu>
      </div>
    );
  }

  const collectionItems = [
    {
      key: "all" as const,
      label: "All work",
      count: workArtifacts.length,
      icon: Files,
    },
    {
      key: "threads" as const,
      label: "Threads",
      count: libraryThreads.length,
      icon: MessageSquare,
    },
    {
      key: "unplaced" as const,
      label: "Unplaced",
      count: workArtifacts.filter(
        (work) => artifactPlacements(work).length === 0,
      ).length,
      icon: FolderInput,
    },
    {
      key: "shared" as const,
      label: "Shared with me",
      count: workArtifacts.filter((artifact) => artifact.ownership === "shared")
        .length,
      icon: Share2,
    },
    {
      key: "recent" as const,
      label: "Recent",
      count: workArtifacts.filter(
        (work) => now - work.updatedAt <= 1000 * 60 * 60 * 24 * 30,
      ).length,
      icon: Clock3,
    },
    {
      key: "favorites" as const,
      label: "Favorites",
      count: favoriteIds.size,
      icon: Heart,
    },
    {
      key: "collections" as const,
      label: "Collections",
      count: new Set(workArtifacts.flatMap((work) => work.tags)).size,
      icon: Tags,
    },
    {
      key: "invitations" as const,
      label: "Invitations",
      count: shareInvitations.length,
      icon: Mail,
    },
  ];
  const primaryCollectionItems = collectionItems.slice(0, 5);
  const secondaryCollectionItems = collectionItems.slice(5);

  return (
    <div className="spectra-wave-y flex h-full min-h-0 bg-[var(--bg-primary)]">
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
          onActivateHub={(tabId) => {
            if (studio.mode === "tab") returnToAllHub();
            else activateAllHub(tabId);
          }}
          onCloseHub={closeAllHubTab}
          onAddHub={addAllHubTab}
          onActivateTab={studio.activateTab}
          onCloseTab={closeArtifactTab}
          persistent
        />
        <div className="spectra-workbench-frame relative flex min-h-0 flex-1">
          {pendingCreateType ? (
            <div
              className="absolute inset-0 z-[90] flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-primary)_72%,transparent)] backdrop-blur-[2px]"
              onPointerDown={() => setPendingCreateType(null)}
            >
              <div
                className="w-[390px] rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[0_24px_70px_rgba(27,20,12,0.2)]"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <h2 className="font-display text-[19px] font-semibold text-[var(--text-primary)]">
                  Choose a destination
                </h2>
                <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                  Create this{" "}
                  {blueprintMeta[pendingCreateType].label.toLowerCase()} in a
                  workspace or keep it in General.
                </p>
                <div className="mt-4 max-h-[300px] space-y-1 overflow-y-auto">
                  <button
                    type="button"
                    className={menuItemClass()}
                    onClick={() => {
                      const type = pendingCreateType;
                      setPendingCreateType(null);
                      void createArtifact(createDefaultArtifactPayload(type));
                    }}
                  >
                    <LayoutGrid className="h-4 w-4" />
                    General
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
                      {target.title}
                    </button>
                  ))}
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
                  This work item, its placements, version history, and linked
                  run history will be permanently removed.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setArtifactDeletePending(null)}
                    className="h-9 px-3 text-[12px] text-[var(--text-secondary)]"
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
          {shareTarget ? (
            <ShareDialog
              open
              resourceType={
                shareTarget.blueprintKey === "agent" ? "agent" : "artifact"
              }
              resourceId={shareTarget._id}
              title={shareTarget.title}
              onClose={() => setShareTarget(null)}
              onChanged={async () => {
                await load(true);
              }}
            />
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
              sourceLabel="Library"
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
              sourceLabel="Library"
              onClose={returnToAllHub}
              onExpand={studio.openTab}
              onActivateTab={studio.activateTab}
              onCloseTab={closeArtifactTab}
              onArchive={archiveArtifact}
              onShare={(artifact) => setShareTarget(artifact)}
              onDirtyChange={studio.setDirty}
              onContinueThread={(threadId, title) =>
                toggleContinuedThread(threadId, title)
              }
              continuedThreadId={composerThread?.id}
            />
          ) : (
            <>
              <section className="spectra-library-content min-w-0 flex-1 overflow-y-auto px-4 pb-[150px] pt-16 sm:px-8 sm:pt-7">
                <header>
                  <div className="spectra-library-heading-row flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="spectra-library-heading-copy">
                      <h1 className="font-display text-[34px] font-semibold leading-none text-[var(--text-primary)]">
                        Library
                      </h1>
                      <p className="mt-3 text-[14px] text-[var(--text-secondary)]">
                        Find, organize, receive, and open work across every
                        workspace.
                      </p>
                    </div>
                    <div className="spectra-library-primary-actions flex flex-wrap items-center gap-2">
                      <input
                        ref={importInputRef}
                        type="file"
                        className="sr-only"
                        // Opened by the Import button, never reached directly:
                        // sr-only alone left a "Choose file" control in the tab
                        // order and the accessibility tree at the top of Library.
                        tabIndex={-1}
                        aria-hidden="true"
                        accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.tsv,.txt,.md,.js,.jsx,.ts,.tsx,.py,.html,.css,.json"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void importLibraryFile(file);
                        }}
                      />
                      <div className="relative w-[320px] max-w-full flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
                        <input
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          className="h-9 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-9 pr-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                          placeholder="Search work"
                        />
                      </div>
                      <WorkspacePicker
                        workspaces={workspaces}
                        selectedWorkspaceId={selectedWorkspaceId}
                        onSelect={setSelectedWorkspaceId}
                      />
                      <div className="relative" ref={createMenuRef}>
                        <button
                          type="button"
                          className={buttonClass("dark")}
                          onClick={() => setCreateMenuOpen((open) => !open)}
                        >
                          <Plus className="h-4 w-4" />
                          New work
                        </button>
                        {createMenuOpen ? (
                          <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[230px] rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[0_6px_18px_rgba(0,0,0,0.10)]">
                            <button
                              type="button"
                              className={menuItemClass()}
                              disabled={busyKey === "library:import"}
                              onClick={() => {
                                setCreateMenuOpen(false);
                                importInputRef.current?.click();
                              }}
                            >
                              {busyKey === "library:import" ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Upload className="h-4 w-4" />
                              )}
                              Import file
                            </button>
                            <div className="my-1 h-px bg-[var(--border-subtle)]" />
                            {filters
                              .filter((filter) => isCreatableFilter(filter.key))
                              .map((filter) => {
                                const Icon = filter.icon;
                                const key = filter.key as ArtifactTypeKey;
                                return (
                                  <button
                                    key={key}
                                    type="button"
                                    className={menuItemClass()}
                                    disabled={
                                      busyKey === `artifact:create:${key}`
                                    }
                                    onClick={() => {
                                      setCreateMenuOpen(false);
                                      requestCreateArtifact(key);
                                    }}
                                  >
                                    {busyKey === `artifact:create:${key}` ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Icon className="h-4 w-4" />
                                    )}
                                    New {blueprintMeta[key].label}
                                  </button>
                                );
                              })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="spectra-library-collection-select mt-6 block xl:hidden">
                    <SelectField
                      ariaLabel="Library collection"
                      value={collection}
                      onChange={(next) => {
                        setCollection(next as ArtifactCollection);
                        setSelectedWorkspaceId("");
                        setActiveFilter("all");
                      }}
                      options={collectionItems.map((item) => ({
                        value: item.key,
                        label: item.count
                          ? `${item.label} (${compactCollectionCount(item.count)})`
                          : item.label,
                      }))}
                    />
                  </div>
                  <nav
                    className="spectra-library-collection-tabs mt-7 hidden items-end gap-6 border-b border-[var(--border-default)] xl:flex"
                    aria-label="Library collections"
                  >
                    {primaryCollectionItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => {
                            setCollection(item.key);
                            setSelectedWorkspaceId("");
                            setActiveFilter("all");
                          }}
                          className={`relative flex h-10 items-center gap-2 px-0.5 text-[13px] font-medium transition ${collection === item.key ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
                          aria-current={
                            collection === item.key ? "page" : undefined
                          }
                          // The visible label is dropped by CSS when the rail
                          // tightens, which left these named only by their
                          // count — "button, 200" — and left Shared with me,
                          // which has no count, with no name at all. The name
                          // is stated here so it survives every width.
                          aria-label={
                            item.count > 0
                              ? `${item.label}, ${item.count}`
                              : item.label
                          }
                          title={item.label}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span className="spectra-library-collection-label">
                            {item.label}
                          </span>
                          {item.count > 0 ? (
                            <span className="min-w-5 rounded-[5px] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-center text-micro text-[var(--text-secondary)]">
                              {compactCollectionCount(item.count)}
                            </span>
                          ) : null}
                          {collection === item.key ? (
                            <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--text-primary)]" />
                          ) : null}
                        </button>
                      );
                    })}
                    <div className="relative ml-auto shrink-0">
                      <OverflowMenu
                        label="More Library collections"
                        items={secondaryCollectionItems.map((item) => ({
                          key: item.key,
                          label: item.label,
                          icon: item.icon,
                          hint: item.count
                            ? compactCollectionCount(item.count)
                            : undefined,
                        }))}
                        value={
                          secondaryCollectionItems.some(
                            (item) => item.key === collection,
                          )
                            ? collection
                            : ""
                        }
                        active={secondaryCollectionItems.some(
                          (item) => item.key === collection,
                        )}
                        onSelect={(key) => {
                          setCollection(key);
                          setSelectedWorkspaceId("");
                          setActiveFilter("all");
                        }}
                      />
                      {secondaryCollectionItems.some(
                        (item) => item.key === collection,
                      ) ? (
                        <span className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 bg-[var(--text-primary)]" />
                      ) : null}
                    </div>
                  </nav>
                  {collection !== "invitations" && collection !== "threads" ? (
                    <div className="spectra-library-filter-row mt-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                      <div className="relative" ref={filterMenuRef}>
                        {(() => {
                          const selectedFilter =
                            filters.find(
                              (filter) => filter.key === activeFilter,
                            ) ?? filters[0];
                          const SelectedIcon = selectedFilter.icon;
                          return (
                            <>
                              <button
                                type="button"
                                onClick={() => setFilterOpen((open) => !open)}
                                className="inline-flex h-9 min-w-[156px] items-center gap-2 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[12px] font-medium text-[var(--text-primary)] shadow-[0_1px_2px_rgba(27,20,12,.03)] transition hover:bg-[var(--bg-hover)]"
                                aria-haspopup="menu"
                                aria-expanded={filterOpen}
                              >
                                <SelectedIcon className="h-4 w-4 text-[var(--text-secondary)]" />
                                <span>{selectedFilter.label}</span>
                                <ChevronDown
                                  className={`ml-auto h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform ${filterOpen ? "rotate-180" : ""}`}
                                />
                              </button>
                              {filterOpen ? (
                                <div
                                  className="absolute left-0 top-[calc(100%+7px)] z-40 grid w-[300px] grid-cols-2 gap-1 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_18px_44px_rgba(27,20,12,.14)]"
                                  role="menu"
                                  aria-label="Filter by work type"
                                >
                                  {filters.map((filter) => {
                                    const Icon = filter.icon;
                                    return (
                                      <button
                                        key={filter.key}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={
                                          activeFilter === filter.key
                                        }
                                        onClick={() => {
                                          setActiveFilter(filter.key);
                                          setFilterOpen(false);
                                        }}
                                        className={`flex min-h-9 items-center gap-2 rounded-[7px] px-2.5 text-left text-[12px] font-medium transition ${activeFilter === filter.key ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"}`}
                                      >
                                        <Icon className="h-3.5 w-3.5" />
                                        {filter.label}
                                        {activeFilter === filter.key ? (
                                          <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-[var(--success)]" />
                                        ) : null}
                                      </button>
                                    );
                                  })}
                                  <div className="col-span-2 mt-1 border-t border-[var(--border-subtle)] pt-1">
                                    <button
                                      type="button"
                                      className={menuItemClass()}
                                      onClick={() => {
                                        setFilterOpen(false);
                                        setMultiSelectMode((value) => {
                                          const next = !value;
                                          if (
                                            next &&
                                            selectedContextIds.size === 0
                                          )
                                            restoreLatestSelection();
                                          return next;
                                        });
                                      }}
                                    >
                                      <Files className="h-4 w-4" />
                                      {multiSelectMode
                                        ? "Finish selecting objects"
                                        : "Select objects for AI"}
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </>
                          );
                        })()}
                      </div>
                      <div className="spectra-library-view-actions ml-auto flex items-center gap-2">
                        <div className="relative" ref={sortMenuRef}>
                          <button
                            type="button"
                            className={buttonClass()}
                            onClick={() => setSortOpen((open) => !open)}
                          >
                            {sortMode === "updated"
                              ? "Recently updated"
                              : sortMode === "created"
                                ? "Recently created"
                                : sortMode === "title"
                                  ? "Title A–Z"
                                  : sortMode === "type"
                                    ? "Work type"
                                    : sortMode === "workspace"
                                      ? "Workspace"
                                      : "Activity"}
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                          {sortOpen ? (
                            <div className="absolute right-0 top-[calc(100%+7px)] z-40 w-[190px] rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_14px_32px_rgba(27,20,12,0.13)]">
                              {(
                                [
                                  ["updated", "Recently updated"],
                                  ["created", "Recently created"],
                                  ["title", "Title A–Z"],
                                  ["type", "Work type"],
                                  ["workspace", "Workspace"],
                                  ["activity", "Activity"],
                                ] as Array<[ArtifactSort, string]>
                              ).map(([key, label]) => (
                                <button
                                  key={key}
                                  type="button"
                                  className={menuItemClass()}
                                  onClick={() => {
                                    setSortMode(key);
                                    setSortOpen(false);
                                  }}
                                >
                                  {label}
                                  {sortMode === key ? (
                                    <CheckCircle2 className="ml-auto h-4 w-4 text-[var(--success)]" />
                                  ) : null}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex rounded-[10px] bg-[color-mix(in_oklab,var(--bg-elevated)_74%,transparent)] p-1 shadow-[inset_0_0_0_1px_var(--border-default)]">
                          {[
                            { key: "list" as const, label: "List", icon: List },
                            {
                              key: "board" as const,
                              label: "Board",
                              icon: PanelTop,
                            },
                            {
                              key: "canvas" as const,
                              label: "Canvas",
                              icon: Sparkles,
                            },
                          ].map((item) => {
                            const Icon = item.icon;
                            return (
                              <button
                                key={item.key}
                                type="button"
                                className={`inline-flex h-8 items-center gap-2 rounded-[7px] px-3 text-[12px] font-medium transition-all duration-200 ${mode === item.key ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_1px_6px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--bg-primary)_52%,transparent)] hover:text-[var(--text-primary)]"}`}
                                onClick={() => setMode(item.key)}
                              >
                                <Icon className="h-4 w-4" />
                                {item.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </header>
                {loading ? <ArtifactsSkeleton /> : null}
                {!loading && collection === "invitations" ? (
                  <InvitationInbox
                    invitations={shareInvitations}
                    busyKey={busyKey}
                    onRespond={respondToShareInvitation}
                  />
                ) : null}
                {!loading &&
                collection !== "invitations" &&
                collection !== "threads" &&
                artifacts.length === 0 ? (
                  <EmptyArtifactsState />
                ) : null}
                {!loading && collection === "threads" ? (
                  visibleThreads.length ? (
                    <div className="mt-7 space-y-1">
                      {visibleThreads.map((thread) => (
                        <article
                          key={thread._id}
                          className="group relative rounded-[10px] transition-colors hover:bg-[var(--bg-secondary)]"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setLiveThread({
                                id: thread._id,
                                title: thread.title,
                              })
                            }
                            className="grid min-h-[64px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3 py-2.5 pr-12 text-left sm:grid-cols-[minmax(0,1fr)_120px_auto]"
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <MessageSquare className="size-4 shrink-0 text-[var(--text-secondary)]" />
                              <span className="min-w-0">
                                <strong className="block truncate text-[13px] font-medium text-[var(--text-primary)]">
                                  {thread.title}
                                </strong>
                                {thread.summaryShort ? (
                                  <span className="mt-0.5 block truncate text-[11px] text-[var(--text-secondary)]">
                                    {thread.summaryShort}
                                  </span>
                                ) : null}
                              </span>
                            </span>
                            <span className="hidden truncate text-[11px] text-[var(--text-tertiary)] sm:block">
                              {workspaces.find(
                                (workspace) =>
                                  workspace._id === thread.workspaceId,
                              )?.title ??
                                (thread.workspaceId ? "Workspace" : "Unplaced")}
                            </span>
                            <span className="text-[11px] text-[var(--text-tertiary)]">
                              {formatRelativeTime(
                                thread.lastMessageAt ?? thread.updatedAt,
                              )}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              toggleContinuedThread(thread._id, thread.title)
                            }
                            className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-[8px] text-[var(--text-secondary)] opacity-0 transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] group-hover:opacity-100 group-focus-within:opacity-100"
                            aria-label={
                              composerThread?.id === thread._id
                                ? "Remove thread from Live Dock"
                                : "Continue thread in Live Dock"
                            }
                            title={
                              composerThread?.id === thread._id
                                ? "Remove from Live Dock"
                                : "Continue in Live Dock"
                            }
                          >
                            {composerThread?.id === thread._id ? (
                              <CheckCircle2 className="size-4 text-[var(--success)]" />
                            ) : (
                              <Plus className="size-4" />
                            )}
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-[9px] border border-dashed border-[var(--border-default)] px-4 py-8 text-center text-[13px] text-[var(--text-secondary)]">
                      Conversations you start will appear here. They are not
                      counted as work artifacts.
                    </p>
                  )
                ) : null}
                {!loading &&
                collection !== "invitations" &&
                collection !== "threads" &&
                artifacts.length > 0 &&
                mode === "list" ? (
                  <GroupedList
                    inbox={inbox}
                    groups={byWorkspace}
                    rowActions={rowActions}
                    onOpen={openArtifactSurface}
                    landingTitle={
                      collection === "shared"
                        ? "Shared with you"
                        : collection === "favorites"
                          ? "Favorites"
                          : collection === "collections"
                            ? "Tagged collections"
                            : "Unplaced work"
                    }
                    landingDescription={
                      collection === "shared"
                        ? "Received work that you have not placed in a workspace yet."
                        : collection === "favorites"
                          ? "Work you marked for quick return."
                          : collection === "collections"
                            ? "Work organized with collection tags."
                            : "Work not yet placed in a workspace."
                    }
                  />
                ) : null}
                {!loading &&
                collection !== "invitations" &&
                collection !== "threads" &&
                artifacts.length > 0 &&
                mode === "board" ? (
                  <BoardColumns
                    inbox={inbox}
                    groups={byWorkspace}
                    onOpen={openArtifactSurface}
                  />
                ) : null}
                {!loading &&
                collection !== "invitations" &&
                collection !== "threads" &&
                artifacts.length > 0 &&
                mode === "canvas" ? (
                  <ArtifactsCanvas
                    artifacts={artifacts}
                    onOpen={openArtifactSurface}
                    selectionMode={multiSelectMode}
                    selectedIds={selectedContextIds}
                    onToggleContext={toggleContextArtifact}
                  />
                ) : null}
              </section>
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
                  sourceLabel="Library"
                  onPanelWidthChange={setStudioPanelWidth}
                  onClose={returnToAllHub}
                  onExpand={studio.openTab}
                  onActivateTab={studio.activateTab}
                  onCloseTab={closeArtifactTab}
                  onArchive={archiveArtifact}
                  onShare={(artifact) => setShareTarget(artifact)}
                  onDirtyChange={studio.setDirty}
                  onContinueThread={(threadId, title) =>
                    toggleContinuedThread(threadId, title)
                  }
                  continuedThreadId={composerThread?.id}
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
                  sourceLabel="Library"
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
          )}
          <WorkbenchDockShell
            zIndex={320}
            attachmentsHostRef={setAttachmentsHost}
            dock={{
              workspaceId: selectedWorkspaceId || undefined,
              optimistic: runEngine.liveExchange,
              openThreadId: liveThread?.id,
              onStartNewThread: () => setComposerThread(null),
              onOpen: (_runId, threadId, title, artifactId) => {
                skipAutoContinueThreadIdRef.current = null;
                setActiveRunPanelId(null);
                setLiveThread({ id: threadId, title });
                setComposerThread({
                  id: threadId,
                  title,
                  runId: _runId,
                  workspaceId: selectedWorkspaceId || undefined,
                });
                if (artifactId) {
                  const artifact = allArtifacts.find(
                    (item) => item._id === artifactId,
                  );
                  if (artifact) openArtifactSurface(artifact);
                }
              },
              onContinue: (_runId, threadId, title) => {
                skipAutoContinueThreadIdRef.current = null;
                setComposerThread({
                  id: threadId,
                  title,
                  runId: _runId,
                  workspaceId: selectedWorkspaceId || undefined,
                });
              },
              onDeselect: () => {
                if (liveThread)
                  skipAutoContinueThreadIdRef.current = liveThread.id;
                setComposerThread(null);
              },
              onStop: (runId) => runEngine.stop(runId),
              onRetry: (runId) => void runEngine.retry(runId),
              onAction: (card, action) =>
                void runEngine.onCardAction(card, action, card.runId),
              onRevise: (card, revision) =>
                void runEngine.revise(card, revision),
              onInput: (threadId, response, attachments) =>
                runEngine.run(response, attachments ?? [], { threadId }),
            }}
            selection={
              multiSelectMode ? (
                <SelectionActionBar
                  count={selectedContextIds.size}
                  onClear={clearSelection}
                  onExit={() => {
                    clearSelection();
                    setMultiSelectMode(false);
                  }}
                  onAddToContext={() => {
                    const count = selectedContextIds.size;
                    commitSelection();
                    setFocusModeOverride("selection");
                    setMultiSelectMode(false);
                    toast.success(
                      `${count} object${count === 1 ? "" : "s"} added to context.`,
                    );
                  }}
                  onTile={openSelectedArtifactsInTiles}
                />
              ) : undefined
            }
            composer={
              <CommandBar
                allowAttachments
                attachmentsPortalTarget={attachmentsHost}
                placeholder={
                  composerThread
                    ? `Continue ${composerThread.title}...`
                    : studio.activeArtifact
                      ? `Act on ${studio.activeArtifact.title}...`
                      : "Ask across all objects..."
                }
                onSubmit={(prompt, attachments) => {
                  if (
                    studio.activeArtifact &&
                    studio.dirtyIds.has(studio.activeArtifact._id)
                  ) {
                    toast.message(
                      "Save this work before asking Spectra to update it.",
                    );
                    return false;
                  }
                  return runEngine.run(prompt, attachments);
                }}
                busy={runEngine.submitting}
                allowConcurrent={!composerThread}
                onStop={runEngine.stop}
                activeRunId={runEngine.activeRunId}
                onSteer={runEngine.steer}
                onStartNewThread={() => setComposerThread(null)}
                context={
                  <ContextFocusControl
                    mode={effectiveFocusMode}
                    onModeChange={setFocusModeOverride}
                    workspace={selectedWorkspace}
                    artifact={studio.activeArtifact}
                    selectedCount={contextualArtifactIds.length}
                    threadTitle={composerThread?.title}
                  />
                }
                menu={
                  <div>
                    <CommandBarMenuItem onClick={() => setComposerThread(null)}>
                      <MessageSquare className="h-4 w-4" />
                      New chat
                    </CommandBarMenuItem>
                    <CommandBarSubmenu label="New work" icon={Plus}>
                      {filters
                        .filter((filter) => isCreatableFilter(filter.key))
                        .map((filter) => {
                          const Icon = filter.icon;
                          const key = filter.key as ArtifactTypeKey;
                          return (
                            <CommandBarMenuItem
                              key={key}
                              disabled={busyKey === `artifact:create:${key}`}
                              onClick={() => requestCreateArtifact(key)}
                            >
                              {busyKey === `artifact:create:${key}` ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Icon className="h-4 w-4" />
                              )}
                              {blueprintMeta[key].label}
                            </CommandBarMenuItem>
                          );
                        })}
                    </CommandBarSubmenu>
                    <CommandBarMenuItem
                      onClick={() => {
                        setMultiSelectMode(true);
                        if (selectedContextIds.size === 0)
                          restoreLatestSelection();
                      }}
                    >
                      <Files className="h-4 w-4" />
                      Select objects
                    </CommandBarMenuItem>
                  </div>
                }
              />
            }
          />
          {liveThread ? (
            <LiveThreadPanel
              threadId={liveThread.id}
              title={liveThread.title}
              liveExchange={
                runEngine.liveExchange &&
                runEngine.liveExchange.threadId === liveThread.id
                  ? runEngine.liveExchange
                  : null
              }
              width={liveThreadPanelWidth}
              onWidthChange={setLiveThreadPanelWidth}
              continuing={composerThread?.id === liveThread.id}
              onContinue={() => {
                void (async () => {
                  if (composerThread?.id === liveThread.id) {
                    skipAutoContinueThreadIdRef.current = liveThread.id;
                    setComposerThread(null);
                    return;
                  }
                  skipAutoContinueThreadIdRef.current = null;
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
                      workspaceId: selectedWorkspaceId || undefined,
                    });
                    window.dispatchEvent(new Event("spectra:threads-changed"));
                  } catch (error) {
                    toast.message(
                      describeFailure(error, {
                        fallback:
                          "Could not select this thread for continuation.",
                      }).message,
                    );
                  }
                })();
              }}
              onClose={() => setLiveThread(null)}
              onOpenArtifact={(artifactId) => {
                const artifact = allArtifacts.find(
                  (item) => item._id === artifactId,
                );
                if (artifact) openArtifactSurface(artifact);
              }}
              onOpenWorkspace={(workspaceId) =>
                setSelectedWorkspaceId(workspaceId)
              }
            />
          ) : null}
          {activeRunPanelId ? (
            <RunDetailPanel
              runId={activeRunPanelId}
              card={runEngine.cards.find(
                (card) => card.runId === activeRunPanelId,
              )}
              onClose={() => setActiveRunPanelId(null)}
              onSaved={() => setActiveRunPanelId(null)}
              onUseThread={(id, title) =>
                toggleContinuedThread(id, title, activeRunPanelId)
              }
              onAction={(card, action, targetId) =>
                void runEngine.onCardAction(card, action, targetId)
              }
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WorkspacePicker({
  workspaces,
  selectedWorkspaceId,
  onSelect,
}: {
  workspaces: SpectraWorkspace[];
  selectedWorkspaceId: string;
  onSelect: (workspaceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const selected = workspaces.find(
    (workspace) => workspace._id === selectedWorkspaceId,
  );
  return (
    <div>
      <button
        type="button"
        className={buttonClass()}
        onClick={(event) => {
          setAnchor(event.currentTarget.getBoundingClientRect());
          setOpen((value) => !value);
        }}
      >
        <LayoutGrid className="h-4 w-4" />
        <span className="max-w-[150px] truncate">
          {selected?.title ?? "All workspaces"}
        </span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <FloatingMenu
        open={open}
        anchor={anchor}
        onClose={() => setOpen(false)}
        width={260}
      >
        <button
          type="button"
          className={menuItemClass()}
          onClick={() => {
            onSelect("");
            setOpen(false);
          }}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
            <LayoutGrid className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate">All workspaces</span>
          {!selectedWorkspaceId ? (
            <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
          ) : null}
        </button>
        {workspaces.map((workspace) => (
          <button
            key={workspace._id}
            type="button"
            className={menuItemClass()}
            onClick={() => {
              onSelect(workspace._id);
              setOpen(false);
            }}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[var(--bg-secondary)] text-[11px] font-semibold text-[var(--text-secondary)]">
              {initials(workspace.title)}
            </span>
            <span className="min-w-0 flex-1 truncate">{workspace.title}</span>
            {workspace._id === selectedWorkspaceId ? (
              <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
            ) : null}
          </button>
        ))}
      </FloatingMenu>
    </div>
  );
}

function InvitationInbox({
  invitations,
  busyKey,
  onRespond,
}: {
  invitations: SpectraShareInvitation[];
  busyKey: string | null;
  onRespond: (invitationId: string, response: "accept" | "decline") => void;
}) {
  if (invitations.length === 0) {
    return (
      <div className="mt-8 flex min-h-[260px] items-center justify-center rounded-[10px] border border-dashed border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_42%,transparent)]">
        <div className="max-w-sm text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
            <Mail className="h-4 w-4" />
          </div>
          <h2 className="mt-4 font-display text-[20px] font-semibold text-[var(--text-primary)]">
            No pending invitations
          </h2>
          <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">
            New work and workspace invitations will wait here until you accept
            or decline them.
          </p>
        </div>
      </div>
    );
  }
  return (
    <section className="mt-8" aria-labelledby="share-invitations-title">
      <div className="mb-4">
        <h2
          id="share-invitations-title"
          className="font-display text-[21px] font-semibold text-[var(--text-primary)]"
        >
          Waiting for you
        </h2>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          Nothing appears in Shared until you accept. You can review the
          requested access first.
        </p>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {invitations.map((invitation) => {
          const artifactMeta =
            invitation.resource.typeKey !== "workspace"
              ? blueprintMeta[invitation.resource.typeKey]
              : null;
          const Icon = artifactMeta?.icon ?? LayoutGrid;
          const working = busyKey === `invitation:${invitation.invitationId}`;
          return (
            <article
              key={invitation.invitationId}
              className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[0_1px_2px_rgba(27,20,12,0.03)]"
            >
              <div className="flex items-start gap-3.5">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] bg-[var(--bg-secondary)]"
                  style={{
                    color: artifactMeta?.color ?? "var(--text-secondary)",
                  }}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="truncate font-display text-[18px] font-semibold text-[var(--text-primary)]">
                      {invitation.resource.title}
                    </h3>
                    <span className="rounded-[5px] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-micro font-medium text-[var(--text-secondary)]">
                      {invitation.resourceType === "workspace"
                        ? "Workspace"
                        : (artifactMeta?.label ?? "Work")}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                    <span className="font-medium text-[var(--text-primary)]">
                      {invitation.inviter?.name ?? "A school member"}
                    </span>{" "}
                    invited you with{" "}
                    {invitation.level === "modify" ? "modify" : "read-only"}{" "}
                    access.
                  </p>
                  {invitation.message ? (
                    <p className="mt-3 rounded-[7px] border-l-2 border-[var(--border-strong)] bg-[var(--bg-secondary)] px-3 py-2 text-[12px] leading-5 text-[var(--text-secondary)]">
                      {invitation.message}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
                <button
                  type="button"
                  disabled={working}
                  onClick={() => onRespond(invitation.invitationId, "decline")}
                  className="h-8 rounded-[7px] px-3 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45"
                >
                  Decline
                </button>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => onRespond(invitation.invitationId, "accept")}
                  className="inline-flex h-8 items-center gap-2 rounded-[7px] bg-[var(--text-primary)] px-3 text-[12px] font-medium text-[var(--bg-primary)] disabled:opacity-45"
                >
                  {working ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Share2 className="h-3.5 w-3.5" />
                  )}
                  Accept
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/**
 * One row for every Library list surface. The unplaced list and the
 * per-workspace groups both render this, so they cannot drift in height, icon
 * size, title weight, subtitle meaning, timestamp format or action behaviour
 * the way the two hand-written rows did. Height is intrinsic: one line of
 * content stays compact, and a row only grows when it has a summary to show.
 */
function LibraryRow({
  artifact,
  rowActions,
  onOpen,
}: {
  artifact: SpectraArtifact;
  rowActions: (artifact: SpectraArtifact) => ReactNode;
  onOpen: (artifact: SpectraArtifact) => void;
}) {
  const meta = blueprintMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  // The type already has its own column, so repeating it as a subtitle wastes
  // the line that a real summary should occupy. Summaries can arrive as HTML —
  // imported ManageBac tasks carry markup — and this row printed it raw, so a
  // person read "<p>Your homework is completed in unifrog" in their own Library.
  const rawSummary = previewText(artifact.summary);
  const summary =
    rawSummary && rawSummary.toLowerCase() !== meta.label.toLowerCase()
      ? rawSummary
      : null;
  const tags = artifact.tags.slice(0, 2);
  return (
    <article className="group relative rounded-[8px] transition-colors hover:bg-[var(--bg-secondary)]">
      <button
        type="button"
        onClick={() => onOpen(artifact)}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] px-3 py-2 pr-11 text-left sm:grid-cols-[minmax(0,1fr)_minmax(0,auto)_88px_auto]"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Icon className="size-4 shrink-0" style={{ color: meta.color }} />
          <span className="min-w-0">
            <strong className="block truncate text-[13px] font-medium leading-5 text-[var(--text-primary)]">
              {artifact.title}
            </strong>
            {summary ? (
              <span className="block truncate text-[11px] leading-4 text-[var(--text-secondary)]">
                {summary}
              </span>
            ) : null}
          </span>
        </span>
        <span className="hidden min-w-0 items-center gap-1 sm:flex">
          {tags.map((tag) => (
            <span
              key={tag}
              className="max-w-[104px] truncate rounded-[5px] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] group-hover:bg-[var(--bg-elevated)]"
            >
              {tag}
            </span>
          ))}
        </span>
        <span className="hidden truncate text-[11px] text-[var(--text-tertiary)] sm:block">
          {meta.label}
        </span>
        <span className="whitespace-nowrap text-[11px] text-[var(--text-tertiary)]">
          {formatRelativeTime(artifact.updatedAt)}
        </span>
      </button>
      <div
        className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        onClick={(event) => event.stopPropagation()}
      >
        {rowActions(artifact)}
      </div>
    </article>
  );
}

function GroupedList({
  inbox,
  groups,
  rowActions,
  onOpen,
  landingTitle,
  landingDescription,
}: {
  inbox: SpectraArtifact[];
  groups: Array<{ workspace: SpectraWorkspace; artifacts: SpectraArtifact[] }>;
  rowActions: (artifact: SpectraArtifact) => ReactNode;
  onOpen: (artifact: SpectraArtifact) => void;
  landingTitle: string;
  landingDescription: string;
}) {
  const [inboxExpanded, setInboxExpanded] = useState(false);
  return (
    <div className="mt-8">
      <section>
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">
              {landingTitle}
            </h2>
            <span className="rounded-[6px] bg-[var(--bg-secondary)] px-1.5 text-[12px] text-[var(--text-secondary)]">
              {inbox.length}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            {landingDescription}
          </p>
        </div>
        <div className="space-y-0.5">
          {inbox.slice(0, inboxExpanded ? inbox.length : 18).map((artifact) => (
            <LibraryRow
              key={artifact._id}
              artifact={artifact}
              rowActions={rowActions}
              onOpen={onOpen}
            />
          ))}
          {inbox.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-[var(--border-default)] px-4 py-8 text-[13px] text-[var(--text-secondary)]">
              No unplaced work in this scope.
            </div>
          ) : null}
        </div>
        {inbox.length > 18 ? (
          <button
            type="button"
            className="mt-3 h-8 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            onClick={() => setInboxExpanded((value) => !value)}
          >
            {inboxExpanded ? "Show fewer" : `Show ${inbox.length - 18} more`}
          </button>
        ) : null}
      </section>
      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">
              In workspaces
            </h2>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
              Work that has been added to your workspaces.
            </p>
          </div>
        </div>
        <div className="space-y-4">
          {groups
            .filter((group) => group.artifacts.length > 0)
            .map((group, index) => (
              <WorkspaceGroup
                key={group.workspace._id}
                workspace={group.workspace}
                artifacts={group.artifacts}
                index={index}
                rowActions={rowActions}
                onOpen={onOpen}
              />
            ))}
        </div>
      </section>
    </div>
  );
}

function WorkspaceGroup({
  workspace,
  artifacts,
  index,
  rowActions,
  onOpen,
}: {
  workspace: SpectraWorkspace;
  artifacts: SpectraArtifact[];
  index: number;
  rowActions: (artifact: SpectraArtifact) => ReactNode;
  onOpen: (artifact: SpectraArtifact) => void;
}) {
  const accent = workspaceAccent(workspace, index);
  const [expanded, setExpanded] = useState(false);
  return (
    <section>
      <div
        className="flex h-11 items-center justify-between rounded-[10px] px-3"
        style={{ background: accent.soft }}
      >
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: accent.color }}
          />
          {workspace.title}
          <span className="rounded-[5px] bg-[color-mix(in_oklab,var(--bg-elevated)_70%,transparent)] px-1.5 text-[11px] text-[var(--text-secondary)]">
            {artifacts.length}
          </span>
        </div>
      </div>
      <div className="mt-0.5 space-y-0.5 px-1">
        {artifacts.slice(0, expanded ? artifacts.length : 8).map((artifact) => (
          <LibraryRow
            key={artifact._id}
            artifact={artifact}
            rowActions={rowActions}
            onOpen={onOpen}
          />
        ))}
      </div>
      {artifacts.length > 8 ? (
        <button
          type="button"
          className="m-2 h-8 px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show fewer" : `Show ${artifacts.length - 8} more`}
        </button>
      ) : null}
    </section>
  );
}

function BoardColumns({
  inbox,
  groups,
  onOpen,
}: {
  inbox: SpectraArtifact[];
  groups: Array<{ workspace: SpectraWorkspace; artifacts: SpectraArtifact[] }>;
  onOpen: (artifact: SpectraArtifact) => void;
}) {
  const visibleGroups = [
    ...(inbox.length
      ? [
          {
            key: "unplaced",
            title: "Unplaced",
            artifacts: inbox,
            accent: {
              color: "#9a7655",
              soft: "color-mix(in oklab, #9a7655 7%, var(--bg-primary))",
            },
          },
        ]
      : []),
    ...groups
      .filter((group) => group.artifacts.length > 0)
      .map((group, index) => ({
        key: group.workspace._id,
        title: group.workspace.title,
        artifacts: group.artifacts,
        accent: workspaceAccent(group.workspace, index),
      })),
  ];
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  return (
    <div className="mt-8 overflow-x-auto pb-6">
      <div
        className="grid gap-4 pr-2"
        style={{
          gridTemplateColumns: `repeat(${Math.max(visibleGroups.length, 1)}, clamp(340px, 30vw, 430px))`,
          width: "max-content",
        }}
      >
        {visibleGroups.map((group) => {
          const expanded = expandedGroups.has(group.key);
          return (
            <section
              key={group.key}
              data-board-column={group.key}
              className="min-h-[620px] px-1"
              style={{ "--card-accent": group.accent.color } as CSSProperties}
            >
              <div
                className="mb-3 flex h-11 items-center justify-between rounded-[10px] px-3"
                style={{ background: group.accent.soft }}
              >
                <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: group.accent.color }}
                  />
                  {group.title}
                  <span className="text-[12px] text-[var(--text-tertiary)]">
                    {group.artifacts.length}
                  </span>
                </div>
              </div>
              <div className="space-y-2.5">
                {group.artifacts
                  .slice(0, expanded ? group.artifacts.length : 6)
                  .map((artifact) => {
                    const card = artifactToCard(artifact);
                    return (
                      <ArtifactCard
                        key={artifact._id}
                        artifact={card}
                        quiet
                        className="spectra-card--board"
                        onSelect={() => onOpen(artifact)}
                      />
                    );
                  })}
              </div>
              {group.artifacts.length > 6 ? (
                <button
                  type="button"
                  className="mt-3 h-8 px-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  onClick={() =>
                    setExpandedGroups((current) => {
                      const next = new Set(current);
                      if (expanded) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })
                  }
                >
                  {expanded
                    ? "Show fewer"
                    : `Show ${group.artifacts.length - 6} more`}
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ArtifactsCanvas({
  artifacts,
  onOpen,
  selectionMode,
  selectedIds,
  onToggleContext,
}: {
  artifacts: SpectraArtifact[];
  onOpen: (artifact: SpectraArtifact) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleContext: (artifact: SpectraArtifact) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const clusters = filters
    .filter((filter) => filter.key !== "all")
    .map((filter) => ({
      ...filter,
      color: blueprintMeta[filter.key as SpectraBlueprintKey].color,
      artifacts: artifacts.filter(
        (artifact) => artifact.blueprintKey === filter.key,
      ),
    }))
    .filter((cluster) => cluster.artifacts.length > 0);
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
      className="relative mt-5 min-h-[620px] overflow-auto rounded-[12px] border border-[var(--border-subtle)] bg-[radial-gradient(color-mix(in_oklab,var(--border-default)_62%,transparent)_0.65px,transparent_0.8px)] p-5 pb-28 [background-size:18px_18px]"
    >
      <div className="sticky top-0 z-20 ml-auto mb-5 flex w-fit items-center gap-1 rounded-[9px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_96%,transparent)] p-1 shadow-[0_10px_28px_-22px_rgba(27,20,12,.45)] backdrop-blur">
        <button
          type="button"
          onClick={() => resetCanvas(1)}
          className="flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-micro font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
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
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-11 text-center text-micro tabular-nums text-[var(--text-secondary)]">
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
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => resetCanvas(0.8)}
          className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          aria-label="Fit canvas to view"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <span className="h-5 w-px bg-[var(--border-subtle)]" />
        <span className="px-2 text-micro text-[var(--text-tertiary)]">
          Clustered by type
        </span>
      </div>
      <div
        className="grid auto-rows-min gap-5 transition-transform duration-200 motion-reduce:transition-none lg:grid-cols-2 xl:grid-cols-12"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "top left",
          width: `${100 / zoom}%`,
        }}
      >
        {clusters.map((cluster, index) => {
          const Icon = cluster.icon;
          return (
            <section
              key={cluster.key}
              className={`self-start rounded-[10px] border p-2.5 lg:col-span-1 ${layouts[index % layouts.length]}`}
              style={{
                borderColor: `color-mix(in oklab, ${cluster.color} 24%, var(--border-default))`,
                background: `color-mix(in oklab, ${cluster.color} 5%, var(--bg-primary))`,
                boxShadow: `0 20px 45px -38px color-mix(in oklab, ${cluster.color} 42%, transparent)`,
              }}
            >
              <header className="mb-3 flex items-center gap-2 px-1">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-micro font-semibold"
                  style={{
                    color: cluster.color,
                    background: `color-mix(in oklab, ${cluster.color} 10%, var(--bg-elevated))`,
                  }}
                >
                  {index + 1}
                </span>
                <Icon className="h-4 w-4" style={{ color: cluster.color }} />
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {cluster.label}
                </span>
                <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
                  {cluster.artifacts.length}
                </span>
              </header>
              <div className="grid gap-2">
                {cluster.artifacts.slice(0, 6).map((artifact) => (
                  <ArtifactCard
                    key={artifact._id}
                    artifact={artifactToCard(artifact)}
                    size="compact"
                    quiet
                    className="spectra-card--canvas"
                    selectionMode={selectionMode}
                    contextSelected={selectedIds.has(artifact._id)}
                    onToggleContext={() => onToggleContext(artifact)}
                    onSelect={() => onOpen(artifact)}
                  />
                ))}
                {cluster.artifacts.length > 6 ? (
                  <div className="col-span-full flex h-8 items-center justify-center rounded-[6px] border border-dashed border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_72%,transparent)] text-micro text-[var(--text-tertiary)]">
                    {cluster.artifacts.length - 6} more in this cluster
                  </div>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
      <div
        className="sticky bottom-5 z-20 ml-auto mt-8 hidden h-24 w-36 overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_94%,transparent)] p-2 shadow-[0_12px_30px_rgba(27,20,12,.12)] backdrop-blur sm:block"
        aria-label="Canvas minimap"
      >
        <div className="grid h-full grid-cols-3 gap-1.5">
          {clusters.slice(0, 6).map((cluster) => (
            <span
              key={`mini:${String(cluster.key)}`}
              className="rounded-[4px] border"
              style={{
                borderColor: `color-mix(in oklab, ${cluster.color} 28%, var(--border-default))`,
                background: `color-mix(in oklab, ${cluster.color} 10%, var(--bg-primary))`,
              }}
            />
          ))}
        </div>
        <span className="pointer-events-none absolute inset-3 rounded-[5px] border border-[color-mix(in_oklab,var(--accent-cyan)_55%,transparent)]" />
      </div>
    </div>
  );
}

function ArtifactsSkeleton() {
  return (
    <div className="mt-6" role="status" aria-label="Loading work">
      <span className="sr-only">Loading work</span>
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="flex h-[62px] animate-pulse items-center gap-3 border-b border-[var(--border-subtle)] px-1"
        >
          <span className="size-8 rounded-[8px] bg-[var(--bg-secondary)]" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-2.5 w-[min(220px,55%)] rounded bg-[var(--bg-secondary)]" />
            <span className="block h-2 w-[min(320px,72%)] rounded bg-[color-mix(in_oklab,var(--bg-secondary)_72%,transparent)]" />
          </span>
        </div>
      ))}
    </div>
  );
}

function EmptyArtifactsState() {
  return (
    <ProductEmptyState
      icon={Search}
      title="No work matches"
      detail="Adjust the search, type, or workspace scope."
      className="mt-10 min-h-[340px]"
    />
  );
}
