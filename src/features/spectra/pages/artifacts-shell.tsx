"use client";

import {
  BookOpen,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  FileText,
  HelpCircle,
  Inbox,
  Layers3,
  Library,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArtifactCard, blueprintMeta } from "../components/artifact-card";
import {
  getSpectraArtifacts,
  getSpectraOverview,
  postSpectra,
  toArtifactCardView,
  type SpectraArtifact,
  type SpectraBlueprintKey,
  type SpectraWorkspace,
} from "../data/api";

const filters: Array<{ key: "all" | SpectraBlueprintKey; label: string; icon: LucideIcon }> = [
  { key: "all", label: "All", icon: Layers3 },
  { key: "document", label: "Document", icon: FileText },
  { key: "flashcard_deck", label: "Deck", icon: BookOpen },
  { key: "quiz", label: "Quiz", icon: HelpCircle },
  { key: "planner_task", label: "Task", icon: CalendarCheck2 },
  { key: "thread_reference", label: "Thread", icon: MessageSquare },
];

const createTypes: Array<{ key: Exclude<SpectraBlueprintKey, "thread_reference">; label: string; icon: LucideIcon }> = [
  { key: "document", label: "Document", icon: FileText },
  { key: "flashcard_deck", label: "Deck", icon: BookOpen },
  { key: "quiz", label: "Quiz", icon: HelpCircle },
  { key: "planner_task", label: "Task", icon: CalendarCheck2 },
];

function actionButtonClass(tone: "quiet" | "primary" = "quiet") {
  if (tone === "primary") {
    return "inline-flex h-10 items-center gap-1.5 rounded-[14px] bg-[var(--accent-cyan)] px-3 text-[13px] font-semibold text-white shadow-[0_14px_30px_-20px_rgba(8,22,40,0.45)] transition-[filter,transform] hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45";
  }
  return "inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[color-mix(in_oklab,var(--border-default)_82%,transparent)] bg-[var(--bg-elevated)] px-2.5 text-[11.5px] font-semibold text-[var(--text-secondary)] transition-[background,transform,color] hover:-translate-y-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-45";
}

