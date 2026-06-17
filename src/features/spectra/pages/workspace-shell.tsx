"use client";

import {
  BookOpen,
  CalendarCheck2,
  FileText,
  HelpCircle,
  Loader2,
  MessageSquare,
  PanelRight,
  Plus,
  RefreshCw,
  Rows3,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArtifactCard } from "../components/artifact-card";
import { CommandBar } from "../components/command-bar";
import { ResultCardStack } from "../components/result-card";
import {
  getSpectraOverview,
  postSpectra,
  workspaceItemToArtifactCardView,
  type SpectraBlueprintKey,
  type SpectraOverview,
  type SpectraWorkspaceItem,
} from "../data/api";

const viewTabs = ["Cards", "Canvas", "Timeline", "Library"];

const createTypes: Array<{ key: Exclude<SpectraBlueprintKey, "thread_reference">; label: string; icon: typeof FileText }> = [
  { key: "document", label: "Document", icon: FileText },
  { key: "flashcard_deck", label: "Deck", icon: BookOpen },
  { key: "quiz", label: "Quiz", icon: HelpCircle },
  { key: "planner_task", label: "Task", icon: CalendarCheck2 },
];

function formatCount(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function actionButtonClass(tone: "quiet" | "danger" | "primary" = "quiet") {
  if (tone === "primary") {
    return "inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-[var(--accent-cyan)] px-2.5 text-[12px] font-semibold text-white transition-[filter,transform] hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45";
  }
  if (tone === "danger") {
    return "inline-flex h-7 items-center gap-1 rounded-[6px] border border-[color-mix(in_oklab,var(--danger)_35%,var(--border-default))] px-2 text-[11px] font-medium text-[var(--danger)] transition-colors hover:bg-[color-mix(in_oklab,var(--danger)_8%,var(--bg-elevated))] disabled:cursor-not-allowed disabled:opacity-45";
  }
  return "inline-flex h-7 items-center gap-1 rounded-[6px] border border-[var(--border-default)] px-2 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-45";
}

export function WorkspaceShell() {
  const [overview, setOverview] = useState<SpectraOverview | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [workspaceTitle, setWorkspaceTitle] = useState("");
  const seededRef = useRef(false);

  const load = useCallback(async (workspaceId?: string) => {
    setLoading(true);
    try {
      const next = await getSpectraOverview(workspaceId);
      setOverview(next);
      setSelectedWorkspaceId(next.selectedWorkspaceId);
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

  const workspace = overview?.workspace?.workspace ?? null;
  const artifactCards = useMemo(
    () => (overview?.workspace?.items ?? [])
      .map((item) => ({ item, card: workspaceItemToArtifactCardView(item) }))
      .filter((entry): entry is { item: SpectraWorkspaceItem; card: NonNullable<ReturnType<typeof workspaceItemToArtifactCardView>> } => Boolean(entry.card)),
    [overview?.workspace?.items],
  );
  const selectedArtifact = artifactCards[0]?.card;
  const inboxCount = overview?.artifacts.filter((artifact) => artifact.placementStatus === "inbox").length ?? 0;
  const recentRunCount = overview?.runs.length ?? 0;

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
      await load(selectedWorkspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove workspace card.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="relative flex h-full min-h-0 bg-[var(--bg-primary)]">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[82px] items-center justify-between gap-4 border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-6">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="truncate text-[22px] font-semibold text-[var(--text-primary)]">
                {workspace?.title ?? (loading ? "Loading workspace" : "Workspace")}
              </h1>
              {loading ? <Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" /> : null}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <span>{formatCount(artifactCards.length, "card")}</span>
              <span className="h-1 w-1 rounded-full bg-[var(--border-default)]" />
              <span>{formatCount(inboxCount, "inbox artifact")}</span>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <select
              value={selectedWorkspaceId ?? ""}
              onChange={(event) => void load(event.target.value)}
              className="h-9 max-w-[210px] rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] outline-none"
            >
              {(overview?.workspaces ?? []).map((item) => (
                <option key={item._id} value={item._id}>{item.title}</option>
              ))}
            </select>
            <div className="hidden items-center rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 xl:flex">
              {viewTabs.map((view, index) => (
                <button
                  key={view}
                  type="button"
                  className={`h-8 rounded-[6px] px-3 text-[12px] font-medium transition-colors ${
                    index === 0
                      ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {view}
                </button>
              ))}
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-[310px] pt-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
            <section className="min-w-0">
              <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-[13px] font-semibold text-[var(--text-secondary)]">Workspace cards</h2>
                  <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">Cards are projections. Removing one keeps the artifact in the library.</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {createTypes.map((type) => {
                    const Icon = type.icon;
                    return (
                      <button
                        key={type.key}
                        type="button"
                        className={actionButtonClass()}
                        disabled={!selectedWorkspaceId || busyKey === `artifact:${type.key}`}
                        onClick={() => void createArtifact(type.key)}
                      >
                        {busyKey === `artifact:${type.key}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                        {type.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {artifactCards.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {artifactCards.map(({ item, card }) => (
                    <ArtifactCard
                      key={item._id}
                      artifact={card}
                      selected={item._id === artifactCards[0]?.item._id}
                      actions={(
                        <button
                          type="button"
                          className={actionButtonClass("danger")}
                          disabled={busyKey === `hide:${item._id}`}
                          onClick={() => void hideWorkspaceItem(item._id)}
                        >
                          {busyKey === `hide:${item._id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          Remove
                        </button>
                      )}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-[8px] border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-8 text-center">
                  <p className="text-[14px] font-semibold text-[var(--text-primary)]">No cards in this workspace yet</p>
                  <p className="mt-1 text-[12px] text-[var(--text-secondary)]">Create an artifact here or add one from the artifact library.</p>
                </div>
              )}
            </section>

            <section className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)]">
              <div className="border-b border-[var(--border-default)] px-4 py-3">
                <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Focus pane</h2>
              </div>
              <div className="space-y-4 p-4">
                <div>
                  <div className="text-[12px] font-medium text-[var(--text-tertiary)]">Selected artifact</div>
                  <h3 className="mt-1 truncate text-[16px] font-semibold text-[var(--text-primary)]">{selectedArtifact?.title ?? "Nothing selected"}</h3>
                  <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">
                    {selectedArtifact?.summary ?? "Select or create a workspace card to inspect its artifact projection."}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    formatCount(overview?.workspaces.length ?? 0, "workspace"),
                    formatCount(overview?.artifacts.length ?? 0, "artifact"),
                    formatCount(recentRunCount, "run"),
                  ].map((item) => (
                    <div key={item} className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                      {item}
                    </div>
                  ))}
                </div>
                <div className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
                  <div className="text-[12px] font-semibold text-[var(--text-primary)]">New workspace</div>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={workspaceTitle}
                      onChange={(event) => setWorkspaceTitle(event.target.value)}
                      placeholder="Subject or project"
                      className="h-8 min-w-0 flex-1 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                    />
                    <button
                      type="button"
                      className={actionButtonClass("primary")}
                      disabled={!workspaceTitle.trim() || busyKey === "workspace:create"}
                      onClick={() => void createWorkspace()}
                    >
                      {busyKey === "workspace:create" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      Create
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-[linear-gradient(to_top,var(--bg-primary)_72%,transparent)] px-6 pb-5 pt-20">
          <div className="pointer-events-auto mx-auto max-w-3xl">
            <ResultCardStack className="mb-2" />
            <CommandBar contextLabel={workspace ? `${workspace.title} workspace` : "Workspace"} placeholder="Work with this workspace..." />
          </div>
        </div>
      </section>

      <aside className="hidden w-[300px] shrink-0 border-l border-[var(--border-default)] bg-[var(--bg-elevated)] lg:flex lg:flex-col">
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-4">
          <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Run hub</h2>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            onClick={() => void load(selectedWorkspaceId)}
            aria-label="Refresh workspace"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="space-y-2 p-3">
          {[
            { label: "Running", value: String(overview?.runs.filter((run) => run.status === "running").length ?? 0), icon: Rows3 },
            { label: "Recent", value: String(recentRunCount), icon: PanelRight },
            { label: "Threads", value: "0", icon: MessageSquare },
          ].map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.label}
                type="button"
                className="flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
              >
                <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--text-secondary)]">
                  <Icon className="h-4 w-4" />
                  {section.label}
                </span>
                <span className="text-[12px] text-[var(--text-tertiary)]">{section.value}</span>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
