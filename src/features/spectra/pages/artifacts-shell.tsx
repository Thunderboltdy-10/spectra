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
  Home,
  LayoutGrid,
  List,
  Loader2,
  MessageSquare,
  MoreHorizontal,
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
  artifactToCard,
  formatRelativeTime,
  initials,
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

function ArtifactsRail({ workspaces }: { workspaces: SpectraWorkspace[] }) {
  return (
    <aside className="flex w-[74px] shrink-0 flex-col items-center border-r border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-primary)_84%,var(--bg-elevated))] px-2.5 py-5">
      <button type="button" className="flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[11px] font-medium text-[var(--text-primary)] shadow-[0_2px_8px_rgba(27,20,12,0.05)]">
        <Home className="h-4 w-4" />
        Home
      </button>
      <div className="mt-4 flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto">
        {workspaces.map((workspace, index) => {
          const accent = workspaceAccent(workspace, index);
          const Icon = iconForWorkspace(workspace, index);
          return (
            <div key={workspace._id} className="flex w-14 flex-col items-center gap-1 rounded-[8px] px-1.5 py-2 text-[11px] font-medium text-[var(--text-secondary)]">
              <span className="flex h-9 w-9 items-center justify-center rounded-[8px] text-white" style={{ background: accent.color }}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="max-w-full truncate">{workspace.title}</span>
            </div>
          );
        })}
      </div>
      <button type="button" className="mt-3 flex h-10 w-10 items-center justify-center rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
        <Plus className="h-4 w-4" />
      </button>
    </aside>
  );
}

