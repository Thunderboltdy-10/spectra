"use client";

import {
  BookOpen,
  CalendarCheck2,
  FileText,
  HelpCircle,
  Home,
  LayoutGrid,
  Library,
  Loader2,
  Plus,
  Rows3,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArtifactCard, blueprintMeta } from "../components/artifact-card";
import { CommandBar } from "../components/command-bar";
import { ResultCardStack, type ResultCardView } from "../components/result-card";
import {
  getSpectraOverview,
  postSpectra,
  workspaceItemToArtifactCardView,
  type SpectraBlueprintKey,
  type SpectraOverview,
  type SpectraWorkspace,
  type SpectraWorkspaceItem,
} from "../data/api";

type ViewMode = "cards" | "timeline" | "library";

const createTypes: Array<{ key: Exclude<SpectraBlueprintKey, "thread_reference">; label: string; icon: LucideIcon }> = [
  { key: "document", label: "Document", icon: FileText },
  { key: "flashcard_deck", label: "Deck", icon: BookOpen },
  { key: "quiz", label: "Quiz", icon: HelpCircle },
  { key: "planner_task", label: "Task", icon: CalendarCheck2 },
];

const viewModes: Array<{ key: ViewMode; label: string; icon: LucideIcon }> = [
  { key: "cards", label: "Cards", icon: LayoutGrid },
  { key: "timeline", label: "Timeline", icon: Rows3 },
  { key: "library", label: "Library", icon: Library },
];

