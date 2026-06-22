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
  PanelTop,
  Pin,
  Plus,
  Rows3,
  Sparkles,
  Sprout,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useSpectraSession } from "@/context/spectra-session-context";
import { useSpectraRun } from "../ai/use-spectra-run";
import { createDefaultArtifactPayload, type ArtifactPayload } from "../components/artifact-blueprint-sheet";
import { ArtifactCard, blueprintMeta } from "../components/artifact-card";
import { ArtifactStudio, StudioTabRail, useArtifactStudioState } from "../components/artifact-studio";
import { CommandBar } from "../components/command-bar";
import { ResultCardStack } from "../components/result-card";
import { RunDetailPanel } from "../components/run-detail-panel";
import { LocalThreadTabs } from "../components/local-thread-tabs";
import { ObjectLibrary, type LibraryMode } from "../components/object-library";
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
  peekSpectraWorkspace,
  getSpectraWorkspace,
  postSpectra,
  type SpectraArtifact,
  type SpectraBlueprintKey,
  type SpectraOverview,
  type SpectraRun,
  type SpectraWorkspace,
  type SpectraWorkspaceItem,
} from "../data/api";

type ViewMode = "list" | "board" | "timeline" | "canvas";
type WorkspaceSort = "updated" | "created" | "title" | "type";
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
];

const viewModes: Array<{ key: ViewMode; label: string; icon: LucideIcon }> = [
  { key: "list", label: "List", icon: List },
  { key: "board", label: "Board", icon: PanelTop },
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
        className="mt-3 flex h-10 w-10 items-center justify-center rounded-[8px] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
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
  onDeleteArtifact,
}: {
  overview: SpectraOverview | null;
  onSelect: (workspaceId: string) => void;
  onOpenArtifact: (artifact: SpectraArtifact) => void;
  onAddArtifactToWorkspace: (artifact: SpectraArtifact, workspaceId: string) => void;
  onCreateArtifact: (blueprintKey: SpectraBlueprintKey, workspaceId?: string) => void;
  onDeleteArtifact: (artifact: SpectraArtifact) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const createRef = useOutsideClick<HTMLDivElement>(createOpen, () => setCreateOpen(false));
  useEffect(() => { setPinnedOpen(window.localStorage.getItem("spectra.home.pinned.open") !== "false"); }, []);
  useEffect(() => { window.localStorage.setItem("spectra.home.pinned.open", String(pinnedOpen)); }, [pinnedOpen]);
  const workspaces = overview?.workspaces ?? [];
  const artifacts = overview?.artifacts ?? [];
  const unplacedArtifacts = artifacts.filter((artifact) => artifactPlacements(artifact).length === 0);
  const unplacedCount = unplacedArtifacts.length;
  const pinnedArtifacts = artifacts.filter((artifact) => artifactPlacements(artifact).some((placement) => placement.pinned));
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
          <div className="flex items-center gap-4" ref={createRef}>
            <div className="hidden items-center gap-4 text-[11px] text-[var(--text-secondary)] lg:flex">
              <span>{workspaces.length} workspaces</span><span>{artifacts.length} objects</span><span>{unplacedCount} unplaced</span>
            </div>
            <div className="relative">
              <button type="button" className={smallButtonClass("dark")} onClick={() => setCreateOpen((open) => !open)}><Plus className="h-4 w-4" />Create artifact</button>
              {createOpen ? <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-[230px] rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_16px_38px_rgba(27,20,12,0.14)]">{createTypes.map((type) => { const Icon = type.icon; return <button key={type.key} type="button" className={menuItemClass()} onClick={() => { setCreateOpen(false); onCreateArtifact(type.key); }}><Icon className="h-4 w-4" />New {type.label}</button>; })}</div> : null}
            </div>
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
                      <span>{count} artifacts</span>
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

        {pinnedArtifacts.length > 0 ? <section className="mt-9"><button type="button" onClick={() => setPinnedOpen((open) => !open)} className="mb-4 flex w-full items-center gap-2 text-left"><ChevronDown className={`h-4 w-4 text-[var(--text-tertiary)] transition ${pinnedOpen ? "" : "-rotate-90"}`} /><Pin className="h-4 w-4 text-[#b67616]" /><h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">Pinned work</h2><span className="rounded-[6px] bg-[var(--bg-secondary)] px-1.5 text-[12px] text-[var(--text-secondary)]">{pinnedArtifacts.length}</span><span className="ml-1 text-[12px] text-[var(--text-tertiary)]">Important objects across your workspaces</span></button>{pinnedOpen ? <PinnedArtifactShelf artifacts={pinnedArtifacts} onSelect={onOpenArtifact} /> : null}</section> : null}

        <div className="mt-8"><ObjectLibrary entries={unplacedArtifacts.map((artifact) => ({ artifact }))} workspaces={workspaces} groupBy="workspace" showHeader={false} showToolbar={false} showGroups={false} onOpen={(entry) => onOpenArtifact(entry.artifact)} onAddToWorkspace={(entry, workspaceId) => onAddArtifactToWorkspace(entry.artifact, workspaceId)} onDelete={(entry) => onDeleteArtifact(entry.artifact)} /></div>

        <div className="mt-10 border-t border-[var(--border-default)] pt-7">
          <ObjectLibrary entries={artifacts.map((artifact) => ({ artifact }))} workspaces={workspaces} groupBy="workspace" title="All work" subtitle="Artifacts and conversations across your workspaces" showInbox={false} onOpen={(entry) => onOpenArtifact(entry.artifact)} onAddToWorkspace={(entry, workspaceId) => onAddArtifactToWorkspace(entry.artifact, workspaceId)} onCreateArtifact={onCreateArtifact} onDelete={(entry) => onDeleteArtifact(entry.artifact)} />
        </div>
      </div>
    </main>
  );
}

