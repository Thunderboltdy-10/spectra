"use client";

import {
  BarChart3,
  BookOpen,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileText,
  Files,
  FolderInput,
  FolderPlus,
  Grid2X2,
  HelpCircle,
  LayoutGrid,
  List,
  Loader2,
  MessageSquare,
  PanelTop,
  Plus,
  Search,
  Sparkles,
  Sprout,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import { useSpectraRun } from "../ai/use-spectra-run";
import { createDefaultArtifactPayload, type ArtifactPayload } from "../components/artifact-blueprint-sheet";
import { ArtifactCard, blueprintMeta } from "../components/artifact-card";
import { ArtifactStudio, StudioTabRail, useArtifactStudioState } from "../components/artifact-studio";
import { CommandBar } from "../components/command-bar";
import { ContextFocusControl, GlobalSearch, SelectionActionBar, type ComposerFocusMode } from "../components/context-controls";
import { FloatingMenu } from "../components/floating-menu";
import { ResultCardStack } from "../components/result-card";
import { RunDetailPanel } from "../components/run-detail-panel";
import { useSpectraSession } from "@/context/spectra-session-context";
import {
  artifactPlacements,
  artifactToCard,
  formatRelativeTime,
  initials,
  sortSpectraWorkspaces,
  workspaceAccent,
} from "../components/spectra-view-model";
import {
  getSpectraArtifacts,
  getSpectraOverview,
  getSpectraRunDetail,
  postSpectra,
  type SpectraArtifact,
  type SpectraBlueprintKey,
  type SpectraWorkspace,
  type SpectraResultCard,
} from "../data/api";

type ArtifactMode = "list" | "board" | "grid";
type ArtifactSort = "updated" | "created" | "title" | "type" | "workspace" | "activity";
type ArtifactHubTab = { id: string; label: string };

function artifactHubTab(): ArtifactHubTab {
  return { id: `artifact-hub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: "All" };
}

const filters: Array<{ key: "all" | SpectraBlueprintKey; label: string; icon: LucideIcon }> = [
  { key: "all", label: "All", icon: LayoutGrid },
  { key: "document", label: "Documents", icon: FileText },
  { key: "flashcard_deck", label: "Decks", icon: BookOpen },
  { key: "quiz", label: "Quizzes", icon: HelpCircle },
  { key: "planner_task", label: "Tasks", icon: CalendarCheck2 },
  { key: "thread_reference", label: "Threads", icon: MessageSquare },
];

function iconForWorkspace(workspace: SpectraWorkspace, index: number) {
  const accent = workspaceAccent(workspace, index);
  if (accent.icon === "leaf") return Sprout;
  if (accent.icon === "bar") return BarChart3;
  if (accent.icon === "book") return BookOpen;
  if (accent.icon === "spark") return Sparkles;
  return Plus;
}

function buttonClass(tone: "normal" | "dark" = "normal") {
  if (tone === "dark") return "inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[var(--text-primary)] px-3 text-[13px] font-medium text-[var(--bg-primary)] disabled:opacity-45";
  return "inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45";
}

function menuItemClass() {
  return "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-45";
}

function useOutsideClick<T extends HTMLElement>(open: boolean, onClose: () => void) {
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

function ArtifactsRail({
  workspaces,
  selectedWorkspaceId,
  onSelect,
}: {
  workspaces: SpectraWorkspace[];
  selectedWorkspaceId: string;
  onSelect: (workspaceId: string) => void;
}) {
  return (
    <aside className="flex w-[74px] shrink-0 flex-col items-center border-r border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-primary)_84%,var(--bg-elevated))] px-2.5 py-5">
      <button
        type="button"
        className={`flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-[8px] text-[11px] font-medium transition ${
          !selectedWorkspaceId ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_2px_8px_rgba(27,20,12,0.04)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        }`}
        onClick={() => onSelect("")}
      >
        <LayoutGrid className="h-4 w-4" />
        All
      </button>
      <div className="mt-4 flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto">
        {workspaces.map((workspace, index) => {
          const accent = workspaceAccent(workspace, index);
          const Icon = iconForWorkspace(workspace, index);
          const selected = workspace._id === selectedWorkspaceId;
          return (
            <button
              key={workspace._id}
              type="button"
              className={`flex w-14 flex-col items-center gap-1 rounded-[8px] px-1.5 py-2 text-[11px] font-medium transition ${
                selected ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_2px_8px_rgba(27,20,12,0.04)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
              onClick={() => onSelect(workspace._id)}
              title={`Filter ${workspace.title}`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-[8px] text-white" style={{ background: accent.color }}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="max-w-full truncate">{workspace.title}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export function ArtifactsShell() {
  const spectraSession = useSpectraSession();
  const searchParams = useSearchParams();
  const requestedArtifactId = searchParams.get("artifactId");
  const [allArtifacts, setAllArtifacts] = useState<SpectraArtifact[]>([]);
  const [workspaces, setWorkspaces] = useState<SpectraWorkspace[]>([]);
  const [resultCards, setResultCards] = useState<SpectraResultCard[]>([]);
  const [activeFilter, setActiveFilter] = useState<"all" | SpectraBlueprintKey>("all");
  const [mode, setMode] = useState<ArtifactMode>("list");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<ArtifactSort>("updated");
  const [sortOpen, setSortOpen] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedContextIds, setSelectedContextIds] = useState<Set<string>>(() => new Set());
  const [focusModeOverride, setFocusModeOverride] = useState<ComposerFocusMode | null>(null);
  const [composerThread, setComposerThread] = useState<{ id: string; title: string; runId?: string } | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [hubTabs, setHubTabs] = useState<ArtifactHubTab[]>(() => [{ id: "artifacts-all-default", label: "All" }]);
  const [activeHubTabId, setActiveHubTabId] = useState<string | null>("artifacts-all-default");
  const [hubTabsRestored, setHubTabsRestored] = useState(false);
  const [studioPanelWidth, setStudioPanelWidth] = useState(760);
  const [addMenuArtifactId, setAddMenuArtifactId] = useState<string | null>(null);
  const [moveMenuArtifactId, setMoveMenuArtifactId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const metadataLoadedRef = useRef(false);
  const openedQueryArtifactRef = useRef<string | null>(null);
  const [placementAnchor, setPlacementAnchor] = useState<DOMRect | null>(null);
  const [pendingCreateType, setPendingCreateType] = useState<SpectraBlueprintKey | null>(null);
  const [artifactDeletePending, setArtifactDeletePending] = useState<SpectraArtifact | null>(null);
  const createMenuRef = useOutsideClick<HTMLDivElement>(createMenuOpen, () => setCreateMenuOpen(false));
  const sortMenuRef = useOutsideClick<HTMLDivElement>(sortOpen, () => setSortOpen(false));
  const studio = useArtifactStudioState("spectra.shared.artifactStudio", allArtifacts);
  const selectedWorkspace = workspaces.find((item) => item._id === selectedWorkspaceId) ?? null;
  const activeLocalThread = !composerThread ? spectraSession.localThreads.find((thread) => thread.runId === spectraSession.activeLocalThreadRunId) ?? null : null;
  const naturalFocusMode: ComposerFocusMode = composerThread || activeLocalThread ? "thread" : selectedContextIds.size ? "selection" : studio.activeArtifact ? "artifact" : selectedWorkspace ? "workspace" : "global";
  const effectiveFocusMode = focusModeOverride === "selection" && selectedContextIds.size === 0 ? naturalFocusMode : focusModeOverride === "artifact" && !studio.activeArtifact ? naturalFocusMode : focusModeOverride === "workspace" && !selectedWorkspace ? naturalFocusMode : focusModeOverride === "thread" && !composerThread && !activeLocalThread ? naturalFocusMode : focusModeOverride ?? naturalFocusMode;

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("spectra.artifacts.hubTabs.v1") ?? "null") as { tabs?: ArtifactHubTab[]; activeId?: string | null } | null;
      if (saved?.tabs?.length) { setHubTabs(saved.tabs.slice(0, 16)); setActiveHubTabId(saved.activeId ?? saved.tabs[0]?.id ?? null); }
    } catch { window.localStorage.removeItem("spectra.artifacts.hubTabs.v1"); }
    setHubTabsRestored(true);
  }, []);
  useEffect(() => { if (hubTabsRestored) window.localStorage.setItem("spectra.artifacts.hubTabs.v1", JSON.stringify({ tabs: hubTabs, activeId: activeHubTabId })); }, [activeHubTabId, hubTabs, hubTabsRestored]);

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
    const fallbackHub = remaining[Math.min(closingIndex > 0 ? closingIndex - 1 : 0, remaining.length - 1)];
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
    const target = hubTabs.find((tab) => tab.id === activeHubTabId) ?? hubTabs[hubTabs.length - 1];
    if (target) activateAllHub(target.id);
    else addAllHubTab();
  }

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [artifactResult, overview] = await Promise.all([
        getSpectraArtifacts({
          placement: "all",
        }),
        metadataLoadedRef.current ? Promise.resolve(null) : getSpectraOverview(),
      ]);
      setAllArtifacts(artifactResult.artifacts);
      if (overview) {
        metadataLoadedRef.current = true;
        setWorkspaces(sortSpectraWorkspaces(overview.workspaces));
        setResultCards((overview.resultCards ?? []).filter((card) => card.run?.sourceSurface === "artifact" && !card.run.workspaceId));
      }
      return artifactResult.artifacts;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load artifacts.");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const runEngine = useSpectraRun({
    surface: composerThread ? "artifacts" : studio.activeArtifact ? "artifact" : "artifacts",
    workspaceId: selectedWorkspaceId || undefined,
    artifactId: studio.activeArtifact?._id,
    threadId: composerThread?.id,
    localConversation: activeLocalThread?.messages.map((message) => ({ role: message.role, content: message.content })),
    focusMode: effectiveFocusMode,
    selectedArtifactIds: [...selectedContextIds],
    currentView: mode,
    initialCards: resultCards,
    onThreadReady: (threadId) => {
      setComposerThread((current) => current?.id === threadId ? current : { id: threadId, title: "Current conversation" });
      window.dispatchEvent(new Event("spectra:threads-changed"));
    },
    onDataChanged: () => load(true),
    onOpenArtifact: async (artifactId) => {
      const refreshed = await load(true);
      const artifact = refreshed.find((item) => item._id === artifactId);
      if (artifact) studio.openSplit(artifact);
    },
    onFinal: ({ runId, prompt, summary }) => {
      if (activeLocalThread) spectraSession.appendLocalExchange(activeLocalThread.runId, prompt, summary, runId);
    },
  });

  async function openRunPanel(runId: string, title: string) {
    try {
      const detail = await getSpectraRunDetail(runId);
      spectraSession.openLocalThread(runId, title, [
        { id: `root-user:${runId}`, role: "user", content: detail.run.userPrompt, runId, createdAt: detail.run.createdAt },
        { id: `root-assistant:${runId}`, role: "assistant", content: detail.run.finalSummary ?? detail.run.error ?? title, runId, createdAt: detail.run.updatedAt },
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open conversation.");
    }
  }

  function toggleContinuedThread(threadId: string, title: string, runId?: string) {
    setComposerThread((current) => current?.id === threadId ? null : { id: threadId, title, runId });
  }

  function toggleContextArtifact(artifact: SpectraArtifact) {
    setMultiSelectMode(true);
    setMode("grid");
    setSelectedContextIds((current) => {
      const next = new Set(current);
      if (next.has(artifact._id)) next.delete(artifact._id); else if (next.size < 12) next.add(artifact._id);
      return next;
    });
    setFocusModeOverride("selection");
  }

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!requestedArtifactId || openedQueryArtifactRef.current === requestedArtifactId) return;
    const artifact = allArtifacts.find((item) => item._id === requestedArtifactId);
    if (!artifact) return;
    openedQueryArtifactRef.current = requestedArtifactId;
    studio.openSplit(artifact);
  }, [allArtifacts, requestedArtifactId, studio]);

  const autoContinuedArtifactRef = useRef<string | null>(null);
  useEffect(() => {
    const artifact = studio.activeArtifact;
    if (!artifact || artifact.blueprintKey !== "thread_reference" || autoContinuedArtifactRef.current === artifact._id) return;
    autoContinuedArtifactRef.current = artifact._id;
    const threadId = typeof (artifact.content as { threadId?: unknown } | null)?.threadId === "string" ? String((artifact.content as { threadId: string }).threadId).trim() : "";
    if (threadId && !composerThread) setComposerThread({ id: threadId, title: artifact.title });
  }, [composerThread, studio.activeArtifact]);

  const artifacts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allArtifacts.filter((artifact) => {
      if (activeFilter !== "all" && artifact.blueprintKey !== activeFilter) return false;
      if (selectedWorkspaceId && !artifactPlacements(artifact).some((placement) => placement.workspaceId === selectedWorkspaceId)) return false;
      if (!needle) return true;
      return `${artifact.title}\n${artifact.summary ?? ""}\n${artifact.tags.join(" ")}`.toLowerCase().includes(needle);
    }).sort((a, b) => {
      if (sortMode === "created") return b.createdAt - a.createdAt;
      if (sortMode === "title") return a.title.localeCompare(b.title);
      if (sortMode === "type") return a.blueprintKey.localeCompare(b.blueprintKey) || a.title.localeCompare(b.title);
      if (sortMode === "workspace") return (artifactPlacements(a)[0]?.workspaceTitle ?? "Unplaced").localeCompare(artifactPlacements(b)[0]?.workspaceTitle ?? "Unplaced");
      return b.updatedAt - a.updatedAt;
    });
  }, [activeFilter, allArtifacts, search, selectedWorkspaceId, sortMode]);
  const inbox = useMemo(() => artifacts.filter((artifact) => artifact.placementStatus === "inbox" || artifactPlacements(artifact).length === 0), [artifacts]);
  const placed = useMemo(() => artifacts.filter((artifact) => artifact.placementStatus === "workspace" || artifactPlacements(artifact).length > 0), [artifacts]);
  const byWorkspace = useMemo(() => workspaces.map((workspace) => ({
    workspace,
    artifacts: placed.filter((artifact) => artifactPlacements(artifact).some((placement) => placement.workspaceId === workspace._id)),
  })), [placed, workspaces]);

  function requestCreateArtifact(blueprintKey: SpectraBlueprintKey) {
    if (!selectedWorkspaceId) {
      setPendingCreateType(blueprintKey);
      return;
    }
    void createArtifact(createDefaultArtifactPayload(blueprintKey), selectedWorkspaceId);
  }

  async function createArtifact(payload: ArtifactPayload, targetWorkspaceId?: string) {
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
      toast.success(targetWorkspaceId ? "Artifact created in workspace." : "Artifact created as unplaced.");
      const refreshed = await load(true);
      const created = refreshed.find((artifact) => artifact._id === result.artifactId);
      if (created) studio.openTab(created);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create artifact.");
    } finally {
      setBusyKey(null);
    }
  }

  async function updateArtifact(artifactId: string, payload: ArtifactPayload) {
    setBusyKey(`artifact:update:${artifactId}`);
    try {
      await postSpectra({
        action: "updateArtifact",
        artifactId,
        title: payload.title,
        summary: payload.summary,
        content: payload.content,
        tags: payload.tags,
      });
      toast.success("Artifact updated.");
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update artifact.");
    } finally {
      setBusyKey(null);
    }
  }

  async function revertArtifactVersion(artifactId: string, versionId: string) {
    setBusyKey(`artifact:revert:${artifactId}`);
    try {
      await postSpectra({ action: "revertArtifactVersion", artifactId, versionId });
      toast.success("Artifact restored to the selected version.");
      await load(true);
    } finally { setBusyKey(null); }
  }

  async function archiveArtifact(artifact: SpectraArtifact) {
    setBusyKey(`artifact:archive:${artifact._id}`);
    try {
      await postSpectra({ action: "archiveArtifact", artifactId: artifact._id });
      toast.success("Artifact archived.");
      returnToAllHub();
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not archive artifact.");
    } finally {
      setBusyKey(null);
    }
  }

  async function permanentlyDeleteArtifact(artifact: SpectraArtifact, confirmed = false) {
    if (!confirmed) { setArtifactDeletePending(artifact); return; }
    setBusyKey(`delete:${artifact._id}`);
    try {
      await postSpectra({ action: "deleteArtifact", artifactId: artifact._id });
      toast.success("Artifact permanently deleted.");
      setArtifactDeletePending(null);
      if (studio.activeArtifact?._id === artifact._id) returnToAllHub();
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete artifact.");
    } finally {
      setBusyKey(null);
    }
  }

  async function addToWorkspace(artifactId: string, workspaceId: string) {
    setBusyKey(`add:${artifactId}`);
    try {
      await postSpectra({ action: "addArtifactToWorkspace", artifactId, workspaceId });
      const workspaceTitle = workspaces.find((workspace) => workspace._id === workspaceId)?.title ?? "workspace";
      toast.success(`Added to ${workspaceTitle}.`);
      setAddMenuArtifactId(null);
      setMoveMenuArtifactId(null);
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not place artifact.");
    } finally {
      setBusyKey(null);
    }
  }

  async function removePlacement(workspaceItemId: string) {
    setBusyKey(`remove:${workspaceItemId}`);
    try {
      await postSpectra({ action: "hideWorkspaceItem", workspaceItemId });
      toast.success("Removed from workspace. Artifact remains in library.");
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove placement.");
    } finally {
      setBusyKey(null);
    }
  }

  function placementMenu(artifact: SpectraArtifact, variant: "add" | "move") {
    const menuOpen = variant === "add" ? addMenuArtifactId === artifact._id : moveMenuArtifactId === artifact._id;
    const setMenu = variant === "add" ? setAddMenuArtifactId : setMoveMenuArtifactId;
    return (
      <div>
        <button type="button" className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45" disabled={workspaces.length === 0 || busyKey === `add:${artifact._id}`} onClick={(event) => { setPlacementAnchor(event.currentTarget.getBoundingClientRect()); setMenu(menuOpen ? null : artifact._id); }} aria-label={variant === "add" ? "Add to workspace" : "Move to workspace"} title={variant === "add" ? "Add to workspace" : "Move to workspace"}>
          {busyKey === `add:${artifact._id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : variant === "add" ? <FolderPlus className="h-3.5 w-3.5" /> : <FolderInput className="h-3.5 w-3.5" />}
        </button>
        <FloatingMenu open={menuOpen} anchor={placementAnchor} onClose={() => setMenu(null)} width={260}>
            {workspaces.map((workspace) => {
              const alreadyPlaced = artifactPlacements(artifact).some((placement) => placement.workspaceId === workspace._id);
              return (
                <button key={workspace._id} type="button" className={menuItemClass()} disabled={alreadyPlaced || busyKey === `add:${artifact._id}`} onClick={() => void addToWorkspace(artifact._id, workspace._id)}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[var(--bg-secondary)] text-[11px] font-semibold text-[var(--text-secondary)]">{initials(workspace.title)}</span>
                  <span className="min-w-0 flex-1 truncate">{workspace.title}</span>
                  {alreadyPlaced ? <CheckCircle2 className="h-4 w-4 text-[var(--success)]" /> : null}
                </button>
              );
            })}
        </FloatingMenu>
      </div>
    );
  }

  function rowActions(artifact: SpectraArtifact) {
    const firstPlacement = artifactPlacements(artifact)[0];
    const openButton = (
      <button type="button" className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" onClick={() => studio.openSplit(artifact)} aria-label="Open artifact" title="Open artifact">
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
    );
    if (!firstPlacement) {
      return (
        <div className="flex items-center gap-2">
          {openButton}
          {placementMenu(artifact, "add")}
          <button type="button" className="flex h-8 w-8 items-center justify-center text-[var(--text-secondary)] hover:text-[var(--danger)]" onClick={() => void permanentlyDeleteArtifact(artifact)} aria-label="Delete permanently"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        {openButton}
        {placementMenu(artifact, "move")}
        <button type="button" className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-elevated))] hover:text-[var(--danger)]" disabled={busyKey === `remove:${firstPlacement.workspaceItemId}`} onClick={() => void removePlacement(firstPlacement.workspaceItemId)} aria-label="Remove from workspace" title="Remove from workspace">
          {busyKey === `remove:${firstPlacement.workspaceItemId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
        </button>
        <button type="button" className="flex h-8 w-8 items-center justify-center text-[var(--text-secondary)] hover:text-[var(--danger)]" onClick={() => void permanentlyDeleteArtifact(artifact)} aria-label="Delete permanently"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-[radial-gradient(circle_at_32%_-12%,color-mix(in_oklab,var(--bg-elevated)_70%,transparent),transparent_34%),var(--bg-primary)]">
      <ArtifactsRail workspaces={workspaces} selectedWorkspaceId={selectedWorkspaceId} onSelect={setSelectedWorkspaceId} />
      <div className="flex min-w-0 flex-1 flex-col">
        <StudioTabRail
          hubTabs={hubTabs}
          activeHubTabId={studio.mode === "tab" ? null : activeHubTabId}
          artifacts={allArtifacts}
          tabs={studio.tabs}
          activeArtifactId={studio.mode === "tab" ? studio.activeArtifactId : null}
          dirtyIds={studio.dirtyIds}
          onActivateHub={activateAllHub}
          onCloseHub={closeAllHubTab}
          onAddHub={addAllHubTab}
          onActivateTab={studio.activateTab}
          onCloseTab={closeArtifactTab}
        />
        <div className="relative flex min-h-0 flex-1">
      {pendingCreateType ? <div className="absolute inset-0 z-[90] flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-primary)_72%,transparent)] backdrop-blur-[2px]" onPointerDown={() => setPendingCreateType(null)}><div className="w-[390px] rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[0_24px_70px_rgba(27,20,12,0.2)]" onPointerDown={(event) => event.stopPropagation()}><h2 className="font-display text-[19px] font-semibold text-[var(--text-primary)]">Choose a destination</h2><p className="mt-1 text-[12px] text-[var(--text-secondary)]">Create this {blueprintMeta[pendingCreateType].label.toLowerCase()} in a workspace or keep it unplaced.</p><div className="mt-4 max-h-[300px] space-y-1 overflow-y-auto"><button type="button" className={menuItemClass()} onClick={() => { const type = pendingCreateType; setPendingCreateType(null); void createArtifact(createDefaultArtifactPayload(type)); }}><LayoutGrid className="h-4 w-4" />Unplaced / inbox</button>{workspaces.map((target) => <button key={target._id} type="button" className={menuItemClass()} onClick={() => { const type = pendingCreateType; setPendingCreateType(null); void createArtifact(createDefaultArtifactPayload(type), target._id); }}>{target.title}</button>)}</div></div></div> : null}
      {artifactDeletePending ? <div className="absolute inset-0 z-[96] flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-primary)_76%,transparent)] p-5 backdrop-blur-[2px]" onPointerDown={() => setArtifactDeletePending(null)}><div className="w-full max-w-[440px] rounded-[12px] border border-[color-mix(in_oklab,var(--danger)_24%,var(--border-default))] bg-[var(--bg-elevated)] p-5 shadow-[0_24px_70px_rgba(27,20,12,0.2)]" onPointerDown={(event) => event.stopPropagation()}><h2 className="font-display text-[21px] font-semibold text-[var(--text-primary)]">Delete {artifactDeletePending.title}?</h2><p className="mt-2 text-[13px] leading-5 text-[var(--text-secondary)]">The artifact, placements, version history, and linked run history will be permanently removed.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setArtifactDeletePending(null)} className="h-9 px-3 text-[12px] text-[var(--text-secondary)]">Cancel</button><button type="button" disabled={busyKey === `delete:${artifactDeletePending._id}`} onClick={() => void permanentlyDeleteArtifact(artifactDeletePending, true)} className="flex h-9 items-center gap-2 rounded-[8px] bg-[var(--danger)] px-3 text-[12px] font-medium text-white disabled:opacity-45">{busyKey === `delete:${artifactDeletePending._id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Delete permanently</button></div></div></div> : null}
      {studio.mode === "tab" && studio.activeArtifact ? (
        <ArtifactStudio
          mode="tab"
          artifact={studio.activeArtifact}
          artifacts={allArtifacts}
          tabs={studio.tabs}
          dirtyIds={studio.dirtyIds}
          busy={busyKey === `artifact:update:${studio.activeArtifact._id}`}
          sourceLabel="Artifacts"
          onClose={returnToAllHub}
          onExpand={studio.openTab}
          onActivateTab={studio.activateTab}
          onCloseTab={closeArtifactTab}
          onSave={updateArtifact}
          onRevert={revertArtifactVersion}
          onArchive={archiveArtifact}
          onDirtyChange={studio.setDirty}
          onContinueThread={(threadId, title) => toggleContinuedThread(threadId, title)}
          continuedThreadId={composerThread?.id}
        />
      ) : (
      <>
      <section className="min-w-0 flex-1 overflow-y-auto px-8 pb-[150px] pt-7">
        <header>
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h1 className="font-display text-[34px] font-semibold leading-none text-[var(--text-primary)]">Artifacts</h1>
              <p className="mt-3 text-[14px] text-[var(--text-secondary)]">All your documents, decks, quizzes, tasks, and threads — in one place.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-[280px] max-w-full">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-9 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-9 pr-12 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                  placeholder="Search artifacts"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-tertiary)]">Filter</span>
              </div>
              <GlobalSearch onOpenArtifact={studio.openSplit} onOpenWorkspace={(target) => setSelectedWorkspaceId(target._id)} selectedIds={selectedContextIds} onToggleSelected={toggleContextArtifact} placementWorkspaceId={selectedWorkspace?._id} placementLabel={selectedWorkspace?.title} onPlaceArtifact={selectedWorkspace ? (artifact) => void addToWorkspace(artifact._id, selectedWorkspace._id) : undefined} />
              <WorkspacePicker workspaces={workspaces} selectedWorkspaceId={selectedWorkspaceId} onSelect={setSelectedWorkspaceId} />
              <div className="relative" ref={createMenuRef}>
                <button type="button" className={buttonClass("dark")} onClick={() => setCreateMenuOpen((open) => !open)}>
                  <Plus className="h-4 w-4" />
                  New artifact
                </button>
                {createMenuOpen ? (
                  <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[230px] rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[0_6px_18px_rgba(0,0,0,0.10)]">
                    {filters.filter((filter) => filter.key !== "all" && filter.key !== "thread_reference").map((filter) => {
                      const Icon = filter.icon;
                      const key = filter.key as SpectraBlueprintKey;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={menuItemClass()}
                          disabled={busyKey === `artifact:create:${key}`}
                          onClick={() => {
                            setCreateMenuOpen(false);
                            requestCreateArtifact(key);
                          }}
                        >
                          {busyKey === `artifact:create:${key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                          New {blueprintMeta[key].label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div className="mt-8 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2">
              {filters.map((filter) => {
                const Icon = filter.icon;
                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setActiveFilter(filter.key)}
                    className={`inline-flex h-9 items-center gap-2 rounded-[8px] border border-transparent px-3 text-[13px] font-medium transition-all duration-200 ${
                      activeFilter === filter.key ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_1px_7px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--bg-elevated)_68%,transparent)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {filter.label}
                  </button>
                );
              })}
            </div>
            <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => { setMultiSelectMode((value) => !value); setMode("grid"); }} className={`flex h-9 items-center gap-2 rounded-[8px] border px-3 text-[12px] font-medium transition ${multiSelectMode ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)]" : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`} title={multiSelectMode ? "Finish selecting" : "Select objects for AI context"} aria-label={multiSelectMode ? "Finish selecting" : "Select multiple artifacts"} aria-pressed={multiSelectMode}><Files className="h-4 w-4" />{multiSelectMode ? "Done selecting" : "Select objects"}</button>
            <div className="relative" ref={sortMenuRef}><button type="button" className={buttonClass()} onClick={() => setSortOpen((open) => !open)}>{sortMode === "updated" ? "Recently updated" : sortMode === "created" ? "Recently created" : sortMode === "title" ? "Title A–Z" : sortMode === "type" ? "Artifact type" : sortMode === "workspace" ? "Workspace" : "Activity"}<ChevronDown className="h-3.5 w-3.5" /></button>{sortOpen ? <div className="absolute right-0 top-[calc(100%+7px)] z-40 w-[190px] rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_14px_32px_rgba(27,20,12,0.13)]">{([['updated','Recently updated'],['created','Recently created'],['title','Title A–Z'],['type','Artifact type'],['workspace','Workspace'],['activity','Activity']] as Array<[ArtifactSort,string]>).map(([key,label]) => <button key={key} type="button" className={menuItemClass()} onClick={() => { setSortMode(key); setSortOpen(false); }}>{label}{sortMode === key ? <CheckCircle2 className="ml-auto h-4 w-4 text-[var(--success)]" /> : null}</button>)}</div> : null}</div>
            <div className="flex rounded-[10px] bg-[color-mix(in_oklab,var(--bg-elevated)_74%,transparent)] p-1 shadow-[inset_0_0_0_1px_var(--border-default)]">
              {[
                { key: "grid" as const, label: "Grid", icon: Grid2X2 },
                { key: "list" as const, label: "List", icon: List },
                { key: "board" as const, label: "Board", icon: PanelTop },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.key} type="button" className={`inline-flex h-8 items-center gap-2 rounded-[7px] px-3 text-[12px] font-medium transition-all duration-200 ${mode === item.key ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_1px_6px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--bg-primary)_52%,transparent)] hover:text-[var(--text-primary)]"}`} onClick={() => setMode(item.key)}>
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </div>
            </div>
          </div>
        </header>
        {loading ? <ArtifactsSkeleton /> : null}
        {!loading && artifacts.length === 0 ? <EmptyArtifactsState /> : null}
        {!loading && mode === "list" ? <GroupedList inbox={inbox} groups={byWorkspace} rowActions={rowActions} onOpen={studio.openSplit} /> : null}
        {!loading && mode === "board" ? <BoardColumns groups={byWorkspace} onOpen={studio.openSplit} /> : null}
        {mode === "grid" ? (
          <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {!loading ? artifacts.map((artifact) => <ArtifactCard key={artifact._id} artifact={artifactToCard(artifact)} actions={multiSelectMode ? undefined : rowActions(artifact)} onSelect={() => studio.openSplit(artifact)} selectionMode={multiSelectMode} contextSelected={selectedContextIds.has(artifact._id)} onToggleContext={() => toggleContextArtifact(artifact)} />) : null}
          </div>
        ) : null}
      </section>
      {studio.mode === "split" && studio.activeArtifact ? (
        <ArtifactStudio
          mode="split"
          artifact={studio.activeArtifact}
          artifacts={allArtifacts}
          tabs={studio.tabs}
          dirtyIds={studio.dirtyIds}
          busy={busyKey === `artifact:update:${studio.activeArtifact._id}`}
          panelWidth={studioPanelWidth}
          sourceLabel="Artifacts"
          onPanelWidthChange={setStudioPanelWidth}
          onClose={returnToAllHub}
          onExpand={studio.openTab}
          onActivateTab={studio.activateTab}
          onCloseTab={closeArtifactTab}
          onSave={updateArtifact}
          onRevert={revertArtifactVersion}
          onArchive={archiveArtifact}
          onDirtyChange={studio.setDirty}
          onContinueThread={(threadId, title) => toggleContinuedThread(threadId, title)}
          continuedThreadId={composerThread?.id}
        />
      ) : null}
      </>
      )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-[linear-gradient(to_top,var(--bg-primary)_72%,transparent)] px-8 pb-5 pt-12" style={spectraSession.activeLocalThreadRunId ? { right: "var(--spectra-run-panel-width, 680px)" } : undefined}>
          <div className="pointer-events-auto mx-auto max-w-[880px]">
            {multiSelectMode ? <SelectionActionBar count={selectedContextIds.size} onClear={() => { setSelectedContextIds(new Set()); setFocusModeOverride(null); }} onExit={() => { setMultiSelectMode(false); if (selectedContextIds.size === 0) setFocusModeOverride(null); }} onRun={(prompt) => void runEngine.run(prompt)} /> : null}
            <ResultCardStack cards={runEngine.cards} className="mb-1.5 ml-[52px]" activeThreadId={composerThread?.id} activeRunId={composerThread?.runId ?? activeLocalThread?.runId} onContinue={(thread) => setComposerThread(thread ? { id: thread.threadId, title: thread.title, runId: thread.runId } : null)} onOpen={(card) => void openRunPanel(card.runId, card.summary ?? card.title)} onAction={(card, action, targetId) => { if (action === "hide" && spectraSession.activeLocalThreadRunId === card.runId) spectraSession.closeLocalThread(card.runId); void runEngine.onCardAction(card, action, targetId); }} />
            <CommandBar
              placeholder={composerThread ? `Continue ${composerThread.title}...` : activeLocalThread ? `Continue ${activeLocalThread.title}...` : studio.activeArtifact ? `Act on ${studio.activeArtifact.title}...` : "Ask across all objects..."}
              onSubmit={(prompt, attachments) => {
                if (studio.activeArtifact && studio.dirtyIds.has(studio.activeArtifact._id)) {
                  toast.message("Save this artifact before asking Spectra to update it.");
                  return false;
                }
                void runEngine.run(prompt, attachments);
                return true;
              }}
              busy={runEngine.submitting}
              allowConcurrent
              onStop={runEngine.stop}
              context={<ContextFocusControl mode={effectiveFocusMode} onModeChange={setFocusModeOverride} workspace={selectedWorkspace} artifact={studio.activeArtifact} selectedCount={selectedContextIds.size} threadTitle={composerThread?.title ?? activeLocalThread?.title} />}
              menu={(
                <div>
                  <button type="button" className={menuItemClass()} onClick={() => { setComposerThread(null); spectraSession.clearActivePanel(); }}><MessageSquare className="h-4 w-4" />New chat</button>
                  <div className="my-1 h-px bg-[var(--border-subtle)]" />
                  {filters.filter((filter) => filter.key !== "all" && filter.key !== "thread_reference").map((filter) => {
                    const Icon = filter.icon;
                    const key = filter.key as SpectraBlueprintKey;
                    return (
                      <button key={key} type="button" className={menuItemClass()} disabled={busyKey === `artifact:create:${key}`} onClick={() => requestCreateArtifact(key)}>
                        {busyKey === `artifact:create:${key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                        New {blueprintMeta[key].label}
                      </button>
                    );
                  })}
                  <button type="button" className={menuItemClass()} onClick={() => { setMultiSelectMode(true); setMode("grid"); }}><Files className="h-4 w-4" />Select objects for context</button>
                </div>
              )}
            />
          </div>
        </div>
        {spectraSession.activeLocalThreadRunId ? (
          <RunDetailPanel
            runId={spectraSession.activeLocalThreadRunId}
            card={runEngine.cards.find((card) => card.runId === spectraSession.activeLocalThreadRunId)}
            onClose={spectraSession.clearActivePanel}
            onSaved={() => spectraSession.closeLocalThread(spectraSession.activeLocalThreadRunId!)}
            onUseThread={(id, title) => toggleContinuedThread(id, title, spectraSession.activeLocalThreadRunId ?? undefined)}
            onAction={(card, action, targetId) => void runEngine.onCardAction(card, action, targetId)}
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
  const selected = workspaces.find((workspace) => workspace._id === selectedWorkspaceId);
  return (
    <div>
      <button type="button" className={buttonClass()} onClick={(event) => { setAnchor(event.currentTarget.getBoundingClientRect()); setOpen((value) => !value); }}>
        <LayoutGrid className="h-4 w-4" />
        <span className="max-w-[150px] truncate">{selected?.title ?? "All workspaces"}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <FloatingMenu open={open} anchor={anchor} onClose={() => setOpen(false)} width={260}>
          <button type="button" className={menuItemClass()} onClick={() => { onSelect(""); setOpen(false); }}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[var(--bg-secondary)] text-[var(--text-secondary)]"><LayoutGrid className="h-3.5 w-3.5" /></span>
            <span className="min-w-0 flex-1 truncate">All workspaces</span>
            {!selectedWorkspaceId ? <CheckCircle2 className="h-4 w-4 text-[var(--success)]" /> : null}
          </button>
          {workspaces.map((workspace) => (
            <button key={workspace._id} type="button" className={menuItemClass()} onClick={() => { onSelect(workspace._id); setOpen(false); }}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[var(--bg-secondary)] text-[11px] font-semibold text-[var(--text-secondary)]">{initials(workspace.title)}</span>
              <span className="min-w-0 flex-1 truncate">{workspace.title}</span>
              {workspace._id === selectedWorkspaceId ? <CheckCircle2 className="h-4 w-4 text-[var(--success)]" /> : null}
            </button>
          ))}
      </FloatingMenu>
    </div>
  );
}

function GroupedList({
  inbox,
  groups,
  rowActions,
  onOpen,
}: {
  inbox: SpectraArtifact[];
  groups: Array<{ workspace: SpectraWorkspace; artifacts: SpectraArtifact[] }>;
  rowActions: (artifact: SpectraArtifact) => ReactNode;
  onOpen: (artifact: SpectraArtifact) => void;
}) {
  const [inboxExpanded, setInboxExpanded] = useState(false);
  return (
    <main className="mt-8">
      <section>
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">Unplaced</h2>
            <span className="rounded-[6px] bg-[var(--bg-secondary)] px-1.5 text-[12px] text-[var(--text-secondary)]">{inbox.length}</span>
          </div>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">Artifacts not yet placed in a workspace.</p>
        </div>
        <div className="grid gap-3 xl:grid-cols-3">
          {inbox.slice(0, inboxExpanded ? inbox.length : 6).map((artifact) => <ArtifactCard key={artifact._id} artifact={artifactToCard(artifact)} actions={rowActions(artifact)} onSelect={() => onOpen(artifact)} />)}
          {inbox.length === 0 ? <div className="rounded-[8px] border border-dashed border-[var(--border-default)] px-4 py-8 text-[13px] text-[var(--text-secondary)]">No unplaced artifacts in this scope.</div> : null}
        </div>
        {inbox.length > 6 ? <button type="button" className="mt-3 h-8 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={() => setInboxExpanded((value) => !value)}>{inboxExpanded ? "Show fewer" : `Show ${inbox.length - 6} more`}</button> : null}
      </section>
      <section className="mt-8 border-t border-[var(--border-default)] pt-7">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">In workspaces</h2>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">Artifacts that have been added to your workspaces.</p>
          </div>
          <span className="text-[12px] text-[var(--text-secondary)]">Sort: Recently updated <ChevronDown className="inline h-3 w-3" /></span>
        </div>
        <div className="space-y-4">
          {groups.filter((group) => group.artifacts.length > 0).map((group, index) => (
            <WorkspaceGroup key={group.workspace._id} workspace={group.workspace} artifacts={group.artifacts} index={index} rowActions={rowActions} onOpen={onOpen} />
          ))}
        </div>
      </section>
    </main>
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
    <section className="overflow-hidden rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)]">
      <div className="flex h-11 items-center justify-between border-b border-[var(--border-default)] px-4" style={{ background: accent.soft }}>
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
          <span className="h-2 w-2 rounded-full" style={{ background: accent.color }} />
          {workspace.title}
          <span className="rounded-[5px] bg-[color-mix(in_oklab,var(--bg-elevated)_70%,transparent)] px-1.5 text-[11px] text-[var(--text-secondary)]">{artifacts.length}</span>
        </div>
        <span className="text-[12px] text-[var(--text-secondary)]">View workspace <ExternalLink className="inline h-3 w-3" /></span>
      </div>
      {artifacts.slice(0, expanded ? artifacts.length : 6).map((artifact) => {
        const meta = blueprintMeta[artifact.blueprintKey];
        const Icon = meta.icon;
        return (
          <div
            key={artifact._id}
            className="grid min-h-[58px] cursor-pointer grid-cols-[minmax(260px,1.2fr)_minmax(130px,0.6fr)_minmax(130px,0.5fr)_auto] items-center gap-4 border-b border-[var(--border-default)] px-4 py-2.5 last:border-b-0 hover:bg-[var(--bg-hover)]"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(artifact)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(artifact);
              }
            }}
          >
            <div className="flex min-w-0 items-center gap-3">
              <Icon className="h-5 w-5 shrink-0" style={{ color: meta.color }} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{artifact.title}</div>
                <div className="text-[11px] text-[var(--text-secondary)]">{meta.label}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]"><span className="h-1.5 w-1.5 rounded-full" style={{ background: accent.color }} />{workspace.title}</div>
            <div className="text-[12px] text-[var(--text-secondary)]">Updated {formatRelativeTime(artifact.updatedAt)}</div>
            <div onClick={(event) => event.stopPropagation()}>{rowActions(artifact)}</div>
          </div>
        );
      })}
      {artifacts.length > 6 ? <button type="button" className="m-2 h-8 px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show fewer" : `Show ${artifacts.length - 6} more`}</button> : null}
    </section>
  );
}

function BoardColumns({
  groups,
  onOpen,
}: {
  groups: Array<{ workspace: SpectraWorkspace; artifacts: SpectraArtifact[] }>;
  onOpen: (artifact: SpectraArtifact) => void;
}) {
  const visibleGroups = groups.filter((group) => group.artifacts.length > 0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  return (
    <div className="mt-8 overflow-x-auto pb-6">
    <main
      className="grid gap-4 pr-2"
      style={{ gridTemplateColumns: `repeat(${Math.max(visibleGroups.length, 1)}, clamp(340px, 30vw, 430px))`, width: "max-content" }}
    >
      {visibleGroups.map((group, index) => {
        const accent = workspaceAccent(group.workspace, index);
        const expanded = expandedGroups.has(group.workspace._id);
        return (
          <section key={group.workspace._id} data-board-column={group.workspace._id} className="min-h-[620px] rounded-[12px] border p-3 shadow-[0_10px_28px_rgba(27,20,12,0.04)]" style={{ "--card-accent": accent.color, borderColor: accent.border, background: `color-mix(in oklab, ${accent.color} 3%, var(--bg-primary))` } as CSSProperties}>
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
                <span className="h-2 w-2 rounded-full" style={{ background: accent.color }} />
                {group.workspace.title}
                <span className="text-[12px] text-[var(--text-tertiary)]">{group.artifacts.length}</span>
              </div>
            </div>
            <div className="space-y-2.5">
              {group.artifacts.slice(0, expanded ? group.artifacts.length : 6).map((artifact) => {
                const card = artifactToCard(artifact);
                return <ArtifactCard key={artifact._id} artifact={card} quiet className="spectra-card--board" onSelect={() => onOpen(artifact)} />;
              })}
            </div>
            {group.artifacts.length > 6 ? <button type="button" className="mt-3 h-8 px-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={() => setExpandedGroups((current) => { const next = new Set(current); if (expanded) next.delete(group.workspace._id); else next.add(group.workspace._id); return next; })}>{expanded ? "Show fewer" : `Show ${group.artifacts.length - 6} more`}</button> : null}
          </section>
        );
      })}
    </main>
    </div>
  );
}

function ArtifactsSkeleton() {
  return (
    <div className="mt-8 space-y-7">
      <div className="grid gap-3 xl:grid-cols-3">
        {[0, 1, 2].map((item) => <div key={item} className="h-[116px] animate-pulse rounded-[8px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_74%,transparent)]" />)}
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-14 animate-pulse rounded-[8px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_70%,transparent)]" />)}
      </div>
    </div>
  );
}

function EmptyArtifactsState() {
  return (
    <div className="mt-10 flex min-h-[340px] items-center justify-center rounded-[8px] border border-dashed border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_42%,transparent)]">
      <div className="max-w-sm text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
          <Search className="h-4 w-4" />
        </div>
        <h2 className="mt-4 font-display text-[20px] font-semibold text-[var(--text-primary)]">No artifacts match</h2>
        <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">Adjust the search, type, or workspace scope.</p>
      </div>
    </div>
  );
}
