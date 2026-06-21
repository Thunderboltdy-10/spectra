"use client";

import {
  BarChart3,
  BookOpen,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileText,
  HelpCircle,
  Home,
  List,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pin,
  Plus,
  Rows3,
  Settings,
  Sparkles,
  Sprout,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useSpectraRun } from "../ai/use-spectra-run";
import { createDefaultArtifactPayload, type ArtifactPayload } from "../components/artifact-blueprint-sheet";
import { ArtifactCard, blueprintMeta } from "../components/artifact-card";
import { ArtifactStudio, StudioTabRail, useArtifactStudioState } from "../components/artifact-studio";
import { CommandBar } from "../components/command-bar";
import { ResultCardStack } from "../components/result-card";
import { RunDetailPanel } from "../components/run-detail-panel";
import { ObjectLibrary } from "../components/object-library";
import {
  formatRelativeTime,
  formatShortDate,
  artifactPlacements,
  linkedArtifacts,
  sortSpectraWorkspaces,
  workspaceAccent,
  workspaceArtifactCount,
  workspaceThreadCount,
  workspaceItemToCard,
} from "../components/spectra-view-model";
import {
  getSpectraOverview,
  getSpectraWorkspace,
  postSpectra,
  type SpectraArtifact,
  type SpectraBlueprintKey,
  type SpectraOverview,
  type SpectraRun,
  type SpectraWorkspace,
  type SpectraWorkspaceItem,
} from "../data/api";

type ViewMode = "timeline" | "library" | "canvas";
type Selection = { type: "artifact"; itemId: string; artifactId: string } | { type: "run"; runId: string } | null;
type WorkspaceHubTab = { id: string; label: string; workspaceId?: string };

function workspaceHubTab(label = "Home", workspaceId?: string): WorkspaceHubTab {
  return { id: `workspace-hub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label, workspaceId };
}

const createTypes: Array<{ key: SpectraBlueprintKey; label: string; icon: LucideIcon }> = [
  { key: "document", label: "Document", icon: FileText },
  { key: "flashcard_deck", label: "Deck", icon: BookOpen },
  { key: "quiz", label: "Quiz", icon: HelpCircle },
  { key: "planner_task", label: "Task", icon: CalendarCheck2 },
  { key: "thread_reference", label: "Thread reference", icon: MessageSquare },
];

const viewModes: Array<{ key: ViewMode; label: string; icon: LucideIcon }> = [
  { key: "library", label: "Library", icon: BookOpen },
  { key: "timeline", label: "Timeline", icon: Rows3 },
  { key: "canvas", label: "Canvas", icon: Sparkles },
];

function iconForWorkspace(workspace: SpectraWorkspace, index: number) {
  const accent = workspaceAccent(workspace, index);
  if (accent.icon === "leaf") return Sprout;
  if (accent.icon === "bar") return BarChart3;
  if (accent.icon === "book") return BookOpen;
  if (accent.icon === "spark") return Sparkles;
  return Plus;
}

function smallButtonClass(tone: "normal" | "dark" | "danger" = "normal") {
  if (tone === "dark") return "inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[var(--text-primary)] px-3 text-[13px] font-medium text-[var(--bg-primary)] disabled:opacity-45";
  if (tone === "danger") return "inline-flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[12px] font-medium text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-elevated))] disabled:opacity-45";
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

function WorkspaceRail({
  workspaces,
  selectedWorkspaceId,
  onHome,
  onSelect,
  onCreateClick,
}: {
  workspaces: SpectraWorkspace[];
  selectedWorkspaceId?: string;
  onHome: () => void;
  onSelect: (workspaceId: string) => void;
  onCreateClick: () => void;
}) {
  return (
    <aside className="flex w-[74px] shrink-0 flex-col items-center border-r border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-primary)_84%,var(--bg-elevated))] px-2.5 py-5">
      <button
        type="button"
        className={`flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-[8px] text-[11px] font-medium ${
          !selectedWorkspaceId ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_2px_8px_rgba(27,20,12,0.04)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        }`}
        onClick={onHome}
      >
        <Home className="h-4 w-4" />
        Home
      </button>
      <div className="mt-4 flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto">
        {workspaces.map((workspace, index) => {
          const selected = workspace._id === selectedWorkspaceId;
          const accent = workspaceAccent(workspace, index);
          const Icon = iconForWorkspace(workspace, index);
          return (
            <button
              key={workspace._id}
              type="button"
              className={`flex w-14 flex-col items-center gap-1 rounded-[8px] px-1.5 py-2 text-[11px] font-medium ${
                selected ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_2px_8px_rgba(27,20,12,0.04)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
              onClick={() => onSelect(workspace._id)}
              title={workspace.title}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-[8px] text-white" style={{ background: accent.color }}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="max-w-full truncate">{workspace.title}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="mt-3 flex h-10 w-10 items-center justify-center rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        onClick={onCreateClick}
        aria-label="Create workspace"
      >
        <Plus className="h-4 w-4" />
      </button>
    </aside>
  );
}

function WorkspaceHome({
  overview,
  onSelect,
  onOpenArtifact,
  onAddArtifactToWorkspace,
  onCreateArtifact,
}: {
  overview: SpectraOverview | null;
  onSelect: (workspaceId: string) => void;
  onOpenArtifact: (artifact: SpectraArtifact) => void;
  onAddArtifactToWorkspace: (artifact: SpectraArtifact, workspaceId: string) => void;
  onCreateArtifact: (blueprintKey: SpectraBlueprintKey, workspaceId?: string) => void;
}) {
  const workspaces = overview?.workspaces ?? [];
  const artifacts = overview?.artifacts ?? [];
  const unplacedCount = artifacts.filter((artifact) => artifactPlacements(artifact).length === 0).length;
  const activity = artifacts
    .map((artifact) => ({ id: artifact._id, time: artifact.updatedAt, title: artifact.title, detail: Math.abs(artifact.updatedAt - artifact.createdAt) < 1_000 ? "Created" : "Updated", artifact }))
    .sort((a, b) => b.time - a.time)
    .slice(0, 8);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_22%_-5%,color-mix(in_oklab,var(--accent-cyan)_7%,transparent),transparent_34%),var(--bg-primary)] px-8 pb-[150px] pt-8">
      <div className="mx-auto max-w-[1320px]">
        <div className="flex items-end justify-between gap-5">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Spectra / Workspace</div>
            <h1 className="font-display text-[36px] font-semibold leading-[1.15] text-[var(--text-primary)]">Mission control</h1>
            <p className="mt-2 text-[14px] text-[var(--text-secondary)]">Every workspace and object, from one working surface.</p>
          </div>
          <div className="hidden items-center gap-2 text-[11px] text-[var(--text-secondary)] md:flex">
            <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5">{workspaces.length} workspaces</span>
            <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5">{artifacts.length} objects</span>
            <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5">{unplacedCount} unplaced</span>
          </div>
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_330px]">
          <section>
            <div className="mb-3 flex items-center justify-between"><div><h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">Workspaces</h2><p className="mt-1 text-[12px] text-[var(--text-secondary)]">Enter a focused working room</p></div></div>
            <div className="grid content-start gap-3 md:grid-cols-2">
          {workspaces.map((workspace, index) => {
            const accent = workspaceAccent(workspace, index);
            const Icon = iconForWorkspace(workspace, index);
            const count = workspaceArtifactCount(workspace, artifacts);
            return (
              <div
                key={workspace._id}
                className="group relative min-h-[142px] overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-left shadow-[0_8px_24px_rgba(27,20,12,0.035)] transition duration-200 hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--text-tertiary)_38%,var(--border-default))]"
                style={{
                  background: `radial-gradient(circle at 88% 20%, color-mix(in oklab, ${accent.color} 15%, transparent) 0 20%, transparent 21%), linear-gradient(135deg, ${accent.soft}, var(--bg-elevated) 62%)`,
                }}
              >
                <button type="button" className="absolute inset-0 z-[1]" onClick={() => onSelect(workspace._id)} aria-label={`Open ${workspace.title} workspace`} />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1" style={{ background: accent.color }} />
                <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:radial-gradient(color-mix(in_oklab,var(--text-primary)_16%,transparent)_0.45px,transparent_0.45px)] [background-size:7px_7px]" />
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] text-white" style={{ background: accent.color }}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[22px] font-semibold leading-tight text-[var(--text-primary)]">{workspace.title}</span>
                    <span className="mt-1 line-clamp-2 block text-[12px] leading-5 text-[var(--text-secondary)]">{workspace.description}</span>
                    <span className="mt-4 flex items-center gap-3 text-[11px] text-[var(--text-tertiary)]">
                      <span className="rounded-[7px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_70%,transparent)] px-2 py-1">{count} artifacts</span>
                      <span>Updated {formatRelativeTime(workspace.lastActivityAt)}</span>
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
            </div>
          </section>
          <aside className="self-start rounded-[10px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_78%,transparent)] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Recent activity</h2>
              <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
            </div>
            <div className="mt-4 space-y-3">
              {activity.map((entry) => {
                return (
                  <button key={entry.id} type="button" className="flex w-full items-center gap-3 rounded-[7px] p-1.5 text-left hover:bg-[var(--bg-hover)]" onClick={() => onOpenArtifact(entry.artifact)}>
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent-cyan)]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-[var(--text-primary)]">{entry.title}</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">{entry.detail} · {formatRelativeTime(entry.time)}</div>
                    </div>
                  </button>
                );
              })}
              {activity.length === 0 ? <div className="text-[13px] text-[var(--text-secondary)]">No activity yet.</div> : null}
            </div>
          </aside>
        </div>

        <div className="mt-10 border-t border-[var(--border-default)] pt-7">
          <ObjectLibrary entries={artifacts.map((artifact) => ({ artifact }))} workspaces={workspaces} groupBy="workspace" title="Global object library" subtitle="All objects, ordered by workspace" onOpen={(entry) => onOpenArtifact(entry.artifact)} onAddToWorkspace={(entry, workspaceId) => onAddArtifactToWorkspace(entry.artifact, workspaceId)} onCreateArtifact={onCreateArtifact} />
        </div>
      </div>
    </main>
  );
}