function formatCount(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function initials(title: string) {
  return title.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "W";
}

function workspaceColor(index: number) {
  const colors = ["var(--mode-document)", "var(--mode-quiz)", "var(--mode-flashcard)", "var(--accent-coral)", "var(--mode-research)"];
  return colors[index % colors.length];
}

function smallButtonClass(tone: "normal" | "danger" = "normal") {
  if (tone === "danger") {
    return "inline-flex h-7 items-center gap-1 rounded-[7px] border border-[color-mix(in_oklab,var(--danger)_35%,var(--border-default))] px-2 text-[11px] font-medium text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-elevated))] disabled:opacity-45";
  }
  return "inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45";
}

function actionMenuItemClass() {
  return "flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-45";
}

function WorkspaceRail({
  workspaces,
  selectedWorkspaceId,
  onHome,
  onSelect,
  onCreate,
  createOpen,
  setCreateOpen,
  title,
  setTitle,
  busy,
}: {
  workspaces: SpectraWorkspace[];
  selectedWorkspaceId?: string;
  onHome: () => void;
  onSelect: (workspaceId: string) => void;
  onCreate: () => void;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  title: string;
  setTitle: (title: string) => void;
  busy: boolean;
}) {
  return (
    <aside className="relative flex w-[62px] shrink-0 flex-col items-center border-r border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-4">
      <button
        type="button"
        className={`flex h-10 w-10 items-center justify-center rounded-[10px] border text-[var(--text-secondary)] ${
          !selectedWorkspaceId ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-elevated))] text-[var(--accent-cyan)]" : "border-transparent hover:bg-[var(--bg-hover)]"
        }`}
        onClick={onHome}
        aria-label="Workspace Home"
        title="Workspace Home"
      >
        <Home className="h-4 w-4" />
      </button>
      <div className="my-3 h-px w-7 bg-[var(--border-default)]" />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto">
        {workspaces.map((workspace, index) => {
          const selected = workspace._id === selectedWorkspaceId;
          return (
            <button
              key={workspace._id}
              type="button"
              className={`flex h-10 w-10 items-center justify-center rounded-[10px] border text-[11px] font-semibold ${
                selected ? "border-[var(--accent-cyan)] bg-[var(--bg-elevated)]" : "border-transparent hover:bg-[var(--bg-hover)]"
              }`}
              style={{ color: workspaceColor(index) }}
              onClick={() => onSelect(workspace._id)}
              aria-label={`Open ${workspace.title}`}
              title={workspace.title}
            >
              {initials(workspace.title)}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="mt-3 flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        onClick={() => setCreateOpen(!createOpen)}
        aria-label="Create workspace"
        title="Create workspace"
      >
        <Plus className="h-4 w-4" />
      </button>
      {createOpen ? (
        <div className="absolute bottom-4 left-[56px] z-30 w-[260px] rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[0_6px_18px_rgba(0,0,0,0.10)]">
          <label className="block text-[12px] font-medium text-[var(--text-secondary)]" htmlFor="new-workspace-title">New workspace</label>
          <div className="mt-2 flex gap-2">
            <input
              id="new-workspace-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Subject or project"
              className="h-9 min-w-0 flex-1 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-[13px] text-[var(--text-primary)] outline-none"
            />
            <button type="button" className={smallButtonClass()} disabled={!title.trim() || busy} onClick={onCreate}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function WorkspaceHome({
  overview,
  openWorkspace,
}: {
  overview: SpectraOverview | null;
  openWorkspace: (workspaceId: string) => void;
}) {
  const workspaces = overview?.workspaces ?? [];
  const artifacts = overview?.artifacts ?? [];

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <h1 className="font-display text-[32px] font-semibold leading-tight text-[var(--text-primary)]">Workspace Home</h1>
          <p className="mt-2 text-[15px] leading-6 text-[var(--text-secondary)]">
            Choose the subject or project you want to work in. Nothing opens until you pick it.
          </p>
        </div>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Recent workspaces</h2>
            <span className="text-[12px] text-[var(--text-tertiary)]">{formatCount(workspaces.length, "workspace")}</span>
          </div>
          {workspaces.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {workspaces.map((workspace, index) => {
                const count = artifacts.filter((artifact) => artifact.placements.some((placement) => placement.workspaceId === workspace._id)).length;
                return (
                  <button
                    key={workspace._id}
                    type="button"
                    className="group relative rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-left hover:border-[color-mix(in_oklab,var(--accent-cyan)_32%,var(--border-default))]"
                    onClick={() => openWorkspace(workspace._id)}
                  >
                    <div className="absolute inset-y-4 left-0 w-[3px] rounded-r-full" style={{ background: workspaceColor(index) }} />
                    <div className="flex items-start gap-3 pl-1">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[var(--bg-secondary)] text-[12px] font-semibold" style={{ color: workspaceColor(index) }}>
                        {initials(workspace.title)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[15px] font-semibold text-[var(--text-primary)]">{workspace.title}</h3>
                        <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--text-secondary)]">{workspace.description ?? "School workspace"}</p>
                        <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
                          <span>{formatCount(count, "artifact")}</span>
                          <span>Updated {formatDate(workspace.lastActivityAt)}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="border-t border-[var(--border-default)] py-10 text-[14px] text-[var(--text-secondary)]">
              No workspaces yet. Use the plus button in the rail to create one.
            </div>
          )}
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <h2 className="mb-3 text-[15px] font-semibold text-[var(--text-primary)]">Library inbox</h2>
            <div className="space-y-2">
              {artifacts.filter((artifact) => artifact.placementStatus === "inbox").slice(0, 5).map((artifact) => (
                <div key={artifact._id} className="flex items-center justify-between border-t border-[var(--border-default)] py-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{artifact.title}</div>
                    <div className="truncate text-[12px] text-[var(--text-secondary)]">{artifact.summary ?? "No summary yet."}</div>
                  </div>
                  <span className="ml-3 text-[11px] text-[var(--text-tertiary)]">{blueprintMeta[artifact.blueprintKey].label}</span>
                </div>
              ))}
              {artifacts.filter((artifact) => artifact.placementStatus === "inbox").length === 0 ? (
                <div className="border-t border-[var(--border-default)] py-8 text-[13px] text-[var(--text-secondary)]">No inbox artifacts.</div>
              ) : null}
            </div>
          </div>
          <div className="border-l border-[var(--border-default)] pl-5">
            <h2 className="mb-3 text-[15px] font-semibold text-[var(--text-primary)]">Recent activity</h2>
            <div className="space-y-3">
              {(overview?.runs ?? []).slice(0, 4).map((run) => (
                <div key={run._id}>
                  <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">{run.userPrompt}</div>
                  <div className="mt-0.5 text-[11px] capitalize text-[var(--text-tertiary)]">{run.status}</div>
                </div>
              ))}
              {(overview?.runs.length ?? 0) === 0 ? <div className="text-[13px] text-[var(--text-secondary)]">No recent runs.</div> : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export function WorkspaceShell() {
  const [overview, setOverview] = useState<SpectraOverview | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [workspaceTitle, setWorkspaceTitle] = useState("");
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const seededRef = useRef(false);

  const load = useCallback(async (workspaceId?: string) => {
    setLoading(true);
    try {
      const next = await getSpectraOverview(workspaceId);
      setOverview(next);
      setSelectedWorkspaceId(workspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Spectra workspace.");
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
        // Loading below will surface auth/config errors. Seed is best-effort and idempotent.
      }
      await load();
    })();
  }, [load]);

  const workspace = selectedWorkspaceId ? overview?.workspace?.workspace ?? null : null;
  const artifactCards = useMemo(
    () => selectedWorkspaceId
      ? (overview?.workspace?.items ?? [])
        .map((item) => ({ item, card: workspaceItemToArtifactCardView(item) }))
        .filter((entry): entry is { item: SpectraWorkspaceItem; card: NonNullable<ReturnType<typeof workspaceItemToArtifactCardView>> } => Boolean(entry.card))
      : [],
    [overview?.workspace?.items, selectedWorkspaceId],
  );
  const selectedEntry = artifactCards.find((entry) => entry.item._id === selectedItemId) ?? null;
  const recentRunCards: ResultCardView[] = (overview?.runs ?? []).slice(0, 3).map((run) => ({
    id: run._id,
    status: run.status,
    title: run.status === "completed" ? "Completed" : run.status === "failed" ? "Failed" : "Running",
    summary: run.finalSummary ?? run.error ?? run.userPrompt,
  }));

  async function createWorkspace() {
    if (!workspaceTitle.trim()) return;
    setBusyKey("workspace:create");
    try {
      const result = await postSpectra<{ workspaceId: string }>({
        action: "createWorkspace",
        title: workspaceTitle,
        description: "New school workspace.",
      });
      setWorkspaceTitle("");
      setCreateWorkspaceOpen(false);
      toast.success("Workspace created.");
      await load(result.workspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create workspace.");
    } finally {
      setBusyKey(null);
    }
  }

  async function createArtifact(blueprintKey: Exclude<SpectraBlueprintKey, "thread_reference">) {
    if (!selectedWorkspaceId) return;
    const label = createTypes.find((type) => type.key === blueprintKey)?.label ?? "Artifact";
    setBusyKey(`artifact:${blueprintKey}`);
    try {
      await postSpectra({
        action: "createArtifact",
        blueprintKey,
        title: `New ${label}`,
        summary: `Workspace-created ${label.toLowerCase()} artifact.`,
        workspaceId: selectedWorkspaceId,
      });
      toast.success(`${label} created in workspace.`);
      await load(selectedWorkspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not create ${label.toLowerCase()}.`);
    } finally {
      setBusyKey(null);
    }
  }

  async function hideWorkspaceItem(workspaceItemId: string) {
    setBusyKey(`hide:${workspaceItemId}`);
    try {
      const result = await postSpectra<{ artifactStillExists: boolean }>({
        action: "hideWorkspaceItem",
        workspaceItemId,
      });
      toast.success(result.artifactStillExists ? "Removed from workspace. Artifact remains in library." : "Removed from workspace.");
      setSelectedItemId((current) => current === workspaceItemId ? null : current);
      await load(selectedWorkspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove workspace card.");
    } finally {
      setBusyKey(null);
    }
  }

  function renderCards() {
    if (artifactCards.length === 0) {
      return <div className="border-t border-[var(--border-default)] py-12 text-center text-[13px] text-[var(--text-secondary)]">No cards in this workspace yet.</div>;
    }
    return (
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {artifactCards.map(({ item, card }) => (
          <ArtifactCard
            key={item._id}
            artifact={card}
            selected={item._id === selectedItemId}
            onSelect={() => setSelectedItemId(item._id)}
            actions={(
              <button type="button" className={smallButtonClass("danger")} disabled={busyKey === `hide:${item._id}`} onClick={() => void hideWorkspaceItem(item._id)}>
                {busyKey === `hide:${item._id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                Remove
              </button>
            )}
          />
        ))}
      </div>
    );
  }

  function renderTimeline() {
    return (
      <div className="border-t border-[var(--border-default)]">
        {artifactCards.map(({ item, card }) => (
          <button key={item._id} type="button" className="flex w-full items-center gap-4 border-b border-[var(--border-default)] py-3 text-left hover:bg-[var(--bg-hover)]/60" onClick={() => setSelectedItemId(item._id)}>
            <span className="w-20 shrink-0 text-[12px] text-[var(--text-tertiary)]">{formatDate(item.updatedAt)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{card.title}</span>
              <span className="block truncate text-[12px] text-[var(--text-secondary)]">{card.summary}</span>
            </span>
            <span className="text-[11px] text-[var(--text-tertiary)]">{blueprintMeta[card.blueprintKey].label}</span>
          </button>
        ))}
      </div>
    );
  }

  function renderLibrary() {
    return (
      <div className="grid gap-6 md:grid-cols-2">
        {createTypes.map((type) => {
          const group = artifactCards.filter(({ card }) => card.blueprintKey === type.key);
          const Icon = type.icon;
          return (
            <section key={type.key}>
              <div className="mb-2 flex items-center gap-2">
                <Icon className="h-4 w-4 text-[var(--text-secondary)]" />
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">{type.label}</h3>
                <span className="text-[12px] text-[var(--text-tertiary)]">{group.length}</span>
              </div>
              <div className="border-t border-[var(--border-default)]">
                {group.map(({ item, card }) => (
                  <button key={item._id} type="button" className="flex w-full items-center justify-between border-b border-[var(--border-default)] py-2.5 text-left hover:bg-[var(--bg-hover)]/60" onClick={() => setSelectedItemId(item._id)}>
                    <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">{card.title}</span>
                    <span className="ml-3 text-[11px] text-[var(--text-tertiary)]">{formatDate(item.updatedAt)}</span>
                  </button>
                ))}
                {group.length === 0 ? <div className="py-4 text-[12px] text-[var(--text-tertiary)]">None yet.</div> : null}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 bg-[var(--bg-primary)]">
      <WorkspaceRail
        workspaces={overview?.workspaces ?? []}
        selectedWorkspaceId={selectedWorkspaceId}
        onHome={() => {
          setSelectedWorkspaceId(undefined);
          setSelectedItemId(null);
          void load();
        }}
        onSelect={(workspaceId) => {
          setSelectedItemId(null);
          void load(workspaceId);
        }}
        createOpen={createWorkspaceOpen}
        setCreateOpen={setCreateWorkspaceOpen}
        title={workspaceTitle}
        setTitle={setWorkspaceTitle}
        onCreate={() => void createWorkspace()}
        busy={busyKey === "workspace:create"}
      />

      {!selectedWorkspaceId ? (
        <WorkspaceHome overview={overview} openWorkspace={(workspaceId) => void load(workspaceId)} />
      ) : (
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-[76px] items-center justify-between gap-4 border-b border-[var(--border-default)] px-6">
            <div className="min-w-0">
              <h1 className="truncate text-[24px] font-semibold text-[var(--text-primary)]">{workspace?.title ?? (loading ? "Loading workspace" : "Workspace")}</h1>
              <div className="mt-1 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                <span>{formatCount(artifactCards.length, "card")}</span>
                <span>Updated {workspace ? formatDate(workspace.lastActivityAt) : ""}</span>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-tertiary)]" /> : null}
              </div>
            </div>
            <div className="flex items-center gap-1 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1">
              {viewModes.map((view) => {
                const Icon = view.icon;
                return (
                  <button
                    key={view.key}
                    type="button"
                    className={`inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] font-medium ${
                      viewMode === view.key ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                    onClick={() => setViewMode(view.key)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {view.label}
                  </button>
                );
              })}
            </div>
          </header>

          <main className={`min-h-0 flex-1 overflow-y-auto px-6 pb-[190px] pt-5 ${selectedEntry ? "xl:pr-[340px]" : ""}`}>
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">{viewMode === "cards" ? "Working set" : viewMode === "timeline" ? "Timeline" : "Library view"}</h2>
                <p className="mt-1 text-[12px] text-[var(--text-secondary)]">{workspace?.description ?? "Artifacts and activity for this workspace."}</p>
              </div>
            </div>
            {viewMode === "cards" ? renderCards() : null}
            {viewMode === "timeline" ? renderTimeline() : null}
            {viewMode === "library" ? renderLibrary() : null}
          </main>

          {selectedEntry ? (
            <aside className="absolute right-0 top-0 hidden h-full w-[320px] border-l border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-5 xl:block">
              <button type="button" className="mb-4 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={() => setSelectedItemId(null)}>Close inspector</button>
              <div className="flex items-start gap-3">
                {(() => {
                  const meta = blueprintMeta[selectedEntry.card.blueprintKey];
                  const Icon = meta.icon;
                  return <Icon className="mt-1 h-5 w-5 shrink-0" style={{ color: meta.color }} />;
                })()}
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-[var(--text-secondary)]">{blueprintMeta[selectedEntry.card.blueprintKey].label}</div>
                  <h3 className="mt-1 text-[17px] font-semibold leading-snug text-[var(--text-primary)]">{selectedEntry.card.title}</h3>
                </div>
              </div>
              <p className="mt-4 text-[13px] leading-6 text-[var(--text-secondary)]">{selectedEntry.card.summary}</p>
              <div className="mt-5 border-t border-[var(--border-default)] pt-4 text-[12px] text-[var(--text-secondary)]">
                <div className="flex justify-between py-1.5"><span>Placement</span><span className="text-[var(--text-primary)]">Workspace</span></div>
                <div className="flex justify-between py-1.5"><span>Updated</span><span className="text-[var(--text-primary)]">{formatDate(selectedEntry.item.updatedAt)}</span></div>
              </div>
            </aside>
          ) : null}

          <div className="pointer-events-none absolute inset-x-[62px] bottom-0 z-20 bg-[linear-gradient(to_top,var(--bg-primary)_76%,transparent)] px-6 pb-4 pt-10">
            <div className="pointer-events-auto mx-auto w-full max-w-[780px]">
              <ResultCardStack cards={recentRunCards} className="mb-1.5" />
              <CommandBar
                placeholder={selectedEntry ? `Act on ${selectedEntry.card.title}...` : "Work with this workspace..."}
                onSubmit={() => toast.message("Workspace AI execution is reserved for the operation engine wave.")}
                menu={(
                  <div>
                    {createTypes.map((type) => {
                      const Icon = type.icon;
                      return (
                        <button key={type.key} type="button" className={actionMenuItemClass()} disabled={busyKey === `artifact:${type.key}`} onClick={() => void createArtifact(type.key)}>
                          {busyKey === `artifact:${type.key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                          New {type.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
