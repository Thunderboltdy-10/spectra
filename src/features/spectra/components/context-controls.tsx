"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { BookOpen, Files, FolderPlus, Search, X } from "@/components/icons/glyph-icons";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { workTypeMeta } from "./artifact-card";
import {
  searchSpectra,
  type SpectraArtifact,
  type SpectraWorkspace,
} from "../data/api";
import { toast } from "sonner";

export function showContinuationConflict({
  currentTitle,
  candidateTitle,
  onReplace,
  onCancel,
}: {
  currentTitle: string;
  candidateTitle: string;
  onReplace: () => void;
  onCancel: () => void;
}) {
  toast.custom(
    (id) => (
      <div
        role="alertdialog"
        aria-label="Choose conversation continuation"
        className="w-[min(430px,calc(100vw-28px))] rounded-surface border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-hover"
      >
        <div className="text-caption font-semibold text-[var(--text-primary)]">
          Keep the continuation coherent
        </div>
        <p className="mt-1 text-micro leading-5 text-[var(--text-secondary)]">
          You are continuing {currentTitle} while opening {candidateTitle}.
          Choose what the next message should continue.
        </p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => toast.dismiss(id)}
            className="min-h-9 rounded-control px-2.5 text-micro text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            Keep current
          </button>
          <button
            type="button"
            onClick={() => {
              toast.dismiss(id);
              onCancel();
            }}
            className="min-h-9 rounded-control px-2.5 text-micro text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_7%,transparent)]"
          >
            Cancel opening
          </button>
          <button
            type="button"
            onClick={() => {
              toast.dismiss(id);
              onReplace();
            }}
            className="min-h-9 rounded-control bg-[var(--text-primary)] px-3 text-micro font-semibold text-[var(--bg-primary)]"
          >
            Replace continuation
          </button>
        </div>
      </div>
    ),
    { duration: 12_000 },
  );
}