export function ArtifactsShell() {
  const [artifacts, setArtifacts] = useState<SpectraArtifact[]>([]);
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [artifactResult, overview] = await Promise.all([
        getSpectraArtifacts({
          placement: "all",
          blueprintKey: activeFilter,
          search,
        }),
        getSpectraOverview(),
      ]);
      setArtifacts(artifactResult.artifacts);
      setWorkspaces(overview.workspaces);
      setSelectedWorkspaceId((current) => current || overview.workspaces[0]?._id || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load artifacts.");
    } finally {
      setLoading(false);
    }
  }, [activeFilter, search]);

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

  useEffect(() => {
    if (!seededRef.current) return;
    const timeout = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const inbox = useMemo(() => artifacts.filter((artifact) => artifact.placementStatus === "inbox"), [artifacts]);
  const placed = useMemo(() => artifacts.filter((artifact) => artifact.placementStatus === "workspace"), [artifacts]);
  const byWorkspace = useMemo(() => workspaces.map((workspace) => ({
    workspace,
    artifacts: placed.filter((artifact) => artifact.placements.some((placement) => placement.workspaceId === workspace._id)),
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
      await load();
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
      await load();
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
      await load();
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
      <div className="relative">
        <button type="button" className={buttonClass()} disabled={workspaces.length === 0 || busyKey === `add:${artifact._id}`} onClick={() => setMenu(menuOpen ? null : artifact._id)}>
          {busyKey === `add:${artifact._id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : variant === "add" ? <Plus className="h-3.5 w-3.5" /> : <PanelTop className="h-3.5 w-3.5" />}
          {variant === "add" ? "Add to workspace" : "Move"}
        </button>
        {menuOpen ? (
          <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[260px] rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[0_6px_18px_rgba(0,0,0,0.10)]">
            {workspaces.map((workspace) => {
              const alreadyPlaced = artifact.placements.some((placement) => placement.workspaceId === workspace._id);
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
    const firstPlacement = artifact.placements[0];
    if (!firstPlacement) return placementMenu(artifact, "add");
    return (
      <div className="flex items-center gap-2">
        <button type="button" className={buttonClass()}><ExternalLink className="h-3.5 w-3.5" />Open</button>
        {placementMenu(artifact, "move")}
        <button type="button" className="flex h-8 w-8 items-center justify-center rounded-[7px] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-elevated))] hover:text-[var(--danger)]" disabled={busyKey === `remove:${firstPlacement.workspaceItemId}`} onClick={() => void removePlacement(firstPlacement.workspaceItemId)}>
          {busyKey === `remove:${firstPlacement.workspaceItemId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
        <button type="button" className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><MoreHorizontal className="h-4 w-4" /></button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-[var(--bg-primary)]">
      <ArtifactsRail workspaces={workspaces} />
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
              <div className="relative">
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
                    className={`inline-flex h-9 items-center gap-2 rounded-[7px] border px-3 text-[13px] font-medium ${
                      activeFilter === filter.key ? "border-[var(--text-primary)] bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {filter.label}
                  </button>
                );
              })}
            </div>
            <div className="flex rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1">
              {[
                { key: "grid" as const, label: "Grid", icon: Grid2X2 },
                { key: "list" as const, label: "List", icon: List },
                { key: "board" as const, label: "Board", icon: PanelTop },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.key} type="button" className={`inline-flex h-8 items-center gap-2 rounded-[6px] px-3 text-[12px] font-medium ${mode === item.key ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(27,20,12,0.06)]" : "text-[var(--text-secondary)]"}`} onClick={() => setMode(item.key)}>
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </header>
        {loading ? <div className="py-8 text-[13px] text-[var(--text-secondary)]">Loading artifacts...</div> : null}
        {mode === "list" ? <GroupedList inbox={inbox} groups={byWorkspace} rowActions={rowActions} /> : null}
        {mode === "board" ? <BoardColumns groups={byWorkspace} rowActions={rowActions} /> : null}
        {mode === "grid" ? (
          <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {artifacts.map((artifact) => <ArtifactCard key={artifact._id} artifact={artifactToCard(artifact)} actions={rowActions(artifact)} />)}
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
  const selected = workspaces.find((workspace) => workspace._id === selectedWorkspaceId);
  return (
    <div className="relative">
      <button type="button" className={buttonClass()} onClick={() => setOpen((value) => !value)}>
        <LayoutGrid className="h-4 w-4" />
        <span className="max-w-[150px] truncate">{selected?.title ?? "All workspaces"}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[260px] rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[0_6px_18px_rgba(0,0,0,0.10)]">
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
        </div>
      </section>
      <section className="mt-8 border-t border-[var(--border-default)] pt-7">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">In workspaces</h2>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">Artifacts that have been added to your workspaces.</p>
          </div>
          <button type="button" className="text-[12px] text-[var(--text-secondary)]">Sort: Recently updated <ChevronDown className="inline h-3 w-3" /></button>
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
        <button type="button" className="text-[12px] text-[var(--text-secondary)]">View workspace <ExternalLink className="inline h-3 w-3" /></button>
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
  rowActions,
}: {
  groups: Array<{ workspace: SpectraWorkspace; artifacts: SpectraArtifact[] }>;
  rowActions: (artifact: SpectraArtifact) => ReactNode;
}) {
  return (
    <main className="mt-8 flex gap-4 overflow-x-auto pb-6">
      {groups.filter((group) => group.artifacts.length > 0).map((group, index) => {
        const accent = workspaceAccent(group.workspace, index);
        return (
          <section key={group.workspace._id} className="w-[270px] shrink-0 rounded-[9px] border p-2.5" style={{ borderColor: accent.border, background: accent.soft }}>
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
                <span className="h-2 w-2 rounded-full" style={{ background: accent.color }} />
                {group.workspace.title}
                <span className="text-[12px] text-[var(--text-tertiary)]">{group.artifacts.length}</span>
              </div>
              <MoreHorizontal className="h-4 w-4 text-[var(--text-secondary)]" />
            </div>
            <div className="space-y-2.5">
              {group.artifacts.map((artifact) => {
                const card = artifactToCard(artifact);
                return <ArtifactCard key={artifact._id} artifact={card} actions={rowActions(artifact)} quiet />;
              })}
            </div>
            <button type="button" className="mt-3 flex h-8 items-center gap-2 px-1 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><Plus className="h-4 w-4" />Add artifact</button>
          </section>
        );
      })}
    </main>
  );
}
