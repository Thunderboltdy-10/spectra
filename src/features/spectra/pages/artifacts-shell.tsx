"use client";

import {
  BarChart3,
  BookOpen,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileText,
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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ArtifactCard, blueprintMeta } from "../components/artifact-card";
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
  postSpectra,
  type SpectraArtifact,
  type SpectraBlueprintKey,
  type SpectraWorkspace,
} from "../data/api";

type ArtifactMode = "list" | "board" | "grid";

const filters: Array<{ key: "all" | SpectraBlueprintKey; label: string; icon: LucideIcon }> = [
  { key: "all", label: "All", icon: LayoutGrid },
  { key: "document", label: "Documents", icon: FileText },
  { key: "flashcard_deck", label: "Decks", icon: BookOpen },
  { key: "quiz", label: "Quizzes", icon: HelpCircle },
  { key: "planner_task", label: "Tasks", icon: CalendarCheck2 },
  { key: "thread_reference", label: "Threads", icon: MessageSquare },
];

const createTypes: Array<{ key: Exclude<SpectraBlueprintKey, "thread_reference">; label: string; icon: LucideIcon }> = [
  { key: "document", label: "Document", icon: FileText },
  { key: "flashcard_deck", label: "Deck", icon: BookOpen },
  { key: "quiz", label: "Quiz", icon: HelpCircle },
  { key: "planner_task", label: "Task", icon: CalendarCheck2 },
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
        className={`flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-[8px] border text-[11px] font-medium transition ${
          !selectedWorkspaceId ? "border-transparent bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_2px_8px_rgba(27,20,12,0.06)]" : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
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
              className={`flex w-14 flex-col items-center gap-1 rounded-[8px] border px-1.5 py-2 text-[11px] font-medium transition ${
                selected ? "border-transparent bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_2px_8px_rgba(27,20,12,0.06)]" : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
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
  const [allArtifacts, setAllArtifacts] = useState<SpectraArtifact[]>([]);
  const [workspaces, setWorkspaces] = useState<SpectraWorkspace[]>([]);
  const [activeFilter, setActiveFilter] = useState<"all" | SpectraBlueprintKey>("all");
  const [mode, setMode] = useState<ArtifactMode>("list");
  const [search, setSearch] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [newArtifactTitle, setNewArtifactTitle] = useState("");
  const [newArtifactType, setNewArtifactType] = useState<Exclude<SpectraBlueprintKey, "thread_reference">>("document");
  const [newOpen, setNewOpen] = useState(false);
  const [addMenuArtifactId, setAddMenuArtifactId] = useState<string | null>(null);
  const [moveMenuArtifactId, setMoveMenuArtifactId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const seededRef = useRef(false);
  const newMenuRef = useOutsideClick<HTMLDivElement>(newOpen, () => setNewOpen(false));
  const placementMenuOpen = addMenuArtifactId !== null || moveMenuArtifactId !== null;
  const placementMenuRef = useOutsideClick<HTMLDivElement>(placementMenuOpen, () => {
    setAddMenuArtifactId(null);
    setMoveMenuArtifactId(null);
  });

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [artifactResult, overview] = await Promise.all([
        getSpectraArtifacts({
          placement: "all",
        }),
        getSpectraOverview(),
      ]);
      setAllArtifacts(artifactResult.artifacts);
      setWorkspaces(sortSpectraWorkspaces(overview.workspaces));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load artifacts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    void (async () => {
      try {
        await postSpectra({ action: "seed" });
      } catch {
        // Loading below handles auth/config failures. Seed is dev-only and idempotent.
      }
      await load();
    })();
  }, [load]);

  const artifacts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allArtifacts.filter((artifact) => {
      if (activeFilter !== "all" && artifact.blueprintKey !== activeFilter) return false;
      if (selectedWorkspaceId && !artifactPlacements(artifact).some((placement) => placement.workspaceId === selectedWorkspaceId)) return false;
      if (!needle) return true;
      return `${artifact.title}\n${artifact.summary ?? ""}\n${artifact.tags.join(" ")}`.toLowerCase().includes(needle);
    });
  }, [activeFilter, allArtifacts, search, selectedWorkspaceId]);
  const inbox = useMemo(() => artifacts.filter((artifact) => artifact.placementStatus === "inbox" || artifactPlacements(artifact).length === 0), [artifacts]);
  const placed = useMemo(() => artifacts.filter((artifact) => artifact.placementStatus === "workspace" || artifactPlacements(artifact).length > 0), [artifacts]);
  const byWorkspace = useMemo(() => workspaces.map((workspace) => ({
    workspace,
    artifacts: placed.filter((artifact) => artifactPlacements(artifact).some((placement) => placement.workspaceId === workspace._id)),
  })), [placed, workspaces]);

  async function createArtifact() {
    if (!newArtifactTitle.trim()) return;
    setBusyKey("artifact:create");
    try {
      await postSpectra({
        action: "createArtifact",
        blueprintKey: newArtifactType,
        title: newArtifactTitle,
        summary: `Unplaced ${newArtifactType.replaceAll("_", " ")} artifact.`,
      });
      setNewArtifactTitle("");
      setNewOpen(false);
      toast.success("Artifact created in library inbox.");
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create artifact.");
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
      <div className="relative" ref={menuOpen ? placementMenuRef : undefined}>
        <button type="button" className={buttonClass()} disabled={workspaces.length === 0 || busyKey === `add:${artifact._id}`} onClick={() => setMenu(menuOpen ? null : artifact._id)}>
          {busyKey === `add:${artifact._id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : variant === "add" ? <Plus className="h-3.5 w-3.5" /> : <PanelTop className="h-3.5 w-3.5" />}
          {variant === "add" ? "Add to workspace" : "Move"}
        </button>
        {menuOpen ? (
          <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[260px] rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[0_6px_18px_rgba(0,0,0,0.10)]">
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
          </div>
        ) : null}
      </div>
    );
  }

  function rowActions(artifact: SpectraArtifact) {
    const firstPlacement = artifactPlacements(artifact)[0];
    if (!firstPlacement) return placementMenu(artifact, "add");
    return (
      <div className="flex items-center gap-2">
        <button type="button" className={buttonClass()} title="Artifact details open in Wave 3; this placeholder is intentionally safe." disabled><ExternalLink className="h-3.5 w-3.5" />Open</button>
        {placementMenu(artifact, "move")}
        <button type="button" className="flex h-8 w-8 items-center justify-center rounded-[7px] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-elevated))] hover:text-[var(--danger)]" disabled={busyKey === `remove:${firstPlacement.workspaceItemId}`} onClick={() => void removePlacement(firstPlacement.workspaceItemId)}>
          {busyKey === `remove:${firstPlacement.workspaceItemId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-[radial-gradient(circle_at_32%_-12%,color-mix(in_oklab,var(--bg-elevated)_70%,transparent),transparent_34%),var(--bg-primary)]">
      <ArtifactsRail workspaces={workspaces} selectedWorkspaceId={selectedWorkspaceId} onSelect={setSelectedWorkspaceId} />
      <section className="min-w-0 flex-1 overflow-y-auto px-8 py-7">
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
                <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[5px] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">⌘ K</span>
              </div>
              <WorkspacePicker workspaces={workspaces} selectedWorkspaceId={selectedWorkspaceId} onSelect={setSelectedWorkspaceId} />
              <div className="relative" ref={newMenuRef}>
                <button type="button" className={buttonClass("dark")} onClick={() => setNewOpen((open) => !open)}>
                  <Plus className="h-4 w-4" />
                  New artifact
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {newOpen ? (
                  <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[320px] rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[0_6px_18px_rgba(0,0,0,0.10)]">
                    <div className="mb-2 flex flex-wrap gap-1">
                      {createTypes.map((type) => {
                        const Icon = type.icon;
                        return (
                          <button key={type.key} type="button" className={`inline-flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-[12px] ${newArtifactType === type.key ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`} onClick={() => setNewArtifactType(type.key)}>
                            <Icon className="h-3.5 w-3.5" />
                            {type.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={newArtifactTitle}
                        onChange={(event) => setNewArtifactTitle(event.target.value)}
                        placeholder="Artifact title"
                        className="h-9 min-w-0 flex-1 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-[13px] text-[var(--text-primary)] outline-none"
                      />
                      <button type="button" className={buttonClass()} disabled={!newArtifactTitle.trim() || busyKey === "artifact:create"} onClick={() => void createArtifact()}>
                        {busyKey === "artifact:create" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      </button>
                    </div>
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
        </header>
        {loading ? <ArtifactsSkeleton /> : null}
        {!loading && artifacts.length === 0 ? <EmptyArtifactsState /> : null}
        {!loading && mode === "list" ? <GroupedList inbox={inbox} groups={byWorkspace} rowActions={rowActions} /> : null}
        {!loading && mode === "board" ? <BoardColumns groups={byWorkspace} /> : null}
        {mode === "grid" ? (
          <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {!loading ? artifacts.map((artifact) => <ArtifactCard key={artifact._id} artifact={artifactToCard(artifact)} actions={rowActions(artifact)} />) : null}
          </div>
        ) : null}
      </section>
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
  const pickerRef = useOutsideClick<HTMLDivElement>(open, () => setOpen(false));
  const selected = workspaces.find((workspace) => workspace._id === selectedWorkspaceId);
  return (
    <div className="relative" ref={pickerRef}>
      <button type="button" className={buttonClass()} onClick={() => setOpen((value) => !value)}>
        <LayoutGrid className="h-4 w-4" />
        <span className="max-w-[150px] truncate">{selected?.title ?? "All workspaces"}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[260px] rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[0_6px_18px_rgba(0,0,0,0.10)]">
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
        </div>
      ) : null}
    </div>
  );
}

function GroupedList({
  inbox,
  groups,
  rowActions,
}: {
  inbox: SpectraArtifact[];
  groups: Array<{ workspace: SpectraWorkspace; artifacts: SpectraArtifact[] }>;
  rowActions: (artifact: SpectraArtifact) => ReactNode;
}) {
  return (
    <main className="mt-8">
      <section>
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">Inbox</h2>
            <span className="rounded-[6px] bg-[var(--bg-secondary)] px-1.5 text-[12px] text-[var(--text-secondary)]">{inbox.length}</span>
          </div>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">Artifacts not yet placed in a workspace.</p>
        </div>
        <div className="grid gap-3 xl:grid-cols-3">
          {inbox.slice(0, 3).map((artifact) => <ArtifactCard key={artifact._id} artifact={artifactToCard(artifact)} actions={rowActions(artifact)} />)}
          {inbox.length === 0 ? <div className="rounded-[8px] border border-dashed border-[var(--border-default)] px-4 py-8 text-[13px] text-[var(--text-secondary)]">Inbox is clear for this scope.</div> : null}
        </div>
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
            <WorkspaceGroup key={group.workspace._id} workspace={group.workspace} artifacts={group.artifacts} index={index} rowActions={rowActions} />
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
}: {
  workspace: SpectraWorkspace;
  artifacts: SpectraArtifact[];
  index: number;
  rowActions: (artifact: SpectraArtifact) => ReactNode;
}) {
  const accent = workspaceAccent(workspace, index);
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
      {artifacts.map((artifact) => {
        const meta = blueprintMeta[artifact.blueprintKey];
        const Icon = meta.icon;
        return (
          <div key={artifact._id} className="grid min-h-[58px] grid-cols-[minmax(260px,1.2fr)_minmax(130px,0.6fr)_minmax(130px,0.5fr)_auto] items-center gap-4 border-b border-[var(--border-default)] px-4 py-2.5 last:border-b-0">
            <div className="flex min-w-0 items-center gap-3">
              <Icon className="h-5 w-5 shrink-0" style={{ color: meta.color }} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{artifact.title}</div>
                <div className="text-[11px] text-[var(--text-secondary)]">{meta.label}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]"><span className="h-1.5 w-1.5 rounded-full" style={{ background: accent.color }} />{workspace.title}</div>
            <div className="text-[12px] text-[var(--text-secondary)]">Updated {formatRelativeTime(artifact.updatedAt)}</div>
            {rowActions(artifact)}
          </div>
        );
      })}
    </section>
  );
}

function BoardColumns({
  groups,
}: {
  groups: Array<{ workspace: SpectraWorkspace; artifacts: SpectraArtifact[] }>;
}) {
  const visibleGroups = groups.filter((group) => group.artifacts.length > 0);
  return (
    <main className="mt-8 grid min-w-[980px] grid-cols-5 gap-4 pb-6 pr-2">
      {visibleGroups.slice(0, 5).map((group, index) => {
        const accent = workspaceAccent(group.workspace, index);
        return (
          <section key={group.workspace._id} className="min-h-[620px] rounded-[10px] border p-2.5 shadow-[0_10px_28px_rgba(27,20,12,0.04)]" style={{ borderColor: accent.border, background: accent.soft }}>
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
                <span className="h-2 w-2 rounded-full" style={{ background: accent.color }} />
                {group.workspace.title}
                <span className="text-[12px] text-[var(--text-tertiary)]">{group.artifacts.length}</span>
              </div>
            </div>
            <div className="space-y-2.5">
              {group.artifacts.map((artifact) => {
                const card = artifactToCard(artifact);
                return <ArtifactCard key={artifact._id} artifact={card} quiet />;
              })}
            </div>
            <button type="button" className="mt-3 flex h-8 items-center gap-2 px-1 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]" disabled title="Use list or grid actions to place existing artifacts."><Plus className="h-4 w-4" />Add artifact</button>
          </section>
        );
      })}
    </main>
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
