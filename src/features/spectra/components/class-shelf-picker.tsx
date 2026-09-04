"use client";

import { Check, GraduationCap, LoaderCircle, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductEmptyState } from "./product-state";
import { cn } from "@/lib/utils";

export type ClassShelfCandidate = {
  recordId: string;
  title: string;
  program: string;
  grade: string;
  workspaceId: string | null;
};

export type ClassShelfLoadState =
  | { kind: "loading" }
  | { kind: "not_connected" }
  | { kind: "identity_required" }
  | { kind: "empty" }
  | { kind: "ready"; classes: ClassShelfCandidate[] }
  | { kind: "error"; message: string };

export async function fetchMyClassCandidates(): Promise<{
  integration: unknown;
  identityRequired: boolean;
  classes: ClassShelfCandidate[];
}> {
  const response = await fetch("/api/spectra/managebac?action=myClasses");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload?.error?.message ?? "Could not load classes.");
  const data = payload.data ?? payload;
  const rows = Array.isArray(data.classes) ? data.classes : [];
  return {
    integration: data.integration ?? null,
    identityRequired: data.identityRequired === true,
    classes: rows.map((row: Record<string, unknown>) => ({
      recordId: String(row.recordId ?? ""),
      title: String(row.title ?? "Class"),
      program: typeof row.program === "string" ? row.program : "",
      grade: typeof row.grade === "string" ? row.grade : "",
      workspaceId:
        typeof row.workspaceId === "string" && row.workspaceId
          ? row.workspaceId
          : null,
    })).filter((row: ClassShelfCandidate) => row.recordId),
  };
}

export function classShelfLoadState(input: {
  integration: unknown;
  identityRequired: boolean;
  classes: ClassShelfCandidate[];
}): ClassShelfLoadState {
  if (!input.integration) return { kind: "not_connected" };
  if (input.identityRequired) return { kind: "identity_required" };
  if (input.classes.length === 0) return { kind: "empty" };
  return { kind: "ready", classes: input.classes };
}

function matchesQuery(item: ClassShelfCandidate, query: string) {
  if (!query) return true;
  const haystack = `${item.title} ${item.program} ${item.grade}`.toLowerCase();
  return haystack.includes(query);
}

export function ClassShelfPicker({
  state,
  selectedIds,
  onSelectedIdsChange,
  submitting,
  submitError,
  primaryLabel,
  onSubmit,
  skipLabel,
  onSkip,
}: {
  state: ClassShelfLoadState;
  selectedIds: readonly string[];
  onSelectedIdsChange: (ids: string[]) => void;
  submitting: boolean;
  submitError?: string;
  primaryLabel: string;
  onSubmit: () => void;
  skipLabel?: string;
  onSkip?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visible = useMemo(() => {
    const classes = state.kind === "ready" ? state.classes : [];
    const needle = query.trim().toLowerCase();
    return classes.filter((item) => matchesQuery(item, needle));
  }, [query, state]);

  useEffect(() => {
    setActiveIndex((current) =>
      visible.length === 0 ? 0 : Math.min(current, visible.length - 1),
    );
  }, [visible.length]);

  useEffect(() => {
    if (state.kind === "ready") searchRef.current?.focus();
  }, [state.kind]);

  function toggle(recordId: string) {
    const next = new Set(selected);
    if (next.has(recordId)) next.delete(recordId);
    else next.add(recordId);
    onSelectedIdsChange([...next]);
  }

  function onListKeyDown(event: KeyboardEvent) {
    if (state.kind !== "ready" || visible.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % visible.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        current === 0 ? visible.length - 1 : current - 1,
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(visible.length - 1);
    } else if (event.key === " " || event.key === "Enter") {
      const item = visible[activeIndex];
      if (!item) return;
      event.preventDefault();
      toggle(item.recordId);
    }
  }

  const emptyCopy =
    state.kind === "not_connected"
      ? {
          title: "Classes are not connected yet",
          detail:
            "You can work in General now. When School connects ManageBac, choose the classes you use.",
        }
      : state.kind === "identity_required"
        ? {
            title: "Spectra could not match your ManageBac account",
            detail:
              "You can still work in General. Ask a school administrator if your school email should appear in ManageBac.",
          }
        : state.kind === "empty"
          ? {
              title: "No current classes",
              detail:
                "Nothing to file into class shelves. General is ready for your work.",
            }
          : state.kind === "error"
            ? {
                title: "Classes could not load",
                detail: state.message,
              }
            : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {state.kind === "loading" ? (
        <div className="grid min-h-52 flex-1 place-items-center">
          <LoaderCircle className="size-5 animate-spin text-[var(--text-tertiary)]" />
          <span className="sr-only">Loading classes</span>
        </div>
      ) : emptyCopy ? (
        <ProductEmptyState
          icon={GraduationCap}
          title={emptyCopy.title}
          detail={emptyCopy.detail}
        />
      ) : (
        <>
          <label className="sr-only" htmlFor="class-shelf-search">
            Search classes
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <Input
              ref={searchRef}
              id="class-shelf-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onListKeyDown}
              placeholder="Search by name, programme, or grade"
              autoComplete="off"
              className="pl-9"
            />
          </div>
          <p className="mt-2 text-micro text-[var(--text-secondary)]">
            {selected.size === 0
              ? `${visible.length} class${visible.length === 1 ? "" : "es"}`
              : `${selected.size} selected`}
          </p>
          <ul
            role="listbox"
            aria-multiselectable="true"
            aria-label="Classes"
            className="mt-2 max-h-[min(52vh,420px)] space-y-1 overflow-y-auto"
            onKeyDown={onListKeyDown}
          >
            {visible.length === 0 ? (
              <li className="px-3 py-8 text-center text-caption text-[var(--text-secondary)]">
                No classes match that search.
              </li>
            ) : (
              visible.map((item, index) => {
                const checked = selected.has(item.recordId);
                const active = index === activeIndex;
                const meta = [item.program, item.grade]
                  .filter(Boolean)
                  .join(" / ");
                return (
                  <li key={item.recordId} role="none">
                    <button
                      type="button"
                      role="option"
                      aria-selected={checked}
                      data-class-control="true"
                      data-class-title={item.title}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left",
                        active
                          ? "bg-[var(--bg-hover)]"
                          : "hover:bg-[var(--bg-secondary)]",
                      )}
                      onClick={() => {
                        setActiveIndex(index);
                        toggle(item.recordId);
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                    >
                      <span
                        className={cn(
                          "grid size-5 shrink-0 place-items-center rounded-control border",
                          checked
                            ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)]"
                            : "border-[var(--border-default)] bg-[var(--bg-primary)]",
                        )}
                      >
                        {checked ? <Check className="size-3" strokeWidth={2.5} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-caption font-medium text-[var(--text-primary)]">
                          {item.title}
                        </strong>
                        {meta ? (
                          <span className="block truncate text-micro text-[var(--text-secondary)]">
                            {meta}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </>
      )}
      {submitError ? (
        <p className="mt-3 text-caption text-[var(--danger)]" role="alert">
          {submitError}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {onSkip && skipLabel ? (
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={onSkip}
          >
            {skipLabel}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="primary"
          disabled={submitting || state.kind === "loading"}
          onClick={onSubmit}
        >
          {submitting ? "Saving" : primaryLabel}
        </Button>
      </div>
    </div>
  );
}