function workspaceInitials(title: string) {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "S";
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
  const selected = workspaces.find((workspace) => workspace._id === selectedWorkspaceId) ?? workspaces[0];

  return (
    <div className="relative">
      <button
        type="button"
        className="flex h-10 min-w-[220px] items-center gap-2 rounded-[15px] border border-[color-mix(in_oklab,var(--border-default)_78%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_92%,var(--bg-primary))] px-3 text-left text-[12px] font-semibold text-[var(--text-primary)] shadow-[0_12px_28px_-24px_rgba(8,22,40,0.45)] transition-[border-color,transform] hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--accent-cyan)_32%,var(--border-default))]"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-[var(--accent-cyan)] text-[10px] font-bold text-white">
          {workspaceInitials(selected?.title ?? "Workspace")}
        </span>
        <span className="min-w-0 flex-1 truncate">{selected?.title ?? "Choose workspace"}</span>
        <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)]" />
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[300px] rounded-[22px] border border-[color-mix(in_oklab,var(--border-default)_80%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_96%,var(--bg-primary))] p-2 shadow-[0_26px_70px_-38px_rgba(8,22,40,0.68)] backdrop-blur-xl">
          <div className="max-h-[260px] space-y-1 overflow-y-auto">
            {workspaces.map((workspace) => {
              const active = workspace._id === selectedWorkspaceId;
              return (
                <button
                  key={workspace._id}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-[14px] px-2.5 py-2 text-left transition-colors ${
                    active ? "bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-secondary))]" : "hover:bg-[var(--bg-hover)]"
                  }`}
                  onClick={() => {
                    onSelect(workspace._id);
                    setOpen(false);
                  }}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] bg-[var(--accent-cyan)] text-[10px] font-bold text-white">
                    {workspaceInitials(workspace.title)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{workspace.title}</span>
                    <span className="block truncate text-[11px] text-[var(--text-tertiary)]">{workspace.description ?? "Active workspace"}</span>
                  </span>
                  {active ? <CheckCircle2 className="h-4 w-4 text-[var(--accent-cyan)]" /> : null}
                </button>
              );
            })}
          </div>
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
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pickerArtifactId, setPickerArtifactId] = useState<string | null>(null);
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
  const selectedWorkspace = workspaces.find((workspace) => workspace._id === selectedWorkspaceId);

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
      setPickerArtifactId(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add artifact to workspace.");
    } finally {
      setBusyKey(null);
    }
  }

  function renderAddAction(artifact: SpectraArtifact) {
    const alreadyInSelected = Boolean(selectedWorkspaceId && artifact.placements.some((placement) => placement.workspaceId === selectedWorkspaceId));
    const disabled = workspaces.length === 0 || busyKey === `add:${artifact._id}`;

    if (alreadyInSelected) {
      return (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[color-mix(in_oklab,var(--success)_10%,var(--bg-secondary))] px-2.5 text-[11.5px] font-semibold text-[var(--success)]">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Placed
        </span>
      );
    }

    return (
      <div className="relative">
        <button
          type="button"
          className={actionButtonClass()}
          disabled={disabled}
          onClick={() => setPickerArtifactId((current) => current === artifact._id ? null : artifact._id)}
        >
          {busyKey === `add:${artifact._id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add
        </button>
        {pickerArtifactId === artifact._id ? (
          <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[280px] rounded-[20px] border border-[color-mix(in_oklab,var(--border-default)_80%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_97%,var(--bg-primary))] p-2 shadow-[0_24px_64px_-38px_rgba(8,22,40,0.68)] backdrop-blur-xl">
            <div className="mb-1 px-2 py-1 text-[11px] font-semibold text-[var(--text-tertiary)]">Add to workspace</div>
            <div className="max-h-[220px] space-y-1 overflow-y-auto">
              {workspaces.map((workspace) => {
                const alreadyPlaced = artifact.placements.some((placement) => placement.workspaceId === workspace._id);
                return (
                  <button
                    key={workspace._id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-[13px] px-2 py-2 text-left transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={alreadyPlaced || busyKey === `add:${artifact._id}`}
                    onClick={() => void addToWorkspace(artifact._id, workspace._id)}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-[var(--accent-cyan)] text-[10px] font-bold text-white">
                      {workspaceInitials(workspace.title)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--text-primary)]">{workspace.title}</span>
                    {alreadyPlaced ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" /> : null}
                  </button>
                );
              })}
            </div>
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
        actions={renderAddAction(artifact)}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-[radial-gradient(circle_at_18%_0%,color-mix(in_oklab,var(--accent-cyan)_9%,transparent),transparent_32%),var(--bg-primary)]">
      <header className="px-5 pt-5 lg:px-6">
        <div className="rounded-b-[34px] rounded-t-[22px] border border-[color-mix(in_oklab,var(--border-default)_74%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_84%,var(--bg-primary))] px-4 py-4 shadow-[0_22px_70px_-54px_rgba(8,22,40,0.72)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[var(--text-tertiary)]">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-primary)]/70 px-2.5 py-1">
                  <Library className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
                  Artifact library
                </span>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              </div>
              <h1 className="font-display text-[28px] font-semibold leading-tight text-[var(--text-primary)]">Artifacts</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                <span>{artifacts.length} artifacts</span>
                <span className="h-1 w-1 rounded-full bg-[var(--border-default)]" />
                <span>{inbox.length} inbox</span>
                <span className="h-1 w-1 rounded-full bg-[var(--border-default)]" />
                <span>{placed.length} in workspaces</span>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative min-w-[260px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-10 w-full rounded-[15px] border border-[color-mix(in_oklab,var(--border-default)_78%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_92%,var(--bg-primary))] pl-9 pr-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,var(--accent-cyan)_55%,var(--border-default))]"
                  placeholder="Search artifacts"
                />
              </div>
              <WorkspacePicker workspaces={workspaces} selectedWorkspaceId={selectedWorkspaceId} onSelect={setSelectedWorkspaceId} />
            </div>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(400px,560px)]">
            <div className="flex gap-1 overflow-x-auto rounded-[18px] border border-[color-mix(in_oklab,var(--border-default)_74%,transparent)] bg-[var(--bg-primary)]/52 p-1">
              {filters.map((filter) => {
                const Icon = filter.icon;
                const active = activeFilter === filter.key;
                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setActiveFilter(filter.key)}
                    className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[13px] px-3 text-[12px] font-semibold transition-[background,color,transform] hover:-translate-y-0.5 ${
                      active ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_10px_24px_-20px_rgba(8,22,40,0.45)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {filter.label}
                  </button>
                );
              })}
            </div>

            <div className="rounded-[22px] border border-[color-mix(in_oklab,var(--border-default)_74%,transparent)] bg-[var(--bg-primary)]/52 p-2">
              <div className="mb-2 flex flex-wrap gap-1">
                {createTypes.map((type) => {
                  const Icon = type.icon;
                  const active = newArtifactType === type.key;
                  return (
                    <button
                      key={type.key}
                      type="button"
                      onClick={() => setNewArtifactType(type.key)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-[12px] px-2.5 text-[11.5px] font-semibold transition-colors ${
                        active ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {type.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex min-w-0 gap-2">
                <input
                  value={newArtifactTitle}
                  onChange={(event) => setNewArtifactTitle(event.target.value)}
                  placeholder={`New ${blueprintMeta[newArtifactType].shortLabel.toLowerCase()} title`}
                  className="h-10 min-w-0 flex-1 rounded-[15px] border border-[color-mix(in_oklab,var(--border-default)_78%,transparent)] bg-[var(--bg-elevated)] px-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,var(--accent-cyan)_55%,var(--border-default))]"
                />
                <button
                  type="button"
                  className={actionButtonClass("primary")}
                  disabled={!newArtifactTitle.trim() || busyKey === "artifact:create"}
                  onClick={() => void createArtifact()}
                >
                  {busyKey === "artifact:create" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  New
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 px-5 py-5 lg:px-6">
        <section className="rounded-[30px] border border-[color-mix(in_oklab,var(--border-default)_72%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_70%,var(--bg-primary))] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-primary)]">
                <Inbox className="h-4 w-4 text-[var(--accent-cyan)]" />
                Inbox
              </h2>
              <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">Unplaced artifacts ready for {selectedWorkspace?.title ?? "a workspace"}.</p>
            </div>
            <span className="rounded-full bg-[var(--bg-primary)]/70 px-2.5 py-1 text-[11px] font-semibold text-[var(--text-tertiary)]">{inbox.length}</span>
          </div>
          {inbox.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {inbox.map((artifact, index) => renderArtifact(artifact, index === 0))}
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-[color-mix(in_oklab,var(--border-default)_74%,transparent)] bg-[var(--bg-primary)]/45 px-4 py-8 text-center text-[13px] text-[var(--text-secondary)]">
              No inbox artifacts match this view.
            </div>
          )}
        </section>

        <section className="mt-5 rounded-[30px] border border-[color-mix(in_oklab,var(--border-default)_72%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_70%,var(--bg-primary))] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-primary)]">
                <Sparkles className="h-4 w-4 text-[var(--accent-cyan)]" />
                In workspaces
              </h2>
              <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">Already placed artifacts stay connected to the library.</p>
            </div>
            <span className="rounded-full bg-[var(--bg-primary)]/70 px-2.5 py-1 text-[11px] font-semibold text-[var(--text-tertiary)]">{placed.length}</span>
          </div>
          {placed.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {placed.map((artifact) => renderArtifact(artifact))}
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-[color-mix(in_oklab,var(--border-default)_74%,transparent)] bg-[var(--bg-primary)]/45 px-4 py-8 text-center text-[13px] text-[var(--text-secondary)]">
              No workspace placements match this view.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
