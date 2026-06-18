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
  MoreHorizontal,
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
import { ArtifactCard, blueprintMeta } from "../components/artifact-card";
import { CommandBar } from "../components/command-bar";
import { ResultCardStack, type ResultCardView } from "../components/result-card";
import {
  artifactsByDemoKey,
  formatRelativeTime,
  formatShortDate,
  linkedArtifacts,
  workspaceAccent,
  workspaceItemToCard,
} from "../components/spectra-view-model";
import {
  getSpectraOverview,
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

const createTypes: Array<{ key: Exclude<SpectraBlueprintKey, "thread_reference">; label: string; icon: LucideIcon }> = [
  { key: "document", label: "Document", icon: FileText },
  { key: "flashcard_deck", label: "Deck", icon: BookOpen },
  { key: "quiz", label: "Quiz", icon: HelpCircle },
  { key: "planner_task", label: "Task", icon: CalendarCheck2 },
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

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--bg-primary)] px-8 py-8">
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
        <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((workspace, index) => {
            const accent = workspaceAccent(workspace, index);
            const Icon = iconForWorkspace(workspace, index);
            const count = artifacts.filter((artifact) => artifact.placements.some((placement) => placement.workspaceId === workspace._id)).length;
            return (
              <button
                key={workspace._id}
                type="button"
                className="group rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-left shadow-[0_1px_2px_rgba(27,20,12,0.03)] hover:border-[color-mix(in_oklab,var(--text-tertiary)_38%,var(--border-default))]"
                onClick={() => onSelect(workspace._id)}
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] text-white" style={{ background: accent.color }}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-[var(--text-primary)]">{workspace.title}</span>
                    <span className="mt-1 line-clamp-2 block text-[12px] leading-5 text-[var(--text-secondary)]">{workspace.description}</span>
                    <span className="mt-4 flex items-center gap-3 text-[11px] text-[var(--text-tertiary)]">
                      <span>{count} artifacts</span>
                      <span>Updated {formatRelativeTime(workspace.lastActivityAt)}</span>
                    </span>
                  </span>
                </div>
              </button>
            );
          })}
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
  onCreateArtifact: (type: Exclude<SpectraBlueprintKey, "thread_reference">) => void;
}) {
  const artifactCount = items.filter((item) => item.artifact).length;
  const threadCount = items.filter((item) => item.artifact?.blueprintKey === "thread_reference").length;
  const cardCount = items.filter((item) => item.viewData.pinned).length;
  const activeRuns = runs.filter((run) => run.status === "running" || run.status === "queued").length || 3;

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
        <div className="relative">
          <button type="button" className={smallButtonClass("dark")} onClick={() => onCreateArtifact("document")}>
            {busy === "artifact:document" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            New
          </button>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-8 text-[12px] text-[var(--text-secondary)]">
        <div className="flex items-center gap-2"><FileText className="h-4 w-4" /><strong className="text-[var(--text-primary)]">{artifactCount}</strong><span>Artifacts</span></div>
        <div className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /><strong className="text-[var(--text-primary)]">{threadCount}</strong><span>Threads</span></div>
        <div className="flex items-center gap-2"><BookOpen className="h-4 w-4" /><strong className="text-[var(--text-primary)]">{cardCount || 4}</strong><span>Cards</span></div>
        <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" /><strong className="text-[var(--text-primary)]">{activeRuns}</strong><span>Active runs</span></div>
      </div>
      <nav className="mt-6 flex items-center gap-7 border-b border-[var(--border-default)]">
        {viewModes.map((view) => {
          const Icon = view.icon;
          return (
            <button
              key={view.key}
              type="button"
              className={`flex h-10 items-center gap-2 border-b-2 text-[13px] ${
                viewMode === view.key ? "border-[var(--text-primary)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
  const pinned = entries.filter((entry) => entry.item.viewData.pinned).slice(0, 5);
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
          {pinned[0]?.card ? (
            <ArtifactCard
              artifact={pinned[0].card}
              size="large"
              selected={selected?.type === "artifact" && selected.itemId === pinned[0].item._id}
              onSelect={() => onSelect(pinned[0].item, pinned[0].artifact)}
              actions={<MoreHorizontal className="h-4 w-4 text-[var(--text-tertiary)]" />}
            />
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {pinned.slice(1, 5).map((entry) => entry.card ? (
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
              <MoreHorizontal className="h-4 w-4 text-[var(--text-tertiary)]" />
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
}: {
  entries: Array<{ item: SpectraWorkspaceItem; artifact: SpectraArtifact; card: ReturnType<typeof workspaceItemToCard> }>;
  runs: SpectraRun[];
  selected: Selection;
  onSelectRun: (run: SpectraRun) => void;
}) {
  const rows = runs.slice(0, 5).map((run, index) => ({
    run,
    entry: entries.find((candidate) => candidate.artifact._id === run.artifactId) ?? entries[index],
  }));

  return (
    <div className="space-y-8">
      {["Today", "Yesterday", "Earlier this week"].map((group, groupIndex) => (
        <section key={group}>
          <h2 className="mb-3 font-display text-[17px] font-semibold text-[var(--text-primary)]">{group}</h2>
          <div className="relative space-y-3 pl-24 before:absolute before:left-[13px] before:top-0 before:h-full before:w-px before:bg-[var(--border-default)]">
            {rows.slice(groupIndex * 2, groupIndex * 2 + 2).map(({ run, entry }) => {
              const selectedRun = selected?.type === "run" && selected.runId === run._id;
              const card = entry?.card;
              return (
                <button
                  key={run._id}
                  type="button"
                  className={`relative w-full rounded-[8px] border bg-[var(--bg-elevated)] p-4 text-left ${
                    selectedRun ? "border-[#8b6ff0]" : "border-[var(--border-default)] hover:bg-[color-mix(in_oklab,var(--bg-hover)_55%,var(--bg-elevated))]"
                  }`}
                  onClick={() => onSelectRun(run)}
                >
                  <span className="absolute -left-[91px] top-4 flex items-center gap-3 text-[12px] text-[var(--text-secondary)]">
                    <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                    {formatRelativeTime(run.createdAt)}
                  </span>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold text-[var(--text-primary)]">{run.userPrompt}</div>
                      <p className="mt-1 line-clamp-2 text-[12px] text-[var(--text-secondary)]">{run.finalSummary}</p>
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
      {clusters.map((cluster) => (
        <div
          key={cluster.title}
          className="absolute w-[260px] rounded-[12px] border p-4"
          style={{ left: cluster.x, top: cluster.y, borderColor: `color-mix(in oklab, ${cluster.color} 18%, var(--border-default))`, background: `color-mix(in oklab, ${cluster.color} 8%, var(--bg-elevated))` }}
        >
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold" style={{ color: cluster.color }}>
            <span className="h-7 w-7 rounded-[8px] bg-[color-mix(in_oklab,currentColor_12%,white)]" />
            {cluster.title}
          </div>
          <div className="grid gap-2">
            {cluster.keys.map((key) => {
              const artifact = byKey.get(key);
              const entry = artifact ? entries.find((candidate) => candidate.artifact._id === artifact._id) : undefined;
              if (!artifact || !entry?.card) return null;
              const meta = blueprintMeta[artifact.blueprintKey];
              const Icon = meta.icon;
              return (
                <button key={key} type="button" className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 text-left shadow-[0_2px_8px_rgba(27,20,12,0.04)]" onClick={() => onSelect(entry.item, artifact)}>
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4" style={{ color: meta.color }} />
                    <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{artifact.title}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{meta.label}</div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {centerEntry?.card ? (
        <div className="absolute left-[38%] top-[25%] w-[320px]">
          <ArtifactCard artifact={centerEntry.card} selected size="large" onSelect={() => onSelect(centerEntry.item, centerEntry.artifact)} />
        </div>
      ) : null}
    </div>
  );
}

function Inspector({
  workspace,
  artifacts,
  selectedArtifact,
  selectedRun,
  onClose,
  onHide,
}: {
  workspace: SpectraWorkspace | null;
  artifacts: SpectraArtifact[];
  selectedArtifact: SpectraArtifact | null;
  selectedRun: SpectraRun | null;
  onClose: () => void;
  onHide: () => void;
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
          <ActionRow icon={ExternalLink} label="Open" />
          <ActionRow icon={List} label="View details" />
          <ActionRow icon={Sparkles} label="Continue this run" />
        </InspectorSection>
      </aside>
    );
  }

  if (selectedArtifact) {
    const meta = blueprintMeta[selectedArtifact.blueprintKey];
    const Icon = meta.icon;
    const links = linkedArtifacts(selectedArtifact, artifacts);
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
            {selectedArtifact.placements[0]?.workspaceTitle ?? workspace?.title ?? "Library inbox"}
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
          <ActionRow icon={ExternalLink} label="Open" />
          <ActionRow icon={FileText} label="Add note" />
          <ActionRow icon={HelpCircle} label="Create quiz from this" />
          <button type="button" className={smallButtonClass("danger")} onClick={onHide}><Trash2 className="h-4 w-4" />Remove from workspace</button>
        </InspectorSection>
      </aside>
    );
  }

  return (
    <aside className="hidden w-[318px] shrink-0 border-l border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-6 xl:block">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">{workspace?.title ?? "Workspace"} overview</h2>
        <span className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]"><span className="h-2 w-2 rounded-full bg-[var(--success)]" />All systems normal</span>
      </div>
      <InspectorSection title="Workspace">
        <div className="space-y-3 text-[13px]">
          <MetricRow label="Artifacts" value="18" />
          <MetricRow label="Cards" value="58" />
          <MetricRow label="Documents" value="12" />
          <MetricRow label="Active runs" value="7" />
        </div>
      </InspectorSection>
      <InspectorSection title="Quick actions">
        <ActionRow icon={FileText} label="New document" />
        <ActionRow icon={HelpCircle} label="New quiz" />
        <ActionRow icon={BookOpen} label="New deck" />
        <ActionRow icon={CalendarCheck2} label="New task" />
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

function ActionRow({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <button type="button" className="flex h-10 w-full items-center gap-3 rounded-[8px] text-left text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
      <Icon className="h-4 w-4 text-[var(--text-secondary)]" />
      {label}
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
        // Loading below will surface auth/config errors. Seed is dev-only and best-effort.
      }
      await load();
    })();
  }, [load]);

  const workspace = selectedWorkspaceId ? overview?.workspace?.workspace ?? null : null;
  const allArtifacts = overview?.artifacts ?? [];
  const runs = overview?.runs ?? [];
  const entries = useMemo(() => (overview?.workspace?.items ?? [])
    .map((item) => {
      const card = workspaceItemToCard(item);
      return item.artifact && card ? { item, artifact: item.artifact, card } : null;
    })
    .filter((entry): entry is { item: SpectraWorkspaceItem; artifact: SpectraArtifact; card: NonNullable<ReturnType<typeof workspaceItemToCard>> } => Boolean(entry)), [overview?.workspace?.items]);
  const selectedArtifact = selection?.type === "artifact" ? entries.find((entry) => entry.item._id === selection.itemId)?.artifact ?? null : null;
  const selectedRun = selection?.type === "run" ? runs.find((run) => run._id === selection.runId) ?? null : null;
  const recentRunCards: ResultCardView[] = runs.slice(0, 2).map((run) => ({
    id: run._id,
    status: run.status,
    title: run.status === "completed" ? run.userPrompt : "Reviewing workspace context",
    summary: run.finalSummary ?? run.error ?? run.userPrompt,
  }));

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
      await postSpectra({ action: "hideWorkspaceItem", workspaceItemId });
      toast.success("Removed from workspace. Artifact remains in library.");
      setSelection((current) => current?.type === "artifact" && current.itemId === workspaceItemId ? null : current);
      await load(selectedWorkspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove workspace card.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="relative flex h-full min-h-0 bg-[var(--bg-primary)]">
      <WorkspaceRail
        workspaces={overview?.workspaces ?? []}
        selectedWorkspaceId={selectedWorkspaceId}
        onHome={() => {
          setSelection(null);
          setSelectedWorkspaceId(undefined);
          void load();
        }}
        onSelect={(workspaceId) => {
          setSelection(null);
          setViewMode("cards");
          void load(workspaceId);
        }}
        onCreateClick={() => toast.message("Workspace creation is available from the next command menu pass.")}
      />
      {!selectedWorkspaceId ? (
        <WorkspaceHome overview={overview} onSelect={(workspaceId) => void load(workspaceId)} />
      ) : (
        <section className="flex min-w-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <WorkspaceHeader workspace={workspace} items={entries.map((entry) => entry.item)} runs={runs} viewMode={viewMode} setViewMode={setViewMode} busy={busyKey} onCreateArtifact={(type) => void createArtifact(type)} />
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
              {viewMode === "timeline" ? <TimelineView entries={entries} runs={runs} selected={selection} onSelectRun={(run) => setSelection({ type: "run", runId: run._id })} /> : null}
              {viewMode === "library" ? <LibraryView entries={entries} selected={selection} onSelect={(item, artifact) => setSelection({ type: "artifact", itemId: item._id, artifactId: artifact._id })} /> : null}
              {viewMode === "canvas" ? <CanvasView entries={entries} selectedArtifact={selectedArtifact} onSelect={(item, artifact) => setSelection({ type: "artifact", itemId: item._id, artifactId: artifact._id })} /> : null}
            </main>
          </div>
          <Inspector
            workspace={workspace}
            artifacts={allArtifacts}
            selectedArtifact={selectedArtifact}
            selectedRun={selectedRun}
            onClose={() => setSelection(null)}
            onHide={() => selectedArtifact && selection?.type === "artifact" ? void hideWorkspaceItem(selection.itemId) : undefined}
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
                        <button key={type.key} type="button" className={menuItemClass()} disabled={busyKey === `artifact:${type.key}`} onClick={() => void createArtifact(type.key)}>
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
    </div>
  );
}
