"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Pencil, RotateCcw, ChevronRight, Copy, FolderPlus, Link2, Lock, Share2, Star, Trash2, ArrowRight, Users } from "@/components/icons/glyph-icons";
import { copyWorkHere } from "./shared-works";
import { toast } from "@/components/ui/toast";
import { showRetryToast } from "@/components/ui/retry-toast";
import { useConvexAuth, useMutation } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { IsolatedErrorBoundary } from "@/components/global-error-boundary";
import { TrashPurgeDialog } from "../components/shell-dialogs";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/use-now";
import { presentSync, replicaHasNativeLock } from "../bridge/status";
import { useProductOnline } from "../bridge/use-product-online";
import { LibrarySyncStrip } from "../bridge/library-sync-strip";
import { ArtifactComposer } from "./artifact-composer";
import { useFolderSync } from "../bridge/use-folder-sync";
import type { StatusTone } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  blueprintChoices,
  createDefaultArtifactPayload,
} from "../components/artifact-blueprint-sheet";
import {
  useTreeActions,
  useTreeChildren,
  useTreePath,
  useTreeQuickView,
  useTreeSearch,
  useTreeTrash,
  treeFailureMessage,
  type TreeNode,
} from "./tree-client";
import {
  EMPTY_SELECTION,
  clickIntent,
  expandedAncestorsForPath,
  isOpenWorkNode,
  opensOnPlainClick,
  filterRows,
  pruneSelection,
  resolveKey,
  selectAll,
  selectRow,
  selectedWorkSourceIds,
  sortRows,
  titleSearchMatch,
  windowRange,
  type SortDirection,
  type SortKey,
  type TypeFilter,
} from "./tree-model";
import { IconButton } from "@/components/ui/icon-button";
import { useOrganizerDrag } from "./organizer-drag";
import { OrganizerRail, type OrganizerLocation } from "./organizer-rail";
import { OrganizerRow, ROW_HEIGHT, type RowCallbacks } from "./organizer-row";
import { useRowPeek } from "./row-peek";
import { spectraBus } from "../events";
import type { SpectraCommandOutcome } from "../events/contracts";
import { subscribeIdleSurfaceRefresh } from "../data/idle-surface";
import { LIBRARY_IMPORT_ACCEPT } from "./library-import";
import {
  SurfaceMoreMenu,
  SurfaceNewMenu,
  SurfaceSearch,
  SurfaceSelectToggle,
  SurfaceViewSwitch,
  type BlueprintChoiceKey,
} from "./surface-chrome";
import { LayoutGrid, Rows3 } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import { beginCreation, sendInto } from "../life/use-life";
import { ClassShelf, classWorkspaceIdentity, isClassWorkspace } from "./class-shelf";
import { LibraryShelf, LibraryShelfSkeleton } from "./library-shelf";
import { FolderShelf } from "./folder-shelf";
import { LibraryCrumbs, crumbSteps } from "./library-crumbs";
import { useLibraryView, useQuickPane } from "./library-view";
import type { WorkPicking } from "./library-note";
import { useClassBook } from "../school/use-class-book";
import { firstTipMoment } from "../onboarding/first-tips";

/**
 * The Library, as a filesystem.
 *
 * One hierarchy, one surface: a rail of containers on the left (closed and
 * opened from the bar) and one level of rows on the right. Recent, Favorites, Shared and type filters are ways of
 * looking at that hierarchy, not separate places — which is why they change the
 * rows and nothing else, and why every one of them can still be dragged out of.
 *
 * Everything on screen is a live Convex subscription. A rename in a split pane
 * moves this row while the reader watches it; nothing here refetches.
 */

export type OrganizerScope = {
  /** The subtree this surface is confined to. */
  nodeId: string;
  /** What the reader calls it — the rail's root and the first breadcrumb. */
  label: string;
};

export type LibraryOrganizerProps = {
  onOpenWork: (artifactId: string) => void;
  onOpenThread: (threadId: string, title: string) => void;
  onShareWork?: (artifactId: string) => void;
  /** Picks or unpicks a work; its name and type say what it is where the loaded work does not have it. */
  onToggleContext?: (artifactId: string, work: { title: string; type?: string }) => void;
  /** Replaces the composer's selected work with this set (list range-select). */
  onSelectWork?: (artifactIds: string[]) => void;
  contextIds?: ReadonlySet<string>;
  onImportFile?: (file: File, parentNodeId?: string | null) => void;
  /** Create a workspace exactly where this surface is currently standing. */
  onNewWorkspace?: (parentNodeId: string | null) => void;
  importing?: boolean;
  /** Where to open. Used by a workspace route to scope the surface (D32). */
  initialNodeId?: string | null;
  /**
   * Confine the surface to one subtree. A workspace's List view is the Library
   * scoped to that workspace — the same grammar, not a second program — so
   * nothing above the scope is reachable and search, quick views and new work
   * all stay inside it.
   */
  scope?: OrganizerScope | null;
  /** Hidden when the host already provides a location strip of its own. */
  showBreadcrumbs?: boolean;
  /** Hidden when the host owns the rail (a workspace hub has its own). */
  showRail?: boolean;
  /**
   * Called when the reader navigates, so a host route can follow along, with
   * the folder they left when they were in one.
   */
  onLocationChange?: (nodeId: string | null, from?: string | null) => void;
  /**
   * The folder the host asks for, as its own Back and Forward walk the
   * reader's steps. Only a change moves the surface; null is the top.
   */
  folderId?: string | null;
  /** Steps into a workspace, at a folder inside it when one is named. */
  onOpenWorkspace?: (workspaceId: string, nodeId?: string) => void;
  /** Steps out of the scope to the top of the Library, or to a folder outside every workspace. */
  onLeaveScope?: (nodeId?: string) => void;
  /**
   * The host surface's own controls, rendered inside this one toolbar row.
   *
   * A workspace hub has a view switch and a finder of its own, and putting them
   * in a band above this header gave the reader two rows of chrome and two
   * search boxes for one surface. They belong in the same row as the location
   * they act on — lead before the breadcrumb, trail after New.
   */
  toolbarLead?: ReactNode;
  /** Rows and cards become a selection the composer answers from. */
  selecting?: boolean;
  onToggleSelect?: () => void;
  /** Turns rows and cards into a picker for the composer's context. */
  selectionMode?: boolean;
  selectedObjectKeys?: Set<string>;
  /** Work currently open in the adjacent studio, independent of picker state. */
  activeWorkId?: string;
  /** A create is in flight somewhere on the surface. */
  busy?: boolean;
  /** A fresh account gets teaching copy instead of a generic empty folder. */
  firstRun?: boolean;
};

type MenuState = {
  x: number;
  y: number;
  /** Empty means the reader right-clicked the surface itself. */
  nodeIds: string[];
};

type ReplicaPresentationRow = {
  replicas: Parameters<typeof presentSync>[0]["replicas"];
  pendingCount: number;
};

/**
 * A row still moving on its own: a write queued for a device, or Office
 * holding the file. The device acknowledges these without any action in the
 * browser, so a parked snapshot would keep "Waiting for Office" or "Syncing"
 * on screen until the next focus or idle refresh, minutes later.
 */
export function replicaRowsInFlight(rows: ReadonlyArray<ReplicaPresentationRow>) {
  return rows.some(
    (row) =>
      row.pendingCount > 0 ||
      row.replicas.some(
        (replica) => replica.state === "pending" || replicaHasNativeLock(replica),
      ),
  );
}