function WorkspaceHeader({
  workspace,
  items,
  runs,
  viewMode,
  setViewMode,
  busy,
  onCreateArtifact,
  onArchiveWorkspace,
}: {
  workspace: SpectraWorkspace | null;
  items: SpectraWorkspaceItem[];
  runs: SpectraRun[];
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  busy: string | null;
  onCreateArtifact: (type: SpectraBlueprintKey) => void;
  onArchiveWorkspace: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const createRef = useOutsideClick<HTMLDivElement>(createOpen, () => setCreateOpen(false));
  const workspaceMenuRef = useOutsideClick<HTMLDivElement>(workspaceMenuOpen, () => setWorkspaceMenuOpen(false));
  const artifactCount = items.filter((item) => item.artifact).length;
  const threadCount = workspaceThreadCount(items);
  const cardCount = items.filter((item) => item.viewData.pinned).length;
  const activeRuns = runs.filter((run) => run.status === "running" || run.status === "queued").length;

  return (
    <header className="border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-8 pb-3 pt-7">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2" ref={workspaceMenuRef}>
            <h1 className="truncate pb-1 font-display text-[34px] font-semibold leading-[1.15] text-[var(--text-primary)]">{workspace?.title ?? "Workspace"}</h1>
            <div className="relative">
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" onClick={() => setWorkspaceMenuOpen((open) => !open)} aria-label="Workspace menu"><MoreHorizontal className="h-4 w-4" /></button>
              {workspaceMenuOpen ? <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[210px] rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_16px_36px_rgba(27,20,12,0.14)]">
                <button type="button" className={`${menuItemClass()} text-[var(--danger)]`} onClick={() => { setWorkspaceMenuOpen(false); onArchiveWorkspace(); }}><Trash2 className="h-4 w-4" />Archive workspace</button>
              </div> : null}
            </div>
          </div>
          <p className="mt-3 text-[14px] text-[var(--text-secondary)]">{workspace?.description ?? "All your work, organized and ready."}</p>
        </div>
        <div className="relative" ref={createRef}>
          <button type="button" className={smallButtonClass("dark")} onClick={() => setCreateOpen((open) => !open)}>
            {busy?.startsWith("artifact:") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            New
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {createOpen ? (
            <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[250px] rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_18px_42px_rgba(27,20,12,0.14)]">
              {createTypes.map((type) => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.key}
                    type="button"
                    className={menuItemClass()}
                    disabled={busy === `artifact:${type.key}`}
                    onClick={() => {
                      setCreateOpen(false);
                      onCreateArtifact(type.key);
                    }}
                  >
                    {busy === `artifact:${type.key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                    New {type.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-8 text-[12px] text-[var(--text-secondary)]">
        <div className="flex items-center gap-2"><FileText className="h-4 w-4" /><strong className="text-[var(--text-primary)]">{artifactCount}</strong><span>Artifacts</span></div>
        <div className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /><strong className="text-[var(--text-primary)]">{threadCount}</strong><span>Threads</span></div>
        <div className="flex items-center gap-2"><Pin className="h-4 w-4" /><strong className="text-[var(--text-primary)]">{cardCount}</strong><span>Pinned</span></div>
        <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" /><strong className="text-[var(--text-primary)]">{activeRuns}</strong><span>Active runs</span></div>
      </div>
      <nav className="mt-6 flex items-center gap-1 rounded-[10px] bg-[color-mix(in_oklab,var(--bg-elevated)_56%,transparent)] p-1">
        {viewModes.map((view) => {
          const Icon = view.icon;
          return (
            <button
              key={view.key}
              type="button"
              className={`flex h-9 items-center gap-2 rounded-[8px] px-3 text-[13px] transition-all duration-200 ${
                viewMode === view.key ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_1px_6px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--bg-elevated)_64%,transparent)] hover:text-[var(--text-primary)]"
              }`}
              onClick={() => setViewMode(view.key)}
            >
              <Icon className="h-4 w-4" />
              {view.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}

function CardsView({
  entries,
  selected,
  onSelect,
  onHide,
  busy,
}: {
  entries: Array<{ item: SpectraWorkspaceItem; artifact: SpectraArtifact; card: ReturnType<typeof workspaceItemToCard> }>;
  selected: Selection;
  onSelect: (item: SpectraWorkspaceItem, artifact: SpectraArtifact) => void;
  onHide: (itemId: string) => void;
  busy: string | null;
}) {
  if (entries.length === 0) {
    return <EmptyWorkspaceState title="No workspace cards yet" message="Create or add an artifact to start building this workspace." />;
  }

  const pinned = entries.filter((entry) => entry.item.viewData.pinned).slice(0, 5);
  const activeEntries = (pinned.length > 0 ? pinned : entries).slice(0, 5);
  const documents = entries.filter((entry) => entry.artifact.blueprintKey === "document").slice(0, 4);
  const practice = entries.filter((entry) => entry.artifact.blueprintKey === "quiz" || entry.artifact.blueprintKey === "flashcard_deck" || entry.artifact.blueprintKey === "planner_task").slice(0, 4);

  return (
    <div className="space-y-7">
      <section>
        <div className="mb-4">
          <h2 className="font-display text-[17px] font-semibold text-[var(--text-primary)]">Pinned / Active</h2>
          <p className="mt-1 text-[12px] text-[var(--text-secondary)]">Your most important items at a glance</p>
        </div>
        <div className="grid gap-3 xl:grid-cols-[minmax(300px,1.1fr)_minmax(360px,1.4fr)]">
          {activeEntries[0]?.card ? (
            <ArtifactCard
              artifact={{ ...activeEntries[0].card, variant: activeEntries[0].card.variant ?? "botanical" }}
              size="large"
              selected={selected?.type === "artifact" && selected.itemId === activeEntries[0].item._id}
              onSelect={() => onSelect(activeEntries[0].item, activeEntries[0].artifact)}
            />
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {activeEntries.slice(1, 5).map((entry) => entry.card ? (
              <ArtifactCard
                key={entry.item._id}
                artifact={entry.card}
                selected={selected?.type === "artifact" && selected.itemId === entry.item._id}
                onSelect={() => onSelect(entry.item, entry.artifact)}
                actions={(
                  <button type="button" className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-[var(--border-default)]" onClick={() => onHide(entry.item._id)}>
                    {busy === `hide:${entry.item._id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                )}
              />
            ) : null)}
          </div>
        </div>
      </section>
      <CompactShelf title="Documents" entries={documents} selected={selected} onSelect={onSelect} />
      <CompactShelf title="Practice" entries={practice} selected={selected} onSelect={onSelect} />
    </div>
  );
}

