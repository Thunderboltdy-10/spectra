"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Bot,
  Check,
  Crosshair,
  Files,
  FileText,
  FolderPlus,
  Globe2,
  MessageSquare,
  Search,
  Sparkles,
  Sprout,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { workTypeMeta } from "./artifact-card";
import {
  searchSpectra,
  getSpectraThreads,
  postSpectra,
  type SpectraArtifact,
  type SpectraThread,
  type SpectraWorkspace,
} from "../data/api";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { toast } from "sonner";
import { spectraBus } from "../events";

export type ComposerFocusMode =
  "global" | "workspace" | "artifact" | "selection" | "thread";

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
        className="w-[min(430px,calc(100vw-28px))] rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[0_18px_48px_rgba(27,20,12,0.18)]"
      >
        <div className="text-[12px] font-semibold text-[var(--text-primary)]">
          Keep the continuation coherent
        </div>
        <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">
          You are continuing {currentTitle} while opening {candidateTitle}.
          Choose what the next message should continue.
        </p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => toast.dismiss(id)}
            className="min-h-9 rounded-[7px] px-2.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            Keep current
          </button>
          <button
            type="button"
            onClick={() => {
              toast.dismiss(id);
              onCancel();
            }}
            className="min-h-9 rounded-[7px] px-2.5 text-[11px] text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_7%,transparent)]"
          >
            Cancel opening
          </button>
          <button
            type="button"
            onClick={() => {
              toast.dismiss(id);
              onReplace();
            }}
            className="min-h-9 rounded-[7px] bg-[var(--text-primary)] px-3 text-[11px] font-semibold text-[var(--bg-primary)]"
          >
            Replace continuation
          </button>
        </div>
      </div>
    ),
    { duration: 12_000 },
  );
}

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
  const [dialogPosition, setDialogPosition] = useState({
    left: 12,
    bottom: 76,
  });
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchSequence = useRef(0);
  const [results, setResults] = useState<{
    artifacts: SpectraArtifact[];
    workspaces: SpectraWorkspace[];
  }>({ artifacts: [], workspaces: [] });
  const [threads, setThreads] = useState<SpectraThread[]>([]);
  const ref = useRef<HTMLDivElement | null>(null);
  const wasOpen = useRef(false);
  const explicit = useSpectraContextStore((state) => state.explicit);
  const visible = useSpectraContextStore((state) => state.visible);
  const continuation = useSpectraContextStore((state) => state.continuation);
  const storeAddExplicit = useSpectraContextStore((state) => state.addExplicit);
  const removeExplicit = useSpectraContextStore(
    (state) => state.removeExplicit,
  );
  const setContinuation = useSpectraContextStore(
    (state) => state.setContinuation,
  );
  const chooseContinuation = useCallback(
    (
      next: {
        id: string;
        title: string;
        workspaceId?: string;
        runId?: string;
      } | null,
    ) => {
      setContinuation(next);
      onModeChange(
        next
          ? "thread"
          : explicit.length
            ? "selection"
            : workspace
              ? "workspace"
              : artifact
                ? "artifact"
                : "global",
      );
      setOpen(false);
      void postSpectra({ action: "selectRunTab", runId: next?.runId }).catch(
        () => undefined,
      );
    },
    [artifact, explicit.length, onModeChange, setContinuation, workspace],
  );
  const addExplicit = useCallback(
    (item: Parameters<typeof storeAddExplicit>[0]) => {
      if (item.type === "thread" && !continuation) {
        chooseContinuation({
          id: item.id,
          title: item.label,
          workspaceId: item.workspaceId,
        });
        return;
      }
      storeAddExplicit(item);
      onModeChange("selection");
    },
    [chooseContinuation, continuation, onModeChange, storeAddExplicit],
  );
  useEffect(() => {
    if (wasOpen.current && !open)
      requestAnimationFrame(() => triggerRef.current?.focus());
    if (!open) {
      setQuery("");
    }
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.PointerEvent) => {
      if (
        !ref.current?.contains(event.target as Node) &&
        !dialogRef.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  useEffect(() => {
    if (!open) {
      setThreads([]);
      return;
    }
    void getSpectraThreads({ limit: 80 })
      .then((threadRows) => {
        setThreads(threadRows.threads);
      })
      .catch(() => {
        setThreads([]);
      });
  }, [open]);
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults({ artifacts: [], workspaces: [] });
      return;
    }
    const sequence = ++searchSequence.current;
    const timer = window.setTimeout(
      () =>
        void searchSpectra(query)
          .then((value) => {
            if (searchSequence.current === sequence) setResults(value);
          })
          .catch(() => {
            if (searchSequence.current === sequence)
              setResults({ artifacts: [], workspaces: [] });
          }),
      160,
    );
    return () => window.clearTimeout(timer);
  }, [open, query]);
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
  const visibleFocus = [
    threadTitle
      ? { key: "thread", label: threadTitle, Icon: MessageSquare }
      : null,
    workspace
      ? { key: "workspace", label: workspace.title, Icon: BookOpen }
      : null,
    artifact
      ? {
          key: "artifact",
          label: artifact.title,
          Icon: artifact.blueprintKey === "agent" ? Bot : FileText,
        }
      : null,
    selectedCount
      ? { key: "selection", label: `${selectedCount} selected`, Icon: Files }
      : null,
  ].filter(
    (item): item is { key: string; label: string; Icon: typeof Globe2 } =>
      Boolean(item),
  );
  const uniqueVisible = visible.filter(
    (item, index) =>
      visible.findIndex(
        (candidate) => candidate.type === item.type && candidate.id === item.id,
      ) === index,
  );
  // The continued thread already owns the chat lane. Repeating it as context
  // suggests that the same conversation is being attached twice.
  const includedVisible = uniqueVisible.filter(
    (item) => !(item.type === "thread" && item.id === continuation?.id),
  );
  const focusSummary =
    mode === "thread" && visibleFocus.length > 1
      ? `${threadTitle} + ${visibleFocus.length - 1} focus item${visibleFocus.length === 2 ? "" : "s"}`
      : detail;
  const contextCount = new Set(
    [...explicit, ...includedVisible]
      .filter((item) => !item.stale)
      .map((item) => `${item.type}:${item.id}`),
  ).size;
  const TriggerIcon =
    mode === "thread"
      ? MessageSquare
      : mode === "artifact"
        ? artifact?.blueprintKey === "agent"
          ? Bot
          : FileText
        : mode === "workspace"
          ? Sprout
          : mode === "selection"
            ? Files
            : Globe2;
  return (
    <div ref={ref} className="relative flex shrink-0 self-center">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!open) {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (rect)
              setDialogPosition({
                left: Math.max(
                  12,
                  Math.min(rect.left, window.innerWidth - 412),
                ),
                bottom: Math.max(76, window.innerHeight - rect.top + 11),
              });
          }
          setOpen((value) => !value);
        }}
        data-focus-state={mode}
        data-spectra-context-trigger="true"
        className={`relative grid size-9 place-items-center rounded-[8px] text-[var(--text-secondary)] shadow-none transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ${open ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : ""}`}
        aria-label={`Choose AI focus${focusSummary ? `: ${focusSummary}` : ""}${contextCount ? ` · ${contextCount} context` : ""}`}
        aria-expanded={open}
        aria-controls="spectra-context-browser"
        title={focusSummary || "Choose what Spectra will focus on"}
      >
        <TriggerIcon className="h-4 w-4" strokeWidth={2} />
        {contextCount > 0 ? (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--text-primary)] px-1 text-micro font-semibold leading-none text-[var(--bg-primary)]"
            aria-hidden
          >
            {contextCount > 99 ? "99+" : contextCount}
          </span>
        ) : null}
      </button>
      <>
        {open
          ? createPortal(
              <motion.div
                ref={dialogRef}
                id="spectra-context-browser"
                role="dialog"
                aria-label="Choose context for the next Spectra run"
                initial={{ opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                transition={{ duration: 0.16 }}
                className="fixed z-[300] w-[min(400px,calc(100vw-24px))] overflow-hidden rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2 shadow-[0_18px_48px_rgba(27,20,12,0.16)]"
                style={dialogPosition}
              >
                <div className="px-2 pb-2 pt-1 text-[16px] font-semibold text-[var(--text-primary)]">
                  Context
                </div>
                <div className="px-2 pb-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">
                  Chat
                </div>
                {continuation ? (
                  <div className="mx-1 mb-2 flex min-h-11 items-center gap-2 rounded-[8px] border border-[color-mix(in_oklab,#8b6ff0_22%,var(--border-default))] bg-[color-mix(in_oklab,#8b6ff0_6%,var(--bg-primary))] px-2.5 py-2">
                    <MessageSquare className="h-4 w-4 text-[#765bd8]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                        {continuation.title}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => chooseContinuation(null)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      aria-label="Start a new chat"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="mx-1 mb-2 flex min-h-11 items-center gap-2 rounded-[8px] border border-dashed border-[var(--border-default)] px-2.5 py-2 text-[12px] font-medium text-[var(--text-secondary)]">
                    <MessageSquare className="h-4 w-4" />
                    New chat
                    <span className="sr-only">
                      None selected — the next message starts a new thread.
                    </span>
                    <Check className="ml-auto h-3.5 w-3.5 text-[var(--accent-cyan)]" />
                  </div>
                )}
                <div className="mx-1 mb-1 border-t border-[var(--border-subtle)] px-1 pb-1.5 pt-2 text-[11px] font-semibold text-[var(--text-secondary)]">
                  Also use
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void spectraBus.command("context.beginPicking", {
                      source: "composer",
                    });
                  }}
                  className="mx-1 mb-1.5 flex min-h-10 w-[calc(100%-8px)] items-center gap-2 rounded-[8px] border border-[var(--border-default)] px-2.5 text-left text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                >
                  <Crosshair className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
                  Pick from page
                  <span className="ml-auto text-micro font-normal text-[var(--text-tertiary)]">
                    Semantic targets
                  </span>
                </button>
                <div className="mx-1 mb-1.5 flex h-10 items-center gap-2 rounded-[8px] bg-[var(--bg-primary)] px-2.5 shadow-[inset_0_0_0_1px_var(--border-default)]">
                  <Search className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Find artifacts, agents, workspaces, or threads…"
                    className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-tertiary)]"
                  />
                </div>
                {explicit.length || includedVisible.length ? (
                  <div className="mx-1 mb-1.5 rounded-[8px] border border-[var(--border-subtle)] p-2">
                    <div className="mb-1.5 text-micro font-medium text-[var(--text-tertiary)]">
                      Included
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {explicit.map((item) => (
                        <button
                          key={`explicit:${item.type}:${item.id}:${item.semanticTargetId ?? "root"}`}
                          type="button"
                          onClick={() => removeExplicit(item.type, item.id)}
                          className={`inline-flex max-w-full items-center gap-1 rounded-[6px] px-1.5 py-1 text-micro ${item.stale ? "bg-[color-mix(in_oklab,var(--danger)_8%,var(--bg-secondary))] text-[var(--danger)]" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]"}`}
                          title={
                            item.stale
                              ? "This object is no longer available. Remove from context."
                              : "Remove from explicit context"
                          }
                        >
                          <span className="max-w-[240px] truncate">
                            {item.label}
                          </span>
                          <X className="h-3 w-3" />
                        </button>
                      ))}
                      {includedVisible
                        .filter(
                          (item) =>
                            !explicit.some(
                              (row) =>
                                row.type === item.type && row.id === item.id,
                            ),
                        )
                        .map((item) => (
                          <span
                            key={`visible:${item.type}:${item.id}`}
                            className="inline-flex max-w-full items-center gap-1 rounded-[6px] bg-[color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-secondary))] px-1.5 py-1 text-micro font-medium text-[var(--text-secondary)]"
                            title="Included because it is visible"
                          >
                            <span className="max-w-[240px] truncate">
                              {item.label}
                            </span>
                            <span className="text-[var(--text-tertiary)]">
                              visible
                            </span>
                          </span>
                        ))}
                    </div>
                  </div>
                ) : null}
                {query.trim().length >= 2 ? (
                  <div className="max-h-[220px] overflow-y-auto px-1 pb-1">
                    {results.workspaces.map((item) => (
                      <button
                        key={item._id}
                        type="button"
                        onClick={() =>
                          addExplicit({
                            type: "workspace",
                            id: item._id,
                            label: item.title,
                            source: "explicit",
                            capability: "context",
                          })
                        }
                        className="flex w-full items-center gap-2 rounded-[7px] px-2 py-2 text-left hover:bg-[var(--bg-hover)]"
                      >
                        <BookOpen className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
                        <span className="min-w-0 flex-1 truncate text-[11px]">
                          {item.title}
                        </span>
                        <span className="text-micro text-[var(--text-tertiary)]">
                          Add context
                        </span>
                      </button>
                    ))}
                    {results.artifacts.map((item) => {
                      const isAgent = item.blueprintKey === "agent";
                      const ItemIcon = isAgent
                        ? Bot
                        : workTypeMeta[item.blueprintKey]?.icon ?? FileText;
                      const itemColor = isAgent
                        ? "var(--brand-primary)"
                        : workTypeMeta[item.blueprintKey]?.color ?? "#d88922";
                      return (
                      <button
                        key={item._id}
                        type="button"
                        onClick={() =>
                          addExplicit({
                            type: "artifact",
                            id: item._id,
                            label: item.title,
                            workspaceId: item.placements?.[0]?.workspaceId,
                            source: "explicit",
                            capability:
                              item.blueprintKey === "thread_reference"
                                ? "context"
                                : isAgent
                                  ? "context"
                                  : "tile",
                          })
                        }
                        className="flex w-full items-center gap-2 rounded-[7px] px-2 py-2 text-left hover:bg-[var(--bg-hover)]"
                      >
                        <ItemIcon
                          className="h-3.5 w-3.5"
                          style={{ color: itemColor }}
                        />
                        <span className="min-w-0 flex-1 truncate text-[11px]">
                          {item.title}
                        </span>
                        <span className="text-micro text-[var(--text-tertiary)]">
                          {isAgent ? "Add agent" : "Add context"}
                        </span>
                      </button>
                      );
                    })}
                    {threads
                      .filter((item) =>
                        `${item.title} ${item.summaryShort ?? ""}`
                          .toLowerCase()
                          .includes(query.trim().toLowerCase()),
                      )
                      .slice(0, 8)
                      .map((item) => (
                        <div
                          key={item._id}
                          className="flex items-center gap-1 rounded-[7px] hover:bg-[var(--bg-hover)]"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              addExplicit({
                                type: "thread",
                                id: item._id,
                                label: item.title,
                                workspaceId: item.workspaceId,
                                source: "explicit",
                                capability: "context",
                              })
                            }
                            className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                          >
                            <MessageSquare className="h-3.5 w-3.5 text-[#8b6ff0]" />
                            <span className="min-w-0 flex-1 truncate text-[11px]">
                              {item.title}
                            </span>
                            <span className="text-micro text-[var(--text-tertiary)]">
                              Use as context
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              chooseContinuation({
                                id: item._id,
                                title: item.title,
                                workspaceId: item.workspaceId,
                                runId: item.lastRunId,
                              })
                            }
                            className="mr-1 rounded-[6px] px-2 py-1 text-micro font-semibold text-[var(--accent-cyan)] hover:bg-[var(--bg-secondary)]"
                          >
                            Continue
                          </button>
                        </div>
                      ))}
                  </div>
                ) : null}
              </motion.div>,
              document.body,
            )
          : null}
      </>
      <span className="sr-only" aria-live="polite">
        {continuation
          ? `Continuing ${continuation.title}. `
          : "Starting a new conversation. "}
        {contextCount} context object{contextCount === 1 ? "" : "s"} included.
      </span>
    </div>
  );
}

