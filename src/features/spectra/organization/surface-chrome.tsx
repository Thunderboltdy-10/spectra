"use client";

import { SearchField } from "@/components/ui/search-field";
import { useRef, type ReactNode } from "react";
import { Loader2, FolderPlus, Laptop, Plus, SlidersHorizontal, X, ArrowDownUp, Columns3, Upload, MoreHorizontal, CheckSquare } from "@/components/icons/glyph-icons";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
 * Every view of the Library is one toolbar: one search box, one type filter,
 * one create menu, one view switch, one set of names. Before this file there were two
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
  "flex h-9 shrink-0 items-center gap-2 rounded-control px-3 text-ui font-medium text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] disabled:opacity-40 [&_svg]:size-[18px]";

/** The engaged state: a control that is currently narrowing what you see. */
export const controlActiveClass =
  "bg-[var(--bg-hover)] text-[var(--text-primary)]";

/**
 * One vocabulary for "what kind of thing".
 *
 * The server keys its type index on exactly these values (`orgNodes.typeKey`),
 * so the filter and the create menu speak the same words.
 */
export const TYPE_FILTERS: ReadonlyArray<{ key: string; label: string }> =
  workTypeFilters.map((type) => ({ key: type.key, label: type.label }));

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
    <SearchField
      value={value}
      onChange={onChange}
      label={`Search ${scopeLabel}`}
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
      className={cn("w-[240px] max-w-full shrink", className)}
    />
  );
}

/** Shelf or List, at the top of the Library and in a class. Same things, same
    filters, different shape. */