function CompactShelf({
  title,
  entries,
  selected,
  onSelect,
}: {
  title: string;
  entries: Array<{ item: SpectraWorkspaceItem; artifact: SpectraArtifact; card: ReturnType<typeof workspaceItemToCard> }>;
  selected: Selection;
  onSelect: (item: SpectraWorkspaceItem, artifact: SpectraArtifact) => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-4">
        <h2 className="font-display text-[16px] font-semibold text-[var(--text-primary)]">{title}</h2>
        <button type="button" className="text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">See all</button>
      </div>
      <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-4">
        {entries.map((entry) => {
          if (!entry.card) return null;
          const meta = blueprintMeta[entry.card.blueprintKey];
          const Icon = meta.icon;
          return (
            <button
              key={entry.item._id}
              type="button"
              className={`flex min-h-[58px] items-center gap-3 rounded-[8px] border bg-[var(--bg-elevated)] px-3 py-2 text-left ${
                selected?.type === "artifact" && selected.itemId === entry.item._id ? "border-[#8b6ff0]" : "border-[var(--border-default)] hover:bg-[var(--bg-hover)]"
              }`}
              onClick={() => onSelect(entry.item, entry.artifact)}
            >
              <Icon className="h-5 w-5 shrink-0" style={{ color: meta.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{entry.card.title}</span>
                <span className="block truncate text-[11px] text-[var(--text-secondary)]">{formatRelativeTime(entry.item.updatedAt)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function TimelineView({
  entries,
  runs,
  selected,
  onSelectRun,
  onSelectArtifact,
}: {
  entries: Array<{ item: SpectraWorkspaceItem; artifact: SpectraArtifact; card: ReturnType<typeof workspaceItemToCard> }>;
  runs: SpectraRun[];
  selected: Selection;
  onSelectRun: (run: SpectraRun) => void;
  onSelectArtifact: (item: SpectraWorkspaceItem, artifact: SpectraArtifact) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(900);
  const runRows = runs.slice(0, 8).map((run) => ({
    id: `run:${run._id}`,
    kind: "run" as const,
    run,
    entry: entries.find((candidate) => candidate.artifact._id === run.artifactId),
    title: run.status === "completed" ? "AI run completed" : `AI run ${run.status.replace("_", " ")}`,
    summary: run.finalSummary ?? run.error ?? "Workspace run activity.",
    time: run.createdAt,
  }));
  const artifactRows = entries.slice(0, 12).map((entry) => ({
    id: `artifact:${entry.item._id}`,
    kind: "artifact" as const,
    entry,
    title: entry.artifact.createdAt === entry.artifact.updatedAt ? `${blueprintMeta[entry.artifact.blueprintKey].label} created` : `${blueprintMeta[entry.artifact.blueprintKey].label} updated`,
    summary: entry.artifact.summary ?? entry.card?.summary ?? "Object updated in this workspace.",
    time: entry.item.updatedAt,
  }));
  const rows = [...runRows, ...artifactRows].sort((a, b) => b.time - a.time);
  const selectedId = selected?.type === "artifact" ? `artifact:${selected.itemId}` : selected?.type === "run" ? `run:${selected.runId}` : null;
  const cardWidth = containerWidth < 720 ? 178 : 208;
  const sidePadding = Math.max(28, Math.min(52, containerWidth * 0.05));
  const columnCount = Math.max(2, Math.min(5, Math.floor((containerWidth - sidePadding * 2) / (cardWidth + 28))));
  const rowHeight = 142;
  const groupGap = 92;
  const firstLineY = 142;
  const centerLeft = sidePadding + cardWidth / 2;
  const centerRight = containerWidth - sidePadding - cardWidth / 2;
  const lineLeft = Math.max(14, centerLeft - 18);
  const lineRight = Math.min(containerWidth - 14, centerRight + 18);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dateGroups = rows.reduce<Array<{ key: string; label: string; rows: typeof rows }>>((groups, row) => {
    const date = new Date(row.time);
    date.setHours(0, 0, 0, 0);
    const days = Math.max(0, Math.round((todayStart.getTime() - date.getTime()) / 86_400_000));
    const key = String(date.getTime());
    const label = days === 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? `${days} days ago` : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const group = groups.find((candidate) => candidate.key === key);
    if (group) group.rows.push(row);
    else groups.push({ key, label, rows: [row] });
    return groups;
  }, []);
  let laneCursor = 0;
  const dayLayouts = dateGroups.map((group, groupIndex) => {
    const laneCount = Math.max(1, Math.ceil(group.rows.length / columnCount));
    const startLane = laneCursor;
    const startY = firstLineY + startLane * rowHeight + groupIndex * groupGap;
    laneCursor += laneCount;
    return { ...group, groupIndex, laneCount, startLane, startY };
  });
  const nodes = dayLayouts.flatMap((group) => group.rows.map((row, groupItemIndex) => {
    const localLane = Math.floor(groupItemIndex / columnCount);
    const lane = group.startLane + localLane;
    const laneIndex = groupItemIndex % columnCount;
    const laneSize = Math.min(columnCount, group.rows.length - localLane * columnCount);
    const progress = laneSize === 1 ? 0.5 : laneIndex / (laneSize - 1);
    const directionProgress = lane % 2 === 0 ? 1 - progress : progress;
    const x = centerLeft + directionProgress * Math.max(0, centerRight - centerLeft);
    const lineY = group.startY + localLane * rowHeight;
    return { ...row, lane, x, lineY, top: lineY - 88, dayKey: group.key };
  }));
  const laneYs = Array.from(new Set(nodes.map((node) => node.lineY))).sort((a, b) => a - b);
  const canvasHeight = (laneYs[laneYs.length - 1] ?? firstLineY) + 64;
  let path = `M ${lineRight} ${laneYs[0] ?? firstLineY} H ${lineLeft}`;
  for (let lane = 1; lane < laneYs.length; lane += 1) {
    const previousY = laneYs[lane - 1];
    const nextY = laneYs[lane];
    const atLeft = lane % 2 === 1;
    const edge = atLeft ? lineLeft : lineRight;
    const bulge = atLeft ? edge - 22 : edge + 22;
    path += ` C ${bulge} ${previousY + 48}, ${bulge} ${nextY - 48}, ${edge} ${nextY}`;
    path += atLeft ? ` H ${lineRight}` : ` H ${lineLeft}`;
  }

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(Math.max(420, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => {
      const target = containerRef.current?.querySelector<HTMLElement>(`[data-timeline-id="${selectedId}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [containerWidth, selectedId]);

  if (rows.length === 0) {
    return <EmptyWorkspaceState title="No activity yet" message="Runs and object changes will appear here as the workspace becomes active." />;
  }

  return (
    <div ref={containerRef} className="relative min-w-0 overflow-hidden rounded-[12px] border border-[var(--border-default)] bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--accent-cyan)_5%,transparent),transparent_34%),radial-gradient(var(--border-default)_0.55px,transparent_0.55px)] [background-size:auto,12px_12px]" style={{ height: canvasHeight }}>
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${containerWidth} ${canvasHeight}`} preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="spectra-timeline-flow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--accent-cyan)" stopOpacity="0.78" /><stop offset="0.55" stopColor="#8b6ff0" stopOpacity="0.64" /><stop offset="1" stopColor="#d88922" stopOpacity="0.58" /></linearGradient></defs>
        <path d={path} fill="none" stroke="var(--bg-elevated)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        <path d={path} fill="none" stroke="url(#spectra-timeline-flow)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {dayLayouts.map((group) => <div key={group.key} className="absolute inset-x-5 z-[2] flex items-center gap-3" style={{ top: group.startY - 124 }}><span className="rounded-full border border-[color-mix(in_oklab,var(--accent-cyan)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--bg-elevated)_96%,transparent)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)] shadow-[0_3px_10px_rgba(27,20,12,0.06)]">{group.label}</span><span className="h-px flex-1 bg-[linear-gradient(to_right,color-mix(in_oklab,var(--accent-cyan)_34%,var(--border-default)),transparent)]" /><span className="text-[10px] text-[var(--text-tertiary)]">{group.rows.length} event{group.rows.length === 1 ? "" : "s"}</span></div>)}
      {nodes.map((node) => {
        const entry = node.entry;
        const active = node.id === selectedId;
        const meta = entry ? blueprintMeta[entry.artifact.blueprintKey] : null;
        const NodeIcon = meta?.icon;
        return <div key={node.id} className="absolute z-[3]" style={{ width: cardWidth, left: node.x - cardWidth / 2, top: node.top }}>
          <span className="absolute left-1/2 top-[66px] h-4 w-px -translate-x-1/2 bg-[color-mix(in_oklab,var(--accent-cyan)_42%,var(--border-default))]" />
          <span className={`absolute left-1/2 top-[82px] h-3 w-3 -translate-x-1/2 rounded-full border-[3px] border-[var(--bg-primary)] shadow-[0_1px_5px_rgba(27,20,12,0.16)] ${active ? "bg-[#8b6ff0] ring-4 ring-[color-mix(in_oklab,#8b6ff0_16%,transparent)]" : "bg-[var(--accent-cyan)]"}`} />
          <button data-timeline-id={node.id} type="button" className={`group flex min-h-[66px] w-full items-center gap-2.5 overflow-hidden rounded-[9px] border bg-[color-mix(in_oklab,var(--bg-elevated)_96%,transparent)] px-2.5 py-2 text-left shadow-[0_7px_20px_rgba(27,20,12,0.07)] backdrop-blur-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_25px_rgba(27,20,12,0.11)] ${active ? "border-[#8b6ff0] ring-2 ring-[color-mix(in_oklab,#8b6ff0_12%,transparent)]" : "border-[var(--border-default)]"}`} onClick={() => entry ? onSelectArtifact(entry.item, entry.artifact) : node.kind === "run" ? onSelectRun(node.run) : undefined}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-[var(--bg-primary)]">{NodeIcon && meta ? <NodeIcon className="h-4 w-4" style={{ color: meta.color }} /> : <Sparkles className="h-4 w-4 text-[var(--accent-cyan)]" />}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-[var(--text-primary)]">{entry?.artifact.title ?? node.title}</span><span className="mt-0.5 block truncate text-[10px] text-[var(--text-secondary)]">{node.title} · {formatRelativeTime(node.time)}</span></span>
          </button>
        </div>;
      })}
    </div>
  );
}

function LibraryView({
  entries,
  workspaceTitle,
  selected,
  onSelect,
  onTogglePin,
  onRemove,
  busy,
  onCreateArtifact,
}: {
  entries: Array<{ item: SpectraWorkspaceItem; artifact: SpectraArtifact; card: ReturnType<typeof workspaceItemToCard> }>;
  workspaceTitle: string;
  selected: Selection;
  onSelect: (item: SpectraWorkspaceItem, artifact: SpectraArtifact) => void;
  onTogglePin: (item: SpectraWorkspaceItem) => void;
  onRemove: (item: SpectraWorkspaceItem) => void;
  busy: string | null;
  onCreateArtifact: (blueprintKey: SpectraBlueprintKey) => void;
}) {
  if (entries.length === 0) {
    return <EmptyWorkspaceState title="No library items here" message="Add artifacts to this workspace to group them by type." />;
  }

  return (
    <div className="space-y-7">
      {entries.some((entry) => entry.item.viewData.pinned) ? <section>
        <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]"><Pin className="h-3.5 w-3.5 text-[#b67616]" />Pinned in {workspaceTitle}</div>
        <div className="flex gap-3 overflow-x-auto pb-2">{entries.filter((entry) => entry.item.viewData.pinned).map((entry) => { const meta = blueprintMeta[entry.artifact.blueprintKey]; const Icon = meta.icon; return <button key={entry.item._id} type="button" className="group relative min-h-[130px] min-w-[350px] max-w-[390px] overflow-hidden rounded-[12px] border border-[color-mix(in_oklab,#b67616_24%,var(--border-default))] bg-[linear-gradient(118deg,color-mix(in_oklab,#b67616_8%,var(--bg-elevated)),var(--bg-elevated)_68%)] p-4 text-left shadow-[0_10px_28px_rgba(27,20,12,0.065)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(27,20,12,0.09)]" onClick={() => onSelect(entry.item, entry.artifact)}><span className="pointer-events-none absolute bottom-0 right-0 h-full w-[48%] opacity-30 [background-image:radial-gradient(color-mix(in_oklab,#b67616_40%,transparent)_0.6px,transparent_0.6px)] [background-size:7px_7px] [mask-image:linear-gradient(to_left,black,transparent)]" /><span className="relative flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[9px] border border-[color-mix(in_oklab,currentColor_20%,transparent)] bg-[var(--bg-primary)]" style={{ color: meta.color }}><Icon className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block truncate font-display text-[16px] font-semibold text-[var(--text-primary)]">{entry.artifact.title}</span><span className="mt-1 block line-clamp-2 text-[11px] leading-[1.45] text-[var(--text-secondary)]">{entry.artifact.summary ?? "No summary yet."}</span><span className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]"><span className="rounded-[5px] bg-[var(--bg-secondary)] px-1.5 py-0.5">{meta.label}</span>{entry.artifact.tags.slice(0, 2).map((tag) => <span key={tag} className="max-w-[88px] truncate rounded-[5px] border border-[var(--border-default)] px-1.5 py-0.5">{tag}</span>)}<span className="ml-auto shrink-0">{formatRelativeTime(entry.item.updatedAt)}</span></span></span></span></button>; })}</div>
      </section> : null}
      <ObjectLibrary
        entries={entries}
        groupBy="type"
        title="Workspace library"
        subtitle="Objects ordered by type"
        selectedArtifactId={selected?.type === "artifact" ? selected.artifactId : undefined}
        busyKey={busy}
        onOpen={(entry) => entry.item && onSelect(entry.item, entry.artifact)}
        onTogglePin={(entry) => entry.item && onTogglePin(entry.item)}
        onRemove={(entry) => entry.item && onRemove(entry.item)}
        onCreateArtifact={(blueprintKey) => onCreateArtifact(blueprintKey)}
      />
    </div>
  );
}

function CanvasView({
  entries,
  selectedArtifact,
  onSelect,
}: {
  entries: Array<{ item: SpectraWorkspaceItem; artifact: SpectraArtifact; card: ReturnType<typeof workspaceItemToCard> }>;
  selectedArtifact: SpectraArtifact | null;
  onSelect: (item: SpectraWorkspaceItem, artifact: SpectraArtifact) => void;
}) {
  const groups = createTypes.map((type) => ({ ...type, entries: entries.filter((entry) => entry.artifact.blueprintKey === type.key) })).filter((group) => group.entries.length > 0);

  return (
    <div className="h-full min-h-full overflow-auto rounded-[8px] border border-[var(--border-default)] bg-[radial-gradient(var(--border-default)_0.7px,transparent_0.7px)] p-4 [background-size:18px_18px]">
      <div className="grid min-h-full auto-rows-min gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {groups.map((group) => { const meta = blueprintMeta[group.key]; const Icon = meta.icon; return <section key={group.key} className="self-start rounded-[12px] border p-3 shadow-[0_8px_24px_rgba(27,20,12,0.04)]" style={{ borderColor: `color-mix(in oklab, ${meta.color} 20%, var(--border-default))`, background: meta.soft }}><header className="mb-3 flex items-center gap-2 px-1"><Icon className="h-4 w-4" style={{ color: meta.color }} /><span className="text-[13px] font-semibold text-[var(--text-primary)]">{group.label}</span><span className="ml-auto text-[11px] text-[var(--text-tertiary)]">{group.entries.length}</span></header><div className="grid gap-2 sm:grid-cols-2">{group.entries.map((entry) => <ArtifactCard key={entry.item._id} artifact={entry.card!} selected={selectedArtifact?._id === entry.artifact._id} quiet className="bg-[var(--bg-elevated)]" onSelect={() => onSelect(entry.item, entry.artifact)} />)}</div></section>; })}
      </div>
    </div>
  );
}

function EmptyWorkspaceState({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-[360px] items-center justify-center rounded-[8px] border border-dashed border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_44%,transparent)]">
      <div className="max-w-sm text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
          <Sparkles className="h-4 w-4" />
        </div>
        <h2 className="mt-4 font-display text-[20px] font-semibold text-[var(--text-primary)]">{title}</h2>
        <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">{message}</p>
      </div>
    </div>
  );
}

function Inspector({
  workspace,
  artifacts,
  selectedArtifact,
  selectedRun,
  runs,
  onClose,
  onHide,
  onCreateArtifact,
  onArchiveWorkspace,
  onOpenArtifact,
}: {
  workspace: SpectraWorkspace | null;
  artifacts: SpectraArtifact[];
  selectedArtifact: SpectraArtifact | null;
  selectedRun: SpectraRun | null;
  runs: SpectraRun[];
  onClose: () => void;
  onHide: () => void;
  onCreateArtifact: (type: SpectraBlueprintKey) => void;
  onArchiveWorkspace: () => void;
  onOpenArtifact: (artifact: SpectraArtifact) => void;
}) {
  if (selectedRun) {
    const affected = artifacts.find((artifact) => artifact._id === selectedRun.artifactId) ?? null;
    return (
      <aside className="hidden w-[318px] shrink-0 border-l border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-6 xl:block">
        <InspectorTitle title="Selected run" onClose={onClose} />
        <div className="mt-5 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <div className="flex items-center justify-between text-[12px] text-[var(--text-secondary)]">
            <span>{formatShortDate(selectedRun.createdAt)}</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />{selectedRun.status}</span>
          </div>
          <h2 className="mt-5 font-display text-[20px] font-semibold leading-tight text-[var(--text-primary)]">{selectedRun.userPrompt}</h2>
          <p className="mt-4 text-[13px] leading-6 text-[var(--text-secondary)]">{selectedRun.finalSummary}</p>
        </div>
        {affected ? (
          <InspectorSection title="Affected objects">
            <InspectorObject artifact={affected} />
          </InspectorSection>
        ) : null}
        <InspectorSection title="Run actions">
          <ActionRow icon={ExternalLink} label="Open" disabled />
          <ActionRow icon={List} label="View details" disabled />
          <ActionRow icon={Sparkles} label="Continue this run" disabled />
        </InspectorSection>
      </aside>
    );
  }

  if (selectedArtifact) {
    const meta = blueprintMeta[selectedArtifact.blueprintKey];
    const Icon = meta.icon;
    const links = linkedArtifacts(selectedArtifact, artifacts);
    const selectedPlacements = artifactPlacements(selectedArtifact);
    return (
      <aside className="hidden w-[318px] shrink-0 border-l border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-6 xl:block">
        <InspectorTitle title="Selected artifact" onClose={onClose} />
        <div className="mt-5">
          <Icon className="h-8 w-8 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5" style={{ color: meta.color }} />
          <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{meta.label}</div>
          <h2 className="mt-2 font-display text-[22px] font-semibold leading-tight text-[var(--text-primary)]">{selectedArtifact.title}</h2>
          <div className="mt-2 text-[12px] text-[var(--text-secondary)]">Updated {formatRelativeTime(selectedArtifact.updatedAt)}</div>
        </div>
        <InspectorSection title="Summary">
          <p className="text-[13px] leading-6 text-[var(--text-secondary)]">{selectedArtifact.summary}</p>
        </InspectorSection>
        <InspectorSection title="Placement">
          <div className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 text-[13px] font-medium text-[var(--text-primary)]">
            {selectedPlacements[0]?.workspaceTitle ?? workspace?.title ?? "Unplaced"}
            <div className="mt-1 text-[11px] font-normal text-[var(--text-secondary)]">Workspace card</div>
          </div>
        </InspectorSection>
        <InspectorSection title="Linked objects">
          <div className="space-y-2">
            {links.slice(0, 5).map(({ artifact }) => <InspectorObject key={artifact._id} artifact={artifact} />)}
            {links.length === 0 ? <div className="text-[13px] text-[var(--text-secondary)]">No seeded links yet.</div> : null}
          </div>
        </InspectorSection>
        <InspectorSection title="Quick actions">
          <ActionRow icon={ExternalLink} label="Open detail" onClick={() => onOpenArtifact(selectedArtifact)} />
          <ActionRow icon={FileText} label="Add note" disabled />
          <ActionRow icon={HelpCircle} label="Create quiz from this" disabled />
          <button type="button" className={smallButtonClass("danger")} onClick={onHide}><Trash2 className="h-4 w-4" />Remove from workspace</button>
        </InspectorSection>
      </aside>
    );
  }

  const workspaceArtifacts = artifacts.filter((artifact) => !workspace || artifactPlacements(artifact).some((placement) => placement.workspaceId === workspace._id));
  const activeRuns = runs.filter((run) => run.status === "queued" || run.status === "running").length;

  return (
    <aside className="hidden w-[318px] shrink-0 border-l border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-6 xl:block">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">{workspace?.title ?? "Workspace"} overview</h2>
        <span className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]"><span className="h-2 w-2 rounded-full bg-[var(--success)]" />All systems normal</span>
      </div>
      <InspectorSection title="Workspace">
        <div className="space-y-3 text-[13px]">
          <MetricRow label="Artifacts" value={String(workspaceArtifacts.length)} />
          <MetricRow label="Cards" value={String(workspaceArtifacts.length)} />
          <MetricRow label="Documents" value={String(workspaceArtifacts.filter((artifact) => artifact.blueprintKey === "document").length)} />
          <MetricRow label="Active runs" value={String(activeRuns)} />
        </div>
      </InspectorSection>
      <InspectorSection title="Quick actions">
        <ActionRow icon={FileText} label="New document" onClick={() => onCreateArtifact("document")} />
        <ActionRow icon={HelpCircle} label="New quiz" onClick={() => onCreateArtifact("quiz")} />
        <ActionRow icon={BookOpen} label="New deck" onClick={() => onCreateArtifact("flashcard_deck")} />
        <ActionRow icon={CalendarCheck2} label="New task" onClick={() => onCreateArtifact("planner_task")} />
        {workspace ? <button type="button" className={smallButtonClass("danger")} onClick={onArchiveWorkspace}><Trash2 className="h-4 w-4" />Archive workspace</button> : null}
      </InspectorSection>
    </aside>
  );
}

function InspectorTitle({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">{title}</h2>
      <button type="button" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={onClose}><X className="h-4 w-4" /></button>
    </div>
  );
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 border-t border-[var(--border-default)] pt-5">
      <h3 className="mb-3 text-[13px] font-semibold text-[var(--text-primary)]">{title}</h3>
      {children}
    </section>
  );
}

function InspectorObject({ artifact }: { artifact: SpectraArtifact }) {
  const meta = blueprintMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-3 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2.5">
      <Icon className="h-4 w-4 shrink-0" style={{ color: meta.color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-[var(--text-primary)]">{artifact.title}</div>
        <div className="text-[11px] text-[var(--text-secondary)]">{meta.label}</div>
      </div>
      <ExternalLink className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
    </div>
  );
}

function ActionRow({ icon: Icon, label, disabled = false, onClick }: { icon: LucideIcon; label: string; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="flex h-10 w-full items-center gap-3 rounded-[8px] text-left text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:text-[var(--text-tertiary)] disabled:hover:bg-transparent" disabled={disabled} onClick={onClick}>
      <Icon className="h-4 w-4 text-[var(--text-secondary)]" />
      {label}
      {disabled ? <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">Wave 3</span> : null}
    </button>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between"><span className="text-[var(--text-secondary)]">{label}</span><strong className="font-semibold text-[var(--text-primary)]">{value}</strong></div>;
}

export function WorkspaceShell() {
  const [overview, setOverview] = useState<SpectraOverview | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>();
  const [selection, setSelection] = useState<Selection>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("library");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [newWorkspaceTitle, setNewWorkspaceTitle] = useState("");
  const [newWorkspaceDescription, setNewWorkspaceDescription] = useState("");
  const [hubTabs, setHubTabs] = useState<WorkspaceHubTab[]>(() => [{ id: "workspace-home-default", label: "Home" }]);
  const [activeHubTabId, setActiveHubTabId] = useState<string | null>("workspace-home-default");
  const [studioPanelWidth, setStudioPanelWidth] = useState(720);
  const workspaceCreateRef = useOutsideClick<HTMLDivElement>(workspaceCreateOpen, () => setWorkspaceCreateOpen(false));
  const seededRef = useRef(false);

  const loadOverview = useCallback(async (workspaceId?: string) => {
    setLoading(true);
    try {
      const next = await getSpectraOverview(workspaceId);
      setOverview(next);
      setSelectedWorkspaceId(next.workspace ? next.selectedWorkspaceId ?? workspaceId : undefined);
      return next;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Spectra workspace.");
      if (workspaceId) {
        setSelectedWorkspaceId(undefined);
        setSelection(null);
        const fallback = await getSpectraOverview().catch(() => null);
        if (fallback) setOverview(fallback);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWorkspace = useCallback(async (workspaceId: string) => {
    setLoading(true);
    try {
      const result = await getSpectraWorkspace(workspaceId);
      setSelectedWorkspaceId(workspaceId);
      setOverview((current) => current
        ? { ...current, selectedWorkspaceId: workspaceId, workspace: result.workspace }
        : { workspaces: [], selectedWorkspaceId: workspaceId, workspace: result.workspace, artifacts: [], runs: [], resultCards: [] });
    } catch (error) {
      setSelectedWorkspaceId(undefined);
      setSelection(null);
      const message = error instanceof Error ? error.message : "Could not load workspace.";
      toast.error(message.includes("Workspace not found") ? "That workspace is no longer available. Refreshed workspace home." : message);
      const fallback = await getSpectraOverview().catch(() => null);
      if (fallback) setOverview(fallback);
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
        // Loading below will surface auth/config errors. Seed is dev-only and best-effort.
      }
      await loadOverview();
    })();
  }, [loadOverview]);

  const workspace = selectedWorkspaceId ? overview?.workspace?.workspace ?? null : null;
  const allArtifacts = overview?.artifacts ?? [];
  const runs = overview?.runs ?? [];
  const studio = useArtifactStudioState("spectra.workspace.artifactStudio", allArtifacts);
  const workspaceRuns = selectedWorkspaceId ? runs.filter((run) => run.workspaceId === selectedWorkspaceId) : runs;
  const workspaces = useMemo(() => sortSpectraWorkspaces(overview?.workspaces ?? []), [overview?.workspaces]);
  const entries = useMemo(() => (overview?.workspace?.items ?? [])
    .map((item) => {
      const card = workspaceItemToCard(item);
      return item.artifact && card ? { item, artifact: item.artifact, card } : null;
    })
    .filter((entry): entry is { item: SpectraWorkspaceItem; artifact: SpectraArtifact; card: NonNullable<ReturnType<typeof workspaceItemToCard>> } => Boolean(entry)), [overview?.workspace?.items]);
  const selectedArtifact = selection?.type === "artifact" ? entries.find((entry) => entry.item._id === selection.itemId)?.artifact ?? null : null;
  const commandFocusArtifact = studio.isOpen ? studio.activeArtifact : selectedArtifact;
  const initialResultCards = useMemo(
    () => (overview?.resultCards ?? []).filter((card) => card.run?.sourceSurface !== "chat"),
    [overview?.resultCards],
  );
  const runEngine = useSpectraRun({
    surface: commandFocusArtifact ? "artifact" : "workspace",
    workspaceId: selectedWorkspaceId,
    artifactId: commandFocusArtifact?._id,
    initialCards: initialResultCards,
    onDataChanged: () => loadOverview(selectedWorkspaceId),
    onOpenArtifact: async (artifactId) => {
      const refreshed = await loadOverview(selectedWorkspaceId);
      const artifact = refreshed?.artifacts.find((item) => item._id === artifactId);
      if (artifact) studio.openSplit(artifact);
    },
  });

  function setActiveHubDestination(label: string, workspaceId?: string) {
    studio.closeStudio();
    if (activeHubTabId && hubTabs.some((tab) => tab.id === activeHubTabId)) {
      setHubTabs((current) => current.map((tab) => tab.id === activeHubTabId ? { ...tab, label, workspaceId } : tab));
      return;
    }
    const next = workspaceHubTab(label, workspaceId);
    setHubTabs((current) => [...current, next]);
    setActiveHubTabId(next.id);
  }

  function goToWorkspaceHub(workspaceId: string) {
    const target = workspaces.find((item) => item._id === workspaceId);
    setActiveHubDestination(target?.title ?? "Workspace", workspaceId);
    setSelection(null);
    setViewMode("library");
    void loadWorkspace(workspaceId);
  }

  function goToHomeHub() {
    setActiveHubDestination("Home");
    setSelection(null);
    setSelectedWorkspaceId(undefined);
    void loadOverview();
  }

  function activateHubTab(tabId: string) {
    const tab = hubTabs.find((item) => item.id === tabId);
    if (!tab) return;
    setActiveHubTabId(tabId);
    studio.closeStudio();
    setSelection(null);
    if (tab.workspaceId) void loadWorkspace(tab.workspaceId);
    else {
      setSelectedWorkspaceId(undefined);
      void loadOverview();
    }
  }

  function addHomeHubTab() {
    const next = workspaceHubTab();
    setHubTabs((current) => [...current, next]);
    setActiveHubTabId(next.id);
    studio.closeStudio();
    setSelection(null);
    setSelectedWorkspaceId(undefined);
    void loadOverview();
  }

  function closeHubTab(tabId: string) {
    const closingIndex = hubTabs.findIndex((tab) => tab.id === tabId);
    const remaining = hubTabs.filter((tab) => tab.id !== tabId);
    setHubTabs(remaining);
    if (activeHubTabId !== tabId) return;
    const fallbackHub = remaining[Math.min(closingIndex > 0 ? closingIndex - 1 : 0, remaining.length - 1)];
    if (fallbackHub) {
      activateHubTab(fallbackHub.id);
      return;
    }
    const fallbackArtifact = studio.tabs[studio.tabs.length - 1];
    if (fallbackArtifact) {
      setActiveHubTabId(null);
      studio.activateTab(fallbackArtifact.artifactId);
      return;
    }
    const replacement = workspaceHubTab();
    setHubTabs([replacement]);
    setActiveHubTabId(replacement.id);
    studio.closeStudio();
    setSelectedWorkspaceId(undefined);
    void loadOverview();
  }

  function closeArtifactTab(artifactId: string) {
    const closesFinalArtifact = studio.tabs.length === 1;
    studio.closeTab(artifactId);
    if (closesFinalArtifact && hubTabs.length === 0) {
      const replacement = workspaceHubTab();
      setHubTabs([replacement]);
      setActiveHubTabId(replacement.id);
      setSelectedWorkspaceId(undefined);
      void loadOverview();
    }
  }

  function returnToHub() {
    const target = hubTabs.find((tab) => tab.id === activeHubTabId) ?? hubTabs[hubTabs.length - 1];
    if (target) activateHubTab(target.id);
    else addHomeHubTab();
  }

  function openCreateArtifact(blueprintKey: SpectraBlueprintKey) {
    void createArtifact(createDefaultArtifactPayload(blueprintKey));
  }

  async function createArtifact(payload: ArtifactPayload, targetWorkspaceId = selectedWorkspaceId) {
    const label = blueprintMeta[payload.blueprintKey].label;
    setBusyKey(`artifact:${payload.blueprintKey}`);
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
      toast.success(targetWorkspaceId ? `${label} created in workspace.` : `${label} created as unplaced.`);
      const refreshed = await loadOverview(selectedWorkspaceId);
      const created = refreshed?.artifacts.find((artifact) => artifact._id === result.artifactId);
      if (created) studio.openTab(created);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not create ${label.toLowerCase()}.`);
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
      await loadOverview(selectedWorkspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update artifact.");
    } finally {
      setBusyKey(null);
    }
  }

  async function archiveArtifact(artifact: SpectraArtifact) {
    setBusyKey(`artifact:archive:${artifact._id}`);
    try {
      await postSpectra({ action: "archiveArtifact", artifactId: artifact._id });
      toast.success("Artifact archived.");
      returnToHub();
      await loadOverview(selectedWorkspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not archive artifact.");
    } finally {
      setBusyKey(null);
    }
  }

  async function hideWorkspaceItem(workspaceItemId: string) {
    setBusyKey(`hide:${workspaceItemId}`);
    const previousOverview = overview;
    setOverview((current) => current?.workspace ? { ...current, workspace: { ...current.workspace, items: current.workspace.items.filter((item) => item._id !== workspaceItemId) } } : current);
    try {
      await postSpectra({ action: "hideWorkspaceItem", workspaceItemId });
      toast.success("Removed from workspace. Artifact remains in library.");
      setSelection((current) => current?.type === "artifact" && current.itemId === workspaceItemId ? null : current);
      await loadOverview(selectedWorkspaceId);
    } catch (error) {
      setOverview(previousOverview);
      toast.error(error instanceof Error ? error.message : "Could not remove workspace card.");
    } finally {
      setBusyKey(null);
    }
  }

  async function addArtifactToWorkspace(artifact: SpectraArtifact, workspaceId: string) {
    setBusyKey(`add:${artifact._id}`);
    try {
      await postSpectra({ action: "addArtifactToWorkspace", artifactId: artifact._id, workspaceId });
      toast.success("Added to workspace.");
      await loadOverview(selectedWorkspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add object to workspace.");
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleWorkspaceItemPin(item: SpectraWorkspaceItem) {
    setBusyKey(`pin:item:${item._id}`);
    try {
      await postSpectra({ action: "setWorkspaceItemPinned", workspaceItemId: item._id, pinned: !item.viewData.pinned });
      await loadOverview(selectedWorkspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update pin.");
    } finally {
      setBusyKey(null);
    }
  }

  async function createWorkspace() {
    const title = newWorkspaceTitle.trim();
    if (!title) return;
    setBusyKey("workspace:create");
    try {
      const result = await postSpectra<{ workspaceId: string }>({
        action: "createWorkspace",
        title,
        description: newWorkspaceDescription.trim() || undefined,
      });
      toast.success("Workspace created.");
      setWorkspaceCreateOpen(false);
      setNewWorkspaceTitle("");
      setNewWorkspaceDescription("");
      setSelection(null);
      setViewMode("library");
      setActiveHubDestination(title, result.workspaceId);
      await loadOverview(result.workspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create workspace.");
    } finally {
      setBusyKey(null);
    }
  }

  async function archiveWorkspace() {
    if (!selectedWorkspaceId) return;
    setBusyKey(`workspace:archive:${selectedWorkspaceId}`);
    try {
      await postSpectra({ action: "archiveWorkspace", workspaceId: selectedWorkspaceId });
      toast.success("Workspace archived.");
      setSelection(null);
      setViewMode("library");
      setActiveHubDestination("Home");
      await loadOverview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not archive workspace.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="relative flex h-full min-h-0 bg-[var(--bg-primary)]">
      <WorkspaceRail
        workspaces={workspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        onHome={() => {
          goToHomeHub();
        }}
        onSelect={(workspaceId) => {
          goToWorkspaceHub(workspaceId);
        }}
        onCreateClick={() => setWorkspaceCreateOpen((open) => !open)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <StudioTabRail
          hubTabs={hubTabs}
          activeHubTabId={studio.mode === "tab" ? null : activeHubTabId}
          artifacts={allArtifacts}
          tabs={studio.tabs}
          activeArtifactId={studio.mode === "tab" ? studio.activeArtifactId : null}
          dirtyIds={studio.dirtyIds}
          onActivateHub={activateHubTab}
          onCloseHub={closeHubTab}
          onAddHub={addHomeHubTab}
          onActivateTab={studio.activateTab}
          onCloseTab={closeArtifactTab}
        />
        <div className="relative flex min-h-0 flex-1">
      {workspaceCreateOpen ? (
        <div ref={workspaceCreateRef} className="absolute left-3 top-5 z-40 w-[330px] rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[0_18px_44px_rgba(27,20,12,0.16)]">
          <div className="mb-3">
            <div className="font-display text-[18px] font-semibold text-[var(--text-primary)]">New workspace</div>
            <div className="mt-1 text-[12px] text-[var(--text-secondary)]">Create a subject space that stays synced with artifacts.</div>
          </div>
          <input
            value={newWorkspaceTitle}
            onChange={(event) => setNewWorkspaceTitle(event.target.value)}
            placeholder="Subject or project name"
            className="h-10 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
          <textarea
            value={newWorkspaceDescription}
            onChange={(event) => setNewWorkspaceDescription(event.target.value)}
            placeholder="Short description"
            className="mt-2 min-h-[70px] w-full resize-none rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className={smallButtonClass()} onClick={() => setWorkspaceCreateOpen(false)}>Cancel</button>
            <button type="button" className={smallButtonClass("dark")} disabled={!newWorkspaceTitle.trim() || busyKey === "workspace:create"} onClick={() => void createWorkspace()}>
              {busyKey === "workspace:create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create
            </button>
          </div>
        </div>
      ) : null}
      {studio.mode === "tab" && studio.activeArtifact ? (
        <ArtifactStudio
          mode="tab"
          artifact={studio.activeArtifact}
          artifacts={allArtifacts}
          tabs={studio.tabs}
          dirtyIds={studio.dirtyIds}
          busy={busyKey === `artifact:update:${studio.activeArtifact._id}`}
          sourceLabel={workspace?.title ?? "Workspace"}
          onClose={returnToHub}
          onExpand={studio.openTab}
          onActivateTab={studio.activateTab}
          onCloseTab={closeArtifactTab}
          onSave={updateArtifact}
          onArchive={archiveArtifact}
          onDirtyChange={studio.setDirty}
        />
      ) : !selectedWorkspaceId ? (
        <section className="flex min-w-0 flex-1">
          <WorkspaceHome overview={overview ? { ...overview, workspaces } : overview} onSelect={goToWorkspaceHub} onOpenArtifact={studio.openSplit} onAddArtifactToWorkspace={(artifact, workspaceId) => void addArtifactToWorkspace(artifact, workspaceId)} onCreateArtifact={(blueprintKey, workspaceId) => void createArtifact(createDefaultArtifactPayload(blueprintKey), workspaceId)} />
          {studio.mode === "split" && studio.activeArtifact ? (
            <ArtifactStudio
              mode="split"
              artifact={studio.activeArtifact}
              artifacts={allArtifacts}
              tabs={studio.tabs}
              dirtyIds={studio.dirtyIds}
              busy={busyKey === `artifact:update:${studio.activeArtifact._id}`}
              panelWidth={studioPanelWidth}
              sourceLabel="Workspace Home"
              onPanelWidthChange={setStudioPanelWidth}
              onClose={returnToHub}
              onExpand={studio.openTab}
              onActivateTab={studio.activateTab}
              onCloseTab={closeArtifactTab}
              onSave={updateArtifact}
              onArchive={archiveArtifact}
              onDirtyChange={studio.setDirty}
            />
          ) : null}
        </section>
      ) : (
        <section className="flex min-w-0 flex-1">
          <>
          <div className="flex min-w-0 flex-1 flex-col">
            <WorkspaceHeader workspace={workspace} items={entries.map((entry) => entry.item)} runs={workspaceRuns} viewMode={viewMode} setViewMode={setViewMode} busy={busyKey} onCreateArtifact={openCreateArtifact} onArchiveWorkspace={() => void archiveWorkspace()} />
            <main className={viewMode === "canvas" ? "min-h-0 flex-1 overflow-hidden px-8 pb-[110px] pt-6" : "min-h-0 flex-1 overflow-y-auto px-8 pb-[150px] pt-6"}>
              {loading && !workspace ? <div className="py-10 text-[13px] text-[var(--text-secondary)]">Loading workspace...</div> : null}
              {viewMode === "timeline" ? (
                <TimelineView
                  entries={entries}
                  runs={workspaceRuns}
                  selected={selection}
                  onSelectRun={(run) => {
                    const card = runEngine.cards.find((candidate) => candidate.runId === run._id);
                    if (card) runEngine.openDetails(card);
                    else setSelection({ type: "run", runId: run._id });
                  }}
                  onSelectArtifact={(item, artifact) => {
                    setSelection({ type: "artifact", itemId: item._id, artifactId: artifact._id });
                    studio.openSplit(artifact);
                  }}
                />
              ) : null}
              {viewMode === "library" ? <LibraryView entries={entries} workspaceTitle={workspace?.title ?? "Workspace"} selected={selection} onSelect={(item, artifact) => {
                setSelection({ type: "artifact", itemId: item._id, artifactId: artifact._id });
                studio.openSplit(artifact);
              }} onTogglePin={(item) => void toggleWorkspaceItemPin(item)} onRemove={(item) => void hideWorkspaceItem(item._id)} busy={busyKey} onCreateArtifact={openCreateArtifact} /> : null}
              {viewMode === "canvas" ? <CanvasView entries={entries} selectedArtifact={selectedArtifact} onSelect={(item, artifact) => {
                setSelection({ type: "artifact", itemId: item._id, artifactId: artifact._id });
                studio.openSplit(artifact);
              }} /> : null}
            </main>
          </div>
          {studio.mode === "split" && studio.activeArtifact ? (
            <ArtifactStudio
              mode="split"
              artifact={studio.activeArtifact}
              artifacts={allArtifacts}
              tabs={studio.tabs}
              dirtyIds={studio.dirtyIds}
              busy={busyKey === `artifact:update:${studio.activeArtifact._id}`}
              panelWidth={studioPanelWidth}
              sourceLabel={workspace?.title ?? "Workspace"}
              onPanelWidthChange={setStudioPanelWidth}
              onClose={returnToHub}
              onExpand={studio.openTab}
              onActivateTab={studio.activateTab}
              onCloseTab={closeArtifactTab}
              onSave={updateArtifact}
              onArchive={archiveArtifact}
              onDirtyChange={studio.setDirty}
            />
          ) : null}
          </>
        </section>
      )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-[linear-gradient(to_top,var(--bg-primary)_72%,transparent)] px-8 pb-5 pt-12">
            <div className="pointer-events-auto mx-auto max-w-[880px]">
              <ResultCardStack cards={runEngine.cards} className="mb-1.5 ml-[52px]" onOpen={runEngine.openDetails} onAction={(card, action, targetId) => void runEngine.onCardAction(card, action, targetId)} />
              <CommandBar
                placeholder={commandFocusArtifact ? `Act on ${commandFocusArtifact.title}...` : workspace ? `Work with ${workspace.title}...` : "Ask across all workspaces and objects..."}
                onSubmit={(prompt) => {
                  if (commandFocusArtifact && studio.dirtyIds.has(commandFocusArtifact._id)) {
                    toast.message("Save this artifact before asking Spectra to update it.");
                    return false;
                  }
                  void runEngine.run(prompt);
                  return true;
                }}
                busy={runEngine.submitting}
                menu={(
                  <div>
                    {createTypes.map((type) => {
                      const Icon = type.icon;
                      return (
                        <button key={type.key} type="button" className={menuItemClass()} disabled={busyKey === `artifact:${type.key}`} onClick={() => openCreateArtifact(type.key)}>
                          {busyKey === `artifact:${type.key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                          New {type.label}
                        </button>
                      );
                    })}
                    {!selectedWorkspaceId ? <button type="button" className={menuItemClass()} onClick={() => setWorkspaceCreateOpen(true)}><Plus className="h-4 w-4" />New workspace</button> : null}
                    {selectedWorkspaceId ? <button type="button" className={menuItemClass()}><Settings className="h-4 w-4" />Workspace settings</button> : null}
                  </div>
                )}
              />
            </div>
          </div>
          {runEngine.selectedRunId && runEngine.cards.find((card) => card.runId === runEngine.selectedRunId) ? (
            <RunDetailPanel
              runId={runEngine.selectedRunId}
              card={runEngine.cards.find((card) => card.runId === runEngine.selectedRunId)!}
              onClose={runEngine.closeDetails}
              onAction={(card, action, targetId) => void runEngine.onCardAction(card, action, targetId)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
