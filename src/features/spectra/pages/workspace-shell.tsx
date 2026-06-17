"use client";

import {
  BookOpen,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Clock3,
  FileText,
  HelpCircle,
  LayoutGrid,
  Library,
  Loader2,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  Sparkles,
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

type ViewMode = "cards" | "timeline" | "library" | "canvas";

const createTypes: Array<{ key: Exclude<SpectraBlueprintKey, "thread_reference">; label: string; icon: LucideIcon }> = [
  { key: "document", label: "Document", icon: FileText },
  { key: "flashcard_deck", label: "Deck", icon: BookOpen },
  { key: "quiz", label: "Quiz", icon: HelpCircle },
  { key: "planner_task", label: "Task", icon: CalendarCheck2 },
];

const views: Array<{ key: ViewMode; label: string; icon: LucideIcon }> = [
  { key: "cards", label: "Cards", icon: LayoutGrid },
  { key: "timeline", label: "Timeline", icon: Clock3 },
  { key: "library", label: "Library", icon: Library },
  { key: "canvas", label: "Canvas", icon: CircleDashed },
];

function formatCount(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function actionButtonClass(tone: "quiet" | "danger" | "primary" = "quiet") {
  if (tone === "primary") {
    return "inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[var(--accent-cyan)] px-3 text-[12px] font-semibold text-white shadow-[0_12px_26px_-18px_rgba(8,22,40,0.45)] transition-[filter,transform] hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45";
  }
  if (tone === "danger") {
    return "inline-flex h-7 items-center gap-1 rounded-[7px] border border-[color-mix(in_oklab,var(--danger)_35%,var(--border-default))] px-2 text-[11px] font-semibold text-[var(--danger)] transition-colors hover:bg-[color-mix(in_oklab,var(--danger)_8%,var(--bg-elevated))] disabled:cursor-not-allowed disabled:opacity-45";
  }
  return "inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[color-mix(in_oklab,var(--border-default)_82%,transparent)] bg-[var(--bg-elevated)] px-2.5 text-[11.5px] font-semibold text-[var(--text-secondary)] shadow-[0_8px_20px_-18px_rgba(8,22,40,0.42)] transition-[background,transform,color] hover:-translate-y-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-45";
}

function workspaceAccent(index: number) {
  const colors = ["var(--accent-cyan)", "var(--mode-quiz)", "var(--accent-coral)", "var(--mode-research)", "var(--mode-document)"];
  return colors[index % colors.length];
}

function workspaceInitials(title: string) {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "S";
}

function WorkspaceSwitcher({
  workspaces,
  selectedWorkspaceId,
  onSelect,
  title,
  onTitleChange,
  onCreate,
  creating,
}: {
  workspaces: SpectraWorkspace[];
  selectedWorkspaceId?: string;
  onSelect: (workspaceId: string) => void;
  title: string;
  onTitleChange: (value: string) => void;
  onCreate: () => void;
  creating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = workspaces.find((workspace) => workspace._id === selectedWorkspaceId) ?? workspaces[0];

  return (
    <div className="relative">
      <button
        type="button"
        className="group flex h-12 min-w-[230px] max-w-[320px] items-center gap-3 rounded-[18px] border border-[color-mix(in_oklab,var(--border-default)_78%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_92%,var(--bg-primary))] px-3 text-left shadow-[0_16px_38px_-30px_rgba(8,22,40,0.55)] transition-[border-color,transform] hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--accent-cyan)_32%,var(--border-default))]"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] text-[12px] font-bold text-white"
          style={{ background: selected ? workspaceAccent(workspaces.findIndex((workspace) => workspace._id === selected._id)) : "var(--accent-cyan)" }}
        >
          {workspaceInitials(selected?.title ?? "Workspace")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{selected?.title ?? "Workspace"}</span>
          <span className="block truncate text-[11px] text-[var(--text-tertiary)]">{formatCount(workspaces.length, "workspace")}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)] transition-transform group-aria-expanded:rotate-180" />
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+10px)] z-40 w-[360px] overflow-hidden rounded-[24px] border border-[color-mix(in_oklab,var(--border-default)_80%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_96%,var(--bg-primary))] p-2 shadow-[0_26px_70px_-38px_rgba(8,22,40,0.68)] backdrop-blur-xl">
          <div className="max-h-[260px] space-y-1 overflow-y-auto pr-1">
            {workspaces.map((workspace, index) => {
              const active = workspace._id === selectedWorkspaceId;
              return (
                <button
                  key={workspace._id}
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-[14px] px-2.5 py-2 text-left transition-colors ${
                    active ? "bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-secondary))]" : "hover:bg-[var(--bg-hover)]"
                  }`}
                  onClick={() => {
                    onSelect(workspace._id);
                    setOpen(false);
                  }}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-[12px] font-bold text-white"
                    style={{ background: workspaceAccent(index) }}
                  >
                    {workspaceInitials(workspace.title)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{workspace.title}</span>
                    <span className="block truncate text-[11px] text-[var(--text-tertiary)]">{workspace.description ?? "Active workspace"}</span>
                  </span>
                  {active ? <CheckCircle2 className="h-4 w-4 text-[var(--accent-cyan)]" /> : null}
                </button>
              );
            })}
          </div>

          <div className="mt-2 rounded-[18px] border border-[color-mix(in_oklab,var(--border-default)_76%,transparent)] bg-[var(--bg-primary)]/55 p-2">
            <div className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold text-[var(--text-secondary)]">
              <Plus className="h-3.5 w-3.5" />
              New workspace
            </div>
            <div className="flex gap-2">
              <input
                value={title}
                onChange={(event) => onTitleChange(event.target.value)}
                placeholder="Subject or project"
                className="h-9 min-w-0 flex-1 rounded-[12px] border border-[color-mix(in_oklab,var(--border-default)_80%,transparent)] bg-[var(--bg-elevated)] px-3 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,var(--accent-cyan)_55%,var(--border-default))]"
              />
              <button
                type="button"
                className={actionButtonClass("primary")}
                disabled={!title.trim() || creating}
                onClick={onCreate}
              >
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function mapResultCards(overview: SpectraOverview | null): ResultCardView[] {
  return (overview?.resultCards ?? []).map((card) => ({
    id: card._id,
    status: card.status,
    variant: card.variant,
    title: card.title,
    summary: card.summary,
    actions: card.actions,
  }));
}

export function WorkspaceShell() {
  const [overview, setOverview] = useState<SpectraOverview | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [workspaceTitle, setWorkspaceTitle] = useState("");
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const seededRef = useRef(false);

  const load = useCallback(async (workspaceId?: string) => {
    setLoading(true);
    try {
      const next = await getSpectraOverview(workspaceId);
      setOverview(next);
      setSelectedWorkspaceId(next.selectedWorkspaceId);
      setViewMode((current) => current === "canvas" ? current : ((next.workspace?.workspace.defaultView as ViewMode | undefined) ?? current));
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
  const selectedEntry = artifactCards.find((entry) => entry.item._id === selectedItemId) ?? null;
  const inboxCount = overview?.artifacts.filter((artifact) => artifact.placementStatus === "inbox").length ?? 0;
  const recentRunCount = overview?.runs.length ?? 0;
  const resultCards = useMemo(() => mapResultCards(overview), [overview]);
  const groupedCards = useMemo(() => {
    return artifactCards.reduce<Record<SpectraBlueprintKey, typeof artifactCards>>((acc, entry) => {
      const key = entry.card.blueprintKey;
      acc[key] = acc[key] ?? [];
      acc[key].push(entry);
      return acc;
    }, {} as Record<SpectraBlueprintKey, typeof artifactCards>);
  }, [artifactCards]);

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
      setSelectedItemId((current) => (current === workspaceItemId ? null : current));
      await load(selectedWorkspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove workspace card.");
    } finally {
      setBusyKey(null);
    }
  }

  function renderCardsView() {
    if (artifactCards.length === 0) {
      return (
        <div className="rounded-[28px] border border-dashed border-[color-mix(in_oklab,var(--border-default)_74%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_70%,var(--bg-primary))] px-5 py-10 text-center">
          <p className="text-[15px] font-semibold text-[var(--text-primary)]">No cards here yet</p>
          <p className="mt-1 text-[12.5px] text-[var(--text-secondary)]">Create an artifact or add one from the library.</p>
        </div>
      );
    }

    return (
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {artifactCards.map(({ item, card }, index) => (
          <ArtifactCard
            key={item._id}
            artifact={card}
            selected={item._id === selectedItemId}
            elevated={index < 2 || card.pinned}
            onSelect={() => setSelectedItemId(item._id)}
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
    );
  }

  function renderTimelineView() {
    return (
      <div className="rounded-[28px] border border-[color-mix(in_oklab,var(--border-default)_74%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_82%,var(--bg-primary))] p-3">
        <div className="space-y-1">
          {artifactCards.map(({ item, card }) => {
            const meta = blueprintMeta[card.blueprintKey];
            const Icon = meta.icon;
            return (
              <button
                key={item._id}
                type="button"
                className={`flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors ${
                  item._id === selectedItemId ? "bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-secondary))]" : "hover:bg-[var(--bg-hover)]"
                }`}
                onClick={() => setSelectedItemId(item._id)}
              >
                <span className="text-[11px] font-semibold text-[var(--text-tertiary)]">{formatDate(item.updatedAt)}</span>
                <span className="h-px w-6 bg-[var(--border-default)]" />
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-[8px]"
                  style={{ color: meta.color, background: meta.soft }}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{card.title}</span>
                  <span className="block truncate text-[11.5px] text-[var(--text-secondary)]">{card.summary}</span>
                </span>
                <span className="hidden text-[11px] font-medium text-[var(--text-tertiary)] lg:block">{meta.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderLibraryView() {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        {(Object.keys(groupedCards) as SpectraBlueprintKey[]).map((key) => {
          const group = groupedCards[key];
          if (!group?.length) return null;
          const meta = blueprintMeta[key];
          const Icon = meta.icon;
          return (
            <section key={key} className="rounded-[28px] border border-[color-mix(in_oklab,var(--border-default)_74%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_82%,var(--bg-primary))] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-[9px]" style={{ color: meta.color, background: meta.soft }}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{meta.label}</h3>
                    <p className="text-[11px] text-[var(--text-tertiary)]">{formatCount(group.length, "object")}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                {group.map(({ item, card }) => (
                  <button
                    key={item._id}
                    type="button"
                    className={`flex w-full items-center justify-between gap-3 rounded-[13px] px-3 py-2 text-left transition-colors ${
                      item._id === selectedItemId ? "bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-secondary))]" : "hover:bg-[var(--bg-hover)]"
                    }`}
                    onClick={() => setSelectedItemId(item._id)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{card.title}</span>
                      <span className="block truncate text-[11px] text-[var(--text-tertiary)]">{card.summary}</span>
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  function renderCanvasPlaceholder() {
    return (
      <div className="relative min-h-[360px] overflow-hidden rounded-[32px] border border-[color-mix(in_oklab,var(--border-default)_74%,transparent)] bg-[radial-gradient(circle_at_28%_20%,color-mix(in_oklab,var(--accent-cyan)_12%,transparent),transparent_34%),linear-gradient(135deg,color-mix(in_oklab,var(--bg-elevated)_88%,var(--bg-primary)),var(--bg-primary))] p-5">
        <div className="absolute inset-x-8 top-16 h-px bg-[linear-gradient(90deg,transparent,var(--border-default),transparent)]" />
        <div className="absolute bottom-10 left-10 h-px w-2/3 bg-[linear-gradient(90deg,transparent,var(--border-default),transparent)]" />
        <div className="relative flex h-full min-h-[320px] items-center justify-center">
          <div className="max-w-[360px] rounded-[24px] border border-[color-mix(in_oklab,var(--border-default)_78%,transparent)] bg-[var(--bg-elevated)]/78 p-5 text-center shadow-[0_24px_60px_-42px_rgba(8,22,40,0.62)] backdrop-blur-xl">
            <CircleDashed className="mx-auto h-8 w-8 text-[var(--accent-cyan)]" />
            <h3 className="mt-3 text-[15px] font-semibold text-[var(--text-primary)]">Canvas comes later</h3>
            <p className="mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">The cards, timeline, and library views are the active workspace surfaces for this wave.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 bg-[radial-gradient(circle_at_18%_0%,color-mix(in_oklab,var(--accent-cyan)_10%,transparent),transparent_30%),var(--bg-primary)]">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 px-5 pt-5 lg:px-6">
          <div className="rounded-b-[32px] rounded-t-[22px] border border-[color-mix(in_oklab,var(--border-default)_74%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_82%,var(--bg-primary))] px-4 py-4 shadow-[0_22px_70px_-54px_rgba(8,22,40,0.72)] backdrop-blur-xl">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[var(--text-tertiary)]">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-primary)]/70 px-2.5 py-1">
                    <Sparkles className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
                    Workspace
                  </span>
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                </div>
                <h1 className="font-display truncate text-[28px] font-semibold leading-tight text-[var(--text-primary)]">
                  {workspace?.title ?? (loading ? "Loading workspace" : "Workspace")}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                  <span>{formatCount(artifactCards.length, "card")}</span>
                  <span className="h-1 w-1 rounded-full bg-[var(--border-default)]" />
                  <span>{formatCount(inboxCount, "inbox artifact")}</span>
                  <span className="h-1 w-1 rounded-full bg-[var(--border-default)]" />
                  <span>{formatCount(recentRunCount, "run")}</span>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
                <WorkspaceSwitcher
                  workspaces={overview?.workspaces ?? []}
                  selectedWorkspaceId={selectedWorkspaceId}
                  onSelect={(workspaceId) => {
                    setSelectedItemId(null);
                    void load(workspaceId);
                  }}
                  title={workspaceTitle}
                  onTitleChange={setWorkspaceTitle}
                  onCreate={() => void createWorkspace()}
                  creating={busyKey === "workspace:create"}
                />
                <div className="flex gap-1 overflow-x-auto rounded-[18px] border border-[color-mix(in_oklab,var(--border-default)_78%,transparent)] bg-[var(--bg-primary)]/52 p-1">
                  {views.map((view) => {
                    const Icon = view.icon;
                    const active = viewMode === view.key;
                    return (
                      <button
                        key={view.key}
                        type="button"
                        className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[13px] px-3 text-[12px] font-semibold transition-[background,color,transform] hover:-translate-y-0.5 ${
                          active ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_10px_24px_-20px_rgba(8,22,40,0.45)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                        onClick={() => setViewMode(view.key)}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {view.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-[330px] pt-5 lg:px-6">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
                {viewMode === "cards" ? "Working set" : viewMode === "timeline" ? "Workspace timeline" : viewMode === "library" ? "Workspace library" : "Spatial preview"}
              </h2>
              <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">{workspace?.description ?? "School work, artifacts, and activity."}</p>
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

          {viewMode === "cards" ? renderCardsView() : null}
          {viewMode === "timeline" ? renderTimelineView() : null}
          {viewMode === "library" ? renderLibraryView() : null}
          {viewMode === "canvas" ? renderCanvasPlaceholder() : null}
        </main>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-[linear-gradient(to_top,var(--bg-primary)_72%,transparent)] px-5 pb-5 pt-24 lg:px-6">
          <div className="pointer-events-auto mx-auto w-full max-w-[880px]">
            <ResultCardStack cards={resultCards} className="mb-2 w-full" />
            <CommandBar
              contextLabel={selectedEntry ? blueprintMeta[selectedEntry.card.blueprintKey].shortLabel : "Workspace"}
              detail={selectedEntry ? selectedEntry.card.title : workspace?.title}
              placeholder={selectedEntry ? `Act on ${selectedEntry.card.title}...` : "Work with this workspace..."}
              onSubmit={() => toast.message("Workspace AI execution is reserved for the operation engine wave.")}
            />
          </div>
        </div>
      </section>

      <aside
        className={`hidden shrink-0 border-l border-[color-mix(in_oklab,var(--border-default)_78%,transparent)] bg-[color-mix(in_oklab,var(--bg-primary)_90%,var(--bg-elevated))] transition-[width] duration-300 lg:flex lg:flex-col ${
          inspectorCollapsed ? "w-[58px]" : "w-[354px]"
        }`}
      >
        <div className={`flex min-h-[66px] items-center border-b border-[color-mix(in_oklab,var(--border-default)_78%,transparent)] ${inspectorCollapsed ? "justify-center px-2" : "justify-between px-4"}`}>
          {!inspectorCollapsed ? (
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">Inspector</p>
              <h2 className="truncate text-[16px] font-semibold text-[var(--text-primary)]">{selectedEntry ? "Selected object" : "Workspace context"}</h2>
            </div>
          ) : null}
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-[10px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            onClick={() => setInspectorCollapsed((value) => !value)}
            aria-label={inspectorCollapsed ? "Expand inspector" : "Collapse inspector"}
          >
            {inspectorCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </button>
        </div>

        {inspectorCollapsed ? (
          <div className="space-y-2 p-2">
            {[Search, Rows3, MessageSquare, RefreshCw].map((Icon, index) => (
              <button
                key={index}
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-[12px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                onClick={index === 3 ? () => void load(selectedWorkspaceId) : undefined}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selectedEntry ? (
              <div className="space-y-4">
                <div className="rounded-[24px] border border-[color-mix(in_oklab,var(--border-default)_74%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_88%,var(--bg-primary))] p-4">
                  <div className="flex items-start gap-3">
                    {(() => {
                      const meta = blueprintMeta[selectedEntry.card.blueprintKey];
                      const Icon = meta.icon;
                      return (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]" style={{ color: meta.color, background: meta.soft }}>
                          <Icon className="h-[18px] w-[18px]" />
                        </span>
                      );
                    })()}
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-[var(--text-tertiary)]">{blueprintMeta[selectedEntry.card.blueprintKey].label}</p>
                      <h3 className="mt-1 text-[17px] font-semibold leading-snug text-[var(--text-primary)]">{selectedEntry.card.title}</h3>
                    </div>
                  </div>
                  <p className="mt-4 text-[13px] leading-6 text-[var(--text-secondary)]">{selectedEntry.card.summary}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-[14px] bg-[var(--bg-primary)]/65 px-3 py-2">
                      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Placement</div>
                      <div className="mt-1 text-[12px] font-semibold text-[var(--text-primary)]">In workspace</div>
                    </div>
                    <div className="rounded-[14px] bg-[var(--bg-primary)]/65 px-3 py-2">
                      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Updated</div>
                      <div className="mt-1 text-[12px] font-semibold text-[var(--text-primary)]">{formatDate(selectedEntry.item.updatedAt)}</div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={actionButtonClass()}>Open</button>
                  <button type="button" className={actionButtonClass()}>Continue</button>
                  <button
                    type="button"
                    className={actionButtonClass("danger")}
                    disabled={busyKey === `hide:${selectedEntry.item._id}`}
                    onClick={() => void hideWorkspaceItem(selectedEntry.item._id)}
                  >
                    Remove
                  </button>
                  <button type="button" className={actionButtonClass()} onClick={() => setSelectedItemId(null)}>Clear</button>
                </div>

                <div className="rounded-[24px] border border-[color-mix(in_oklab,var(--border-default)_74%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_78%,var(--bg-primary))] p-4">
                  <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Linked activity</h3>
                  <div className="mt-3 space-y-2">
                    {overview?.runs.slice(0, 3).map((run) => (
                      <div key={run._id} className="rounded-[14px] bg-[var(--bg-primary)]/62 px-3 py-2">
                        <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{run.userPrompt}</div>
                        <div className="mt-0.5 text-[11px] capitalize text-[var(--text-tertiary)]">{run.status}</div>
                      </div>
                    ))}
                    {(overview?.runs.length ?? 0) === 0 ? (
                      <p className="text-[12px] text-[var(--text-tertiary)]">No linked runs yet.</p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-[26px] border border-[color-mix(in_oklab,var(--border-default)_74%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_88%,var(--bg-primary))] p-4">
                  <h3 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">{workspace?.title ?? "Workspace"}</h3>
                  <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">{workspace?.description ?? "A focused place for school objects and AI activity."}</p>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {[
                      [artifactCards.length, "Cards"],
                      [inboxCount, "Inbox"],
                      [recentRunCount, "Runs"],
                    ].map(([value, label]) => (
                      <div key={label} className="rounded-[15px] bg-[var(--bg-primary)]/65 px-3 py-2 text-center">
                        <div className="text-[15px] font-semibold text-[var(--text-primary)]">{value}</div>
                        <div className="text-[10.5px] font-semibold uppercase tracking-[0.10em] text-[var(--text-tertiary)]">{label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border border-[color-mix(in_oklab,var(--border-default)_74%,transparent)] bg-[color-mix(in_oklab,var(--bg-elevated)_78%,var(--bg-primary))] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Recent runs</h3>
                    <button type="button" className="text-[11px] font-semibold text-[var(--accent-cyan)]" onClick={() => void load(selectedWorkspaceId)}>Refresh</button>
                  </div>
                  <div className="space-y-2">
                    {overview?.runs.slice(0, 5).map((run) => (
                      <div key={run._id} className="rounded-[14px] bg-[var(--bg-primary)]/62 px-3 py-2">
                        <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{run.userPrompt}</div>
                        <div className="mt-0.5 flex items-center justify-between text-[11px] text-[var(--text-tertiary)]">
                          <span className="capitalize">{run.status}</span>
                          <span>{formatDate(run.updatedAt)}</span>
                        </div>
                      </div>
                    ))}
                    {(overview?.runs.length ?? 0) === 0 ? (
                      <p className="text-[12px] text-[var(--text-tertiary)]">No runs yet.</p>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