export function SurfaceViewSwitch<View extends string>({
  view,
  onChange,
  views,
  compact = false,
}: {
  view: View;
  onChange: (next: View) => void;
  /** Icons only, named for screen readers and on hover. */
  compact?: boolean;
  views: ReadonlyArray<{
    key: View;
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
            aria-label={compact ? option.label : undefined}
            title={compact ? option.label : undefined}
            onClick={() => onChange(option.key)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-chip text-caption font-medium transition",
              compact ? "w-7 justify-center" : "px-2.5",
              active
                ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
            )}
          >
            <Icon className="size-3.5" />
            {compact ? null : <span className="surface-bar-label">{option.label}</span>}
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
        title={typeFilterLabel(filter)}
      >
        <SlidersHorizontal className="size-3.5" />
        <span className="surface-bar-label">{typeFilterLabel(filter)}</span>
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

const SORT_LABELS: Record<"manual" | SortKey, string> = {
  manual: "Arrangement",
  name: "Name",
  updated: "Recent activity",
  type: "Type",
};

/**
 * Row order.
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
        title={`Order: ${SORT_LABELS[sortKey]}`}
      >
        {settling ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ArrowDownUp className="size-3.5" />
        )}
        <span className="surface-bar-label">{SORT_LABELS[sortKey]}</span>
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
 * Make something. One menu, wherever creation happens. The place is decided by
 * where the button lives, never by a second dialog (CANON D43).
 */
export function SurfaceNewMenu({
  disabled,
  disabledTitle,
  importing,
  onNewFolder,
  onNewWorkspace,
  onNewWork,
  onImport,
  onSyncFolder,
  onSyncFiles,
  label = "New",
  align = "end",
}: {
  disabled?: boolean;
  /** Why the control is inactive — visible status text plus title / aria. */
  disabledTitle?: string;
  importing?: boolean;
  onNewFolder?: () => void;
  onNewWorkspace?: () => void;
  onNewWork: (key: BlueprintChoiceKey) => void;
  onImport?: () => void;
  /** Syncing a folder from this computer through Bridge, and what the row says. */
  onSyncFolder?: { label: string; run: () => void };
  onSyncFiles?: { label: string; run: () => void };
  label?: string;
  align?: "start" | "end";
}) {
  const folderTakesFocus = useRef(false);

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

  /* Disabled controls often skip native title; wrap so hover/focus still
     explain why New is inactive (e.g. quick views / Trash). */
  const triggerNode = (
    <span
      className={cn(controlClass, "cursor-pointer font-semibold text-[var(--text-primary)]")}
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
        <DropdownMenuTrigger disabled={disabled}>
          {triggerNode}
        </DropdownMenuTrigger>
      </span>
      <DropdownMenuContent
        align={align}
        onCloseAutoFocus={(event) => {
          // The new folder's name field owns focus, even if creation finishes
          // before the menu's closing animation does.
          if (folderTakesFocus.current) event.preventDefault();
          folderTakesFocus.current = false;
        }}
        className="w-[240px]"
        /* New lists every work type; the last rows sit over the live dock.
           dropdown (60) loses to composer-dock (120), so Whiteboard was a
           visible no-op click. Open this menu on the dock layer instead. */
        layer="composer-dock"
        collisionPadding={{ bottom: 16 }}
      >
        {onNewFolder ? (
          <DropdownMenuItem onSelect={() => {
            folderTakesFocus.current = true;
            onNewFolder();
          }}>
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
        {onSyncFolder ? (
          <DropdownMenuItem onSelect={onSyncFolder.run}>
            <Laptop className="size-3.5 text-[var(--text-tertiary)]" />
            {onSyncFolder.label}
          </DropdownMenuItem>
        ) : null}
        {onSyncFiles ? (
          <DropdownMenuItem onSelect={onSyncFiles.run}>
            <Laptop className="size-3.5 text-[var(--text-tertiary)]" />
            {onSyncFiles.label}
          </DropdownMenuItem>
        ) : null}
        {onNewFolder || onNewWorkspace || onImport || onSyncFolder || onSyncFiles ? (
          <DropdownMenuSeparator />
        ) : null}
        {onNewFolder || onNewWorkspace || onImport || onSyncFolder || onSyncFiles ? (
          <DropdownMenuLabel>New artifact here</DropdownMenuLabel>
        ) : null}
        {blueprintChoices.map((choice) => (
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


/**
 * Picking several things at once, beside New: what is picked can be asked
 * about together or laid side by side, so the way in stays in sight.
 */
export function SurfaceSelectToggle({ selecting, onToggle }: { selecting: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-library-select
      aria-pressed={selecting}
      title={selecting ? "Stop picking" : "Pick several artifacts to ask about or lay side by side"}
      aria-label={selecting ? "Done picking" : "Select"}
      onClick={onToggle}
      className={cn(controlClass, selecting && controlActiveClass)}
    >
      <CheckSquare className="size-3.5" />
      <span className="surface-bar-label">{selecting ? "Done" : "Select"}</span>
    </button>
  );
}

/**
 * Everything the bar does that is not finding, making or picking something:
 * how the shelf is shown, what it holds, its order. One menu, so the bar
 * stays the place you are, a search, and New (LIBRARY.md, "Views").
 */
export function SurfaceMoreMenu({
  view,
  onViewChange,
  filter,
  onFilterChange,
  sortKey,
  direction,
  onSortKeyChange,
  onDirectionChange,
  onEmptyTrash,
}: {
  view?: "shelf" | "list";
  onViewChange?: (next: "shelf" | "list") => void;
  filter: TypeFilter;
  onFilterChange: (next: TypeFilter) => void;
  sortKey: "manual" | SortKey;
  direction: SortDirection;
  onSortKeyChange: (next: "manual" | SortKey) => void;
  onDirectionChange: (next: SortDirection) => void;
  onEmptyTrash?: () => void;
}) {
  const narrowed = filter !== "all" || sortKey !== "manual";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(controlClass, "w-8 justify-center px-0", narrowed && controlActiveClass)}
        aria-label="View options"
        title="View options"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[230px]">
        {view && onViewChange ? (
          <>
            <DropdownMenuRadioGroup value={view} onValueChange={(next) => onViewChange(next as "shelf" | "list")}>
              <DropdownMenuRadioItem value="shelf">Shelf</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="list">List</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SlidersHorizontal className="size-3.5 text-[var(--text-tertiary)]" />
            Show
            <span className="ml-auto pr-1 text-micro text-[var(--text-tertiary)]">{typeFilterLabel(filter)}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-[200px]">
            <DropdownMenuRadioGroup value={filter} onValueChange={(next) => onFilterChange(next as TypeFilter)}>
              <DropdownMenuRadioItem value="all">All types</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {TYPE_FILTERS.map((type) => (
                <DropdownMenuRadioItem key={type.key} value={type.key}>
                  {type.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ArrowDownUp className="size-3.5 text-[var(--text-tertiary)]" />
            Order
            <span className="ml-auto pr-1 text-micro text-[var(--text-tertiary)]">{SORT_LABELS[sortKey]}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-[210px]">
            <DropdownMenuRadioGroup value={sortKey} onValueChange={(next) => onSortKeyChange(next as "manual" | SortKey)}>
              <DropdownMenuRadioItem value="manual">Your arrangement</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="updated">Recent activity</DropdownMenuRadioItem>
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
                  {direction === "asc" ? "Ascending" : "Descending"}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {onEmptyTrash ? <DropdownMenuSeparator /> : null}
        {onEmptyTrash ? (
          <DropdownMenuItem onSelect={onEmptyTrash} className="text-[var(--danger)]">
            <X className="size-3.5" />
            Empty Trash
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
