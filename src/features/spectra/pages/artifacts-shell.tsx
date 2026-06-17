"use client";

import {
  BookOpen,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  FileText,
  HelpCircle,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArtifactCard } from "../components/artifact-card";
import {
  getSpectraArtifacts,
  getSpectraOverview,
  postSpectra,
  toArtifactCardView,
  type SpectraArtifact,
  type SpectraBlueprintKey,
  type SpectraWorkspace,
} from "../data/api";

const filters: Array<{ key: "all" | SpectraBlueprintKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "document", label: "Docs" },
  { key: "flashcard_deck", label: "Decks" },
  { key: "quiz", label: "Quizzes" },
  { key: "planner_task", label: "Tasks" },
  { key: "thread_reference", label: "Threads" },
];

const createTypes: Array<{ key: Exclude<SpectraBlueprintKey, "thread_reference">; label: string; icon: LucideIcon }> = [
  { key: "document", label: "Document", icon: FileText },
  { key: "flashcard_deck", label: "Deck", icon: BookOpen },
  { key: "quiz", label: "Quiz", icon: HelpCircle },
  { key: "planner_task", label: "Task", icon: CalendarCheck2 },
];

function actionButtonClass(tone: "normal" | "primary" = "normal") {
  if (tone === "primary") {
    return "inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[var(--accent-cyan)] px-3 text-[13px] font-semibold text-white disabled:opacity-45";
  }
  return "inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45";
}

function menuItemClass() {
  return "flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-45";
}

function initials(title: string) {
  return title.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "W";
}