export function SelectionActionBar({
  count,
  onClear,
  onExit,
  onTile,
  onMove,
}: {
  count: number;
  onClear: () => void;
  onExit: () => void;
  onTile?: () => void;
  onMove?: () => void;
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
          <span className="mr-1 inline-flex items-center gap-1.5 text-caption font-semibold text-[var(--text-primary)]">
            <Files className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
            {count ? `${count} selected` : "Select objects"}
          </span>
          {count > 0 ? (
            <>
              {onTile ? (
                <button
                  type="button"
                  onClick={onTile}
                  className="rounded-chip px-2 py-1 text-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  Group as tiles
                </button>
              ) : null}
              {onMove ? (
                <button
                  type="button"
                  onClick={onMove}
                  className="rounded-chip px-2 py-1 text-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  Move
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClear}
                className="ml-auto flex h-7 w-7 items-center justify-center rounded-chip text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
                title="Clear selection"
                aria-label="Clear selection"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <span className="text-micro text-[var(--text-tertiary)]">
              Checkmarks appear only in this mode.
            </span>
          )}
          <button
            type="button"
            onClick={onExit}
            className={`${count ? "" : "ml-auto"} rounded-chip px-2 py-1 text-micro font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]`}
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
  onPlaceArtifact,
  placementLabel,
  placementWorkspaceId,
  trigger = "button",
}: {
  onOpenArtifact: (artifact: SpectraArtifact) => void;
  onOpenWorkspace: (workspace: SpectraWorkspace) => void;
  onPlaceArtifact?: (artifact: SpectraArtifact) => void;
  placementLabel?: string;
  placementWorkspaceId?: string;
  trigger?: "button" | "icon";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchRetry, setSearchRetry] = useState(0);
  const searchSequence = useRef(0);
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const [results, setResults] = useState<{
    artifacts: SpectraArtifact[];
    workspaces: SpectraWorkspace[];
  }>({ artifacts: [], workspaces: [] });
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults({ artifacts: [], workspaces: [] });
      setSearching(false);
      setSearchError(false);
      return;
    }
    const sequence = ++searchSequence.current;
    setSearching(true);
    setSearchError(false);
    const timer = window.setTimeout(
      () =>
        void searchSpectra(query)
          .then((value) => {
            if (searchSequence.current === sequence) setResults(value);
          })
          .catch(() => {
            if (searchSequence.current === sequence) {
              setResults({ artifacts: [], workspaces: [] });
              setSearchError(true);
            }
          })
          .finally(() => {
            if (searchSequence.current === sequence) setSearching(false);
          }),
      180,
    );
    return () => window.clearTimeout(timer);
  }, [open, query, searchRetry]);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          // Each opening is a new search; the last query and its results stay
          // behind rather than greeting the next visit.
          setQuery("");
          setOpen(true);
        }}
        className={
          trigger === "icon"
            ? "flex h-9 w-9 items-center justify-center rounded-control text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            : "flex h-9 items-center gap-2 rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-caption font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        }
        title="Search Spectra"
        aria-label="Search work and workspaces"
        aria-expanded={open}
        aria-controls="spectra-global-search-dialog"
      >
        <Search className="h-4 w-4" />
        {trigger === "button" ? <span>Search</span> : null}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          id="spectra-global-search-dialog"
          layer="composer-dock"
          aria-describedby={undefined}
          hideCloseButton
          onOpenAutoFocus={(event) => {
            // Focus the field here, not with autoFocus: the dialog records the
            // search button as the place to return to before this runs.
            event.preventDefault();
            fieldRef.current?.focus();
          }}
          className="top-[12vh] w-[calc(100%-2rem)] max-w-[680px] translate-y-0 gap-0 overflow-hidden p-0"
        >
          <DialogTitle className="sr-only">Search Spectra</DialogTitle>
          <div className="flex items-center gap-3 border-b border-[var(--border-default)] px-4">
            <Search className="h-5 w-5 text-[var(--accent-cyan)]" />
            <input
              ref={fieldRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search titles, summaries, types, workspaces, and stored text…"
              className="h-14 min-w-0 flex-1 bg-transparent text-subhead text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
            />
            <span className="rounded-chip bg-[var(--bg-secondary)] px-1.5 py-0.5 text-micro text-[var(--text-tertiary)]">
              ESC
            </span>
          </div>
          <div className="max-h-[58vh] overflow-y-auto p-2">
            {searching ? (
              <div className="space-y-2 px-2 py-3" aria-label="Searching">
                <div data-life-ghost className="h-10 animate-pulse rounded-control bg-[var(--bg-secondary)]" />
                <div data-life-ghost className="h-10 animate-pulse rounded-control bg-[var(--bg-secondary)] [animation-delay:90ms]" />
                <div data-life-ghost className="h-10 animate-pulse rounded-control bg-[var(--bg-secondary)] [animation-delay:180ms]" />
              </div>
            ) : null}
            {query.trim().length < 2 ? (
              <div className="px-3 py-10 text-center">
                <Sparkles className="mx-auto h-5 w-5 text-[var(--text-tertiary)]" />
                <p className="mt-3 text-caption text-[var(--text-secondary)]">
                  Search across your Spectra workspace.
                </p>
              </div>
            ) : null}
            {results.workspaces.length ? (
              <section>
                <div className="px-2 py-1.5 text-micro font-semibold uppercase tracking-[0.09em] text-[var(--text-tertiary)]">
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
                    className="flex w-full items-center gap-3 rounded-control px-2.5 py-2 text-left hover:bg-[var(--bg-hover)]"
                  >
                    <BookOpen className="h-4 w-4 text-[var(--accent-cyan)]" />
                    <span>
                      <span className="block text-caption font-medium text-[var(--text-primary)]">
                        {workspace.title}
                      </span>
                      <span className="line-clamp-1 text-micro text-[var(--text-tertiary)]">
                        {workspace.description}
                      </span>
                    </span>
                  </button>
                ))}
              </section>
            ) : null}
            {results.artifacts.length ? (
              <section className="mt-2">
                <div className="px-2 py-1.5 text-micro font-semibold uppercase tracking-[0.09em] text-[var(--text-tertiary)]">
                  Work
                </div>
                {results.artifacts.map((artifact) => {
                  const meta = workTypeMeta[artifact.blueprintKey];
                  const Icon = meta.icon;
                  return (
                    <div
                      key={artifact._id}
                      className="group flex items-center rounded-control hover:bg-[var(--bg-hover)]"
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
                          <span className="block truncate text-caption font-medium text-[var(--text-primary)]">
                            {artifact.title}
                          </span>
                          <span className="block truncate text-micro text-[var(--text-tertiary)]">
                            {meta.label} · {artifact.summary}
                          </span>
                        </span>
                      </button>
                      {onPlaceArtifact &&
                      placementWorkspaceId &&
                      !(artifact.placements ?? []).some(
                        (placement) =>
                          placement.workspaceId === placementWorkspaceId,
                      ) ? (
                        <button
                          type="button"
                          onClick={() => onPlaceArtifact(artifact)}
                          className="flex h-8 w-8 items-center justify-center rounded-chip text-[var(--text-tertiary)] opacity-60 hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover:opacity-100"
                          title={`Place in ${placementLabel ?? "workspace"}`}
                          aria-label={`Place ${artifact.title} in ${placementLabel ?? "workspace"}`}
                        >
                          <FolderPlus className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </section>
            ) : null}
            {!searching && query.trim().length >= 2 && searchError ? (
              <div className="px-3 py-8 text-center" role="alert">
                <p className="text-caption text-[var(--danger)]">Search failed.</p>
                <button
                  type="button"
                  className="mt-2 rounded-control px-3 py-1.5 text-caption font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  onClick={() => setSearchRetry((current) => current + 1)}
                >
                  Retry search
                </button>
              </div>
            ) : null}
            {!searching &&
            !searchError &&
            query.trim().length >= 2 &&
            !results.workspaces.length &&
            !results.artifacts.length ? (
              <p className="px-3 py-12 text-center text-caption text-[var(--text-secondary)]">
                No matching workspaces or work.
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