function WorkspaceHeader({
  workspace,
  items,
  runs,
  busy,
  onCreateArtifact,
  onArchiveWorkspace,
}: {
  workspace: SpectraWorkspace | null;
  items: SpectraWorkspaceItem[];
  runs: SpectraRun[];
  busy: string | null;
  onCreateArtifact: (type: SpectraBlueprintKey) => void;
  onArchiveWorkspace: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const createRef = useOutsideClick<HTMLDivElement>(createOpen, () => setCreateOpen(false));
  const artifactCount = items.filter((item) => item.artifact).length;
  const threadCount = workspaceThreadCount(items);
  const cardCount = items.filter((item) => item.viewData.pinned).length;
  const activeRuns = runs.filter((run) => run.status === "running" || run.status === "queued").length;

  return (
    <header className="border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-8 pb-3 pt-7">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate pb-1 font-display text-[34px] font-semibold leading-[1.15] text-[var(--text-primary)]">{workspace?.title ?? "Workspace"}</h1>
            <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] text-[var(--danger)] transition hover:bg-[color-mix(in_oklab,var(--danger)_9%,transparent)]" onClick={onArchiveWorkspace} aria-label="Delete workspace permanently" title="Delete workspace permanently"><Trash2 className="h-4 w-4" /></button>
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
    </header>
  );
}

function WorkspaceLibraryToolbar({ viewMode, onViewModeChange, sort, onSortChange, type, onTypeChange }: { viewMode: ViewMode; onViewModeChange: (mode: ViewMode) => void; sort: WorkspaceSort; onSortChange: (sort: WorkspaceSort) => void; type: "all" | SpectraBlueprintKey; onTypeChange: (type: "all" | SpectraBlueprintKey) => void }) {
  const [sortOpen, setSortOpen] = useState(false);
  const ref = useOutsideClick<HTMLDivElement>(sortOpen, () => setSortOpen(false));
  const sortLabels: Record<WorkspaceSort, string> = { updated: "Recently updated", created: "Recently created", title: "Title A–Z", type: "Artifact type" };
  const types: Array<{ key: "all" | SpectraBlueprintKey; label: string }> = [{ key: "all", label: "All" }, { key: "document", label: "Documents" }, { key: "flashcard_deck", label: "Decks" }, { key: "quiz", label: "Quizzes" }, { key: "planner_task", label: "Tasks" }, { key: "thread_reference", label: "Threads" }];
  return <div className="mt-5 flex flex-wrap items-center gap-2 pb-1" aria-label="Workspace library controls">
    <div className="flex shrink-0 gap-1 overflow-x-auto">{types.map((option) => <button key={option.key} type="button" onClick={() => onTypeChange(option.key)} className={`inline-flex h-9 items-center rounded-[8px] px-3 text-[13px] font-medium transition ${type === option.key ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_1px_7px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--bg-elevated)_68%,transparent)]"}`}>{option.label}</button>)}</div>
    <div className="relative ml-auto" ref={ref}>
      <button type="button" className="flex h-9 min-w-[164px] items-center justify-between gap-3 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[12px] font-medium text-[var(--text-primary)] shadow-[0_1px_4px_rgba(27,20,12,0.04)] hover:bg-[var(--bg-hover)]" onClick={() => setSortOpen((open) => !open)}>{sortLabels[sort]}<ChevronDown className={`h-3.5 w-3.5 text-[var(--text-tertiary)] transition ${sortOpen ? "rotate-180" : ""}`} /></button>
      {sortOpen ? <div className="absolute right-0 top-[calc(100%+7px)] z-40 w-[190px] rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_14px_32px_rgba(27,20,12,0.13)]">{(Object.entries(sortLabels) as Array<[WorkspaceSort, string]>).map(([key, label]) => <button key={key} type="button" className={menuItemClass()} onClick={() => { onSortChange(key); setSortOpen(false); }}>{label}{sort === key ? <CheckCircle2 className="ml-auto h-4 w-4 text-[var(--success)]" /> : null}</button>)}</div> : null}
    </div>
    <nav className="flex items-center gap-1 rounded-[10px] bg-[color-mix(in_oklab,var(--bg-elevated)_72%,transparent)] p-1">
      {viewModes.map((view) => { const Icon = view.icon; return <button key={view.key} type="button" className={`flex h-8 items-center gap-2 rounded-[7px] px-3 text-[12px] font-medium transition ${viewMode === view.key ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_1px_6px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"}`} onClick={() => onViewModeChange(view.key)}><Icon className="h-4 w-4" />{view.label}</button>; })}
    </nav>
  </div>;
}

