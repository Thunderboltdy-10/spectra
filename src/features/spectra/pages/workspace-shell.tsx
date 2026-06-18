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
  LayoutGrid,
  List,
  Loader2,
  MessageSquare,
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
import { ArtifactBlueprintSheet, type ArtifactPayload } from "../components/artifact-blueprint-sheet";
import { ArtifactCard, blueprintMeta } from "../components/artifact-card";
import { CommandBar } from "../components/command-bar";
import { ResultCardStack, type ResultCardView } from "../components/result-card";
import {
  artifactsByDemoKey,
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

type ViewMode = "cards" | "timeline" | "library" | "canvas";
type Selection = { type: "artifact"; itemId: string; artifactId: string } | { type: "run"; runId: string } | null;

const createTypes: Array<{ key: SpectraBlueprintKey; label: string; icon: LucideIcon }> = [
  { key: "document", label: "Document", icon: FileText },
  { key: "flashcard_deck", label: "Deck", icon: BookOpen },
  { key: "quiz", label: "Quiz", icon: HelpCircle },
  { key: "planner_task", label: "Task", icon: CalendarCheck2 },
  { key: "thread_reference", label: "Thread reference", icon: MessageSquare },
];

const viewModes: Array<{ key: ViewMode; label: string; icon: LucideIcon }> = [
  { key: "cards", label: "Cards", icon: LayoutGrid },
  { key: "timeline", label: "Timeline", icon: Rows3 },
  { key: "library", label: "Library", icon: BookOpen },
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
        className={`flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-[8px] border text-[11px] font-medium ${
          !selectedWorkspaceId ? "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_2px_8px_rgba(27,20,12,0.05)]" : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
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
              className={`flex w-14 flex-col items-center gap-1 rounded-[8px] border px-1.5 py-2 text-[11px] font-medium ${
                selected ? "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_2px_8px_rgba(27,20,12,0.05)]" : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
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
}: {
  overview: SpectraOverview | null;
  onSelect: (workspaceId: string) => void;
}) {
  const workspaces = overview?.workspaces ?? [];
  const artifacts = overview?.artifacts ?? [];
  const recent = artifacts.slice(0, 5);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_34%_0%,color-mix(in_oklab,var(--bg-elevated)_68%,transparent),transparent_38%),var(--bg-primary)] px-8 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-end justify-between gap-5">
          <div>
            <h1 className="font-display text-[34px] font-semibold leading-none text-[var(--text-primary)]">Workspace Home</h1>
            <p className="mt-3 text-[14px] text-[var(--text-secondary)]">Choose a workspace to continue your school work.</p>
          </div>
          <div className="hidden items-center gap-5 text-[12px] text-[var(--text-secondary)] md:flex">
            <span>{workspaces.length} workspaces</span>
            <span>{artifacts.length} artifacts</span>
          </div>
        </div>
        <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid content-start gap-4 md:grid-cols-2">
          {workspaces.map((workspace, index) => {
            const accent = workspaceAccent(workspace, index);
            const Icon = iconForWorkspace(workspace, index);
            const count = workspaceArtifactCount(workspace, artifacts);
            return (
              <button
                key={workspace._id}
                type="button"
                className="group relative min-h-[182px] overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 text-left shadow-[0_12px_32px_rgba(27,20,12,0.045)] transition duration-200 hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--text-tertiary)_38%,var(--border-default))]"
                style={{
                  background: `radial-gradient(circle at 88% 20%, color-mix(in oklab, ${accent.color} 15%, transparent) 0 20%, transparent 21%), linear-gradient(135deg, ${accent.soft}, var(--bg-elevated) 62%)`,
                }}
                onClick={() => onSelect(workspace._id)}
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1" style={{ background: accent.color }} />
                <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:radial-gradient(color-mix(in_oklab,var(--text-primary)_16%,transparent)_0.45px,transparent_0.45px)] [background-size:7px_7px]" />
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] text-white" style={{ background: accent.color }}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[22px] font-semibold leading-tight text-[var(--text-primary)]">{workspace.title}</span>
                    <span className="mt-1 line-clamp-2 block text-[12px] leading-5 text-[var(--text-secondary)]">{workspace.description}</span>
                    <span className="mt-6 flex items-center gap-3 text-[11px] text-[var(--text-tertiary)]">
                      <span className="rounded-[7px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_70%,transparent)] px-2 py-1">{count} artifacts</span>
                      <span>Updated {formatRelativeTime(workspace.lastActivityAt)}</span>
                    </span>
                  </span>
                </div>
              </button>
            );
          })}
          </div>
          <aside className="rounded-[8px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_78%,transparent)] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Recent activity</h2>
              <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
            </div>
            <div className="mt-4 space-y-3">
              {recent.map((artifact) => {
                const meta = blueprintMeta[artifact.blueprintKey];
                const Icon = meta.icon;
                return (
                  <div key={artifact._id} className="flex items-center gap-3">
                    <Icon className="h-4 w-4 shrink-0" style={{ color: meta.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-[var(--text-primary)]">{artifact.title}</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">{formatRelativeTime(artifact.updatedAt)}</div>
                    </div>
                  </div>
                );
              })}
              {recent.length === 0 ? <div className="text-[13px] text-[var(--text-secondary)]">No recent artifacts yet.</div> : null}
            </div>
          </aside>
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
}: {
  workspace: SpectraWorkspace | null;
  items: SpectraWorkspaceItem[];
  runs: SpectraRun[];
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  busy: string | null;
  onCreateArtifact: (type: SpectraBlueprintKey) => void;
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
            <h1 className="truncate font-display text-[34px] font-semibold leading-none text-[var(--text-primary)]">{workspace?.title ?? "Workspace"}</h1>
            <ChevronDown className="h-4 w-4 text-[var(--text-secondary)]" />
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
        <div className="flex items-center gap-2"><BookOpen className="h-4 w-4" /><strong className="text-[var(--text-primary)]">{cardCount || 4}</strong><span>Cards</span></div>
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
  const runRows = runs.slice(0, 5).map((run, index) => ({
    id: `run:${run._id}`,
    kind: "run" as const,
    run,
    entry: entries.find((candidate) => candidate.artifact._id === run.artifactId) ?? entries[index],
    title: run.userPrompt,
    summary: run.finalSummary ?? run.error ?? "Workspace run activity.",
    time: run.createdAt,
  }));
  const artifactRows = entries.slice(0, 6).map((entry) => ({
    id: `artifact:${entry.item._id}`,
    kind: "artifact" as const,
    entry,
    title: `${entry.card ? blueprintMeta[entry.card.blueprintKey].label : "Artifact"} updated: ${entry.artifact.title}`,
    summary: entry.artifact.summary ?? entry.card?.summary ?? "Object updated in this workspace.",
    time: entry.item.updatedAt,
  }));
  const rows = (runRows.length > 0 ? runRows : artifactRows).sort((a, b) => b.time - a.time);

  if (rows.length === 0) {
    return <EmptyWorkspaceState title="No activity yet" message="Runs and object changes will appear here as the workspace becomes active." />;
  }

  return (
    <div className="space-y-8">
      {["Today", "Yesterday", "Earlier this week"].map((group, groupIndex) => (
        <section key={group}>
          <h2 className="mb-3 font-display text-[17px] font-semibold text-[var(--text-primary)]">{group}</h2>
          <div className="relative space-y-3 pl-24 before:absolute before:left-[13px] before:top-0 before:h-full before:w-px before:bg-[var(--border-default)]">
            {rows.slice(groupIndex * 2, groupIndex * 2 + 2).map((row) => {
              const entry = row.entry;
              const selectedRun = row.kind === "run" && selected?.type === "run" && selected.runId === row.run._id;
              const selectedArtifact = row.kind === "artifact" && selected?.type === "artifact" && selected.itemId === entry.item._id;
              const card = entry?.card;
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`relative w-full rounded-[8px] border bg-[var(--bg-elevated)] p-4 text-left ${
                    selectedRun || selectedArtifact ? "border-[#8b6ff0]" : "border-[var(--border-default)] hover:bg-[color-mix(in_oklab,var(--bg-hover)_55%,var(--bg-elevated))]"
                  }`}
                  onClick={() => row.kind === "run" ? onSelectRun(row.run) : onSelectArtifact(entry.item, entry.artifact)}
                >
                  <span className="absolute -left-[91px] top-4 flex items-center gap-3 text-[12px] text-[var(--text-secondary)]">
                    <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                    {formatRelativeTime(row.time)}
                  </span>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold text-[var(--text-primary)]">{row.title}</div>
                      <p className="mt-1 line-clamp-2 text-[12px] text-[var(--text-secondary)]">{row.summary}</p>
                      {card ? (
                        <div className="mt-4 max-w-[520px] rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
                          <div className="flex items-center gap-3">
                            {(() => {
                              const meta = blueprintMeta[card.blueprintKey];
                              const Icon = meta.icon;
                              return <Icon className="h-5 w-5" style={{ color: meta.color }} />;
                            })()}
                            <div>
                              <div className="text-[12px] text-[var(--text-secondary)]">{blueprintMeta[card.blueprintKey].label}</div>
                              <div className="text-[14px] font-semibold text-[var(--text-primary)]">{card.title}</div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[var(--border-default)]">→</span>
                  </div>
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
  selected,
  onSelect,
}: {
  entries: Array<{ item: SpectraWorkspaceItem; artifact: SpectraArtifact; card: ReturnType<typeof workspaceItemToCard> }>;
  selected: Selection;
  onSelect: (item: SpectraWorkspaceItem, artifact: SpectraArtifact) => void;
}) {
  if (entries.length === 0) {
    return <EmptyWorkspaceState title="No library items here" message="Add artifacts to this workspace to group them by type." />;
  }

  const groups = createTypes.map((type) => ({
    key: type.key,
    label: type.label,
    icon: type.icon,
    entries: entries.filter((entry) => entry.artifact.blueprintKey === type.key),
  }));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {groups.map((group) => {
        const Icon = group.icon;
        return (
          <section key={group.key} className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)]">
            <div className="flex h-11 items-center justify-between border-b border-[var(--border-default)] px-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]"><Icon className="h-4 w-4" />{group.label}</div>
              <span className="text-[12px] text-[var(--text-tertiary)]">{group.entries.length}</span>
            </div>
            {group.entries.map((entry) => entry.card ? (
              <button
                key={entry.item._id}
                type="button"
                className={`flex w-full items-center justify-between gap-3 border-b border-[var(--border-default)] px-3 py-3 text-left last:border-b-0 ${
                  selected?.type === "artifact" && selected.itemId === entry.item._id ? "bg-[color-mix(in_oklab,#8b6ff0_5%,var(--bg-elevated))]" : "hover:bg-[var(--bg-hover)]"
                }`}
                onClick={() => onSelect(entry.item, entry.artifact)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-[var(--text-primary)]">{entry.card.title}</span>
                  <span className="block truncate text-[11px] text-[var(--text-secondary)]">{entry.card.summary}</span>
                </span>
                <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">{formatShortDate(entry.item.updatedAt)}</span>
              </button>
            ) : null)}
          </section>
        );
      })}
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
  const byKey = artifactsByDemoKey(entries.map((entry) => entry.artifact));
  const centerEntry = entries.find((entry) => entry.artifact._id === selectedArtifact?._id)
    ?? entries.find((entry) => entry.artifact.title === "Photosynthesis comparison")
    ?? entries[0];
  const clusters = [
    { title: "Photosynthesis & Light", keys: ["photosynthesis-overview", "light-dependent-reactions", "calvin-cycle-summary"], x: "3%", y: "4%", color: "#2fa66f" },
    { title: "Cellular Respiration", keys: ["cell-respiration-notes", "glycolysis-summary", "krebs-cycle-overview"], x: "3%", y: "44%", color: "#d88922" },
    { title: "Assessment", keys: ["respiration-check"], x: "70%", y: "5%", color: "#8b6ff0" },
    { title: "Practice & Review", keys: ["chapter-5-flashcards", "biology-midterm-deck"], x: "70%", y: "36%", color: "#2f95d8" },
    { title: "Analysis", keys: ["respiration-data-analysis"], x: "38%", y: "68%", color: "#2fa698" },
    { title: "Next Steps", keys: ["enzyme-activity-factors"], x: "72%", y: "65%", color: "#42a875" },
  ];

  return (
    <div className="relative min-h-[640px] overflow-hidden rounded-[8px] border border-[var(--border-default)] bg-[radial-gradient(var(--border-default)_0.7px,transparent_0.7px)] [background-size:18px_18px]">
      <svg className="pointer-events-none absolute inset-0 h-full w-full text-[var(--border-default)]" aria-hidden="true">
        <path d="M 330 150 C 430 150 430 245 535 245" fill="none" stroke="currentColor" strokeDasharray="4 5" />
        <path d="M 330 365 C 430 365 430 285 535 285" fill="none" stroke="currentColor" strokeDasharray="4 5" />
        <path d="M 660 245 C 770 245 770 155 895 155" fill="none" stroke="currentColor" strokeDasharray="4 5" />
        <path d="M 620 390 C 630 470 635 500 645 552" fill="none" stroke="currentColor" strokeDasharray="4 5" />
      </svg>
      {clusters.map((cluster) => {
        const keyed = cluster.keys
          .map((key) => {
            const artifact = byKey.get(key);
            return artifact ? entries.find((candidate) => candidate.artifact._id === artifact._id) : undefined;
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
        const fallback = entries.filter((entry) => {
          if (cluster.title.includes("Assessment")) return entry.artifact.blueprintKey === "quiz";
          if (cluster.title.includes("Practice")) return entry.artifact.blueprintKey === "flashcard_deck" || entry.artifact.blueprintKey === "planner_task";
          if (cluster.title.includes("Analysis")) return entry.artifact.blueprintKey === "thread_reference";
          if (cluster.title.includes("Next")) return entry.artifact.blueprintKey === "planner_task" || entry.artifact.blueprintKey === "document";
          return entry.artifact.blueprintKey === "document" || entry.artifact.blueprintKey === "thread_reference";
        });
        const clusterEntries = (keyed.length > 0 ? keyed : fallback).filter((entry) => entry.item._id !== centerEntry?.item._id).slice(0, 3);
        return (
          <div
            key={cluster.title}
            className="absolute w-[280px] rounded-[14px] border p-4 shadow-[0_10px_28px_rgba(27,20,12,0.05)]"
            style={{ left: cluster.x, top: cluster.y, borderColor: `color-mix(in oklab, ${cluster.color} 20%, var(--border-default))`, background: `linear-gradient(135deg,color-mix(in oklab, ${cluster.color} 10%, var(--bg-elevated)),color-mix(in oklab,var(--bg-elevated)_76%,transparent))` }}
          >
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold" style={{ color: cluster.color }}>
              <span className="h-7 w-7 rounded-[8px] bg-[color-mix(in_oklab,currentColor_12%,white)]" />
              {cluster.title}
            </div>
            <div className="grid gap-2">
              {clusterEntries.map((entry) => {
                const meta = blueprintMeta[entry.artifact.blueprintKey];
                const Icon = meta.icon;
                return (
                  <button key={entry.item._id} type="button" className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 text-left shadow-[0_2px_8px_rgba(27,20,12,0.04)] transition hover:-translate-y-0.5" onClick={() => onSelect(entry.item, entry.artifact)}>
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" style={{ color: meta.color }} />
                      <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{entry.artifact.title}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{meta.label}</div>
                  </button>
                );
              })}
              {clusterEntries.length === 0 ? <div className="rounded-[8px] border border-dashed border-[var(--border-default)] px-3 py-4 text-[12px] text-[var(--text-secondary)]">No matching objects yet.</div> : null}
            </div>
          </div>
        );
      })}
      {centerEntry?.card ? (
        <div className="absolute left-[38%] top-[25%] w-[320px]">
          <ArtifactCard artifact={centerEntry.card} selected size="large" onSelect={() => onSelect(centerEntry.item, centerEntry.artifact)} />
        </div>
      ) : null}
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
            {selectedPlacements[0]?.workspaceTitle ?? workspace?.title ?? "Library inbox"}
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
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [newWorkspaceTitle, setNewWorkspaceTitle] = useState("");
  const [newWorkspaceDescription, setNewWorkspaceDescription] = useState("");
  const [createBlueprintKey, setCreateBlueprintKey] = useState<SpectraBlueprintKey | null>(null);
  const [openArtifact, setOpenArtifact] = useState<SpectraArtifact | null>(null);
  const workspaceCreateRef = useOutsideClick<HTMLDivElement>(workspaceCreateOpen, () => setWorkspaceCreateOpen(false));
  const seededRef = useRef(false);

  const loadOverview = useCallback(async (workspaceId?: string) => {
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

  const loadWorkspace = useCallback(async (workspaceId: string) => {
    setLoading(true);
    setSelectedWorkspaceId(workspaceId);
    try {
      const result = await getSpectraWorkspace(workspaceId);
      setOverview((current) => current
        ? { ...current, selectedWorkspaceId: workspaceId, workspace: result.workspace }
        : { workspaces: [], selectedWorkspaceId: workspaceId, workspace: result.workspace, artifacts: [], runs: [] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load workspace.");
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
  const workspaceRuns = selectedWorkspaceId ? runs.filter((run) => run.workspaceId === selectedWorkspaceId) : runs;
  const workspaces = useMemo(() => sortSpectraWorkspaces(overview?.workspaces ?? []), [overview?.workspaces]);
  const entries = useMemo(() => (overview?.workspace?.items ?? [])
    .map((item) => {
      const card = workspaceItemToCard(item);
      return item.artifact && card ? { item, artifact: item.artifact, card } : null;
    })
    .filter((entry): entry is { item: SpectraWorkspaceItem; artifact: SpectraArtifact; card: NonNullable<ReturnType<typeof workspaceItemToCard>> } => Boolean(entry)), [overview?.workspace?.items]);
  const selectedArtifact = selection?.type === "artifact" ? entries.find((entry) => entry.item._id === selection.itemId)?.artifact ?? null : null;
  const selectedRun = selection?.type === "run" ? workspaceRuns.find((run) => run._id === selection.runId) ?? null : null;
  const recentRunCards: ResultCardView[] = workspaceRuns.slice(0, 2).map((run) => ({
    id: run._id,
    status: run.status,
    title: run.status === "completed" ? run.userPrompt : "Reviewing workspace context",
    summary: run.finalSummary ?? run.error ?? run.userPrompt,
    meta: formatRelativeTime(run.createdAt),
  }));

  function openCreateArtifact(blueprintKey: SpectraBlueprintKey) {
    if (!selectedWorkspaceId) return;
    setCreateBlueprintKey(blueprintKey);
  }

  async function createArtifact(payload: ArtifactPayload) {
    if (!selectedWorkspaceId) return;
    const label = blueprintMeta[payload.blueprintKey].label;
    setBusyKey(`artifact:${payload.blueprintKey}`);
    try {
      await postSpectra({
        action: "createArtifact",
        blueprintKey: payload.blueprintKey,
        title: payload.title,
        summary: payload.summary,
        content: payload.content,
        tags: payload.tags,
        workspaceId: selectedWorkspaceId,
      });
      setCreateBlueprintKey(null);
      toast.success(`${label} created in workspace.`);
      await loadOverview(selectedWorkspaceId);
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
      setOpenArtifact(null);
      await loadOverview(selectedWorkspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update artifact.");
    } finally {
      setBusyKey(null);
    }
  }

  async function hideWorkspaceItem(workspaceItemId: string) {
    setBusyKey(`hide:${workspaceItemId}`);
    try {
      await postSpectra({ action: "hideWorkspaceItem", workspaceItemId });
      toast.success("Removed from workspace. Artifact remains in library.");
      setSelection((current) => current?.type === "artifact" && current.itemId === workspaceItemId ? null : current);
      await loadOverview(selectedWorkspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove workspace card.");
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
      setViewMode("cards");
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
      setViewMode("cards");
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
          setSelection(null);
          setSelectedWorkspaceId(undefined);
          void loadOverview();
        }}
        onSelect={(workspaceId) => {
          setSelection(null);
          setViewMode("cards");
          void loadWorkspace(workspaceId);
        }}
        onCreateClick={() => setWorkspaceCreateOpen((open) => !open)}
      />
      {workspaceCreateOpen ? (
        <div ref={workspaceCreateRef} className="absolute left-[88px] top-5 z-40 w-[330px] rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[0_18px_44px_rgba(27,20,12,0.16)]">
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
      {!selectedWorkspaceId ? (
        <WorkspaceHome overview={overview ? { ...overview, workspaces } : overview} onSelect={(workspaceId) => void loadWorkspace(workspaceId)} />
      ) : (
        <section className="flex min-w-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <WorkspaceHeader workspace={workspace} items={entries.map((entry) => entry.item)} runs={workspaceRuns} viewMode={viewMode} setViewMode={setViewMode} busy={busyKey} onCreateArtifact={openCreateArtifact} />
            <main className="min-h-0 flex-1 overflow-y-auto px-8 pb-[150px] pt-6">
              {loading ? <div className="py-10 text-[13px] text-[var(--text-secondary)]">Loading workspace...</div> : null}
              {viewMode === "cards" ? (
                <CardsView
                  entries={entries}
                  selected={selection}
                  onSelect={(item, artifact) => setSelection({ type: "artifact", itemId: item._id, artifactId: artifact._id })}
                  onHide={(itemId) => void hideWorkspaceItem(itemId)}
                  busy={busyKey}
                />
              ) : null}
              {viewMode === "timeline" ? (
                <TimelineView
                  entries={entries}
                  runs={workspaceRuns}
                  selected={selection}
                  onSelectRun={(run) => setSelection({ type: "run", runId: run._id })}
                  onSelectArtifact={(item, artifact) => setSelection({ type: "artifact", itemId: item._id, artifactId: artifact._id })}
                />
              ) : null}
              {viewMode === "library" ? <LibraryView entries={entries} selected={selection} onSelect={(item, artifact) => setSelection({ type: "artifact", itemId: item._id, artifactId: artifact._id })} /> : null}
              {viewMode === "canvas" ? <CanvasView entries={entries} selectedArtifact={selectedArtifact} onSelect={(item, artifact) => setSelection({ type: "artifact", itemId: item._id, artifactId: artifact._id })} /> : null}
            </main>
          </div>
          <Inspector
            workspace={workspace}
            artifacts={allArtifacts}
            selectedArtifact={selectedArtifact}
            selectedRun={selectedRun}
            runs={workspaceRuns}
            onClose={() => setSelection(null)}
            onHide={() => selectedArtifact && selection?.type === "artifact" ? void hideWorkspaceItem(selection.itemId) : undefined}
            onCreateArtifact={openCreateArtifact}
            onArchiveWorkspace={() => void archiveWorkspace()}
            onOpenArtifact={setOpenArtifact}
          />
          <div className="pointer-events-none absolute bottom-0 left-[74px] right-0 z-20 bg-[linear-gradient(to_top,var(--bg-primary)_72%,transparent)] px-8 pb-5 pt-12 xl:right-[318px]">
            <div className="pointer-events-auto mx-auto max-w-[880px]">
              <ResultCardStack cards={recentRunCards} className="mb-2" />
              <CommandBar
                placeholder={selectedArtifact ? `Act on ${selectedArtifact.title}...` : "Work with this workspace..."}
                context={workspace ? <span className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-primary)]"><Sprout className="h-4 w-4 text-[var(--mode-document)]" />{workspace.title}</span> : null}
                onSubmit={() => toast.message("Real AI execution is reserved for the operation engine wave.")}
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
                    <button type="button" className={menuItemClass()}><Settings className="h-4 w-4" />Workspace settings</button>
                  </div>
                )}
              />
            </div>
          </div>
        </section>
      )}
      {createBlueprintKey ? (
        <ArtifactBlueprintSheet
          mode="create"
          initialBlueprintKey={createBlueprintKey}
          busy={busyKey === `artifact:${createBlueprintKey}`}
          onClose={() => setCreateBlueprintKey(null)}
          onSubmit={createArtifact}
        />
      ) : null}
      {openArtifact ? (
        <ArtifactBlueprintSheet
          mode="edit"
          artifact={openArtifact}
          busy={busyKey === `artifact:update:${openArtifact._id}`}
          onClose={() => setOpenArtifact(null)}
          onSubmit={(payload) => updateArtifact(openArtifact._id, payload)}
        />
      ) : null}
    </div>
  );
}