export function SelectionActionBar({
  count,
  onClear,
  onExit,
  onAddToContext,
  onTile,
  onMove,
}: {
  count: number;
  onClear: () => void;
  onExit: () => void;
  onAddToContext?: () => void;
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
          <span className="mr-1 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-primary)]">
            <Files className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
            {count ? `${count} selected` : "Select objects"}
          </span>
          {count > 0 ? (
            <>
              <button
                type="button"
                onClick={onAddToContext}
                className="rounded-[6px] px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                Add to context
              </button>
              {onTile ? (
                <button
                  type="button"
                  onClick={onTile}
                  className="rounded-[6px] px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  Group as tiles
                </button>
              ) : null}
              {onMove ? (
                <button
                  type="button"
                  onClick={onMove}
                  className="rounded-[6px] px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  Move
                </button>
              ) : null}
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
            <span className="text-[11px] text-[var(--text-tertiary)]">
              Checkmarks appear only in this mode.
            </span>
          )}
          <button
            type="button"
            onClick={onExit}
            className={`${count ? "" : "ml-auto"} rounded-[6px] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]`}
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
  const [searching, setSearching] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchSequence = useRef(0);
  const [results, setResults] = useState<{
    artifacts: SpectraArtifact[];
    workspaces: SpectraWorkspace[];
  }>({ artifacts: [], workspaces: [] });
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults({ artifacts: [], workspaces: [] });
      setSearching(false);
      return;
    }
    const sequence = ++searchSequence.current;
    setSearching(true);
    const timer = window.setTimeout(
      () =>
        void searchSpectra(query)
          .then((value) => {
            if (searchSequence.current === sequence) setResults(value);
          })
          .catch(() => {
            if (searchSequence.current === sequence)
              setResults({ artifacts: [], workspaces: [] });
          })
          .finally(() => {
            if (searchSequence.current === sequence) setSearching(false);
          }),
      180,
    );
    return () => window.clearTimeout(timer);
  }, [open, query]);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className={
          trigger === "icon"
            ? "flex h-9 w-9 items-center justify-center rounded-[8px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            : "flex h-9 items-center gap-2 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        }
        title="Search Spectra"
        aria-label="Search work and workspaces"
        aria-expanded={open}
        aria-controls="spectra-global-search-dialog"
      >
        <Search className="h-4 w-4" />
        {trigger === "button" ? <span>Search</span> : null}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            className="fixed inset-0 z-[120] flex items-start justify-center bg-black/20 px-4 pt-[12vh]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={() => {
              setOpen(false);
              requestAnimationFrame(() => triggerRef.current?.focus());
            }}
          >
            <motion.div
              ref={dialogRef}
              id="spectra-global-search-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Search Spectra"
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
                <span className="rounded-[5px] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-micro text-[var(--text-tertiary)]">
                  ESC
                </span>
              </div>
              <div className="max-h-[58vh] overflow-y-auto p-2">
                {searching ? (
                  <div className="space-y-2 px-2 py-3" aria-label="Searching">
                    <div className="h-10 animate-pulse rounded-[8px] bg-[var(--bg-secondary)]" />
                    <div className="h-10 animate-pulse rounded-[8px] bg-[var(--bg-secondary)] [animation-delay:90ms]" />
                    <div className="h-10 animate-pulse rounded-[8px] bg-[var(--bg-secondary)] [animation-delay:180ms]" />
                  </div>
                ) : null}
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
                        className="flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left hover:bg-[var(--bg-hover)]"
                      >
                        <BookOpen className="h-4 w-4 text-[var(--accent-cyan)]" />
                        <span>
                          <span className="block text-[12px] font-medium text-[var(--text-primary)]">
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
                      Artifacts
                    </div>
                    {results.artifacts.map((artifact) => {
                      const meta = workTypeMeta[artifact.blueprintKey];
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
                              className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] opacity-60 hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover:opacity-100"
                              title={`Place in ${placementLabel ?? "workspace"}`}
                              aria-label={`Place ${artifact.title} in ${placementLabel ?? "workspace"}`}
                            >
                              <FolderPlus className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => onToggleSelected(artifact)}
                            className={`mr-2 flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-micro font-medium ${selected ? "bg-[var(--text-primary)] text-[var(--bg-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"}`}
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
                {!searching &&
                query.trim().length >= 2 &&
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
