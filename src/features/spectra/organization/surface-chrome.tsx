"use client";

import { type ReactNode } from "react";
import { Loader2, FolderPlus, Plus, Search, SlidersHorizontal, X, ArrowDownUp, Columns3, Upload } from "@/components/icons/glyph-icons";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  blueprintChoices,
  createDefaultArtifactPayload,
} from "../components/artifact-blueprint-sheet";
import { workTypeMeta } from "../components/artifact-card";
import { workTypeFilters } from "./node-identity";
import type { SortDirection, SortKey, TypeFilter } from "./tree-model";

/**
 * The chrome every view of the tree shares (CANON D41).
 *
 * The Library's List and its Board are two views of one world, so they are one
 * toolbar: one search box, one type filter, one grouping control, one create
 * menu, one view switch, one set of names. Before this file there were two
 * searches, two "All types" controls with two different vocabularies and two
 * different visual treatments, a grouping control that opened in a style nothing
 * else used, and a second "New" button in a row that already had one. Each of
 * those was a bug, not a variant.
 *
 * Everything here takes props and holds no state. A per-view difference is a
 * prop; it is never a fork.
 */

/** Every control in the toolbar is this button. One height, one radius. */
export const controlClass =
  "flex h-8 shrink-0 items-center gap-1.5 rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 text-caption font-medium text-[var(--text-secondary)] outline-none transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] focus-visible:border-[var(--brand-primary)] disabled:opacity-40";

/** The engaged state: a control that is currently narrowing what you see. */
export const controlActiveClass =
  "border-[var(--brand-primary)] text-[var(--text-primary)]";

export type SurfaceView = "list" | "board";

export type BoardGroupBy = "type" | "workspace" | "updated" | "folder";

export const GROUP_BY_LABELS: Record<BoardGroupBy, string> = {
  type: "Type",
  workspace: "Workspace",
  folder: "Folder",
  updated: "Last activity",
};

/**
 * One vocabulary for "what kind of thing".
 *
 * The server keys its board columns on exactly these values (`orgNodes.typeKey`),
 * so the filter, the columns and the create menu all speak the same words. The
 * List used to add "All work", "Chats" and "Folders and workspaces" — three
 * options the Board could not honour — which is how the same control came to
 * mean two different things in two places.
 */
export const TYPE_FILTERS: ReadonlyArray<{ key: string; label: string }> = [
  ...workTypeFilters.map((type) => ({ key: type.key, label: type.label })),
  { key: "thread", label: "Chats" },
];

export function typeFilterLabel(filter: TypeFilter) {
  if (filter === "all") return "All types";
  return TYPE_FILTERS.find((type) => type.key === filter)?.label ?? "Filtered";
}

/** Search, once. The only search input any view of the tree renders. */
export function SurfaceSearch({
  value,
  onChange,
  scopeLabel,
  className,
  onMoveToResults,
  onOpenFirstResult,
  descriptionId,
}: {
  value: string;
  onChange: (next: string) => void;
  /** What is being searched, so the placeholder tells the truth about scope. */
  scopeLabel: string;
  className?: string;
  onMoveToResults?: () => void;
  onOpenFirstResult?: () => void;
  descriptionId?: string;
}) {
  return (
    <div className={cn("relative min-w-9 w-[240px] max-w-full shrink", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={`Search ${scopeLabel}`}
        aria-label={`Search ${scopeLabel}`}
        aria-describedby={descriptionId}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && onMoveToResults) {
            event.preventDefault();
            onMoveToResults();
            return;
          }
          if (event.key === "Enter" && onOpenFirstResult) {
            event.preventDefault();
            onOpenFirstResult();
          }
        }}
        className="h-8 w-full rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-8 pr-7 text-ui text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--brand-primary)]"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-chip text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** List or Board. Same rows, same filters, different shape. */
export function SurfaceViewSwitch({
  view,
  onChange,
  views,
}: {
  view: SurfaceView;
  onChange: (next: SurfaceView) => void;
  views: ReadonlyArray<{
    key: SurfaceView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
}) {
  return (
    <nav
      aria-label="View"
      className="flex h-8 shrink-0 items-center gap-0.5 rounded-control border border-[var(--border-default)] bg-[var(--bg-secondary)] p-0.5"
    >
      {views.map((option) => {
        const Icon = option.icon;
        const active = view === option.key;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.key)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-chip px-2.5 text-caption font-medium transition",
              active
                ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
            )}
          >
            <Icon className="size-3.5" />
            {option.label}
          </button>
        );
      })}
    </nav>
  );
}

