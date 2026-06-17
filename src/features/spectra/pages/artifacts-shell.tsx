"use client";

import { BookOpen, CalendarCheck2, FileText, HelpCircle, Loader2, Plus, Search } from "lucide-react";
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
  { key: "document", label: "Document" },
  { key: "flashcard_deck", label: "Deck" },
  { key: "quiz", label: "Quiz" },
  { key: "planner_task", label: "Task" },
  { key: "thread_reference", label: "Thread" },
];

const createTypes: Array<{ key: Exclude<SpectraBlueprintKey, "thread_reference">; label: string; icon: typeof FileText }> = [
  { key: "document", label: "Document", icon: FileText },
  { key: "flashcard_deck", label: "Deck", icon: BookOpen },
  { key: "quiz", label: "Quiz", icon: HelpCircle },
  { key: "planner_task", label: "Task", icon: CalendarCheck2 },
];

function actionButtonClass(tone: "quiet" | "primary" = "quiet") {
  if (tone === "primary") {
    return "inline-flex h-10 items-center gap-1.5 rounded-[8px] bg-[var(--accent-cyan)] px-3 text-[13px] font-semibold text-white transition-[filter,transform] hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45";
  }
  return "inline-flex h-7 items-center gap-1 rounded-[6px] border border-[var(--border-default)] px-2 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-45";
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
      toast.success("Artifact created in library inbox.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create artifact.");
    } finally {
      setBusyKey(null);
    }
  }

  async function addToWorkspace(artifactId: string) {
    if (!selectedWorkspaceId) return;
    setBusyKey(`add:${artifactId}`);
    try {
      await postSpectra({
        action: "addArtifactToWorkspace",
        artifactId,
        workspaceId: selectedWorkspaceId,
      });
      const workspaceTitle = workspaces.find((workspace) => workspace._id === selectedWorkspaceId)?.title ?? "workspace";
      toast.success(`Added to ${workspaceTitle}.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add artifact to workspace.");
    } finally {
      setBusyKey(null);
    }
  }

  function renderArtifact(artifact: SpectraArtifact, selected = false) {
    const canAdd = workspaces.length > 0 && !artifact.placements.some((placement) => placement.workspaceId === selectedWorkspaceId);
    return (
      <ArtifactCard
        key={artifact._id}
        artifact={toArtifactCardView(artifact)}
        selected={selected}
        actions={(
          <button
            type="button"
            className={actionButtonClass()}
            disabled={!canAdd || busyKey === `add:${artifact._id}`}
            onClick={() => void addToWorkspace(artifact._id)}
          >
            {busyKey === `add:${artifact._id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Add
          </button>
        )}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-[var(--bg-primary)]">
      <header className="border-b border-[var(--border-default)] px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-[22px] font-semibold text-[var(--text-primary)]">Artifacts</h1>
            <div className="mt-1 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <span>{artifacts.length} artifacts</span>
              <span className="h-1 w-1 rounded-full bg-[var(--border-default)]" />
              <span>{inbox.length} inbox</span>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-tertiary)]" /> : null}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-[240px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-9 pr-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,var(--accent-cyan)_55%,var(--border-default))]"
                placeholder="Search artifacts"
              />
            </div>
            <select
              value={selectedWorkspaceId}
              onChange={(event) => setSelectedWorkspaceId(event.target.value)}
              className="h-10 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 text-[13px] font-medium text-[var(--text-primary)] outline-none"
            >
              {workspaces.map((workspace) => (
                <option key={workspace._id} value={workspace._id}>{workspace.title}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(360px,520px)]">
          <div className="flex gap-1 overflow-x-auto rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1">
            {filters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setActiveFilter(filter.key)}
                className={`h-8 shrink-0 rounded-[6px] px-3 text-[12px] font-medium transition-colors ${
                  activeFilter === filter.key
                    ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="flex min-w-0 gap-2 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5">
            <select
              value={newArtifactType}
              onChange={(event) => setNewArtifactType(event.target.value as Exclude<SpectraBlueprintKey, "thread_reference">)}
              className="h-9 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-[12px] font-medium text-[var(--text-primary)] outline-none"
            >
              {createTypes.map((type) => (
                <option key={type.key} value={type.key}>{type.label}</option>
              ))}
            </select>
            <input
              value={newArtifactTitle}
              onChange={(event) => setNewArtifactTitle(event.target.value)}
              placeholder="New artifact title"
              className="h-9 min-w-0 flex-1 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
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
      </header>

      <main className="min-h-0 flex-1 px-6 py-5">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-[var(--text-secondary)]">Inbox</h2>
            <span className="text-[12px] text-[var(--text-tertiary)]">{inbox.length}</span>
          </div>
          {inbox.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {inbox.map((artifact, index) => renderArtifact(artifact, index === 0))}
            </div>
          ) : (
            <div className="rounded-[8px] border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-7 text-center text-[13px] text-[var(--text-secondary)]">
              No unplaced artifacts match this view.
            </div>
          )}
        </section>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-[var(--text-secondary)]">In workspaces</h2>
            <span className="text-[12px] text-[var(--text-tertiary)]">{placed.length}</span>
          </div>
          {placed.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {placed.map((artifact) => renderArtifact(artifact))}
            </div>
          ) : (
            <div className="rounded-[8px] border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-7 text-center text-[13px] text-[var(--text-secondary)]">
              No workspace placements match this view.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
