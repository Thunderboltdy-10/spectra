"use client";

import { SearchField } from "@/components/ui/search-field";
import { LoaderCircle, Check, GraduationCap } from "@/components/icons/glyph-icons";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { ProductEmptyState } from "./product-state";
import { requestSpectra } from "../data/request";
import { classIdentity } from "../../../../shared/class-identity";
import { inkStyle, useClassBook } from "../school/use-class-book";

export type ClassShelfCandidate = {
  recordId: string;
  title: string;
  program: string;
  grade: string;
  workspaceId: string | null;
  selected?: boolean;
  retention?: ClassShelfRetention;
  academicPeriodKey?: string;
};

export type ClassShelfRetention = "keep_in_spectra" | "archive_projection";

export type ClassShelfIdentityStatus =
  | "pending"
  | "verified"
  | "no_match"
  | "ambiguous"
  | "revoked";

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
  identityStatus?: ClassShelfIdentityStatus;
  identityMatchCount?: number;
  classes: ClassShelfCandidate[];
  selectionRevision?: number;
  lastSyncAt?: number;
  nextSyncAt?: number;
}> {
  const response = await requestSpectra("/api/spectra/managebac?action=myClasses");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload?.error?.message ?? "Could not load classes.");
  const data = payload.data ?? payload;
  const rows = Array.isArray(data.classes) ? data.classes : [];
  return {
    integration: data.integration ?? null,
    identityRequired: data.identityRequired === true,
    identityStatus:
      typeof data.identityStatus === "string"
        ? (data.identityStatus as ClassShelfIdentityStatus)
        : undefined,
    identityMatchCount:
      typeof data.identityMatchCount === "number"
        ? data.identityMatchCount
        : undefined,
    selectionRevision:
      typeof data.selectionRevision === "number"
        ? data.selectionRevision
        : undefined,
    lastSyncAt:
      typeof data.lastSyncAt === "number" ? data.lastSyncAt : undefined,
    nextSyncAt:
      typeof data.nextSyncAt === "number" ? data.nextSyncAt : undefined,
    classes: rows.map((row: Record<string, unknown>) => ({
      recordId: String(row.recordId ?? ""),
      title: String(row.title ?? "Class"),
      program: typeof row.program === "string" ? row.program : "",
      grade: typeof row.grade === "string" ? row.grade : "",
      workspaceId:
        typeof row.workspaceId === "string" && row.workspaceId
          ? row.workspaceId
          : null,
      selected: row.selected === true,
      retention:
        row.retention === "archive_projection" || row.retention === "keep_in_spectra"
          ? row.retention
          : undefined,
      academicPeriodKey:
        typeof row.academicPeriodKey === "string" && row.academicPeriodKey
          ? row.academicPeriodKey
          : undefined,
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
  initialSelectedIds,
  onSelectedIdsChange,
  submitting,
  submitError,
  submitDisabled = false,
  primaryLabel,
  onSubmit,
  skipLabel,
  onSkip,
  retention = "keep_in_spectra",
  onRetentionChange,
  onResolveIdentity,
  resolvingIdentity = false,
  identityStatus,
}: {
  state: ClassShelfLoadState;
  selectedIds: readonly string[];
  initialSelectedIds?: readonly string[];
  onSelectedIdsChange: (ids: string[]) => void;
  submitting: boolean;
  submitError?: string;
  submitDisabled?: boolean;
  primaryLabel: string;
  onSubmit: () => void;
  skipLabel?: string;
  onSkip?: () => void;
  retention?: ClassShelfRetention;
  onRetentionChange?: (retention: ClassShelfRetention) => void;
  onResolveIdentity?: () => void;
  resolvingIdentity?: boolean;
  identityStatus?: ClassShelfIdentityStatus;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const initiallySelected = useMemo(
    () => new Set(initialSelectedIds ?? []),
    [initialSelectedIds],
  );
  const deselectedCount = [...initiallySelected].filter(
    (recordId) => !selected.has(recordId),
  ).length;
  const book = useClassBook();
  // Each class in the ink it will wear as a workspace, subjects first, as School's own choice shows them.
  const visible = useMemo(() => {
    const classes = state.kind === "ready" ? state.classes : [];
    const needle = query.trim().toLowerCase();
    return classes
      .filter((item) => matchesQuery(item, needle))
      .map((item) => {
        const known = book.classes.find((cls) => cls.recordId === item.recordId);
        const identity = known ? book.of(known.providerClassId, known.title)! : classIdentity({ providerClassId: item.recordId, title: item.title });
        return { ...item, identity };
      })
      .sort((a, b) => Number(b.identity.subject) - Number(a.identity.subject) || a.identity.name.localeCompare(b.identity.name));
  }, [book, query, state]);

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
            title:
              identityStatus === "no_match"
                ? "Your school account was not found"
                : identityStatus === "ambiguous"
                  ? "Your school account needs review"
                  : "Match your ManageBac account",
            detail:
              identityStatus === "no_match"
                ? "Spectra searched only for the email on your Spectra account. Check that your invitation and ManageBac email match, then try again or continue in General."
                : identityStatus === "ambiguous"
                  ? "ManageBac returned more than one exact email match. Ask a school administrator to review the school connection."
                  : "Spectra uses the email on your Spectra account to find one matching ManageBac account via the school connection. No provider account is exposed or guessed.",
          }
        : state.kind === "empty"
          ? {
              title: "No current classes",
              detail:
                "Nothing to file into class shelves. General is ready for your artifact.",
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
          action={
            state.kind === "identity_required" && onResolveIdentity ? (
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={submitting || resolvingIdentity}
                onClick={onResolveIdentity}
              >
                {resolvingIdentity ? "Matching…" : "Match my school account"}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <label className="sr-only" htmlFor="class-shelf-search">
            Search classes
          </label>
          <SearchField
            ref={searchRef}
            id="class-shelf-search"
            value={query}
            onChange={setQuery}
            onKeyDown={onListKeyDown}
            label="Search classes"
            placeholder="Search by name, programme, or grade"
            autoComplete="off"
          />
          <p className="mt-2 text-micro text-[var(--text-secondary)]">
            {selected.size === 0
              ? `${visible.length} class${visible.length === 1 ? "" : "es"}`
              : `${selected.size} selected`}
          </p>
          <ul
            role="listbox"
            aria-multiselectable="true"
            aria-label="Classes"
            className="school-choice mt-2 max-h-[min(52vh,420px)] overflow-y-auto p-0.5"
            onKeyDown={onListKeyDown}
          >
            {visible.length === 0 ? (
              <li className="col-span-full px-3 py-8 text-center text-caption text-[var(--text-secondary)]">
                No classes match that search.
              </li>
            ) : (
              visible.map((item, index) => {
                const checked = selected.has(item.recordId);
                const meta = [item.program, item.grade].filter(Boolean).join(" / ");
                return (
                  <li key={item.recordId} role="none">
                    <button
                      type="button"
                      role="option"
                      aria-selected={checked}
                      data-class-control="true"
                      data-class-title={item.title}
                      data-active={index === activeIndex || undefined}
                      title={meta || undefined}
                      style={inkStyle(item.identity)}
                      className="school-choice-item"
                      onClick={() => {
                        setActiveIndex(index);
                        toggle(item.recordId);
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                    >
                      <span aria-hidden className="school-choice-box">
                        {checked ? <Check className="size-3" strokeWidth={2.5} /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.identity.name}</span>
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
      {state.kind === "ready" && onRetentionChange && deselectedCount > 0 ? (
        <fieldset className="mt-5 rounded-card border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
          <legend className="px-1 text-micro font-semibold text-[var(--text-primary)]">
            What should happen to classes you stop following?
          </legend>
          <div className="mt-2 space-y-2">
            <label className="flex cursor-pointer gap-2.5 text-micro text-[var(--text-secondary)]">
              <input
                type="radio"
                name="managebac-retention"
                value="keep_in_spectra"
                checked={retention === "keep_in_spectra"}
                onChange={() => onRetentionChange("keep_in_spectra")}
                className="mt-0.5 accent-[var(--text-primary)]"
              />
              <span>
                <strong className="block text-[var(--text-primary)]">Keep in Spectra</strong>
                Keep your notes, completion, schedule, reminders, and links. This only stops new school updates.
              </span>
            </label>
            <label className="flex cursor-pointer gap-2.5 text-micro text-[var(--text-secondary)]">
              <input
                type="radio"
                name="managebac-retention"
                value="archive_projection"
                checked={retention === "archive_projection"}
                onChange={() => onRetentionChange("archive_projection")}
                className="mt-0.5 accent-[var(--text-primary)]"
              />
              <span>
                <strong className="block text-[var(--text-primary)]">Archive in Spectra</strong>
                Hide the class projection in Spectra only. Nothing is deleted or changed in ManageBac.
              </span>
            </label>
          </div>
        </fieldset>
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
          disabled={submitting || state.kind === "loading" || submitDisabled}
          onClick={onSubmit}
        >
          {submitting ? "Saving" : primaryLabel}
        </Button>
      </div>
    </div>
  );
}
