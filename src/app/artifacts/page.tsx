"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Plus,
  Search,
  LayoutGrid,
  Clock,
  GitBranch,
  Layers,
  Filter,
  X,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { ARTIFACT_TYPES, ARTIFACT_TYPE_META, type ArtifactType } from "@/lib/artifact-types";
import { SectionsView } from "@/components/artifacts/sections-view";
import { TimelineView } from "@/components/artifacts/timeline-view";
import { CanvasView } from "@/components/artifacts/canvas-view";
import { GraphView } from "@/components/artifacts/graph-view";
import { CreateArtifactDialog } from "@/components/artifacts/create-artifact-dialog";
import { ArtifactEditor } from "@/components/artifacts/artifact-editor";
import type { ArtifactItem } from "@/components/artifacts/artifact-card";
import { cn } from "@/lib/utils";

type ViewMode = "sections" | "timeline" | "canvas" | "graph";

const VIEW_OPTIONS: { id: ViewMode; label: string; icon: typeof LayoutGrid }[] = [
  { id: "sections", label: "Sections", icon: LayoutGrid },
  { id: "timeline", label: "Timeline", icon: Clock },
  { id: "canvas", label: "Canvas", icon: Layers },
  { id: "graph", label: "Graph", icon: GitBranch },
];

type Stats = {
  total: number;
  pinned: number;
  archived: number;
  recentlyActive: number;
  byType: Record<string, number>;
};

function ArtifactsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL-driven state
  const typeFilter = searchParams.get("type") ?? undefined;
  const initialView = (searchParams.get("view") as ViewMode) ?? "sections";
  const openedArtifactId = searchParams.get("id") ?? null;

  const [view, setView] = useState<ViewMode>(initialView);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Data
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactItem | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch artifacts
  const loadArtifacts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set("type", typeFilter);
      if (showArchived) params.set("status", "all");
      if (search) params.set("search", search);

      const [artifactsRes, statsRes] = await Promise.all([
        fetch(`/api/artifacts?${params.toString()}`),
        fetch("/api/artifacts?action=stats"),
      ]);

      if (artifactsRes.ok) {
        const data = (await artifactsRes.json()) as { artifacts: ArtifactItem[] };
        setArtifacts(data.artifacts ?? []);
      }
      if (statsRes.ok) {
        const data = (await statsRes.json()) as { stats: Stats };
        setStats(data.stats ?? null);
      }
    } catch {
      toast.error("Failed to load artifacts");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, showArchived, search]);

  useEffect(() => {
    void loadArtifacts();
  }, [loadArtifacts]);

  // Load single artifact when id is in URL
  useEffect(() => {
    if (!openedArtifactId) {
      setSelectedArtifact(null);
      return;
    }
    async function loadArtifact() {
      try {
        const res = await fetch(`/api/artifacts?action=get&id=${openedArtifactId}`);
        if (res.ok) {
          const data = (await res.json()) as { artifact: ArtifactItem };
          setSelectedArtifact(data.artifact);
        }
      } catch {
        toast.error("Failed to load artifact");
      }
    }
    void loadArtifact();
  }, [openedArtifactId]);

  // Handlers
  function openArtifact(id: string) {
    router.push(`/artifacts?id=${id}`, { scroll: false });
  }

  function closeArtifact() {
    const params = new URLSearchParams();
    if (typeFilter) params.set("type", typeFilter);
    if (view !== "sections") params.set("view", view);
    const qs = params.toString();
    router.push(`/artifacts${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  async function handleCreate(type: ArtifactType, title: string, tags: string[]) {
    try {
      // Initialize content based on type
      let content: unknown = {};
      switch (type) {
        case "note": content = { text: "" }; break;
        case "study_plan": content = { description: "", milestones: [] }; break;
        case "flashcard_deck": content = { cards: [] }; break;
        case "timetable": content = { slots: [] }; break;
        case "bookmark": content = { note: "" }; break;
        case "code_project": content = { language: "javascript", code: "" }; break;
        case "image": content = { prompt: "" }; break;
        case "document": content = { body: "" }; break;
        case "diagram": content = {}; break;
        case "collection": content = { items: [] }; break;
      }

      const res = await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          type,
          title,
          content,
          tags: tags.length > 0 ? tags : undefined,
        }),
      });

      if (!res.ok) throw new Error("Create failed");
      const data = (await res.json()) as { artifactId: string };
      toast.success("Artifact created");
      void loadArtifacts();
      // Open the newly created artifact
      openArtifact(data.artifactId);
    } catch {
      toast.error("Failed to create artifact");
    }
  }

  async function handlePin(id: string) {
    try {
      await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "togglePin", artifactId: id }),
      });
      void loadArtifacts();
      // If we're viewing this artifact, reload it
      if (selectedArtifact && selectedArtifact._id === id) {
        const res = await fetch(`/api/artifacts?action=get&id=${id}`);
        if (res.ok) {
          const data = (await res.json()) as { artifact: ArtifactItem };
          setSelectedArtifact(data.artifact);
        }
      }
    } catch {
      toast.error("Failed to update pin");
    }
  }

  async function handleArchive(id: string) {
    try {
      const artifact = artifacts.find((a) => a._id === id);
      const action = artifact?.status === "archived" ? "restore" : "archive";
      await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, artifactId: id }),
      });
      toast.success(action === "archive" ? "Archived" : "Restored");
      void loadArtifacts();
      if (selectedArtifact && selectedArtifact._id === id) {
        closeArtifact();
      }
    } catch {
      toast.error("Failed to update artifact");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this artifact permanently?")) return;
    try {
      await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", artifactId: id }),
      });
      toast.success("Deleted");
      void loadArtifacts();
      if (selectedArtifact && selectedArtifact._id === id) {
        closeArtifact();
      }
    } catch {
      toast.error("Failed to delete");
    }
  }

  async function handleSave(updates: { title?: string; content?: unknown; tags?: string[] }) {
    if (!selectedArtifact) return;
    await fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        artifactId: selectedArtifact._id,
        ...updates,
      }),
    });
    void loadArtifacts();
    // Reload the artifact
    const res = await fetch(`/api/artifacts?action=get&id=${selectedArtifact._id}`);
    if (res.ok) {
      const data = (await res.json()) as { artifact: ArtifactItem };
      setSelectedArtifact(data.artifact);
    }
  }

  async function handleRestoreVersion(versionId: string) {
    if (!selectedArtifact) return;
    try {
      await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restoreVersion",
          artifactId: selectedArtifact._id,
          versionId,
        }),
      });
      toast.success("Version restored");
      // Reload artifact
      const res = await fetch(`/api/artifacts?action=get&id=${selectedArtifact._id}`);
      if (res.ok) {
        const data = (await res.json()) as { artifact: ArtifactItem };
        setSelectedArtifact(data.artifact);
      }
      void loadArtifacts();
    } catch {
      toast.error("Failed to restore version");
    }
  }

  function setTypeFilter(type: string | undefined) {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (view !== "sections") params.set("view", view);
    const qs = params.toString();
    router.push(`/artifacts${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  // If viewing a single artifact, show the editor
  if (selectedArtifact) {
    return (
      <AppShell fullBleed contentClassName="!p-0 h-screen">
        <ArtifactEditor
          artifact={selectedArtifact}
          onBack={closeArtifact}
          onSave={handleSave}
          onPin={() => handlePin(selectedArtifact._id)}
          onArchive={() => handleArchive(selectedArtifact._id)}
          onDelete={() => handleDelete(selectedArtifact._id)}
          onRestoreVersion={handleRestoreVersion}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Page header */}
      <div data-tour="artifacts-header" className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-[var(--text-primary)]">
          Artifacts
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Your living workspace — study plans, flashcards, notes, and everything you create.
        </p>
      </div>

      {/* Stats strip */}
      {stats && stats.total > 0 ? (
        <div className="mb-6 flex items-center divide-x divide-[var(--border-default)] border-b border-t border-[var(--border-default)] text-center">
          <div className="flex-1 px-4 py-3">
            <div className="font-display text-lg font-semibold text-[var(--text-primary)]">
              {stats.total}
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)]">Total</div>
          </div>
          <div className="flex-1 px-4 py-3">
            <div className="font-display text-lg font-semibold text-[var(--brand-primary)]">
              {stats.recentlyActive}
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)]">Active this week</div>
          </div>
          <div className="flex-1 px-4 py-3">
            <div className="font-display text-lg font-semibold text-[var(--text-primary)]">
              {stats.pinned}
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)]">Pinned</div>
          </div>
          <div className="flex-1 px-4 py-3">
            <div className="font-display text-lg font-semibold text-[var(--text-tertiary)]">
              {stats.archived}
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)]">Archived</div>
          </div>
        </div>
      ) : null}

      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search artifacts..."
            className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--brand-primary)] focus:outline-none"
          />
          {search ? (
            <button
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              onClick={() => setSearch("")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-1 rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-1 py-1">
          <button
            type="button"
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
              !typeFilter
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
            )}
            onClick={() => setTypeFilter(undefined)}
          >
            All
          </button>
          {ARTIFACT_TYPES.map((type) => {
            const meta = ARTIFACT_TYPE_META[type];
            const Icon = meta.icon;
            const isActive = typeFilter === type;
            const count = stats?.byType[type] ?? 0;
            if (count === 0 && !isActive) return null;
            return (
              <button
                key={type}
                type="button"
                className={cn(
                  "flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
                )}
                onClick={() => setTypeFilter(isActive ? undefined : type)}
                title={meta.label}
              >
                <Icon className="h-3 w-3" style={isActive ? { color: meta.color } : undefined} />
                <span className="hidden sm:inline">{meta.label}</span>
                {count > 0 ? (
                  <span className="text-[9px] text-[var(--text-tertiary)]">{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* View toggles */}
        <div className="flex items-center gap-0.5 rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-1">
          {VIEW_OPTIONS.map((opt) => {
            const VIcon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                className={cn(
                  "rounded-lg p-1.5 transition-colors",
                  view === opt.id
                    ? "bg-[var(--bg-elevated)] text-[var(--brand-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
                )}
                onClick={() => setView(opt.id)}
                title={opt.label}
              >
                <VIcon className="h-4 w-4" />
              </button>
            );
          })}
        </div>

        {/* Archive toggle */}
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-[var(--radius-input)] border px-3 py-2 text-xs",
            showArchived
              ? "border-[var(--brand-primary)] bg-[color-mix(in_oklab,var(--brand-primary)_8%,var(--bg-primary))] text-[var(--brand-primary)]"
              : "border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
          )}
          onClick={() => setShowArchived(!showArchived)}
        >
          <Filter className="h-3 w-3" />
          {showArchived ? "All" : "Active"}
        </button>

        {/* Refresh */}
        <button
          type="button"
          className="rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          onClick={() => {
            setLoading(true);
            void loadArtifacts();
          }}
          title="Refresh"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>

        {/* Create button */}
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-[var(--radius-input)] bg-[var(--brand-primary)] px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
          onClick={() => setShowCreateDialog(true)}
        >
          <Plus className="h-4 w-4" />
          New
        </button>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-sm text-[var(--text-tertiary)]">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--brand-primary)]" />
            Loading artifacts...
          </div>
        </div>
      ) : (
        <>
          {/* Views */}
          {view === "sections" && (
            <SectionsView
              artifacts={artifacts}
              onOpen={openArtifact}
              onPin={handlePin}
              onArchive={handleArchive}
              onDelete={handleDelete}
            />
          )}
          {view === "timeline" && (
            <TimelineView artifacts={artifacts} onOpen={openArtifact} />
          )}
          {view === "canvas" && (
            <CanvasView
              artifacts={artifacts}
              onOpen={openArtifact}
              onPin={handlePin}
              onArchive={handleArchive}
              onDelete={handleDelete}
            />
          )}
          {view === "graph" && (
            <GraphView artifacts={artifacts} onOpen={openArtifact} />
          )}
        </>
      )}

      {/* Create dialog */}
      <CreateArtifactDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreate}
      />
    </AppShell>
  );
}

export default function ArtifactsPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="flex items-center justify-center py-20">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--brand-primary)]" />
          </div>
        </AppShell>
      }
    >
      <ArtifactsContent />
    </Suspense>
  );
}