/** Narrow to one kind of thing. Understood identically by every view. */
export function SurfaceTypeFilter({
  filter,
  onChange,
}: {
  filter: TypeFilter;
  onChange: (next: TypeFilter) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(controlClass, filter !== "all" && controlActiveClass)}
        aria-label="Filter by type"
      >
        <SlidersHorizontal className="size-3.5" />
        {typeFilterLabel(filter)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        <DropdownMenuRadioGroup
          value={filter}
          onValueChange={(value) => onChange(value as TypeFilter)}
        >
          <DropdownMenuRadioItem value="all">All types</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {TYPE_FILTERS.map((type) => {
            const Icon =
              workTypeMeta[type.key as keyof typeof workTypeMeta]?.icon ??
              workTypeMeta.thread_reference.icon;
            return (
              <DropdownMenuRadioItem key={type.key} value={type.key}>
                <Icon className="size-3.5 text-[var(--text-tertiary)]" />
                {type.label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** How the board cuts its columns. The Board's only exclusive control. */
export function SurfaceGroupBy({
  value,
  onChange,
}: {
  value: BoardGroupBy;
  onChange: (next: BoardGroupBy) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={controlClass} aria-label="Group columns by">
        <Columns3 className="size-3.5" />
        Grouped by {GROUP_BY_LABELS[value].toLowerCase()}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as BoardGroupBy)}
        >
          {(Object.keys(GROUP_BY_LABELS) as BoardGroupBy[]).map((key) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {GROUP_BY_LABELS[key]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SORT_LABELS: Record<"manual" | SortKey, string> = {
  manual: "Arrangement",
  name: "Name",
  updated: "Recent activity",
  type: "Type",
};

/**
 * Row order. The List's only exclusive control: a board's order *is* its
 * grouping, so offering both there would be two answers to one question.
 */
export function SurfaceSortMenu({
  sortKey,
  direction,
  onKeyChange,
  onDirectionChange,
  settling,
}: {
  sortKey: "manual" | SortKey;
  direction: SortDirection;
  onKeyChange: (next: "manual" | SortKey) => void;
  onDirectionChange: (next: SortDirection) => void;
  settling: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(controlClass, sortKey !== "manual" && controlActiveClass)}
        aria-label="Sort"
      >
        {settling ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ArrowDownUp className="size-3.5" />
        )}
        {SORT_LABELS[sortKey]}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px]">
        <DropdownMenuRadioGroup
          value={sortKey}
          onValueChange={(value) => onKeyChange(value as "manual" | SortKey)}
        >
          <DropdownMenuRadioItem value="manual">
            Arrangement
            <span className="ml-auto pr-4 text-micro text-[var(--text-tertiary)]">
              drag
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="updated">
            Recent activity
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="type">Type</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {sortKey !== "manual" ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                onDirectionChange(direction === "asc" ? "desc" : "asc");
              }}
            >
              <ArrowDownUp className="size-3.5 text-[var(--text-tertiary)]" />
              {direction === "asc" ? "Ascending" : "Descending"}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type BlueprintChoiceKey = Parameters<
  typeof createDefaultArtifactPayload
>[0];

/**
 * Make something. One menu, wherever creation happens — the toolbar, a column's
 * foot, an empty state.
 *
 * `fixedTypeKey` is CANON D43 in one prop: when the position the reader clicked
 * already decides the type, the menu does not ask for it again. The same is true
 * in reverse for the place, which the caller decides from where the button
 * lives, never from a second dialog.
 */
export function SurfaceNewMenu({
  disabled,
  disabledTitle,
  importing,
  onNewFolder,
  onNewWorkspace,
  onNewWork,
  onImport,
  fixedTypeKey,
  label = "New",
  placeLabel,
  align = "end",
  trigger,
  placeChoices,
}: {
  disabled?: boolean;
  /** Why the control is inactive — visible status text plus title / aria. */
  disabledTitle?: string;
  importing?: boolean;
  onNewFolder?: () => void;
  onNewWorkspace?: () => void;
  onNewWork: (key: BlueprintChoiceKey) => void;
  onImport?: () => void;
  /** Set when the position already fixes the type; the menu then skips asking. */
  fixedTypeKey?: string;
  label?: string;
  /** Where the new thing will land, said once, at the top of the menu. */
  placeLabel?: string;
  align?: "start" | "end";
  /** Replaces the default filled button — used by a column's own affordance. */
  trigger?: ReactNode;
  /** The only unanswered choice when a board column already fixes the type. */
  placeChoices?: ReadonlyArray<{
    key: string;
    label: string;
    onSelect: () => void;
  }>;
}) {
  const choices = fixedTypeKey
    ? blueprintChoices.filter((choice) => choice.key === fixedTypeKey)
    : blueprintChoices;

  /* Hover-only title failed live honesty on Recent/quick; keep title/aria and
     also show the reason as visible muted status text beside the control. */
  const disabledReason =
    disabled && disabledTitle ? (
      <span
        role="status"
        className="max-w-[14rem] text-micro leading-4 text-[var(--text-tertiary)]"
      >
        {disabledTitle}
      </span>
    ) : null;
  const withDisabledReason = (control: ReactNode) =>
    disabledReason ? (
      <span className="inline-flex max-w-full flex-wrap items-center gap-2">
        {control}
        {disabledReason}
      </span>
    ) : (
      control
    );

  /* The type is settled and there is exactly one thing this button can make, so
     it makes it. A menu of one item asks a question with one answer. */
  if (
    fixedTypeKey &&
    choices.length === 1 &&
    !onNewFolder &&
    !onNewWorkspace &&
    !onImport &&
    !placeChoices?.length
  ) {
    const only = choices[0]!;
    return withDisabledReason(
      <button
        type="button"
        disabled={disabled}
        title={disabled ? disabledTitle : undefined}
        onClick={() => onNewWork(only.key)}
        className={cn(controlClass, "w-full justify-center")}
      >
        <Plus className="size-3.5" />
        {label}
      </button>,
    );
  }

  /* Disabled controls often skip native title; wrap so hover/focus still
     explain why New is inactive (e.g. quick views / Trash). */
  const triggerNode = trigger ?? (
    <span
      className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-control bg-[var(--text-primary)] px-3 text-ui font-medium text-[var(--text-inverse)] transition-opacity hover:opacity-90"
      title={disabled ? disabledTitle : undefined}
      aria-description={disabled ? disabledTitle : undefined}
    >
      <Plus className="size-3.5" />
      {label}
    </span>
  );

  return withDisabledReason(
    <DropdownMenu>
      <span
        className="inline-flex"
        title={disabled ? disabledTitle : undefined}
      >
        <DropdownMenuTrigger disabled={disabled} asChild={Boolean(trigger)}>
          {triggerNode}
        </DropdownMenuTrigger>
      </span>
      <DropdownMenuContent
        align={align}
        className="w-[240px]"
        /* New lists every work type; the last rows sit over the live dock.
           dropdown (60) loses to composer-dock (120), so Whiteboard was a
           visible no-op click. Open this menu on the dock layer instead. */
        layer="composer-dock"
        collisionPadding={{ bottom: 16 }}
      >
        {fixedTypeKey && placeChoices?.length ? (
          <>
            <DropdownMenuLabel>File in</DropdownMenuLabel>
            {placeChoices.map((place) => (
              <DropdownMenuItem key={place.key} onSelect={place.onSelect}>
                <Columns3 className="size-3.5 text-[var(--text-tertiary)]" />
                {place.label}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        {placeLabel ? (
          <DropdownMenuLabel>Into {placeLabel}</DropdownMenuLabel>
        ) : null}
        {onNewFolder ? (
          <DropdownMenuItem onSelect={onNewFolder}>
            <FolderPlus className="size-3.5 text-[var(--text-tertiary)]" />
            New folder
          </DropdownMenuItem>
        ) : null}
        {onNewWorkspace ? (
          <DropdownMenuItem onSelect={onNewWorkspace}>
            <Columns3 className="size-3.5 text-[var(--text-tertiary)]" />
            New workspace
          </DropdownMenuItem>
        ) : null}
        {onImport ? (
          <DropdownMenuItem onSelect={onImport} disabled={importing}>
            {importing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5 text-[var(--text-tertiary)]" />
            )}
            Import a file
          </DropdownMenuItem>
        ) : null}
        {onNewFolder || onNewWorkspace || onImport ? (
          <DropdownMenuSeparator />
        ) : null}
        {placeLabel || !(onNewFolder || onNewWorkspace || onImport) ? null : (
          <DropdownMenuLabel>New work here</DropdownMenuLabel>
        )}
        {!placeChoices?.length && choices.map((choice) => (
          <DropdownMenuItem
            key={choice.key}
            onSelect={() => onNewWork(choice.key)}
          >
            <choice.icon className="size-3.5 text-[var(--text-tertiary)]" />
            {choice.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