function WorkspaceContentSkeleton() {
  return <div className="absolute inset-0 z-20 bg-[var(--bg-primary)] px-8 pt-6" aria-label="Loading workspace"><div className="ml-auto h-9 w-[520px] max-w-full animate-pulse rounded-[9px] bg-[var(--bg-secondary)]" /><div className="mt-7 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-[116px] animate-pulse rounded-[10px] bg-[linear-gradient(110deg,var(--bg-secondary),color-mix(in_oklab,var(--bg-elevated)_70%,var(--bg-secondary)),var(--bg-secondary))] [background-size:220%_100%]" style={{ animationDelay: `${index * 55}ms` }} />)}</div></div>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
                  <button type="button" className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]" onClick={() => onHide(entry.item._id)} aria-label="Remove from workspace" title="Remove from workspace">
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
  if (rows.length === 0) {
    return <EmptyWorkspaceState title="No activity yet" message="Runs and object changes will appear here as the workspace becomes active." />;
  }

  return (
    <div className="relative space-y-9 pb-3 pl-8 before:absolute before:bottom-4 before:left-[7px] before:top-3 before:w-px before:bg-[linear-gradient(to_bottom,var(--accent-cyan),color-mix(in_oklab,var(--accent-cyan)_24%,var(--border-default)),transparent)]">
      {dateGroups.map((group, groupIndex) => (
        <section key={group.key} className="relative">
          <span className="absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--bg-primary)] ring-4 ring-[var(--bg-primary)]">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-[var(--accent-cyan)] bg-[var(--bg-elevated)]" />
          </span>
          <header className="mb-3 flex items-baseline gap-3">
            <h2 className="font-display text-[18px] font-semibold text-[var(--text-primary)]">{group.label}</h2>
            <span className="text-[11px] text-[var(--text-tertiary)]">{new Date(Number(group.key)).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">{group.rows.length} {group.rows.length === 1 ? "item" : "items"}</span>
          </header>
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {group.rows.map((row) => {
              const entry = row.entry;
              const active = row.id === selectedId;
              const meta = row.kind === "artifact" && entry ? blueprintMeta[entry.artifact.blueprintKey] : null;
              const RowIcon = meta?.icon;
              const important = row.kind === "artifact" && entry?.item.viewData.pinned;
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`group relative overflow-hidden rounded-[9px] border p-3.5 text-left transition duration-200 hover:-translate-y-0.5 ${row.kind === "run" ? "min-h-[104px] border-[color-mix(in_oklab,var(--accent-cyan)_18%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-elevated))] shadow-[0_5px_18px_rgba(27,20,12,0.05)]" : important ? "min-h-[132px] bg-[color-mix(in_oklab,#b67616_5%,var(--bg-elevated))] shadow-[0_7px_22px_rgba(27,20,12,0.06)] sm:col-span-2 2xl:col-span-1" : "min-h-[116px] bg-[var(--bg-elevated)] shadow-[0_3px_12px_rgba(27,20,12,0.045)]"} ${active ? "border-[#8b6ff0] ring-2 ring-[color-mix(in_oklab,#8b6ff0_10%,transparent)]" : row.kind === "run" ? "" : "border-[var(--border-default)]"}`}
                  style={{ animationDelay: `${groupIndex * 35}ms` }}
                  onClick={() => row.kind === "run" ? onSelectRun(row.run) : entry ? onSelectArtifact(entry.item, entry.artifact) : undefined}
                >
                  <span className="pointer-events-none absolute bottom-0 right-0 h-20 w-32 opacity-35 [background-image:linear-gradient(135deg,transparent_45%,color-mix(in_oklab,var(--accent-cyan)_11%,transparent))]" />
                  <span className="relative flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] bg-[var(--bg-primary)]">
                      {RowIcon && meta ? <RowIcon className="h-4 w-4" style={{ color: meta.color }} /> : <Sparkles className="h-4 w-4 text-[var(--accent-cyan)]" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: meta?.color ?? "var(--accent-cyan)" }}>
                        {row.title}<span className="text-[var(--text-tertiary)]">· {formatRelativeTime(row.time)}</span>
                      </span>
                      <span className="mt-1.5 block truncate text-[14px] font-semibold text-[var(--text-primary)]">{entry?.artifact.title ?? (row.kind === "run" ? row.run.userPrompt : row.title)}</span>
                      <span className="mt-1.5 block line-clamp-2 text-[11px] leading-5 text-[var(--text-secondary)]">{row.summary}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function LibraryView({
  entries,
  mode,
  selected,
  onSelect,
  onTogglePin,
  onRemove,
  onDelete,
  busy,
  onCreateArtifact,
}: {
  entries: Array<{ item: SpectraWorkspaceItem; artifact: SpectraArtifact; card: ReturnType<typeof workspaceItemToCard> }>;
  mode: LibraryMode;
  selected: Selection;
  onSelect: (item: SpectraWorkspaceItem, artifact: SpectraArtifact) => void;
  onTogglePin: (item: SpectraWorkspaceItem) => void;
  onRemove: (item: SpectraWorkspaceItem) => void;
  busy: string | null;
  onCreateArtifact: (blueprintKey: SpectraBlueprintKey) => void;
  onDelete: (artifact: SpectraArtifact) => void;
}) {
  if (entries.length === 0) {
    return <EmptyWorkspaceState title="No library items here" message="Add artifacts to this workspace to group them by type." />;
  }

  return (
    <div className="space-y-7">
      <ObjectLibrary
        entries={entries}
        groupBy="type"
        mode={mode}
        showModeSwitcher={false}
        showHeader={false}
        showToolbar={false}
        selectedArtifactId={selected?.type === "artifact" ? selected.artifactId : undefined}
        busyKey={busy}
        onOpen={(entry) => entry.item && onSelect(entry.item, entry.artifact)}
        onTogglePin={(entry) => entry.item && onTogglePin(entry.item)}
        onRemove={(entry) => entry.item && onRemove(entry.item)}
        onDelete={(entry) => onDelete(entry.artifact)}
        onCreateArtifact={(blueprintKey) => onCreateArtifact(blueprintKey)}
      />
    </div>
  );
}

function WorkspacePinnedShelf({ entries, workspaceTitle, onSelect }: {
  entries: Array<{ item: SpectraWorkspaceItem; artifact: SpectraArtifact; card: ReturnType<typeof workspaceItemToCard> }>;
  workspaceTitle: string;
  onSelect: (item: SpectraWorkspaceItem, artifact: SpectraArtifact) => void;
}) {
  const pinned = entries.filter((entry) => entry.item.viewData.pinned);
  const storageKey = `spectra.workspace.pinned.${workspaceTitle}.open`;
  const [open, setOpen] = useState(true);
  useEffect(() => { setOpen(window.localStorage.getItem(storageKey) !== "false"); }, [storageKey]);
  useEffect(() => { window.localStorage.setItem(storageKey, String(open)); }, [open, storageKey]);
  if (pinned.length === 0) return null;
  return <section className="mb-2 mt-4"><button type="button" onClick={() => setOpen((value) => !value)} className="mb-4 flex w-full items-center gap-2 text-left"><ChevronDown className={`h-4 w-4 text-[var(--text-tertiary)] transition ${open ? "" : "-rotate-90"}`} /><Pin className="h-4 w-4 text-[#b67616]" /><h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">Pinned in {workspaceTitle}</h2><span className="rounded-[6px] bg-[var(--bg-secondary)] px-1.5 text-[12px] text-[var(--text-secondary)]">{pinned.length}</span><span className="ml-1 text-[12px] text-[var(--text-tertiary)]">Important workspace objects</span></button>{open ? <PinnedArtifactShelf artifacts={pinned.map((entry) => entry.artifact)} onSelect={(artifact) => { const entry = pinned.find((candidate) => candidate.artifact._id === artifact._id); if (entry) onSelect(entry.item, entry.artifact); }} /> : null}</section>;
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
    <div className="h-full min-h-full overflow-auto bg-[radial-gradient(var(--border-default)_0.7px,transparent_0.7px)] p-4 [background-size:18px_18px]">
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

function PinnedArtifactShelf({ artifacts, onSelect }: { artifacts: SpectraArtifact[]; onSelect: (artifact: SpectraArtifact) => void }) {
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{artifacts.slice(0, 6).map((artifact) => { const meta = blueprintMeta[artifact.blueprintKey]; const Icon = meta.icon; return <article key={artifact._id} className="relative min-h-[112px] overflow-hidden rounded-[8px] border border-[color-mix(in_oklab,#b67616_18%,var(--border-default))] bg-[linear-gradient(118deg,color-mix(in_oklab,#b67616_5%,var(--bg-elevated)),var(--bg-elevated)_72%)] p-3 shadow-[0_1px_3px_rgba(27,20,12,0.035)]"><span className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-[#b67616]" /><span className="pointer-events-none absolute -bottom-12 -right-10 h-24 w-24 rounded-full border border-[color-mix(in_oklab,#b67616_13%,transparent)]" /><button type="button" className="relative flex w-full items-start gap-2.5 pl-1 text-left" onClick={() => onSelect(artifact)}><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-[var(--bg-primary)]"><Icon className="h-4 w-4" style={{ color: meta.color }} /></span><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{artifact.title}</span><span className="mt-0.5 block truncate text-[11px] text-[var(--text-secondary)]">{artifact.summary ?? meta.label}</span><span className="mt-1 block text-[10px] text-[var(--text-tertiary)]">{meta.label} · {formatRelativeTime(artifact.updatedAt)}</span></span></button></article>; })}</div>;
}

export function WorkspaceShell() {
  const spectraSession = useSpectraSession();
  const [overview, setOverview] = useState<SpectraOverview | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>();
  const [selection, setSelection] = useState<Selection>(null);
  const [composerThread, setComposerThread] = useState<{ id: string; title: string; runId?: string } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [workspaceSort, setWorkspaceSort] = useState<WorkspaceSort>("updated");
  const [workspaceType, setWorkspaceType] = useState<"all" | SpectraBlueprintKey>("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [, setLoading] = useState(true);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [newWorkspaceTitle, setNewWorkspaceTitle] = useState("");
  const [newWorkspaceDescription, setNewWorkspaceDescription] = useState("");
  const [hubTabs, setHubTabs] = useState<WorkspaceHubTab[]>(() => [{ id: "workspace-home-default", label: "Home" }]);
  const [activeHubTabId, setActiveHubTabId] = useState<string | null>("workspace-home-default");
  const [hubTabsRestored, setHubTabsRestored] = useState(false);
  const [studioPanelWidth, setStudioPanelWidth] = useState(720);
  const [threadPanelWidth, setThreadPanelWidth] = useState(560);
  const [threadPanelArtifactId, setThreadPanelArtifactId] = useState<string | null>(null);
  const [pendingCreateType, setPendingCreateType] = useState<SpectraBlueprintKey | null>(null);
  const [workspaceDeleteOpen, setWorkspaceDeleteOpen] = useState(false);
  const [artifactDeletePending, setArtifactDeletePending] = useState<SpectraArtifact | null>(null);
  const [workspaceDeleteConfirmation, setWorkspaceDeleteConfirmation] = useState("");
  const workspaceCreateRef = useOutsideClick<HTMLDivElement>(workspaceCreateOpen, () => setWorkspaceCreateOpen(false));

  const loadOverview = useCallback(async (workspaceId?: string, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const next = await getSpectraOverview(workspaceId, quiet);
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
      if (!quiet) setLoading(false);
    }
  }, []);

  const loadWorkspace = useCallback(async (workspaceId: string, force = false) => {
    const cached = !force ? peekSpectraWorkspace(workspaceId) : null;
    if (cached) {
      setSelectedWorkspaceId(workspaceId);
      setOverview((current) => current ? { ...current, selectedWorkspaceId: workspaceId, workspace: cached } : current);
      return;
    }
    setWorkspaceLoading(true);
    try {
      const result = await getSpectraWorkspace(workspaceId, force);
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
      setWorkspaceLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("spectra.workspace.hubTabs.v1") ?? "null") as { tabs?: WorkspaceHubTab[]; activeId?: string | null } | null;
      if (saved?.tabs?.length) { setHubTabs(saved.tabs.slice(0, 16)); setActiveHubTabId(saved.activeId ?? saved.tabs[0]?.id ?? null); }
    } catch { window.localStorage.removeItem("spectra.workspace.hubTabs.v1"); }
    setHubTabsRestored(true);
  }, []);
  useEffect(() => { if (hubTabsRestored) window.localStorage.setItem("spectra.workspace.hubTabs.v1", JSON.stringify({ tabs: hubTabs, activeId: activeHubTabId })); }, [activeHubTabId, hubTabs, hubTabsRestored]);
  useEffect(() => {
    if (!hubTabsRestored || !overview || selectedWorkspaceId) return;
    const active = hubTabs.find((tab) => tab.id === activeHubTabId);
    if (active?.workspaceId) void loadWorkspace(active.workspaceId);
  }, [activeHubTabId, hubTabs, hubTabsRestored, loadWorkspace, overview, selectedWorkspaceId]);

  const workspace = selectedWorkspaceId && overview?.workspace?.workspace?._id === selectedWorkspaceId ? overview.workspace.workspace : null;
  const allArtifacts = overview?.artifacts ?? [];
  const runs = overview?.runs ?? [];
  const studio = useArtifactStudioState("spectra.shared.artifactStudio", allArtifacts);
  const threadPanelArtifact = allArtifacts.find((artifact) => artifact._id === threadPanelArtifactId && artifact.blueprintKey === "thread_reference") ?? null;
  const workspaceRuns = selectedWorkspaceId ? runs.filter((run) => run.workspaceId === selectedWorkspaceId) : runs;
  const workspaces = useMemo(() => sortSpectraWorkspaces(overview?.workspaces ?? []), [overview?.workspaces]);
  const workspaceHeader = workspace ?? workspaces.find((candidate) => candidate._id === selectedWorkspaceId) ?? null;
  const entries = useMemo(() => (selectedWorkspaceId && overview?.workspace?.workspace?._id === selectedWorkspaceId ? overview.workspace.items : [])
    .map((item) => {
      const card = workspaceItemToCard(item);
      return item.artifact && card ? { item, artifact: item.artifact, card } : null;
    })
    .filter((entry): entry is { item: SpectraWorkspaceItem; artifact: SpectraArtifact; card: NonNullable<ReturnType<typeof workspaceItemToCard>> } => Boolean(entry)), [overview?.workspace, selectedWorkspaceId]);
  const visibleEntries = useMemo(() => entries.filter((entry) => workspaceType === "all" || entry.artifact.blueprintKey === workspaceType).sort((a, b) => {
    if (workspaceSort === "created") return b.artifact.createdAt - a.artifact.createdAt;
    if (workspaceSort === "title") return a.artifact.title.localeCompare(b.artifact.title);
    if (workspaceSort === "type") return a.artifact.blueprintKey.localeCompare(b.artifact.blueprintKey) || a.artifact.title.localeCompare(b.artifact.title);
    return b.artifact.updatedAt - a.artifact.updatedAt;
  }), [entries, workspaceSort, workspaceType]);
  const selectedArtifact = selection?.type === "artifact" ? entries.find((entry) => entry.item._id === selection.itemId)?.artifact ?? null : null;
  const commandFocusArtifact = studio.isOpen ? studio.activeArtifact : threadPanelArtifact ?? selectedArtifact;
  const initialResultCards = useMemo(
    () => (overview?.resultCards ?? []).filter((card) => card.run?.sourceSurface !== "chat"),
    [overview?.resultCards],
  );
  const runEngine = useSpectraRun({
    surface: composerThread ? "workspace" : commandFocusArtifact ? "artifact" : "workspace",
    workspaceId: selectedWorkspaceId,
    artifactId: commandFocusArtifact?._id,
    threadId: composerThread?.id,
    initialCards: initialResultCards,
    onDataChanged: () => loadOverview(selectedWorkspaceId, true),
    onOpenArtifact: async (artifactId) => {
      const refreshed = await loadOverview(selectedWorkspaceId, true);
      const artifact = refreshed?.artifacts.find((item) => item._id === artifactId);
      if (artifact) openArtifactPanel(artifact);
    },
  });

  function openArtifactPanel(artifact: SpectraArtifact) {
    if (artifact.blueprintKey === "thread_reference") {
      spectraSession.clearActivePanel();
      setThreadPanelArtifactId(artifact._id);
      return;
    }
    studio.openSplit(artifact);
  }

  function toggleContinuedThread(threadId: string, title: string, runId?: string) {
    setComposerThread((current) => current?.id === threadId ? null : { id: threadId, title, runId });
  }

  function setActiveHubDestination(label: string, workspaceId?: string) {
    studio.closeStudio();
    setThreadPanelArtifactId(null);
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
    setViewMode("list");
    setSelectedWorkspaceId(workspaceId);
    void loadWorkspace(workspaceId);
  }

  function goToHomeHub() {
    setActiveHubDestination("Home");
    setSelection(null);
    setSelectedWorkspaceId(undefined);
  }

  function activateHubTab(tabId: string) {
    const tab = hubTabs.find((item) => item.id === tabId);
    if (!tab) return;
    setActiveHubTabId(tabId);
    studio.closeStudio();
    setThreadPanelArtifactId(null);
    setSelection(null);
    if (tab.workspaceId) void loadWorkspace(tab.workspaceId);
    else {
      setSelectedWorkspaceId(undefined);
    }
  }

  function addHomeHubTab() {
    const next = workspaceHubTab();
    setHubTabs((current) => [...current, next]);
    setActiveHubTabId(next.id);
    studio.closeStudio();
    setThreadPanelArtifactId(null);
    setSelection(null);
    setSelectedWorkspaceId(undefined);
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
    if (!selectedWorkspaceId) {
      setPendingCreateType(blueprintKey);
      return;
    }
    void createArtifact(createDefaultArtifactPayload(blueprintKey), selectedWorkspaceId);
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
      await loadOverview(selectedWorkspaceId, true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update artifact.");
    } finally {
      setBusyKey(null);
    }
  }

  async function revertArtifactVersion(artifactId: string, versionId: string) {
    setBusyKey(`artifact:revert:${artifactId}`);
    try {
      await postSpectra({ action: "revertArtifactVersion", artifactId, versionId });
      toast.success("Artifact restored to the selected version.");
      await loadOverview(selectedWorkspaceId, true);
    } finally { setBusyKey(null); }
  }

  async function archiveArtifact(artifact: SpectraArtifact) {
    setBusyKey(`artifact:archive:${artifact._id}`);
    try {
      await postSpectra({ action: "archiveArtifact", artifactId: artifact._id });
      toast.success("Artifact archived.");
      returnToHub();
      await loadOverview(selectedWorkspaceId, true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not archive artifact.");
    } finally {
      setBusyKey(null);
    }
  }

  async function permanentlyDeleteArtifact(artifact: SpectraArtifact, confirmed = false) {
    if (!confirmed) { setArtifactDeletePending(artifact); return; }
    setBusyKey(`delete:${artifact._id}`);
    try {
      await postSpectra({ action: "deleteArtifact", artifactId: artifact._id });
      toast.success("Artifact permanently deleted.");
      setArtifactDeletePending(null);
      if (studio.activeArtifact?._id === artifact._id) returnToHub();
      await loadOverview(selectedWorkspaceId, true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete artifact.");
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
      if (selectedWorkspaceId) await loadWorkspace(selectedWorkspaceId, true);
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
      if (selectedWorkspaceId === workspaceId) await loadWorkspace(workspaceId, true);
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
      if (selectedWorkspaceId) await loadWorkspace(selectedWorkspaceId, true);
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
      setViewMode("list");
      setActiveHubDestination(title, result.workspaceId);
      await loadOverview(result.workspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create workspace.");
    } finally {
      setBusyKey(null);
    }
  }

  async function permanentlyDeleteWorkspace() {
    if (!selectedWorkspaceId || !workspace) return;
    const expected = `Remove ${workspace.title} permanently`;
    if (workspaceDeleteConfirmation !== expected) return;
    setBusyKey(`workspace:delete:${selectedWorkspaceId}`);
    try {
      await postSpectra({ action: "deleteWorkspace", workspaceId: selectedWorkspaceId, confirmation: workspaceDeleteConfirmation });
      toast.success("Workspace permanently removed.");
      setWorkspaceDeleteOpen(false);
      setWorkspaceDeleteConfirmation("");
      setSelection(null);
      setViewMode("list");
      setActiveHubDestination("Home");
      await loadOverview(undefined, true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete workspace.");
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
      {pendingCreateType ? (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-primary)_72%,transparent)] backdrop-blur-[2px]" onPointerDown={() => setPendingCreateType(null)}>
          <div className="w-[390px] rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[0_24px_70px_rgba(27,20,12,0.2)]" onPointerDown={(event) => event.stopPropagation()}>
            <h2 className="font-display text-[19px] font-semibold text-[var(--text-primary)]">Where should this {blueprintMeta[pendingCreateType].label.toLowerCase()} live?</h2>
            <p className="mt-1 text-[12px] text-[var(--text-secondary)]">Choose a workspace or keep it unplaced.</p>
            <div className="mt-4 max-h-[300px] space-y-1 overflow-y-auto">
              <button type="button" className={menuItemClass()} onClick={() => { const type = pendingCreateType; setPendingCreateType(null); void createArtifact(createDefaultArtifactPayload(type), undefined); }}><Home className="h-4 w-4" />Unplaced / inbox</button>
              {workspaces.map((target) => <button key={target._id} type="button" className={menuItemClass()} onClick={() => { const type = pendingCreateType; setPendingCreateType(null); void createArtifact(createDefaultArtifactPayload(type), target._id); }}><span className="h-2.5 w-2.5 rounded-full" style={{ background: workspaceAccent(target, 0).color }} />{target.title}</button>)}
            </div>
          </div>
        </div>
      ) : null}
      {workspaceDeleteOpen && workspace ? (
        <div className="absolute inset-0 z-[95] flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-primary)_76%,transparent)] backdrop-blur-[2px]" onPointerDown={() => setWorkspaceDeleteOpen(false)}>
          <div className="w-[480px] rounded-[12px] border border-[color-mix(in_oklab,var(--danger)_28%,var(--border-default))] bg-[var(--bg-elevated)] p-5 shadow-[0_24px_70px_rgba(27,20,12,0.22)]" onPointerDown={(event) => event.stopPropagation()}>
            <h2 className="font-display text-[21px] font-semibold text-[var(--text-primary)]">Permanently remove {workspace.title}?</h2>
            <p className="mt-2 text-[13px] leading-5 text-[var(--text-secondary)]">Workspace-only artifacts, placements, runs, operations, and result cards will be deleted. Artifacts also placed elsewhere remain available there.</p>
            <label className="mt-4 block text-[12px] font-medium text-[var(--text-primary)]">Type <span className="select-all font-mono">Remove {workspace.title} permanently</span></label>
            <input autoFocus value={workspaceDeleteConfirmation} onChange={(event) => setWorkspaceDeleteConfirmation(event.target.value)} className="mt-2 h-10 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] text-[var(--text-primary)] outline-none" />
            <div className="mt-4 flex justify-end gap-2"><button type="button" className={smallButtonClass()} onClick={() => setWorkspaceDeleteOpen(false)}>Cancel</button><button type="button" className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[var(--danger)] px-3 text-[13px] font-medium text-white disabled:opacity-40" disabled={workspaceDeleteConfirmation !== `Remove ${workspace.title} permanently` || busyKey === `workspace:delete:${selectedWorkspaceId}`} onClick={() => void permanentlyDeleteWorkspace()}>{busyKey === `workspace:delete:${selectedWorkspaceId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Delete permanently</button></div>
          </div>
        </div>
      ) : null}
      {artifactDeletePending ? <div className="absolute inset-0 z-[96] flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-primary)_76%,transparent)] p-5 backdrop-blur-[2px]" onPointerDown={() => setArtifactDeletePending(null)}><div className="w-full max-w-[440px] rounded-[12px] border border-[color-mix(in_oklab,var(--danger)_24%,var(--border-default))] bg-[var(--bg-elevated)] p-5 shadow-[0_24px_70px_rgba(27,20,12,0.2)]" onPointerDown={(event) => event.stopPropagation()}><h2 className="font-display text-[21px] font-semibold text-[var(--text-primary)]">Delete {artifactDeletePending.title}?</h2><p className="mt-2 text-[13px] leading-5 text-[var(--text-secondary)]">The artifact, its placements, version history, and directly linked run history will be permanently removed.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setArtifactDeletePending(null)} className={smallButtonClass()}>Cancel</button><button type="button" disabled={busyKey === `delete:${artifactDeletePending._id}`} onClick={() => void permanentlyDeleteArtifact(artifactDeletePending, true)} className="flex h-9 items-center gap-2 rounded-[8px] bg-[var(--danger)] px-3 text-[12px] font-medium text-white disabled:opacity-45">{busyKey === `delete:${artifactDeletePending._id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Delete permanently</button></div></div></div> : null}
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
          onRevert={revertArtifactVersion}
          onArchive={archiveArtifact}
          onDirtyChange={studio.setDirty}
        />
      ) : !selectedWorkspaceId ? (
        <section className="flex min-w-0 flex-1">
          <WorkspaceHome overview={overview ? { ...overview, workspaces } : overview} onSelect={goToWorkspaceHub} onOpenArtifact={openArtifactPanel} onAddArtifactToWorkspace={(artifact, workspaceId) => void addArtifactToWorkspace(artifact, workspaceId)} onCreateArtifact={(blueprintKey, workspaceId) => workspaceId ? void createArtifact(createDefaultArtifactPayload(blueprintKey), workspaceId) : openCreateArtifact(blueprintKey)} onDeleteArtifact={(artifact) => void permanentlyDeleteArtifact(artifact)} />
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
              onClose={studio.closeStudio}
              onExpand={studio.openTab}
              onActivateTab={studio.activateTab}
              onCloseTab={closeArtifactTab}
              onSave={updateArtifact}
              onRevert={revertArtifactVersion}
              onArchive={archiveArtifact}
              onDirtyChange={studio.setDirty}
            />
          ) : null}
        </section>
      ) : (
        <section className="flex min-w-0 flex-1">
          <>
          <div className="flex min-w-0 flex-1 flex-col">
            <WorkspaceHeader workspace={workspaceHeader} items={entries.map((entry) => entry.item)} runs={workspaceRuns} busy={busyKey} onCreateArtifact={openCreateArtifact} onArchiveWorkspace={() => { setWorkspaceDeleteConfirmation(""); setWorkspaceDeleteOpen(true); }} />
            <main className={viewMode === "canvas" ? "relative min-h-0 flex-1 overflow-hidden px-8 pb-[110px] pt-6" : "relative min-h-0 flex-1 overflow-y-auto px-8 pb-[150px] pt-6"}>
              {workspaceLoading && !workspace ? <WorkspaceContentSkeleton /> : null}
              <WorkspacePinnedShelf entries={entries} workspaceTitle={workspace?.title ?? "Workspace"} onSelect={(item, artifact) => { setSelection({ type: "artifact", itemId: item._id, artifactId: artifact._id }); openArtifactPanel(artifact); }} />
              <section className="mt-10">
                <h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">Workspace library</h2>
                <p className="mt-1 text-[13px] text-[var(--text-secondary)]">Objects, activity, and working views for this workspace.</p>
                <WorkspaceLibraryToolbar viewMode={viewMode} onViewModeChange={setViewMode} sort={workspaceSort} onSortChange={setWorkspaceSort} type={workspaceType} onTypeChange={setWorkspaceType} />
              </section>
              {viewMode === "timeline" ? (
                <TimelineView
                  entries={visibleEntries}
                  runs={workspaceRuns}
                  selected={selection}
                  onSelectRun={(run) => {
                    const card = runEngine.cards.find((candidate) => candidate.runId === run._id);
                    if (card) {
                      if (studio.activeArtifact && studio.dirtyIds.has(studio.activeArtifact._id)) { toast.message("Save or discard the open artifact before opening run details."); return; }
                      setThreadPanelArtifactId(null);
                      spectraSession.openLocalThread(card.runId, run.userPrompt);
                    }
                    else setSelection({ type: "run", runId: run._id });
                  }}
                  onSelectArtifact={(item, artifact) => {
                    setSelection({ type: "artifact", itemId: item._id, artifactId: artifact._id });
                    openArtifactPanel(artifact);
                  }}
                />
              ) : null}
              {viewMode === "list" || viewMode === "board" ? <LibraryView entries={visibleEntries} mode={viewMode} selected={selection} onSelect={(item, artifact) => {
                setSelection({ type: "artifact", itemId: item._id, artifactId: artifact._id });
                openArtifactPanel(artifact);
              }} onTogglePin={(item) => void toggleWorkspaceItemPin(item)} onRemove={(item) => void hideWorkspaceItem(item._id)} onDelete={(artifact) => void permanentlyDeleteArtifact(artifact)} busy={busyKey} onCreateArtifact={openCreateArtifact} /> : null}
              {viewMode === "canvas" ? <CanvasView entries={visibleEntries} selectedArtifact={selectedArtifact} onSelect={(item, artifact) => {
                setSelection({ type: "artifact", itemId: item._id, artifactId: artifact._id });
                openArtifactPanel(artifact);
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
              onClose={studio.closeStudio}
              onExpand={studio.openTab}
              onActivateTab={studio.activateTab}
              onCloseTab={closeArtifactTab}
              onSave={updateArtifact}
              onRevert={revertArtifactVersion}
              onArchive={archiveArtifact}
              onDirtyChange={studio.setDirty}
            />
          ) : null}
          </>
        </section>
      )}
          {threadPanelArtifact ? <ArtifactStudio mode="split" artifact={threadPanelArtifact} artifacts={allArtifacts} tabs={[]} dirtyIds={new Set()} panelWidth={threadPanelWidth} sourceLabel={workspace?.title ?? "Workspace"} onPanelWidthChange={setThreadPanelWidth} onClose={() => setThreadPanelArtifactId(null)} onExpand={openArtifactPanel} onActivateTab={() => undefined} onCloseTab={() => setThreadPanelArtifactId(null)} onSave={updateArtifact} onRevert={revertArtifactVersion} onArchive={archiveArtifact} onDirtyChange={() => undefined} onContinueThread={(threadId, title) => toggleContinuedThread(threadId, title)} continuedThreadId={composerThread?.id} /> : null}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-50 bg-[linear-gradient(to_top,var(--bg-primary)_72%,transparent)] px-8 pb-5 pt-12">
            <div className="pointer-events-auto mx-auto max-w-[880px]">
              <LocalThreadTabs activeThreadId={composerThread?.id} activeRunId={composerThread?.runId} onContinue={(thread) => setComposerThread(thread ? { id: thread.threadId, title: thread.title, runId: thread.runId } : null)} onOpen={(runId) => { setThreadPanelArtifactId(null); spectraSession.activateLocalThread(runId); }} />
              <ResultCardStack cards={runEngine.cards} className="mb-1.5 ml-[52px]" onOpen={(card) => { setThreadPanelArtifactId(null); spectraSession.openLocalThread(card.runId, card.summary ?? card.title); }} onAction={(card, action, targetId) => void runEngine.onCardAction(card, action, targetId)} />
              <CommandBar
                placeholder={composerThread ? `Continue ${composerThread.title}...` : commandFocusArtifact ? `Act on ${commandFocusArtifact.title}...` : workspace ? `Work with ${workspace.title}...` : "Ask across all workspaces and objects..."}
                onSubmit={(prompt, attachments) => {
                  if (commandFocusArtifact && studio.dirtyIds.has(commandFocusArtifact._id)) {
                    toast.message("Save this artifact before asking Spectra to update it.");
                    return false;
                  }
                  void runEngine.run(prompt, attachments);
                  return true;
                }}
                busy={runEngine.submitting}
                onStop={runEngine.stop}
                context={<span className="flex max-w-[220px] items-center gap-1.5 text-[11px] text-[var(--text-secondary)]" title={composerThread ? `Continuing ${composerThread.title}${commandFocusArtifact ? ` with ${commandFocusArtifact.title} in focus` : ""}` : commandFocusArtifact?.title ?? workspace?.title ?? "All workspaces"}>{composerThread ? <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[#7256dc]" /> : commandFocusArtifact ? <FileText className="h-3.5 w-3.5 shrink-0" /> : workspace ? <BookOpen className="h-3.5 w-3.5 shrink-0" /> : <Sparkles className="h-3.5 w-3.5 shrink-0" />}<span className="truncate">{composerThread ? `Continue · ${composerThread.title}` : commandFocusArtifact?.title ?? workspace?.title ?? "Global"}</span>{composerThread ? <button type="button" onClick={() => setComposerThread(null)} className="ml-1 flex h-5 w-5 items-center justify-center rounded-[5px] hover:bg-[var(--bg-hover)]" aria-label="Stop continuing chat" title="Stop continuing chat"><X className="h-3 w-3" /></button> : null}</span>}
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
                  </div>
                )}
              />
            </div>
          </div>
          {spectraSession.activeLocalThreadRunId ? (
            <RunDetailPanel
              runId={spectraSession.activeLocalThreadRunId}
              card={runEngine.cards.find((card) => card.runId === spectraSession.activeLocalThreadRunId)}
              onClose={spectraSession.clearActivePanel}
              onAction={(card, action, targetId) => { if (action === "open") runEngine.closeDetails(); void runEngine.onCardAction(card, action, targetId); }}
              onUseThread={(id, title) => toggleContinuedThread(id, title, spectraSession.activeLocalThreadRunId ?? undefined)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
