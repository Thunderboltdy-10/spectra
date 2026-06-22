"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronDown, ExternalLink, FolderPlus, List, Loader2, PanelTop, Pin, PinOff, Plus, Search, Trash2, X } from "lucide-react";
import { blueprintMeta } from "./artifact-card";
import { FloatingMenu } from "./floating-menu";
import { artifactPlacements, formatRelativeTime, workspaceAccent } from "./spectra-view-model";
import type { SpectraArtifact, SpectraBlueprintKey, SpectraWorkspace, SpectraWorkspaceItem } from "../data/api";

export type ObjectLibraryEntry = { artifact: SpectraArtifact; item?: SpectraWorkspaceItem };
type GroupBy = "workspace" | "type";
export type LibraryMode = "list" | "board";
type SortMode = "updated" | "created" | "alphabetical" | "type" | "pinned" | "workspace" | "activity";

const types: Array<{ key: "all" | SpectraBlueprintKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "document", label: "Documents" },
  { key: "flashcard_deck", label: "Decks" },
  { key: "quiz", label: "Quizzes" },
  { key: "planner_task", label: "Tasks" },
  { key: "thread_reference", label: "Threads" },
];

export function ObjectLibrary({
  entries,
  workspaces = [],
  groupBy,
  title = "Object library",
  subtitle,
  selectedArtifactId,
  busyKey,
  onOpen,
  onTogglePin,
  onRemove,
  onDelete,
  onAddToWorkspace,
  onCreateArtifact,
  mode: controlledMode,
  onModeChange,
  showModeSwitcher = true,
  showInbox = true,
  showGroups = true,
  showHeader = true,
  showToolbar = true,
}: {
  entries: ObjectLibraryEntry[];
  workspaces?: SpectraWorkspace[];
  groupBy: GroupBy;
  title?: string;
  subtitle?: string;
  selectedArtifactId?: string;
  busyKey?: string | null;
  onOpen: (entry: ObjectLibraryEntry) => void;
  onTogglePin?: (entry: ObjectLibraryEntry) => void;
  onRemove?: (entry: ObjectLibraryEntry) => void;
  onDelete?: (entry: ObjectLibraryEntry) => void;
  onAddToWorkspace?: (entry: ObjectLibraryEntry, workspaceId: string) => void;
  onCreateArtifact?: (blueprintKey: SpectraBlueprintKey, workspaceId?: string) => void;
  mode?: LibraryMode;
  onModeChange?: (mode: LibraryMode) => void;
  showModeSwitcher?: boolean;
  showInbox?: boolean;
  showGroups?: boolean;
  showHeader?: boolean;
  showToolbar?: boolean;
}) {
  const [internalMode, setInternalMode] = useState<LibraryMode>("list");
  const mode = controlledMode ?? internalMode;
  const setMode = (next: LibraryMode) => { setInternalMode(next); onModeChange?.(next); };
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<"all" | SpectraBlueprintKey>("all");
  const [sort, setSort] = useState<SortMode>("updated");
  const [sortOpen, setSortOpen] = useState(false);
  const [placementMenuId, setPlacementMenuId] = useState<string | null>(null);
  const [placementAnchor, setPlacementAnchor] = useState<DOMRect | null>(null);
  const [createMenuKey, setCreateMenuKey] = useState<string | null>(null);
  const [unplacedOpen, setUnplacedOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const sortRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sortOpen) return;
    function close(event: PointerEvent) { if (!sortRef.current?.contains(event.target as Node)) setSortOpen(false); }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [sortOpen]);

  useEffect(() => {
    if (groupBy !== "workspace") return;
    setUnplacedOpen(window.localStorage.getItem("spectra.library.unplaced.open") === "true");
  }, [groupBy]);

  useEffect(() => {
    if (groupBy === "workspace") window.localStorage.setItem("spectra.library.unplaced.open", String(unplacedOpen));
  }, [groupBy, unplacedOpen]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries
      .filter((entry) => activeType === "all" || entry.artifact.blueprintKey === activeType)
      .filter((entry) => !needle || `${entry.artifact.title} ${entry.artifact.summary ?? ""} ${entry.artifact.tags.join(" ")}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        if (sort === "pinned") return Number(Boolean(b.item?.viewData.pinned)) - Number(Boolean(a.item?.viewData.pinned)) || b.artifact.updatedAt - a.artifact.updatedAt;
        if (sort === "workspace") return (artifactPlacements(a.artifact)[0]?.workspaceTitle ?? "Unplaced").localeCompare(artifactPlacements(b.artifact)[0]?.workspaceTitle ?? "Unplaced");
        if (sort === "activity") return (b.item?.updatedAt ?? b.artifact.updatedAt) - (a.item?.updatedAt ?? a.artifact.updatedAt);
        if (sort === "alphabetical") return a.artifact.title.localeCompare(b.artifact.title);
        if (sort === "created") return b.artifact.createdAt - a.artifact.createdAt;
        if (sort === "type") return a.artifact.blueprintKey.localeCompare(b.artifact.blueprintKey) || a.artifact.title.localeCompare(b.artifact.title);
        return b.artifact.updatedAt - a.artifact.updatedAt;
      });
  }, [activeType, entries, search, sort]);

  const unplaced = groupBy === "workspace" ? visible.filter((entry) => artifactPlacements(entry.artifact).length === 0) : [];
  const groups = groupBy === "workspace"
    ? workspaces.map((workspace, index) => ({
      key: workspace._id,
      label: workspace.title,
      color: workspaceAccent(workspace, index).color,
      soft: workspaceAccent(workspace, index).soft,
      border: workspaceAccent(workspace, index).border,
      workspace,
      entries: visible.filter((entry) => artifactPlacements(entry.artifact).some((placement) => placement.workspaceId === workspace._id)),
    }))
    : types.slice(1).map((type) => {
      const meta = blueprintMeta[type.key as SpectraBlueprintKey];
      return {
        key: type.key,
        label: type.label,
        color: meta.color,
        soft: `color-mix(in oklab, ${meta.color} 7%, var(--bg-elevated))`,
        border: `color-mix(in oklab, ${meta.color} 18%, var(--border-default))`,
        workspace: undefined,
        entries: visible.filter((entry) => entry.artifact.blueprintKey === type.key),
      };
    });
  const populatedGroups = groups.filter((group) => group.entries.length > 0);

  function actions(entry: ObjectLibraryEntry) {
    const pinned = Boolean(entry.item?.viewData.pinned);
    return <div className="flex items-center gap-2">
      <button type="button" className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]" onClick={() => onOpen(entry)} aria-label="Open artifact" title="Open artifact"><ExternalLink className="h-3.5 w-3.5" /></button>
      {onTogglePin ? <button type="button" className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]" onClick={() => onTogglePin(entry)} aria-label={pinned ? "Unpin" : "Pin"} title={pinned ? "Remove from important" : "Mark important"}>{pinned ? <PinOff className="h-3.5 w-3.5 text-[#b67616]" /> : <Pin className="h-3.5 w-3.5" />}</button> : null}
      {onRemove && entry.item ? <button type="button" className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--danger)]" disabled={busyKey === `hide:${entry.item._id}`} onClick={() => onRemove(entry)} aria-label="Remove from workspace" title="Remove from workspace; the artifact remains available">{busyKey === `hide:${entry.item._id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}</button> : null}
      {onDelete ? <button type="button" className="flex h-8 w-8 items-center justify-center text-[var(--text-secondary)] hover:text-[var(--danger)]" disabled={busyKey === `delete:${entry.artifact._id}`} onClick={() => onDelete(entry)} aria-label="Delete artifact permanently" title="Delete artifact permanently">{busyKey === `delete:${entry.artifact._id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button> : null}
    </div>;
  }

  function placementAction(entry: ObjectLibraryEntry) {
    if (!onAddToWorkspace || workspaces.length === 0) return actions(entry);
    const open = placementMenuId === entry.artifact._id;
    return <div className="flex items-center gap-2">
      {actions(entry)}
      <div>
        <button type="button" className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]" onClick={(event) => { setPlacementAnchor(event.currentTarget.getBoundingClientRect()); setPlacementMenuId(open ? null : entry.artifact._id); }} aria-label="Add to workspace" title="Add to workspace"><FolderPlus className="h-3.5 w-3.5" /></button>
        <FloatingMenu open={open} anchor={placementAnchor} onClose={() => setPlacementMenuId(null)}>
          {workspaces.map((workspace) => {
            const alreadyPlaced = artifactPlacements(entry.artifact).some((placement) => placement.workspaceId === workspace._id);
            return <button key={workspace._id} type="button" className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-45" disabled={alreadyPlaced} onClick={() => { setPlacementMenuId(null); onAddToWorkspace(entry, workspace._id); }}><span className="min-w-0 flex-1 truncate">{workspace.title}</span>{alreadyPlaced ? <CheckCircle2 className="h-4 w-4 text-[var(--success)]" /> : null}</button>;
          })}
        </FloatingMenu>
      </div>
    </div>;
  }

  function creationAction(groupKey: string, workspaceId?: string) {
    if (!onCreateArtifact) return null;
    const open = createMenuKey === groupKey;
    return <div className="relative"><button type="button" className="flex h-8 items-center gap-2 rounded-[7px] px-1 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={() => setCreateMenuKey(open ? null : groupKey)}><Plus className="h-3.5 w-3.5" />New artifact</button>{open ? <div className="absolute bottom-[calc(100%+7px)] left-0 z-30 w-[210px] rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_14px_32px_rgba(27,20,12,0.13)]">{types.slice(1).map((type) => { const meta = blueprintMeta[type.key as SpectraBlueprintKey]; const Icon = meta.icon; return <button key={type.key} type="button" className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]" onClick={() => { setCreateMenuKey(null); onCreateArtifact(type.key as SpectraBlueprintKey, workspaceId); }}><Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />{type.label}</button>; })}</div> : null}</div>;
  }

  function unplacedCard(entry: ObjectLibraryEntry) {
    const meta = blueprintMeta[entry.artifact.blueprintKey];
    const Icon = meta.icon;
    return <article key={entry.artifact._id} className="relative min-h-[112px] overflow-hidden rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[0_1px_3px_rgba(27,20,12,0.035)]"><span className="pointer-events-none absolute inset-y-0 left-0 w-1" style={{ background: meta.color }} /><button type="button" className="flex w-full items-start gap-2.5 pl-1 text-left" onClick={() => onOpen(entry)}><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-[var(--bg-primary)]"><Icon className="h-4 w-4" style={{ color: meta.color }} /></span><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{entry.artifact.title}</span><span className="mt-0.5 block truncate text-[11px] text-[var(--text-secondary)]">{entry.artifact.summary ?? meta.label}</span><span className="mt-1 block text-[10px] text-[var(--text-tertiary)]">{meta.label} · {formatRelativeTime(entry.artifact.updatedAt)}</span></span></button><div className="mt-2 flex justify-end" onClick={(event) => event.stopPropagation()}>{placementAction(entry)}</div></article>;
  }

  return <section>
    {showHeader ? <div><h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">{title}</h2>{subtitle ? <p className="mt-1 text-[13px] text-[var(--text-secondary)]">{subtitle}</p> : null}</div> : null}

    {showToolbar ? <div className="mt-5 flex flex-wrap items-center gap-2 pb-1"><div className="flex shrink-0 gap-1 overflow-x-auto">{types.map((type) => <button key={type.key} type="button" onClick={() => setActiveType(type.key)} className={`inline-flex h-9 items-center rounded-[8px] px-3 text-[13px] font-medium transition-all ${activeType === type.key ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_1px_7px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--bg-elevated)_68%,transparent)]"}`}>{type.label}</button>)}</div><div className="ml-auto flex items-center gap-2"><div className="relative w-[210px] shrink-0"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-9 pr-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]" placeholder="Search objects" /></div><div className="relative shrink-0" ref={sortRef}><button type="button" className="flex h-9 min-w-[164px] items-center justify-between gap-3 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[12px] font-medium text-[var(--text-primary)] shadow-[0_1px_4px_rgba(27,20,12,0.04)] hover:bg-[var(--bg-hover)]" onClick={() => setSortOpen((open) => !open)}><span>{sort === "updated" ? "Recently updated" : sort === "created" ? "Recently created" : sort === "alphabetical" ? "Title A–Z" : sort === "type" ? "Artifact type" : sort === "pinned" ? "Pinned first" : sort === "workspace" ? "Workspace" : "Activity"}</span><ChevronDown className={`h-3.5 w-3.5 text-[var(--text-tertiary)] transition ${sortOpen ? "rotate-180" : ""}`} /></button>{sortOpen ? <div className="absolute right-0 top-[calc(100%+7px)] z-30 w-[190px] rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_14px_32px_rgba(27,20,12,0.13)]">{([['updated','Recently updated'],['created','Recently created'],['alphabetical','Title A–Z'],['type','Artifact type'],['pinned','Pinned first'],['workspace','Workspace'],['activity','Activity']] as Array<[SortMode,string]>).map(([key,label]) => <button key={key} type="button" className="flex w-full items-center justify-between rounded-[7px] px-2.5 py-2 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]" onClick={() => { setSort(key); setSortOpen(false); }}><span>{label}</span>{sort === key ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : null}</button>)}</div> : null}</div>{showModeSwitcher ? <div className="flex shrink-0 rounded-[10px] bg-[color-mix(in_oklab,var(--bg-elevated)_74%,transparent)] p-1 shadow-[inset_0_0_0_1px_var(--border-default)]">{[{ key: "list" as const, label: "List", icon: List }, { key: "board" as const, label: "Board", icon: PanelTop }].map((option) => { const Icon = option.icon; return <button key={option.key} type="button" className={`inline-flex h-8 items-center gap-2 rounded-[7px] px-3 text-[12px] font-medium transition-all duration-200 ${mode === option.key ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_1px_6px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--bg-primary)_52%,transparent)] hover:text-[var(--text-primary)]"}`} onClick={() => setMode(option.key)}><Icon className="h-4 w-4" />{option.label}</button>; })}</div> : null}</div></div> : null}

    {showInbox && groupBy === "workspace" ? <section className="mt-7">
      <button type="button" onClick={() => setUnplacedOpen((open) => !open)} className="mb-4 flex w-full items-center gap-2 text-left"><ChevronDown className={`h-4 w-4 text-[var(--text-tertiary)] transition ${unplacedOpen ? "" : "-rotate-90"}`} /><h3 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">Inbox</h3><span className="rounded-[6px] bg-[var(--bg-secondary)] px-1.5 text-[12px] text-[var(--text-secondary)]">{unplaced.length}</span><span className="ml-1 text-[12px] text-[var(--text-tertiary)]">Not placed in a workspace</span></button>
      {unplacedOpen ? <div className="grid gap-3 xl:grid-cols-3">{unplaced.slice(0, 6).map(unplacedCard)}{unplaced.length === 0 ? <div className="rounded-[8px] border border-dashed border-[var(--border-default)] px-4 py-7 text-[13px] text-[var(--text-secondary)]">Inbox is clear.</div> : null}</div> : null}
    </section> : null}

    {showGroups && mode === "list" ? <main className="mt-8">
      <section>
        <div className="mb-4"><h3 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">{groupBy === "workspace" ? "In workspaces" : "By type"}</h3><p className="mt-1 text-[13px] text-[var(--text-secondary)]">{groupBy === "workspace" ? "Objects grouped by their workspace." : "Objects grouped by artifact type."}</p></div>
        <div className="space-y-4">{populatedGroups.map((group) => <section key={group.key} className="overflow-hidden rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)]">
          <div className="flex h-11 items-center justify-between border-b border-[var(--border-default)] px-4" style={{ background: group.soft }}><div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]"><span className="h-2 w-2 rounded-full" style={{ background: group.color }} />{group.label}<span className="rounded-[5px] bg-[color-mix(in_oklab,var(--bg-elevated)_70%,transparent)] px-1.5 text-[11px] text-[var(--text-secondary)]">{group.entries.length}</span></div>{group.workspace ? <span className="text-[12px] text-[var(--text-secondary)]">Workspace <ExternalLink className="inline h-3 w-3" /></span> : null}</div>
          {group.entries.slice(0, expandedGroups.has(group.key) ? group.entries.length : 6).map((entry) => { const meta = blueprintMeta[entry.artifact.blueprintKey]; const Icon = meta.icon; const workspaceName = group.workspace?.title ?? artifactPlacements(entry.artifact)[0]?.workspaceTitle ?? "Unplaced"; return <div key={`${group.key}:${entry.item?._id ?? entry.artifact._id}`} className={`grid min-h-[58px] cursor-pointer grid-cols-[minmax(260px,1.2fr)_minmax(130px,0.6fr)_minmax(130px,0.5fr)_auto] items-center gap-4 border-b border-[var(--border-default)] px-4 py-2.5 last:border-b-0 hover:bg-[color-mix(in_oklab,var(--bg-hover)_58%,transparent)] ${selectedArtifactId === entry.artifact._id ? "bg-[color-mix(in_oklab,var(--accent-cyan)_5%,transparent)]" : ""}`} role="button" tabIndex={0} onClick={() => onOpen(entry)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(entry); }}><div className="flex min-w-0 items-center gap-3"><Icon className="h-5 w-5 shrink-0" style={{ color: meta.color }} /><div className="min-w-0"><div className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{entry.artifact.title}</div><div className="text-[11px] text-[var(--text-secondary)]">{meta.label}</div></div></div><div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]"><span className="h-1.5 w-1.5 rounded-full" style={{ background: group.color }} />{workspaceName}</div><div className="text-[12px] text-[var(--text-secondary)]">Updated {formatRelativeTime(entry.artifact.updatedAt)}</div><div onClick={(event) => event.stopPropagation()}>{actions(entry)}</div></div>; })}
          {group.entries.length > 6 ? <button type="button" onClick={() => setExpandedGroups((current) => { const next = new Set(current); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next; })} className="flex h-9 w-full items-center justify-center text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]">{expandedGroups.has(group.key) ? "Show less" : `Show ${group.entries.length - 6} more`}</button> : null}
          {onCreateArtifact ? <div className="border-t border-[var(--border-default)] px-4 py-1.5">{creationAction(`list-${group.key}`, group.workspace?._id)}</div> : null}
        </section>)}</div>
      </section>
    </main> : null}

    {showGroups && mode === "board" ? <div className="mt-8 overflow-x-auto pb-6"><main className="grid gap-3 pr-2" style={{ gridTemplateColumns: `repeat(${Math.max(populatedGroups.length, 1)}, clamp(300px, 27vw, 360px))`, width: "max-content" }}>
      {populatedGroups.map((group) => { const expanded = expandedGroups.has(`board:${group.key}`); return <section key={group.key} className="self-start rounded-[10px] border p-2.5 shadow-[0_10px_28px_rgba(27,20,12,0.04)]" style={{ borderColor: group.border, background: group.soft }}><div className="mb-2 flex h-8 items-center justify-between px-1"><div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]"><span className="h-2 w-2 rounded-full" style={{ background: group.color }} />{group.label}<span className="text-[12px] text-[var(--text-tertiary)]">{group.entries.length}</span></div></div><div className="space-y-1.5">{group.entries.slice(0, expanded ? group.entries.length : 6).map((entry) => { const meta = blueprintMeta[entry.artifact.blueprintKey]; const Icon = meta.icon; return <button key={`${group.key}:${entry.item?._id ?? entry.artifact._id}`} type="button" className="flex min-h-[54px] w-full items-center gap-3 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5 text-left shadow-[0_1px_3px_rgba(27,20,12,0.035)] hover:bg-[var(--bg-hover)]" onClick={() => onOpen(entry)}><Icon className="h-4 w-4 shrink-0" style={{ color: meta.color }} /><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{entry.artifact.title}</span><span className="block truncate text-[10px] text-[var(--text-secondary)]">{entry.artifact.summary ?? meta.label}</span></span><span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">{formatRelativeTime(entry.artifact.updatedAt)}</span></button>; })}</div>{group.entries.length > 6 ? <button type="button" className="mt-2 h-8 px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={() => setExpandedGroups((current) => { const next = new Set(current); if (expanded) next.delete(`board:${group.key}`); else next.add(`board:${group.key}`); return next; })}>{expanded ? "Show fewer" : `Show ${group.entries.length - 6} more`}</button> : null}{onCreateArtifact ? <div className="mt-1.5 border-t border-[color-mix(in_oklab,var(--border-default)_72%,transparent)] px-1 pt-1">{creationAction(`board-${group.key}`, group.workspace?._id)}</div> : null}</section>; })}
    </main></div> : null}
  </section>;
}