export function ReplicaPresentationLoader({
  onRows,
}: {
  onRows: (
    rows:
      | ReadonlyArray<{
          workId: string;
          replicas: Parameters<typeof presentSync>[0]["replicas"];
          openConflictCount: number;
          pendingCount: number;
        }>
      | undefined,
  ) => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const [live, setLive] = useState(true);
  const rows = useQuery(
    api.replicas.presentationsForAccount,
    isAuthenticated && live ? {} : "skip",
  );
  useEffect(() => {
    if (rows === undefined) return;
    onRows(rows);
    // Park only a settled answer; stay subscribed while a write is in flight
    // so its acknowledgement replaces the waiting label as soon as it lands.
    if (!replicaRowsInFlight(rows)) setLive(false);
  }, [onRows, rows]);
  useEffect(() => {
    const refresh = () => setLive(true);
    const stopIdle = subscribeIdleSurfaceRefresh(refresh);
    const stopBus = spectraBus.on("workspace.refreshRequested", refresh);
    return () => {
      stopIdle();
      stopBus();
    };
  }, []);
  return null;
}

const QUICK_LABELS = { recent: "Recent", favorites: "Favorites", shared: "Shared" } as const;
const VIEW_CHOICES = [
  { key: "shelf", label: "Shelf", icon: LayoutGrid },
  { key: "list", label: "List", icon: Rows3 },
] as const;

/** What a quick view of the Library lists: never threads. */
const PLACES_AND_WORK: TreeNode["kind"][] = ["folder", "workspace", "work"];

/** Tried once by itself, since most failures here pass; then it asks. */
function LibraryFailure({ onRetry, attempt }: { onRetry: () => void; attempt: number }) {
  useEffect(() => {
    if (attempt > 0) return;
    const timer = window.setTimeout(onRetry, 1_200);
    return () => window.clearTimeout(timer);
  }, [attempt, onRetry]);
  if (attempt === 0) return <p role="status" className="p-4 text-body text-[var(--text-secondary)]">Opening the Library again.</p>;
  return (
    <div role="alert" className="p-4 text-body text-[var(--text-secondary)]">
      <p>The Library didn&apos;t load. Your artifacts are safe.</p>
      <Button className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function LibraryOrganizer(props: LibraryOrganizerProps) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return (
    <IsolatedErrorBoundary
      key={`${props.scope?.nodeId ?? "root"}:${attempt}`}
      fallback={({ offline }) =>
        offline ? (
          <p role="status" className="p-4 text-body text-[var(--text-secondary)]">
            This device is offline. The Library comes back when it reconnects.
          </p>
        ) : (
          <LibraryFailure onRetry={retry} attempt={attempt} />
        )
      }
    >
      <LibraryOrganizerContent {...props} />
    </IsolatedErrorBoundary>
  );
}

function LibraryOrganizerContent({
  onOpenWork,
  onOpenThread,
  onShareWork,
  onToggleContext,
  onSelectWork,
  contextIds,
  onImportFile,
  onNewWorkspace,
  importing = false,
  initialNodeId = null,
  scope = null,
  showBreadcrumbs = true,
  showRail = true,
  onLocationChange,
  folderId,
  onOpenWorkspace,
  onLeaveScope,
  toolbarLead,
  selecting,
  onToggleSelect,
  selectionMode = false,
  activeWorkId,
  busy: hostBusy = false,
  firstRun = false,
}: LibraryOrganizerProps) {
  const now = useNow(60_000);
  const book = useClassBook();
  const productOnline = useProductOnline();
  const folderSync = useFolderSync();
  const [replicaRows, setReplicaRows] = useState<
    | ReadonlyArray<{
        workId: string;
        replicas: Parameters<typeof presentSync>[0]["replicas"];
        openConflictCount: number;
        pendingCount: number;
      }>
    | undefined
  >(undefined);
  const syncByWorkId = useMemo(() => {
    const replicaPresentations = replicaRows;
    const map = new Map<string, { label: string; tone: StatusTone }>();
    for (const row of replicaPresentations ?? []) {
      const presentation = presentSync({
        replicas: row.replicas,
        openConflictCount: row.openConflictCount,
        replicaPendingCount: row.pendingCount,
        online: productOnline,
      });
      if (presentation.ready) continue;
      map.set(row.workId, {
        label: presentation.label,
        tone:
          presentation.tone === "positive"
            ? "healthy"
            : presentation.tone === "warning"
              ? "attention"
              : presentation.tone === "danger"
                ? "failure"
                : "neutral",
      });
    }
    return map;
  }, [productOnline, replicaRows]);
  const actions = useTreeActions();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  /* The scope is the floor. Everything that talks about "the top" — the rail's
     root button, the first breadcrumb, where a new folder lands — means this
     node when there is one, and the account root when there is not. */
  const floorId = scope?.nodeId ?? null;
  const floorLabel = scope?.label ?? "Library";

  const [location, setLocation] = useState<OrganizerLocation>({
    kind: "folder",
    nodeId: initialNodeId ?? floorId,
  });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [sortKey, setSortKey] = useState<"manual" | SortKey>("manual");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(640);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [busy, setBusy] = useState(false);
  const [purgeConfirm, setPurgeConfirm] = useState<{
    nodeIds: string[];
    names: string[];
    emptying: boolean;
  } | null>(null);
  /* Shelf or list, kept on this device for every place (LIBRARY.md, "Views");
     the list keeps a quick access pane at its side, as File Explorer does. */
  const [view, setView] = useLibraryView();
  const [paneOpen, togglePane] = useQuickPane();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
  const frameRef = useRef(0);
  /* Every node the surface has seen, so a drop target's ancestry can be checked
     without another query. Cheap: it is only ever read during a drag. */
  const seenRef = useRef(new Map<string, TreeNode>());

  const searchHelpId = useId();
  const searching = term.trim().length >= 2;
  useEffect(() => {
    if (searching) firstTipMoment("search");
  }, [searching]);
  const inFolder = location.kind === "folder";
  const currentParentId = inFolder ? location.nodeId : null;
  const currentParentRef = useRef(currentParentId);
  currentParentRef.current = currentParentId;

  // Folder/class shelves own their paginated reads. Keep the hidden list
  // unsubscribed; the root shelf still uses this query for its places.
  const nestedShelf = inFolder && currentParentId !== null && !searching &&
    filter === "all" && view === "shelf" && renamingId === null;
  const children = useTreeChildren(currentParentId, {
    enabled: inFolder && !searching && !nestedShelf,
    sortKey,
    direction: sortDirection,
    typeFilter: filter,
    withoutThreads: true,
  });
  /* Threads are kept behind the Threads button, not among the work; only
     search reaches them here. */
  const search = useTreeSearch(term, undefined, floorId, filter);
  const quick = useTreeQuickView(
    !searching && location.kind === "quick" ? location.view : null,
    PLACES_AND_WORK,
    floorId,
    filter,
  );
  const trash = useTreeTrash(!searching && location.kind === "trash");
  const path = useTreePath(inFolder ? location.nodeId : null);

  /* A flat listing is one that shows nodes from all over the tree. It cannot be
     reordered — there is no single sibling list to reorder within — and it earns
     a location column instead. */
  const flat = searching || location.kind !== "folder";

  const source = searching
    ? search.results
    : location.kind === "quick"
      ? quick.nodes
      : location.kind === "trash"
        ? trash
        : children.nodes;
  const page = searching ? search : location.kind === "quick" ? quick : children;
  const paginated = location.kind !== "trash" || searching;
  const loading = source === null || (paginated && page.status === "LoadingFirstPage");
  const hasMore = paginated && (page.status === "CanLoadMore" || page.status === "LoadingMore");

  const rows = useMemo(() => {
    const base = filterRows(source ?? [], filter);
    if (!flat || sortKey === "manual") return base;
    return sortRows(base, sortKey, sortDirection);
  }, [source, filter, sortKey, sortDirection, flat]);

  // Picking keeps the shelf: its cards are picked where they stand.
  const atShelfRoot = inFolder && currentParentId === null && !scope;
  const folderShelf = inFolder && currentParentId !== null && path?.node.nodeId === currentParentId ? path.node : null;
  /* A class's workspace opens as the class (LIBRARY.md, "A class"), with the
     same switch to its plain rows. */
  const classFolder =
    inFolder && currentParentId !== null && isClassWorkspace(path?.node)
      ? path!.node
      : null;
  const shelfable = inFolder && !searching;
  // Shelf cards have no name field. Use the existing row editor during a
  // rename, then return to the reader's chosen view without changing it.
  const shelf = shelfable && filter === "all" && view === "shelf" && renamingId === null;

  const picking = useMemo<WorkPicking | undefined>(
    () =>
      selectionMode && onToggleContext
        ? {
            has: (node) => Boolean(node.sourceId && contextIds?.has(node.sourceId)),
            toggle: (node) => {
              if (node.sourceId) onToggleContext(node.sourceId, { title: node.name, type: node.typeKey });
            },
          }
        : undefined,
    [contextIds, onToggleContext, selectionMode],
  );

  const firstResult = !loading ? rows[0] : undefined;
  const selectedSearchResult = rows.find((row) => row.nodeId === selection.cursorId);
  const hasExactTitleMatch = rows.some((row) => titleSearchMatch(row.name, term) === "Exact title match");

  const nodesById = useMemo(() => {
    const map = seenRef.current;
    for (const node of rows) map.set(node.nodeId, node);
    for (const ancestor of path?.ancestors ?? [])
      map.set(ancestor.nodeId, ancestor);
    if (path?.node) map.set(path.node.nodeId, path.node);
    return map;
  }, [rows, path]);

  const noteNodes = useCallback((nodes: readonly TreeNode[]) => {
    for (const node of nodes) seenRef.current.set(node.nodeId, node);
  }, []);

  /* Ordinary scrolling loads the next page as the reader approaches the end. */
  const { status: pageStatus, loadMore: loadMorePage } = page;
  useEffect(() => {
    if (!paginated || rows.length === 0) return;
    if (pageStatus !== "CanLoadMore") return;
    const remaining = rows.length * ROW_HEIGHT - scrollTop - viewportHeight;
    if (remaining >= ROW_HEIGHT * 12) return;
    // Convex guards loadMore once per cursor. Row count is not a cursor:
    // filtered pages can legitimately return zero additional visible rows.
    loadMorePage(50);
  }, [
    paginated,
    pageStatus,
    loadMorePage,
    rows.length,
    scrollTop,
    viewportHeight,
  ]);

  /* The account's floor, guaranteed rather than guessed: General exists and
     every workspace has a node (D31, D32). It used to run only when the top
     level looked empty, which meant a workspace created by a path that forgot
     to place it stayed invisible forever. The call is idempotent and costs one
     indexed lookup per workspace, so it runs once per mount at the top level.
     A scoped surface never does this: it is not looking at the top level. */
  const rootsEnsured = useRef(false);
  useEffect(() => {
    if (rootsEnsured.current || scope) return;
    if (!inFolder || currentParentId !== null || searching) return;
    if (children.status === "LoadingFirstPage") return;
    rootsEnsured.current = true;
    void actionsRef.current.ensureRoots().catch(() => {
      rootsEnsured.current = false;
    });
  }, [inFolder, currentParentId, searching, children.status, scope]);

  /* Keep the path to the current folder visible, but do not force the current
     folder's own children open. A selected tree item and an expanded tree item
     are separate states; conflating them made the current folder impossible
     to collapse. */
  useEffect(() => {
    if (!path) return;
    const ids = expandedAncestorsForPath(path);
    setExpanded((current) => {
      if (ids.every((id) => current.has(id))) return current;
      return new Set([...current, ...ids]);
    });
  }, [path]);

  useEffect(() => {
    setSelection((current) => pruneSelection(current, rows));
  }, [rows]);

  const measure = useCallback(() => {
    const element = scrollRef.current;
    if (element) setViewportHeight(element.clientHeight);
  }, []);
  useEffect(() => {
    measure();
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  const moveTo = useCallback((next: OrganizerLocation) => {
    setLocation(next);
    setSelection(EMPTY_SELECTION);
    setRenamingId(null);
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);
  const navigate = useCallback(
    (next: OrganizerLocation) => {
      moveTo(next);
      if (next.kind === "folder")
        onLocationChange?.(next.nodeId, location.kind === "folder" ? location.nodeId : undefined);
    },
    [location, moveTo, onLocationChange],
  );
  const askedFolderRef = useRef(folderId);
  useEffect(() => {
    if (folderId === undefined || folderId === askedFolderRef.current) return;
    askedFolderRef.current = folderId;
    const target = folderId ?? floorId;
    if (location.kind !== "folder" || location.nodeId !== target) moveTo({ kind: "folder", nodeId: target });
  }, [floorId, folderId, location, moveTo]);

  const setWorksShared = useMutation(api.workspaceSharing.setWorksShared);
  const run = useCallback(async function execute(
    label: string,
    operation: () => Promise<unknown>,
    failureToastId?: string | number,
  ) {
    setBusy(true);
    try {
      await operation();
      if (failureToastId !== undefined) toast.dismiss(failureToastId);
    } catch (error) {
      showRetryToast(
        treeFailureMessage(error, label),
        (id) => execute(label, operation, id),
        { id: failureToastId },
      );
    } finally {
      setBusy(false);
    }
  }, []);

  /* Application commands and visible Library gestures share these exact tree
     mutations. The handler is semantic and awaitable; choreography may point
     at this surface, but it never performs the write itself. */
  useEffect(() => {
    const removeOrganize = spectraBus.handle(
      "library.organize",
      async (input) => {
        if (input.action === "create_folder") {
          if (!input.name?.trim())
            throw new Error("LIBRARY_FOLDER_NAME_REQUIRED");
          await actionsRef.current.createFolder(
            input.name.trim(),
            input.destinationId ?? currentParentRef.current,
          );
          return {
            status: "completed",
            message: "Library folder created.",
          } satisfies SpectraCommandOutcome;
        }
        if (input.targetIds.length === 0)
          throw new Error("LIBRARY_TARGETS_REQUIRED");
        if (input.action === "rename") {
          if (input.targetIds.length !== 1 || !input.name?.trim())
            throw new Error("LIBRARY_RENAME_PARAMS_REQUIRED");
          await actionsRef.current.rename(
            input.targetIds[0]!,
            input.name.trim(),
          );
          return {
            status: "completed",
            message: "Library item renamed.",
          } satisfies SpectraCommandOutcome;
        }
        if (!input.destinationId)
          throw new Error("LIBRARY_DESTINATION_REQUIRED");
        if (input.action === "move") {
          await actionsRef.current.move(input.targetIds, input.destinationId);
          return {
            status: "completed",
            message: "Library items moved.",
          } satisfies SpectraCommandOutcome;
        }
        for (const nodeId of input.targetIds)
          await actionsRef.current.createReference(nodeId, input.destinationId);
        return {
          status: "completed",
          message: "Library references created.",
        } satisfies SpectraCommandOutcome;
      },
    );
    const removeDelete = spectraBus.handle(
      "library.delete",
      async ({ targetIds }) => {
        if (!targetIds.length) throw new Error("LIBRARY_TARGETS_REQUIRED");
        await actionsRef.current.trash(targetIds);
        return {
          status: "completed",
          message: "Library items moved to Trash.",
        } satisfies SpectraCommandOutcome;
      },
    );
    return () => {
      removeOrganize();
      removeDelete();
    };
  }, []);

  const openNode = useCallback(
    (node: TreeNode) => {
      // A workspace is a place: it opens on its own, unless it is where this surface already stands.
      const place = node.kind === "workspace" ? node.workspace?.workspaceId : undefined;
      if (place && onOpenWorkspace && node.nodeId !== floorId) {
        onOpenWorkspace(place);
        return;
      }
      if (node.kind === "folder" || node.kind === "workspace") {
        navigate({ kind: "folder", nodeId: node.nodeId });
        return;
      }
      const target = node.kind === "link" ? node.target : null;
      if (node.kind === "link" && !target?.available) {
        toast.error("That reference points at something that is gone.");
        return;
      }
      const kind = target?.kind ?? node.kind;
      const sourceId = target?.sourceId ?? node.sourceId;
      const name = target?.name ?? node.name;
      if (kind === "work" && node.source?.available === false) {
        toast.error("That reference points at something that is gone.");
        return;
      }
      if (target && (kind === "folder" || kind === "workspace")) {
        navigate({ kind: "folder", nodeId: target.nodeId });
        return;
      }
      if (!sourceId) return;
      if (kind === "work") onOpenWork(sourceId);
      else if (kind === "thread") onOpenThread(sourceId, name);
    },
    [floorId, navigate, onOpenThread, onOpenWork, onOpenWorkspace],
  );

  const moveNodes = useCallback(
    (
      nodeIds: string[],
      parentId: string | null,
      neighbours?: { beforeSiblingId?: string; afterSiblingId?: string },
    ) => {
      const destination = parentId ? nodesById.get(parentId)?.name : floorLabel;
      void run("That move did not go through.", async () => {
        await actions.move(nodeIds, parentId, neighbours);
        // "Add A to B" (LIFE.md, send): the folder that took it in pulses.
        if (!neighbours) sendInto(dropTarget(parentId));
        if (!neighbours)
          toast.success(
            nodeIds.length === 1
              ? `Moved to ${destination ?? floorLabel}.`
              : `Moved ${nodeIds.length} items to ${destination ?? floorLabel}.`,
          );
      });
    },
    [actions, nodesById, run, floorLabel],
  );

  const referenceNodes = useCallback(
    (nodeIds: string[], parentId: string | null) => {
      void run("That reference could not be filed.", async () => {
        for (const nodeId of nodeIds)
          await actions.createReference(nodeId, parentId);
        sendInto(dropTarget(parentId));
        toast.success(
          nodeIds.length === 1
            ? "Reference filed. The original stayed where it was."
            : `${nodeIds.length} references filed.`,
        );
      });
    },
    [actions, run],
  );

  const { drag, beginDrag, consumeSuppressedClick } = useOrganizerDrag({
    nodesById,
    rows,
    currentParentId,
    allowReorder: sortKey === "manual" && !flat,
    onMove: moveNodes,
    onReference: referenceNodes,
    onRejected: (reason) => toast.message(reason),
  });

  const trashNodes = useCallback(
    (nodeIds: string[]) => {
      void run("Those items stayed where they were.", async () => {
        await actions.trash(nodeIds);
        toast.success(
          nodeIds.length === 1
            ? "Moved to Trash."
            : `Moved ${nodeIds.length} items to Trash.`,
          {
            action: {
              label: "Undo",
              /* An Undo that fails must say so; a silent failure leaves the
                 reader believing the items came back. */
              onClick: () =>
                void run("Those items are still in the Trash.", () =>
                  actions.restore(nodeIds),
                ),
            },
          },
        );
      });
    },
    [actions, run],
  );

  const requestPurge = useCallback((nodes: TreeNode[], emptying = false) => {
    if (nodes.length === 0) return;
    setPurgeConfirm({
      nodeIds: nodes.map((node) => node.nodeId),
      names: nodes.map((node) => node.name),
      emptying,
    });
  }, []);

  const confirmPurge = useCallback(() => {
    if (!purgeConfirm) return;
    const { nodeIds, emptying } = purgeConfirm;
    void run("Those items stayed in the Trash.", async () => {
      await actions.purge(nodeIds);
      setPurgeConfirm(null);
      toast.success(
        emptying
          ? "Trash emptied."
          : nodeIds.length === 1
            ? "Deleted forever."
            : `Deleted ${nodeIds.length} items forever.`,
      );
    });
  }, [actions, purgeConfirm, run]);

  const createFolderHere = useCallback(() => {
    void run("The folder was not created.", async () => {
      // Dots gather at the press; the folder's row grows out of them.
      const creation = beginCreation({ into: "item" });
      const created = await actions.createFolder("New folder", currentParentId).catch((error: unknown) => {
        creation.cancel();
        throw error;
      });
      creation.land(`node:${created.nodeId}`);
      setRenamingId(created.nodeId);
      setSelection({
        ids: new Set([created.nodeId]),
        anchorId: created.nodeId,
        cursorId: created.nodeId,
      });
    });
  }, [actions, currentParentId, run]);

  /**
   * Make one piece of work, in one named place.
   *
   * The toolbar's New menu reaches this with the place the reader is standing
   * (CANON D43), so it never asks for something their click already answered.
   */
  const createWorkAt = useCallback(
    (blueprintKey: BlueprintChoiceKey, parentId: string | null, title?: string) =>
      run("The artifact was not created.", async () => {
        const payload = createDefaultArtifactPayload(blueprintKey);
        if (title) payload.title = title;
        // Dots gather at the press; the work's studio grows out of them.
        const creation = beginCreation();
        const created = await actions
          .createWorkHere({
            blueprintKey,
            title: payload.title,
            summary: payload.summary,
            content: payload.content,
            parentId,
          })
          .catch((error: unknown) => {
            creation.cancel();
            throw error;
          });
        creation.land();
        onOpenWork(created.artifactId);
      }),
    [actions, onOpenWork, run],
  );

  /* New opens the composer on the kind picked; the place stays where the
     reader stands, captured at the press so a later navigation cannot move it. */
  const [composing, setComposing] = useState<{ kind: BlueprintChoiceKey; parentId: string | null; place: string } | null>(null);
  const createWorkHere = useCallback(
    (blueprintKey: BlueprintChoiceKey) => {
      const parentId = inFolder ? currentParentId : floorId;
      const place =
        inFolder && currentParentId !== null && path?.node.nodeId === currentParentId
          ? path.node.name
          : scope?.label ?? "your Library";
      setComposing({ kind: blueprintKey, parentId, place });
    },
    [currentParentId, floorId, inFolder, path, scope],
  );

  /* A new folder is appended, which in a long folder means off-screen. */
  useEffect(() => {
    if (!renamingId) return;
    const index = rows.findIndex((row) => row.nodeId === renamingId);
    if (index === -1) return;
    const element = scrollRef.current;
    if (!element) return;
    const top = index * ROW_HEIGHT;
    if (
      top < element.scrollTop ||
      top + ROW_HEIGHT > element.scrollTop + element.clientHeight
    )
      element.scrollTop = Math.max(0, top - element.clientHeight / 2);
  }, [renamingId, rows]);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const next = event.currentTarget.scrollTop;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      setScrollTop(next);
    });
  }, []);
  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const selectedNodes = useMemo(
    () => rows.filter((row) => selection.ids.has(row.nodeId)),
    [rows, selection.ids],
  );

  const publishWorkSelection = useCallback(
    (next: typeof selection) => {
      onSelectWork?.(selectedWorkSourceIds(next, rows));
    },
    [onSelectWork, rows],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (renamingId) return;
      const action = resolveKey(event.key, event, rows, selection);
      if (!action) return;
      event.preventDefault();
      if (action.type === "move")
        setSelection((current) => {
          const next = selectRow(
            current,
            rows,
            action.nodeId,
            action.extend ? "range" : "replace",
          );
          if (selectionMode) publishWorkSelection(next);
          return next;
        });
      else if (action.type === "selectAll") {
        const next = selectAll(rows);
        setSelection(next);
        publishWorkSelection(next);
      } else if (action.type === "clear") {
        setSelection(EMPTY_SELECTION);
        publishWorkSelection(EMPTY_SELECTION);
      } else if (action.type === "rename") setRenamingId(action.nodeId);
      else if (action.type === "trash") {
        /* In the Trash, Delete means delete forever — behind the same
           confirmation as the menu. Trashing again changed nothing and still
           announced "Moved to Trash." with an Undo that restored the items. */
        if (location.kind === "trash")
          requestPurge(rows.filter((row) => action.nodeIds.includes(row.nodeId)));
        else trashNodes(action.nodeIds);
      }
      else if (action.type === "leave") {
        if (!inFolder || currentParentId === null) return;
        navigate({
          kind: "folder",
          nodeId: path?.ancestors.at(-1)?.nodeId ?? null,
        });
      } else {
        const node = rows.find((row) => row.nodeId === action.nodeId);
        if (node) openNode(node);
      }
    },
    [
      inFolder,
      currentParentId,
      location.kind,
      navigate,
      openNode,
      path,
      renamingId,
      requestPurge,
      rows,
      selection,
      selectionMode,
      trashNodes,
      publishWorkSelection,
    ],
  );

  const rowCallbacks: RowCallbacks = useMemo(
    () => ({
      onPointerDown: (event, node) => {
        if (renamingId === node.nodeId) return;
        /* A drag of an unselected row drags that row; a drag of a selected one
           takes the whole selection with it. */
        const ids = selection.ids.has(node.nodeId)
          ? [...selection.ids]
          : [node.nodeId];
        const label = ids.length === 1 ? node.name : `${ids.length} items`;
        beginDrag(event, ids, label);
      },
      onClick: (event, node) => {
        if (consumeSuppressedClick()) {
          event.preventDefault();
          return;
        }
        if (opensOnPlainClick(event, selectionMode)) {
          openNode(node);
          return;
        }
        setSelection((current) => {
          const next = selectRow(
            current,
            rows,
            node.nodeId,
            clickIntent(event),
          );
          if (selectionMode) publishWorkSelection(next);
          return next;
        });
        if (renamingId && renamingId !== node.nodeId) setRenamingId(null);
      },
      onDoubleClick: (event, node) => {
        if (renamingId === node.nodeId) return;
        event.preventDefault();
        openNode(node);
      },
      onOpen: openNode,
      onContextMenu: (event, node) => {
        event.preventDefault();
        setSelection((current) =>
          current.ids.has(node.nodeId)
            ? current
            : selectRow(current, rows, node.nodeId, "replace"),
        );
        const ids = selection.ids.has(node.nodeId)
          ? [...selection.ids]
          : [node.nodeId];
        setMenu({ x: event.clientX, y: event.clientY, nodeIds: ids });
      },
      onMenuButton: (event, node) => {
        const rect = (
          event.currentTarget as HTMLElement
        ).getBoundingClientRect();
        setSelection((current) =>
          current.ids.has(node.nodeId)
            ? current
            : selectRow(current, rows, node.nodeId, "replace"),
        );
        setMenu({
          x: rect.left,
          y: rect.bottom,
          nodeIds: selection.ids.has(node.nodeId)
            ? [...selection.ids]
            : [node.nodeId],
        });
      },
      onTogglePin: (node) => {
        void run("The pin did not change.", () =>
          actions.setPinned(node.nodeId, !node.pinned),
        );
      },
      onCommitRename: (node, name) => {
        setRenamingId(null);
        if (!name || name === node.name) return;
        void run("The name did not change.", () =>
          actions.rename(node.nodeId, name),
        );
      },
      onCancelRename: () => setRenamingId(null),
    }),
    [
      actions,
      beginDrag,
      consumeSuppressedClick,
      openNode,
      publishWorkSelection,
      renamingId,
      rows,
      run,
      selection.ids,
      selectionMode,
    ],
  );

  const range = windowRange(scrollTop, viewportHeight, ROW_HEIGHT, rows.length);
  const visible = rows.slice(range.start, range.end);
  const nodeById = useCallback((nodeId: string) => rows.find((node) => node.nodeId === nodeId), [rows]);
  const peek = useRowPeek(nodeById, Boolean(drag) || selectionMode || renamingId !== null);
  const dropRingId =
    drag?.target?.type === "into" ? drag.target.highlightNodeId : undefined;
  const railDropId =
    drag?.target?.type === "into"
      ? (drag.target.parentId ?? "root")
      : undefined;

  const menuNodes = useMemo(
    () =>
      (menu?.nodeIds ?? [])
        .map((id) => nodesById.get(id))
        .filter((node): node is TreeNode => Boolean(node)),
    [menu, nodesById],
  );

  /* The path runs from the top of the Library, through the workspace the
     surface is in, to the open folder (LIBRARY.md, "The path"). */
  const crumbs = useMemo(
    () =>
      crumbSteps({
        path: path && inFolder && path.node.nodeId === currentParentId ? [...path.ancestors, path.node] : [],
        floor: scope ? { nodeId: scope.nodeId, label: scope.label } : null,
        onLeaveFloor: onLeaveScope ? () => onLeaveScope() : undefined,
      }),
    [path, inFolder, currentParentId, scope, onLeaveScope],
  );

  /* Somewhere picked in the quick access pane, with the way down to it. A
     place in another workspace is that workspace's; one outside every
     workspace is the top's. */
  const goTo = useCallback(
    (next: OrganizerLocation, trail?: readonly TreeNode[]) => {
      if (next.kind !== "folder") return navigate(next);
      if (next.nodeId === null) return scope && onLeaveScope ? onLeaveScope() : navigate(next);
      const place = trail?.find((node) => node.kind === "workspace");
      if (!trail || place?.nodeId === floorId || (!scope && !(place?.workspace && onOpenWorkspace))) return navigate(next);
      const inside = next.nodeId === place?.nodeId ? undefined : next.nodeId;
      if (place?.workspace && onOpenWorkspace) onOpenWorkspace(place.workspace.workspaceId, inside);
      else onLeaveScope?.(next.nodeId);
    },
    [floorId, navigate, onLeaveScope, onOpenWorkspace, scope],
  );

  const rail = (
    <OrganizerRail
      location={location}
      expanded={expanded}
      dropNodeId={railDropId}
      floorId={null}
      className="w-full border-0 bg-transparent"
      handlers={{
        onNavigate: goTo,
        onToggle: (nodeId) =>
          setExpanded((current) => {
            const next = new Set(current);
            if (next.has(nodeId)) next.delete(nodeId);
            else next.add(nodeId);
            return next;
          }),
        onBeginDrag: (event, node) =>
          beginDrag(event, [node.nodeId], node.name),
        onContextMenu: (event, node) => {
          event.preventDefault();
          setMenu({
            x: event.clientX,
            y: event.clientY,
            nodeIds: [node.nodeId],
          });
        },
        onNodesSeen: noteNodes,
      }}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-[var(--bg-primary)]">
      <IsolatedErrorBoundary>
        <ReplicaPresentationLoader onRows={setReplicaRows} />
      </IsolatedErrorBoundary>
      <LibrarySyncStrip />
      <ArtifactComposer
        open={composing !== null}
        kind={composing?.kind ?? "document"}
        place={composing?.place ?? ""}
        onClose={() => setComposing(null)}
        onCreate={async (kind, title) => {
          const parentId = composing?.parentId ?? null;
          setComposing(null);
          await createWorkAt(kind, parentId, title || undefined);
        }}
      />
      <input
        ref={importRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={LIBRARY_IMPORT_ACCEPT}
        onChange={(event) => {
          const file = event.target.files?.[0];
          /* Same parent New uses: import lands in the open folder, not at root. */
          if (file) onImportFile?.(file, currentParentId);
          event.target.value = "";
        }}
      />

      <header className="surface-bar shrink-0 border-b border-[var(--border-subtle)] px-4 py-2.5">
        {/* Two groups on one row, always: where the reader is, and what they
            can do there. As the row narrows (a work open beside it) the
            controls fold to their icons and search gives up width; nothing
            wraps to a second row (spectra-library.css, "The bar"). */}
        <div className="surface-bar-where">
          {/* The places open and close here, the way the chat's threads do. */}
          {showRail && !shelf ? (
            <IconButton icon="sidebar" label={paneOpen ? "Hide places" : "Show places"} aria-pressed={paneOpen} onClick={togglePane} />
          ) : null}
          {toolbarLead}
          <nav
            aria-label="Location"
            className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-ui"
          >
            {searching ? (
              <span className="truncate text-[var(--text-secondary)]">
                Results for{" "}
                <span className="font-medium text-[var(--text-primary)]">
                  {term.trim()}
                </span>
              </span>
            ) : showBreadcrumbs ? (
              <LibraryCrumbs
                steps={location.kind === "folder" ? crumbs : crumbs.slice(0, 1)}
                tail={location.kind === "quick" ? QUICK_LABELS[location.view] : location.kind === "trash" ? "Trash" : undefined}
                dropNodeId={drag?.target?.type === "into" ? drag.target.parentId : undefined}
                onNavigate={goTo}
              />
            ) : null}
          </nav>
          {/* Shelf or List sits beside where you are, one press away. */}
          {shelfable ? (
            <SurfaceViewSwitch
              view={shelf ? "shelf" : "list"}
              onChange={(next) => {
                setView(next);
                // The shelf shows everything; asking for it lifts a type filter.
                if (next === "shelf") setFilter("all");
              }}
              views={VIEW_CHOICES}
            />
          ) : null}
        </div>

        <div className="surface-bar-tools">
          {/* One search, one filter, one create menu, for both views. */}
          <SurfaceSearch
            value={term}
            descriptionId={searching ? searchHelpId : undefined}
            onChange={setTerm}
            scopeLabel={floorLabel}
            className="surface-bar-search"
            onMoveToResults={() => {
              const first = rows[0];
              if (first) {
                setSelection(
                  selectRow(EMPTY_SELECTION, rows, first.nodeId, "replace"),
                );
              }
              scrollRef.current?.focus();
            }}
            onOpenFirstResult={() => {
              if (firstResult) openNode(firstResult);
            }}
          />

          {location.kind === "trash" ? null : (
          <SurfaceNewMenu
            disabled={busy || hostBusy}
            importing={importing}
            /* Recent, Favorites and Shared are ways of looking, not places:
               new work there starts at the top, and folders are made where they will stand. */
            onNewFolder={inFolder ? createFolderHere : undefined}
            onNewWorkspace={
              onNewWorkspace && inFolder ? () => onNewWorkspace(currentParentId) : undefined
            }
            onNewWork={createWorkHere}
            onImport={
              onImportFile && inFolder ? () => importRef.current?.click() : undefined
            }
            onSyncFolder={{
              // Not connected yet, the same row connects this computer first.
              label: "Sync a computer folder",
              run: () => void folderSync.sync(currentParentId),
            }}
            onSyncFiles={{ label: "Sync computer files", run: () => void folderSync.syncFiles(currentParentId) }}
          />
          )}
          {onToggleSelect && location.kind !== "trash" ? (
            <SurfaceSelectToggle selecting={Boolean(selecting)} onToggle={onToggleSelect} />
          ) : null}
          {/* How the place is shown, narrowed and ordered: one menu, so the
              bar is where you are, search, New and Select. */}
          <SurfaceMoreMenu
            filter={filter}
            onFilterChange={setFilter}
            sortKey={sortKey}
            direction={sortDirection}
            onSortKeyChange={setSortKey}
            onDirectionChange={setSortDirection}
            onEmptyTrash={location.kind === "trash" && rows.length > 0 ? () => requestPurge(rows, true) : undefined}
          />
        </div>
      </header>

      {searching ? (
        <div
          id={searchHelpId}
          role="status"
          className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-b border-[var(--border-subtle)] px-4 py-2 text-caption text-[var(--text-secondary)]"
        >
          <span>
            {loading
              ? "Searching titles…"
              : rows.length === 0
                ? "No title matches in the loaded results."
                : hasExactTitleMatch
                  ? "Ranked title matches. Partial matches are labeled."
                  : hasMore
                    ? "No exact title match in the loaded results. Showing ranked partial matches."
                    : "No exact title match. Showing ranked partial matches."}
          </span>
          {firstResult ? (
            <span>Enter in search opens “{firstResult.name}”.</span>
          ) : null}
          {firstResult && selectedSearchResult && selectedSearchResult.nodeId !== firstResult.nodeId ? (
            <span>Enter in results opens “{selectedSearchResult.name}”.</span>
          ) : null}
        </div>
      ) : null}

      <div className="library-body relative flex min-h-0 flex-1">

        {shelf && classFolder ? (
          <section className="spectra-composer-clearance min-w-0 flex-1 overflow-y-auto px-8 pt-6">
            <ClassShelf
              key={classFolder.nodeId}
              folderId={classFolder.nodeId}
              workspaceId={classFolder.workspace?.workspaceId}
              name={classFolder.name}
              identity={classWorkspaceIdentity(classFolder, book)}
              providerClassId={book.idNamed(classFolder.name)}
              now={now}
              onOpen={openNode}
              onMenu={(event, node) => {
                event.preventDefault();
                // Shelves show work from across the Library, not only this listing's rows.
                noteNodes([node]);
                setSelection((current) => selectRow(current, rows, node.nodeId, "replace"));
                setMenu({ x: event.clientX, y: event.clientY, nodeIds: [node.nodeId] });
              }}
              onCreate={() => void createWorkAt("document", classFolder.nodeId)}
              picking={picking}
            />
          </section>
        ) : shelf && atShelfRoot ? (
          <section className="spectra-composer-clearance min-w-0 flex-1 overflow-y-auto px-8 pt-6">
            <LibraryShelf
              nodes={children.nodes}
              loading={loading}
              now={now}
              onOpen={openNode}
              onMenu={(event, node) => {
                event.preventDefault();
                // Shelves show work from across the Library, not only this listing's rows.
                noteNodes([node]);
                setSelection((current) => selectRow(current, rows, node.nodeId, "replace"));
                setMenu({ x: event.clientX, y: event.clientY, nodeIds: [node.nodeId] });
              }}
              onNewWorkspace={onNewWorkspace ? () => onNewWorkspace(null) : undefined}
              picking={picking}
            />
          </section>
        ) : shelf && folderShelf ? (
          <section className="spectra-composer-clearance min-w-0 flex-1 overflow-y-auto px-8 pt-6">
            <FolderShelf
              key={folderShelf.nodeId}
              folderId={folderShelf.nodeId}
              workspaceId={folderShelf.kind === "workspace" ? folderShelf.workspace?.workspaceId : undefined}
              name={folderShelf.name}
              now={now}
              onOpen={openNode}
              onMenu={(event, node) => {
                event.preventDefault();
                noteNodes([node]);
                setMenu({ x: event.clientX, y: event.clientY, nodeIds: [node.nodeId] });
              }}
              onCreate={() => void createWorkAt("document", folderShelf.nodeId)}
              picking={picking}
            />
          </section>
        ) : shelf ? (
          <section className="min-w-0 flex-1 px-8 pt-6">
            <LibraryShelfSkeleton />
          </section>
        ) : (
          <>
          {showRail && paneOpen ? (
            <aside className="library-quick-pane spectra-composer-clearance">{rail}</aside>
          ) : null}
          <section className="@container/rows flex min-w-0 flex-1 flex-col">
            <div className="flex h-7 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-4 pr-3.5 text-micro font-semibold text-[var(--text-tertiary)]">
              <span className="w-[22px] shrink-0" />
              <ColumnLabel
                label="Name"
                className="min-w-0 flex-1"
                sorted={sortKey === "name" ? sortDirection : null}
                onClick={() =>
                  cycleSort(
                    "name",
                    sortKey,
                    sortDirection,
                    setSortKey,
                    setSortDirection,
                  )
                }
              />
              {flat ? (
                <span className="hidden w-[190px] shrink-0 @3xl/rows:block">
                  Location
                </span>
              ) : null}
              <ColumnLabel
                label="Type"
                className="hidden w-[104px] shrink-0 @xl/rows:block"
                sorted={sortKey === "type" ? sortDirection : null}
                onClick={() =>
                  cycleSort(
                    "type",
                    sortKey,
                    sortDirection,
                    setSortKey,
                    setSortDirection,
                  )
                }
              />
              <ColumnLabel
                label="Updated"
                className="hidden w-[76px] shrink-0 justify-end text-right @lg/rows:flex"
                sorted={sortKey === "updated" ? sortDirection : null}
                onClick={() =>
                  cycleSort(
                    "updated",
                    sortKey,
                    sortDirection,
                    setSortKey,
                    setSortDirection,
                  )
                }
              />
              <span className="w-[52px] shrink-0" />
            </div>

            <div
              ref={scrollRef}
              data-organizer-scroll
              role="grid"
              aria-label="Library items"
              aria-rowcount={rows.length}
              tabIndex={0}
              onScroll={onScroll}
              onKeyDown={onKeyDown}
              onClick={(event) => {
                if (event.target === event.currentTarget)
                  setSelection(EMPTY_SELECTION);
              }}
              onContextMenu={(event) => {
                if (!(event.target as HTMLElement).closest("[data-node-row]")) {
                  event.preventDefault();
                  setMenu({ x: event.clientX, y: event.clientY, nodeIds: [] });
                }
              }}
              data-drop-node={currentParentId ?? "root"}
              data-drop-kind={flat ? "none" : "surface"}
              data-life-receive={flat ? undefined : true}
              className={cn(
                /* The command composer floats over the bottom of every surface,
                 so the list keeps a lane beneath the last row rather than
                 hiding it. */
                "spectra-composer-clearance min-h-0 flex-1 overflow-y-auto px-2 pt-1 outline-none",
                "focus-visible:shadow-[inset_0_0_0_2px_color-mix(in_oklab,var(--brand-primary)_30%,transparent)]",
                drag && "select-none",
              )}
            >
              {loading ? (
                <RowSkeleton />
              ) : rows.length === 0 && hasMore ? (
                <p role="status" className="px-2 py-6 text-body text-[var(--text-secondary)]">
                  No matching items on this page. Load more to continue looking.
                </p>
              ) : rows.length === 0 ? (
                <EmptyState
                  location={location}
                  searching={searching}
                  term={term}
                  scopeLabel={floorLabel}
                  firstRun={
                    firstRun &&
                    location.kind === "folder" &&
                    location.nodeId === floorId
                  }
                  filtered={filter !== "all"}
                  onNewFolder={createFolderHere}
                  onClearFilter={() => setFilter("all")}
                />
              ) : (
                <div
                  className="relative"
                  style={{ height: rows.length * ROW_HEIGHT }}
                  {...peek.handlers}
                >
                  {peek.card}
                  {visible.map((node, index) => (
                    <OrganizerRow
                      key={node.nodeId}
                      node={node}
                      top={(range.start + index) * ROW_HEIGHT}
                      selected={selection.ids.has(node.nodeId)}
                      active={isOpenWorkNode(node, activeWorkId)}
                      cursor={selection.cursorId === node.nodeId}
                      renaming={renamingId === node.nodeId}
                      dropRing={dropRingId === node.nodeId}
                      insertion={
                        drag?.target?.type === "between" &&
                        drag.target.indicatorNodeId === node.nodeId
                          ? drag.target.edge
                          : null
                      }
                      inContext={
                        node.sourceId
                          ? (contextIds?.has(node.sourceId) ?? false)
                          : false
                      }
                      showLocation={flat}
                      searchMatch={searching ? titleSearchMatch(node.name, term) : undefined}
                      picking={selectionMode}
                      now={now}
                      callbacks={rowCallbacks}
                      ink={
                        node.kind === "workspace"
                          ? ((isClassWorkspace(node) ? book.named(node.name)?.ink : undefined) ?? node.workspace?.color)
                          : undefined
                      }
                      syncLabel={
                        node.sourceId
                          ? syncByWorkId.get(node.sourceId)?.label
                          : undefined
                      }
                      syncTone={
                        node.sourceId
                          ? syncByWorkId.get(node.sourceId)?.tone
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
            </div>

            <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-[var(--border-subtle)] px-4 text-micro text-[var(--text-tertiary)]">
              <span>
                {rows.length} {rows.length === 1 ? "item" : "items"}
                {hasMore ? "+" : ""}
              </span>
              {selection.ids.size > 0 ? (
                <span className="text-[var(--text-secondary)]">
                  {selection.ids.size} selected
                </span>
              ) : null}
              {hasMore ? (
                <button type="button" disabled={page.status === "LoadingMore"} onClick={() => page.loadMore(50)} className="rounded-control px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] disabled:opacity-50">
                  {page.status === "LoadingMore" ? "Loading…" : "Load more"}
                </button>
              ) : null}
              {location.kind === "trash" && rows.length > 0 ? (
                <span>
                  Trashed items stay until you restore them or delete them
                  forever.
                </span>
              ) : null}
              <span className="ml-auto hidden @3xl/rows:block">
                Drag to move, hold Alt to leave a reference, F2 to rename
              </span>
            </footer>
          </section>
          </>
        )}
      </div>

      {menu ? (
        <NodeMenu
          menu={menu}
          nodes={menuNodes}
          location={location}
          canShare={Boolean(onShareWork)}
          onClose={() => setMenu(null)}
          onOpen={openNode}
          onRename={(nodeId) => setRenamingId(nodeId)}
          onTogglePin={(nodes) => {
            const pin = !nodes.every((node) => node.pinned);
            void run("The pin did not change.", async () => {
              for (const node of nodes)
                await actions.setPinned(node.nodeId, pin);
            });
          }}
          onTrash={trashNodes}
          onRestore={(nodeIds) =>
            void run("Those items stayed in the Trash.", async () => {
              await actions.restore(nodeIds);
              toast.success(
                nodeIds.length === 1
                  ? "Restored."
                  : `Restored ${nodeIds.length} items.`,
              );
            })
          }
          onPurge={(nodes) => requestPurge(nodes)}
          onShare={onShareWork}
          onSetShared={(nodes, shared) =>
            void run(shared ? "Those artifacts stayed private." : "Those artifacts stayed shared.", async () => {
              const result = await setWorksShared({ nodeIds: nodes.map((node) => node.nodeId as Id<"orgNodes">), shared });
              const done = result.changed === 1 ? "1 artifact" : `${result.changed} works`;
              if (result.changed) toast.success(shared ? `Shared ${done} with the workspace.` : `${done[0]!.toUpperCase()}${done.slice(1)} private again.`);
              if (result.skipped) toast.error(`${result.skipped} could not change: only your own artifacts in a workspace can be shared with it.`);
            })
          }
          onCopy={(nodes) =>
            void (async () => {
              for (const node of nodes)
                if (node.sourceId) await copyWorkHere(node.sourceId, { workspaceId: node.workspaceContextId, parentNodeId: node.parentId ?? "root" });
            })()
          }
          onNewFolder={createFolderHere}
          onNewWork={createWorkHere}
          onReveal={(node) => {
            setTerm("");
            navigate({ kind: "folder", nodeId: node.parentId });
            setSelection({
              ids: new Set([node.nodeId]),
              anchorId: node.nodeId,
              cursorId: node.nodeId,
            });
          }}
        />
      ) : null}

      {drag ? <DragProxy drag={drag} /> : null}
      {purgeConfirm ? (
        <TrashPurgeDialog
          open
          title={
            purgeConfirm.emptying
              ? "Empty the Trash?"
              : purgeConfirm.names.length === 1
                ? `Delete “${purgeConfirm.names[0]}” forever?`
                : `Delete ${purgeConfirm.names.length} items forever?`
          }
          detail={
            purgeConfirm.emptying
              ? "Everything here will be permanently removed. This cannot be undone."
              : "Folders include everything inside them. This cannot be undone."
          }
          busy={busy}
          onCancel={() => setPurgeConfirm(null)}
          onConfirm={confirmPurge}
        />
      ) : null}
      {selectedNodes.length > 1 ? (
        <div className="spectra-composer-above pointer-events-none fixed left-1/2 z-toast -translate-x-1/2 rounded-chip border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3.5 py-1.5 text-caption text-[var(--text-secondary)] shadow-[var(--shadow-lg)]">
          {selectedNodes.length} selected · drag them anywhere
        </div>
      ) : null}
    </div>
  );
}

function cycleSort(
  key: SortKey,
  current: "manual" | SortKey,
  direction: SortDirection,
  setKey: (next: "manual" | SortKey) => void,
  setDirection: (next: SortDirection) => void,
) {
  if (current !== key) {
    setKey(key);
    setDirection(key === "updated" ? "desc" : "asc");
    return;
  }
  /* A third click on the same column returns to the reader's own arrangement,
     so a sort is never a one-way door. */
  if (direction === (key === "updated" ? "desc" : "asc"))
    setDirection(key === "updated" ? "asc" : "desc");
  else setKey("manual");
}

function ColumnLabel({
  label,
  className,
  sorted,
  onClick,
}: {
  label: string;
  className?: string;
  sorted: SortDirection | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 text-micro font-semibold transition-colors hover:text-[var(--text-secondary)]",
        sorted ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]",
        className,
      )}
    >
      {label}
      {sorted ? (
        <span aria-hidden className="text-micro">
          {sorted === "asc" ? "▲" : "▼"}
        </span>
      ) : null}
    </button>
  );
}

/** The folder, crumb or rail row that takes items for `parentId`, to send light into. */
function dropTarget(parentId: string | null) {
  if (typeof document === "undefined") return null;
  return document.querySelector(`[data-drop-node="${CSS.escape(parentId ?? "root")}"]`);
}

function NodeMenu({
  menu,
  nodes,
  location,
  canShare,
  onClose,
  onOpen,
  onRename,
  onTogglePin,
  onTrash,
  onRestore,
  onPurge,
  onShare,
  onSetShared,
  onCopy,
  onNewFolder,
  onNewWork,
  onReveal,
}: {
  menu: MenuState;
  nodes: TreeNode[];
  location: OrganizerLocation;
  canShare: boolean;
  onClose: () => void;
  onOpen: (node: TreeNode) => void;
  onRename: (nodeId: string) => void;
  onTogglePin: (nodes: TreeNode[]) => void;
  onTrash: (nodeIds: string[]) => void;
  onRestore: (nodeIds: string[]) => void;
  onPurge: (nodes: TreeNode[]) => void;
  onShare?: (artifactId: string) => void;
  onSetShared: (nodes: TreeNode[], shared: boolean) => void;
  onCopy: (nodes: TreeNode[]) => void;
  onNewFolder: () => void;
  onNewWork: (key: Parameters<typeof createDefaultArtifactPayload>[0]) => void;
  onReveal: (node: TreeNode) => void;
}) {
  const single = nodes.length === 1 ? nodes[0] : null;
  // Works of yours inside a workspace: private to you until shared with its people.
  const sharable = nodes.length > 0 && nodes.every((node) => node.kind === "work" && node.workspaceContextId && node.source?.owned !== false);
  const allShared = sharable && nodes.every((node) => node.sharedWithWorkspace);
  const copyable = nodes.length > 0 && nodes.length <= 20 && nodes.every((node) => node.kind === "work" && node.sourceId);
  const inTrash = location.kind === "trash";
  const flat = location.kind !== "folder";
  const work = single?.kind === "work" ? single : null;
  const count = nodes.length;

  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          style={{
            position: "fixed",
            left: menu.x,
            top: menu.y,
            width: 0,
            height: 0,
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={2}
        className="w-[224px]"
        /* Same dock collision as SurfaceNewMenu: bottom rows / Whiteboard
           must paint above the live composer. */
        layer="composer-dock"
        collisionPadding={{ bottom: 16 }}
      >
        {nodes.length === 0 ? (
          <>
            <DropdownMenuItem onSelect={onNewFolder}>
              <FolderPlus className="size-3.5 text-[var(--text-tertiary)]" />
              New folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>New artifact here</DropdownMenuLabel>
            {blueprintChoices.map((choice) => (
              <DropdownMenuItem
                key={choice.key}
                onSelect={() => onNewWork(choice.key)}
              >
                <choice.icon className="size-3.5 text-[var(--text-tertiary)]" />
                {choice.label}
              </DropdownMenuItem>
            ))}
          </>
        ) : inTrash ? (
          <>
            <DropdownMenuItem
              onSelect={() => onRestore(nodes.map((node) => node.nodeId))}
            >
              <RotateCcw className="size-3.5 text-[var(--text-tertiary)]" />
              {count === 1 ? "Restore" : `Restore ${count} items`}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-[var(--danger)] data-[highlighted]:text-[var(--danger)]"
              onSelect={() => onPurge(nodes)}
            >
              <Trash2 className="size-3.5" />
              {count === 1 ? "Delete forever" : `Delete ${count} items forever`}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            {single ? (
              <DropdownMenuItem onSelect={() => onOpen(single)}>
                {single.isContainer ? (
                  <ChevronRight className="size-3.5 text-[var(--text-tertiary)]" />
                ) : (
                  <ArrowRight className="size-3.5 text-[var(--text-tertiary)]" />
                )}
                {single.isContainer ? "Open folder" : "Open"}
              </DropdownMenuItem>
            ) : null}
            {single && flat ? (
              <DropdownMenuItem onSelect={() => onReveal(single)}>
                <Link2 className="size-3.5 text-[var(--text-tertiary)]" />
                Show where it lives
              </DropdownMenuItem>
            ) : null}
            {single ? (
              <DropdownMenuItem onSelect={() => onRename(single.nodeId)}>
                <Pencil className="size-3.5 text-[var(--text-tertiary)]" />
                Rename
                <span className="ml-auto text-micro text-[var(--text-tertiary)]">
                  F2
                </span>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => onTogglePin(nodes)}>
              <Star className="size-3.5 text-[var(--text-tertiary)]" />
              {nodes.every((node) => node.pinned)
                ? "Remove from Favorites"
                : "Add to Favorites"}
            </DropdownMenuItem>
            {work && canShare && work.source?.owned && work.sourceId ? (
              <DropdownMenuItem
                onSelect={() => onShare?.(work.sourceId as string)}
              >
                <Share2 className="size-3.5 text-[var(--text-tertiary)]" />
                Share…
              </DropdownMenuItem>
            ) : null}
            {copyable ? (
              <DropdownMenuItem onSelect={() => onCopy(nodes)}>
                <Copy className="size-3.5 text-[var(--text-tertiary)]" />
                {count === 1 ? "Make a copy" : `Make ${count} copies`}
              </DropdownMenuItem>
            ) : null}
            {sharable ? (
              <DropdownMenuItem onSelect={() => onSetShared(nodes, !allShared)}>
                {allShared ? (
                  <Lock className="size-3.5 text-[var(--text-tertiary)]" />
                ) : (
                  <Users className="size-3.5 text-[var(--text-tertiary)]" />
                )}
                {allShared
                  ? count === 1 ? "Make private" : `Make ${count} private`
                  : count === 1 ? "Share with this workspace" : `Share ${count} with this workspace`}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-[var(--danger)] data-[highlighted]:text-[var(--danger)]"
              onSelect={() => onTrash(nodes.map((node) => node.nodeId))}
            >
              <Trash2 className="size-3.5" />
              {count === 1 ? "Move to Trash" : `Move ${count} items to Trash`}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The thing that follows the pointer. Portalled so no ancestor can clip it. */
function DragProxy({
  drag,
}: {
  drag: NonNullable<ReturnType<typeof useOrganizerDrag>["drag"]>;
}) {
  if (typeof document === "undefined") return null;
  const allowed = drag.target !== null;
  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed z-toast flex items-center gap-2 rounded-control border px-2.5 py-1.5 text-caption shadow-[var(--shadow-lg)]"
      style={{
        left: drag.x + 12,
        top: drag.y + 10,
        backgroundColor: "var(--bg-elevated)",
        borderColor: allowed ? "var(--brand-primary)" : "var(--border-default)",
        color: "var(--text-primary)",
        opacity: allowed ? 1 : 0.72,
      }}
    >
      {drag.mode === "reference" ? (
        <Link2 className="size-3.5 text-[var(--brand-primary)]" />
      ) : null}
      <span className="max-w-[220px] truncate font-medium">{drag.label}</span>
      <span className="text-[var(--text-tertiary)]">
        {drag.mode === "reference"
          ? "reference"
          : allowed
            ? "move"
            : (drag.reason ?? "")}
      </span>
    </div>,
    document.body,
  );
}

function RowSkeleton() {
  return (
    <div data-life-ghost className="flex flex-col gap-1 p-1" aria-hidden>
      {Array.from({ length: 10 }, (_, row) => (
        <div key={row} className="flex h-[30px] items-center gap-2">
          <div data-life-ghost-bar className="size-[22px] shrink-0 animate-pulse rounded-chip bg-[var(--bg-tertiary)]" />
          <div data-life-ghost-bar
            className="h-3 animate-pulse rounded-full bg-[var(--bg-tertiary)]"
            style={{ width: `${34 - (row % 4) * 6}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  location,
  searching,
  term,
  scopeLabel,
  firstRun,
  filtered,
  onNewFolder,
  onClearFilter,
}: {
  location: OrganizerLocation;
  searching: boolean;
  term: string;
  scopeLabel: string;
  firstRun: boolean;
  filtered: boolean;
  onNewFolder: () => void;
  onClearFilter: () => void;
}) {
  const copy = searching
    ? {
        title: `Nothing matches “${term.trim()}”`,
        body: `Search looks at names inside ${scopeLabel}.`,
      }
    : filtered
      ? {
          title: "Nothing of that type here",
          body: "The filter is hiding everything in this folder.",
        }
      : location.kind === "trash"
        ? { title: "The Trash is empty", body: "Nothing has been thrown away." }
        : firstRun
          ? {
              title: "Start with one artifact",
              body: "Use New above to create a document, quiz, study deck, or another kind of artifact. Add folders when you want more structure.",
            }
          : location.kind === "quick"
            ? {
                recent: {
                  title: "Nothing opened yet",
                  body: "Artifacts you open will show up here, newest first.",
                },
                favorites: {
                  title: "No favorites yet",
                  body: "Star anything to keep it one click away.",
                },
                shared: {
                  title: "Nothing shared",
                  body: "Artifacts you share, and artifacts shared with you, collect here.",
                },
              }[location.view]
            : {
                title: "This folder is empty",
                body: "Make a folder, or start something new here.",
              };

  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-subhead font-medium text-[var(--text-primary)]">
        {copy.title}
      </p>
      <p className="max-w-[380px] text-ui text-[var(--text-secondary)]">
        {copy.body}
      </p>
      {filtered ? (
        <button
          type="button"
          onClick={onClearFilter}
          className="mt-2 flex h-8 items-center gap-1.5 rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-ui text-[var(--text-primary)]"
        >
          Clear the filter
        </button>
      ) : !searching && location.kind === "folder" ? (
        <button
          type="button"
          onClick={onNewFolder}
          className="mt-2 flex h-8 items-center gap-1.5 rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-ui text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          <FolderPlus className="size-3.5" />
          New folder
        </button>
      ) : null}
    </div>
  );
}
