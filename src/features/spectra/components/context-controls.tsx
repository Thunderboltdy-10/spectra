"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Check,
  ChevronDown,
  Files,
  FileText,
  FolderPlus,
  Globe2,
  MessageSquare,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { blueprintMeta } from "./artifact-card";
import {
  searchSpectra,
  type SpectraArtifact,
  type SpectraWorkspace,
} from "../data/api";

export type ComposerFocusMode =
  | "global"
  | "workspace"
  | "artifact"
  | "selection"
  | "thread";

const modeMeta = {
  global: { label: "Global", icon: Globe2 },
  workspace: { label: "Workspace", icon: BookOpen },
  artifact: { label: "Open artifact", icon: FileText },
  selection: { label: "Selected objects", icon: Files },
  thread: { label: "Continued thread", icon: MessageSquare },
} satisfies Record<ComposerFocusMode, { label: string; icon: typeof Globe2 }>;

export function ContextFocusControl({
  mode,
  onModeChange,
  workspace,
  artifact,
  selectedCount,
  threadTitle,
}: {
  mode: ComposerFocusMode;
  onModeChange: (mode: ComposerFocusMode) => void;
  workspace?: SpectraWorkspace | null;
  artifact?: SpectraArtifact | null;
  selectedCount?: number;
  threadTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const available: ComposerFocusMode[] = [
    "global",
    ...(workspace ? ["workspace" as const] : []),
    ...(artifact ? ["artifact" as const] : []),
    ...(selectedCount ? ["selection" as const] : []),
    ...(threadTitle ? ["thread" as const] : []),
  ];
  const active = modeMeta[mode];
  const ActiveIcon = active.icon;
  const detail =
    mode === "selection"
      ? `${selectedCount} selected`
      : mode === "artifact"
        ? artifact?.title
        : mode === "workspace"
          ? workspace?.title
          : mode === "thread"
            ? threadTitle
            : "All Spectra objects";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        data-focus-state={mode}
        className="group flex max-w-[230px] items-center gap-1.5 rounded-[7px] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        aria-label="Choose AI context"
        title="Choose what Spectra will use"
      >
        <ActiveIcon className="h-3.5 w-3.5 shrink-0 text-[var(--accent-cyan)]" />
        <span className="min-w-0 truncate">
          {mode === "thread" && artifact
            ? `${detail} + ${artifact.title}`
            : detail}
        </span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="absolute bottom-[calc(100%+11px)] left-0 z-[80] w-[280px] overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_96%,transparent)] p-1.5 shadow-[0_18px_48px_rgba(27,20,12,0.16)] backdrop-blur-xl"
          >
            <div className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-tertiary)]">
              Use as primary context
            </div>
            {available.map((option) => {
              const meta = modeMeta[option];
              const Icon = meta.icon;
              const description =
                option === "global"
                  ? "No focused workspace or object"
                  : option === "workspace"
                    ? workspace?.title
                    : option === "artifact"
                      ? artifact?.title
                      : option === "selection"
                        ? `${selectedCount} explicitly selected artifacts`
                        : `${threadTitle}${artifact ? ` · ${artifact.title} also in focus` : ""}`;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    onModeChange(option);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left hover:bg-[var(--bg-hover)]"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[var(--bg-secondary)]">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium text-[var(--text-primary)]">
                      {meta.label}
                    </span>
                    <span className="block truncate text-[10px] text-[var(--text-tertiary)]">
                      {description}
                    </span>
                  </span>
                  {mode === option ? (
                    <Check className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
                  ) : null}
                </button>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function SelectionActionBar({
  count,
  onClear,
  onExit,
  onRun,
}: {
  count: number;
  onClear: () => void;
  onExit: () => void;
  onRun: (prompt: string) => void;
}) {
  return (
    <AnimatePresence>
      {count >= 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          data-spectra-card="result"
          data-card-state="context"
          className="mb-2 ml-[52px] flex min-h-10 flex-wrap items-center gap-1.5 px-2.5 py-1.5"
        >
          <span className="mr-1 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-primary)]">
            <Files className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
            {count ? `${count} selected` : "Select objects"}
          </span>
          {count > 0 ? (
            <>
              <button
                type="button"
                onClick={() =>
                  onRun(
                    "Summarise the selected artifacts into one concise document.",
                  )
                }
                className="rounded-[6px] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                Summarise
              </button>
              <button
                type="button"
                onClick={() =>
                  onRun("Create a revision guide from the selected artifacts.")
                }
                className="rounded-[6px] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                Revision guide
              </button>
              <button
                type="button"
                onClick={() =>
                  onRun("Create a quiz from the selected artifacts.")
                }
                className="rounded-[6px] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                Make quiz
              </button>
              <button
                type="button"
                onClick={onClear}
                className="ml-auto flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
                title="Clear selection"
                aria-label="Clear selection"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <span className="text-[10px] text-[var(--text-tertiary)]">
              Checkmarks appear only in this mode.
            </span>
          )}
          <button
            type="button"
            onClick={onExit}
            className={`${count ? "" : "ml-auto"} rounded-[6px] px-2 py-1 text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]`}
          >
            Done
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function GlobalSearch({
  onOpenArtifact,
  onOpenWorkspace,
  selectedIds,
  onToggleSelected,
  onPlaceArtifact,
  placementLabel,
  placementWorkspaceId,
  trigger = "button",
}: {
  onOpenArtifact: (artifact: SpectraArtifact) => void;
  onOpenWorkspace: (workspace: SpectraWorkspace) => void;
  selectedIds: Set<string>;
  onToggleSelected: (artifact: SpectraArtifact) => void;
  onPlaceArtifact?: (artifact: SpectraArtifact) => void;
  placementLabel?: string;
  placementWorkspaceId?: string;
  trigger?: "button" | "icon";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{
    artifacts: SpectraArtifact[];
    workspaces: SpectraWorkspace[];
  }>({ artifacts: [], workspaces: [] });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults({ artifacts: [], workspaces: [] });
      return;
    }
    const timer = window.setTimeout(
      () =>
        void searchSpectra(query)
          .then(setResults)
          .catch(() => setResults({ artifacts: [], workspaces: [] })),
      180,
    );
    return () => window.clearTimeout(timer);
  }, [open, query]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={trigger === "icon" ? "flex h-9 w-9 items-center justify-center rounded-[8px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" : "flex h-9 items-center gap-2 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"}
        title="Search Spectra (⌘K)"
        aria-label="Search artifacts and workspaces"
      >
        <Search className="h-4 w-4" />
        {trigger === "button" ? <><span>Search</span><kbd className="ml-2 text-[10px] font-normal text-[var(--text-tertiary)]">⌘K</kbd></> : null}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            className="fixed inset-0 z-[120] flex items-start justify-center bg-black/20 px-4 pt-[12vh]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={() => setOpen(false)}
          >
            <motion.div
              initial={{ y: -14, opacity: 0, scale: 0.985 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -8, opacity: 0, scale: 0.99 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              className="w-full max-w-[680px] overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[0_16px_48px_rgba(27,20,12,0.18)]"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center gap-3 border-b border-[var(--border-default)] px-4">
                <Search className="h-5 w-5 text-[var(--accent-cyan)]" />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search titles, summaries, types, workspaces, and stored text…"
                  className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                />
                <span className="rounded-[5px] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">
                  ESC
                </span>
              </div>
              <div className="max-h-[58vh] overflow-y-auto p-2">
                {query.trim().length < 2 ? (
                  <div className="px-3 py-10 text-center">
                    <Sparkles className="mx-auto h-5 w-5 text-[var(--text-tertiary)]" />
                    <p className="mt-3 text-[12px] text-[var(--text-secondary)]">
                      Search across your Spectra workspace.
                    </p>
                  </div>
                ) : null}
                {results.workspaces.length ? (
                  <section>
                    <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-tertiary)]">
                      Workspaces
                    </div>
                    {results.workspaces.map((workspace) => (
                      <button
                        key={workspace._id}
                        type="button"
                        onClick={() => {
                          onOpenWorkspace(workspace);
                          setOpen(false);
                        }}
                        className="flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left hover:bg-[var(--bg-hover)]"
                      >
                        <BookOpen className="h-4 w-4 text-[var(--accent-cyan)]" />
                        <span>
                          <span className="block text-[12px] font-medium text-[var(--text-primary)]">
                            {workspace.title}
                          </span>
                          <span className="line-clamp-1 text-[10px] text-[var(--text-tertiary)]">
                            {workspace.description}
                          </span>
                        </span>
                      </button>
                    ))}
                  </section>
                ) : null}
                {results.artifacts.length ? (
                  <section className="mt-2">
                    <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-tertiary)]">
                      Artifacts
                    </div>
                    {results.artifacts.map((artifact) => {
                      const meta = blueprintMeta[artifact.blueprintKey];
                      const Icon = meta.icon;
                      const selected = selectedIds.has(artifact._id);
                      return (
                        <div
                          key={artifact._id}
                          className="group flex items-center rounded-[8px] hover:bg-[var(--bg-hover)]"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onOpenArtifact(artifact);
                              setOpen(false);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left"
                          >
                            <Icon
                              className="h-4 w-4 shrink-0"
                              style={{ color: meta.color }}
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">
                                {artifact.title}
                              </span>
                              <span className="block truncate text-[10px] text-[var(--text-tertiary)]">
                                {meta.label} · {artifact.summary}
                              </span>
                            </span>
                          </button>
                          {onPlaceArtifact && placementWorkspaceId && !(artifact.placements ?? []).some((placement) => placement.workspaceId === placementWorkspaceId) ? <button type="button" onClick={() => onPlaceArtifact(artifact)} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] opacity-0 hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] group-hover:opacity-100" title={`Place in ${placementLabel ?? "workspace"}`} aria-label={`Place ${artifact.title} in ${placementLabel ?? "workspace"}`}><FolderPlus className="h-3.5 w-3.5" /></button> : null}
                          <button
                            type="button"
                            onClick={() => onToggleSelected(artifact)}
                            className={`mr-2 flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-[10px] font-medium ${selected ? "bg-[var(--accent-cyan)] text-white" : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"}`}
                            title={
                              selected
                                ? "Remove from context"
                                : "Add to context"
                            }
                            aria-label={
                              selected
                                ? "Remove from context"
                                : "Add to context"
                            }
                          >
                            {selected ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <PlusIcon />
                            )}
                            {selected ? "Added" : "Add context"}
                          </button>
                        </div>
                      );
                    })}
                  </section>
                ) : null}
                {query.trim().length >= 2 &&
                !results.workspaces.length &&
                !results.artifacts.length ? (
                  <p className="px-3 py-12 text-center text-[12px] text-[var(--text-secondary)]">
                    No matching workspaces or artifacts.
                  </p>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function PlusIcon() {
  return <span className="text-[17px] leading-none">+</span>;
}