function WorkspaceTarget({
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
      <button type="button" className={actionButtonClass()} onClick={() => setOpen((value) => !value)}>
        <span className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-[var(--bg-secondary)] text-[10px] font-semibold text-[var(--text-secondary)]">
          {initials(selected?.title ?? "Workspace")}
        </span>
        <span className="max-w-[160px] truncate">{selected?.title ?? "Choose workspace"}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[260px] rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[0_6px_18px_rgba(0,0,0,0.10)]">
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
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[var(--bg-secondary)] text-[11px] font-semibold text-[var(--text-secondary)]">{initials(workspace.title)}</span>
              <span className="min-w-0 flex-1 truncate">{workspace.title}</span>
              {workspace._id === selectedWorkspaceId ? <CheckCircle2 className="h-4 w-4 text-[var(--accent-cyan)]" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ArtifactsShell() {
  const [artifacts, setArtifacts] = useState<SpectraArtifact[]>([]);
  const [workspaces, setWorkspaces] = useState<SpectraWorkspace[]>([]);
  const [activeFilter, setActiveFilter] = useState<"all" | SpectraBlueprintKey>("all");
  const [search, setSearch] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [newArtifactTitle, setNewArtifactTitle] = useState("");
  const [newArtifactType, setNewArtifactType] = useState<Exclude<SpectraBlueprintKey, "thread_reference">>("document");
  const [newOpen, setNewOpen] = useState(false);
  const [addMenuArtifactId, setAddMenuArtifactId] = useState<string | null>(null);
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
      setSelectedWorkspaceId((current) => current || overview.selectedWorkspaceId || overview.workspaces[0]?._id || "");
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
        // The load call handles auth/config failures. Seed is idempotent.
      }
      await load();
    })();
  }, [load]);

  useEffect(() => {
    if (!seededRef.current) return;
    const timeout = window.setTimeout(() => {
      void load();
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const inbox = useMemo(() => artifacts.filter((artifact) => artifact.placementStatus === "inbox"), [artifacts]);
  const placed = useMemo(() => artifacts.filter((artifact) => artifact.placementStatus === "workspace"), [artifacts]);

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
      await postSpectra({
        action: "addArtifactToWorkspace",
        artifactId,
        workspaceId,
      });
      const workspaceTitle = workspaces.find((workspace) => workspace._id === workspaceId)?.title ?? "workspace";
      toast.success(`Added to ${workspaceTitle}.`);
      setAddMenuArtifactId(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add artifact to workspace.");
    } finally {
      setBusyKey(null);
    }
  }

  function addAction(artifact: SpectraArtifact) {
    const alreadyInSelected = Boolean(selectedWorkspaceId && artifact.placements.some((placement) => placement.workspaceId === selectedWorkspaceId));
    if (alreadyInSelected) {
      return <span className="inline-flex h-8 items-center gap-1 rounded-[8px] bg-[var(--bg-secondary)] px-2 text-[12px] text-[var(--text-secondary)]"><CheckCircle2 className="h-3.5 w-3.5" />Placed</span>;
    }
    return (
      <div className="relative">
        <button type="button" className={actionButtonClass()} disabled={workspaces.length === 0 || busyKey === `add:${artifact._id}`} onClick={() => setAddMenuArtifactId((current) => current === artifact._id ? null : artifact._id)}>
          {busyKey === `add:${artifact._id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add
        </button>
        {addMenuArtifactId === artifact._id ? (
          <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[260px] rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[0_6px_18px_rgba(0,0,0,0.10)]">
            {workspaces.map((workspace) => {
              const alreadyPlaced = artifact.placements.some((placement) => placement.workspaceId === workspace._id);
              return (
                <button key={workspace._id} type="button" className={menuItemClass()} disabled={alreadyPlaced || busyKey === `add:${artifact._id}`} onClick={() => void addToWorkspace(artifact._id, workspace._id)}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[var(--bg-secondary)] text-[11px] font-semibold text-[var(--text-secondary)]">{initials(workspace.title)}</span>
                  <span className="min-w-0 flex-1 truncate">{workspace.title}</span>
                  {alreadyPlaced ? <CheckCircle2 className="h-4 w-4 text-[var(--accent-cyan)]" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  function renderArtifact(artifact: SpectraArtifact, selected = false) {
    return (
      <ArtifactCard
        key={artifact._id}
        artifact={toArtifactCardView(artifact)}
        selected={selected}
        actions={addAction(artifact)}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-[var(--bg-primary)]">
      <header className="border-b border-[var(--border-default)] px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-display text-[30px] font-semibold leading-tight text-[var(--text-primary)]">Artifacts</h1>
            <div className="mt-1 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <span>{artifacts.length} artifacts</span>
              <span>{inbox.length} inbox</span>
              <span>{placed.length} in workspaces</span>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-tertiary)]" /> : null}
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="relative w-[260px] max-w-full">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-9 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-9 pr-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                placeholder="Search artifacts"
              />
            </div>
            <WorkspaceTarget workspaces={workspaces} selectedWorkspaceId={selectedWorkspaceId} onSelect={setSelectedWorkspaceId} />
            <div className="relative">
              <button type="button" className={actionButtonClass("primary")} onClick={() => setNewOpen((open) => !open)}>
                <Plus className="h-4 w-4" />
                New
              </button>
              {newOpen ? (
                <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[320px] rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[0_6px_18px_rgba(0,0,0,0.10)]">
                  <div className="mb-2 flex flex-wrap gap-1">
                    {createTypes.map((type) => {
                      const Icon = type.icon;
                      return (
                        <button key={type.key} type="button" className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[12px] ${newArtifactType === type.key ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`} onClick={() => setNewArtifactType(type.key)}>
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
                    <button type="button" className={actionButtonClass()} disabled={!newArtifactTitle.trim() || busyKey === "artifact:create"} onClick={() => void createArtifact()}>
                      {busyKey === "artifact:create" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-1 border-t border-[var(--border-default)] pt-3">
          {filters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setActiveFilter(filter.key)}
              className={`h-8 rounded-[7px] px-2.5 text-[12px] font-medium ${
                activeFilter === filter.key ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </header>

      <main className="min-h-0 flex-1 px-6 py-5">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Inbox</h2>
            <span className="text-[12px] text-[var(--text-tertiary)]">{inbox.length}</span>
          </div>
          {inbox.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {inbox.map((artifact, index) => renderArtifact(artifact, index === 0))}
            </div>
          ) : (
            <div className="border-t border-[var(--border-default)] py-9 text-center text-[13px] text-[var(--text-secondary)]">
              No unplaced artifacts match this view.
            </div>
          )}
        </section>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">In workspaces</h2>
            <span className="text-[12px] text-[var(--text-tertiary)]">{placed.length}</span>
          </div>
          {placed.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {placed.map((artifact) => renderArtifact(artifact))}
            </div>
          ) : (
            <div className="border-t border-[var(--border-default)] py-9 text-center text-[13px] text-[var(--text-secondary)]">
              No workspace placements match this view.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
