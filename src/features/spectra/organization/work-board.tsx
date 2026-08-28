"use client";

import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from "react";
import { FolderOpen, Layers, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ArtifactCard, workTypeMeta } from "../components/artifact-card";
import type { ArtifactCardView } from "../components/artifact-card";
import {
  useBoardColumnCards,
  useBoardColumns,
  type BoardCard,
  type BoardColumn,
  type BoardGroupBy,
  type TreeNode,
} from "./tree-client";
import { nodeIdentity, relativeTime } from "./node-identity";
import { SurfaceNewMenu, type BlueprintChoiceKey } from "./surface-chrome";

/**
 * The board: work in a scope, laid out in columns, deliberately ignoring the
 * folder hierarchy.
 *
 * That is the whole reason it exists beside the list. The list answers "where is
 * this filed"; the board answers "what have I got, of this kind, right now" — so
 * it groups by something other than place, and still tells each card where it
 * lives, because a reader who spots the wrong thing needs to know where to go
 * and fix it.
 *
 * Every column is its own windowed query and pages on its own scroll (CANON
 * D42). Nothing here fetches a collection, filters an array, or counts by
 * measuring one: the grouping *is* the query, and changing it changes which index
 * the server reads rather than how the browser re-partitions what it already
 * pulled down.
 *
 * A workspace boundary is a wall, not a filter (D32): inside a workspace, a
 * nested workspace is one card that opens it, never its contents poured in.
 */

/**
 * Column colour, when the column has no colour of its own.
 *
 * A board where every column is the same mint or the same gold is a board whose
 * columns are hard to tell apart at a glance, which is the one thing a board is
 * for. Workspaces bring their own colour and types bring the registry's, so this
 * ring covers the rest — bands, folders, loose work — and it is walked by
 * position so no two adjacent columns collide.
 */
const COLUMN_HUES = [
  "var(--accent-violet)",
  "var(--accent-mint)",
  "var(--accent-gold)",
  "var(--accent-cyan)",
  "var(--accent-coral)",
  "var(--success)",
  "var(--accent-orange)",
  "var(--brand-primary)",
] as const;

function columnColor(column: BoardColumn, index: number) {
  const identity = column.identity;
  if (identity.kind === "workspace")
    return identity.color ?? COLUMN_HUES[index % COLUMN_HUES.length]!;
  if (identity.kind === "type") {
    const meta = workTypeMeta[identity.typeKey as keyof typeof workTypeMeta];
    if (meta) return meta.color;
    if (identity.typeKey === "thread")
      return workTypeMeta.thread_reference.color;
    if (identity.typeKey === "workspace") return "var(--brand-primary)";
  }
  if (identity.kind === "loose") return "var(--text-tertiary)";
  return COLUMN_HUES[index % COLUMN_HUES.length]!;
}

/** A type column's header is the type's own name, from the work registry. */
function columnLabel(column: BoardColumn) {
  if (column.identity.kind !== "type") return column.label;
  const key = column.identity.typeKey;
  const meta = workTypeMeta[key as keyof typeof workTypeMeta];
  if (meta) return meta.label;
  if (key === "thread") return workTypeMeta.thread_reference.label;
  if (key === "workspace") return "Workspaces";
  return column.label;
}

function blueprintOf(node: TreeNode): ArtifactCardView["blueprintKey"] {
  const resolved = node.kind === "link" ? node.target?.kind : node.kind;
  if (resolved === "thread") return "thread_reference";
  const key = node.source?.blueprintKey;
  return key && key in workTypeMeta
    ? (key as ArtifactCardView["blueprintKey"])
    : "document";
}

/**
 * A card view built from the tree row alone. The board never joins back to the
 * work record: the row already carries the title, summary and activity, and a
 * board that fetched per card would flash a hundred wrong titles first.
 *
 * Every card says when it last changed. It says where it lives only when that is
 * news — never the column's own name, and never the "In workspace" line, which
 * is both a repetition and, for work filed at the top level, untrue.
 */
function cardViewOf(card: BoardCard, now: number, columnLabelText: string) {
  const where =
    card.parentName && card.parentName !== columnLabelText
      ? card.parentName
      : "";
  return {
    id: card.sourceId ?? card.nodeId,
    title: card.source?.title ?? card.name,
    blueprintKey: blueprintOf(card),
    summary: card.source?.summary ?? "",
    meta: where,
    footer: relativeTime(card.activityAt, now),
    placement: card.source?.shared ? "shared" : "workspace",
    shared: card.source?.shared,
    updatedAt: card.activityAt,
    pinned: card.pinned,
    aiState: card.source?.aiState as ArtifactCardView["aiState"],
  } satisfies ArtifactCardView;
}

/**
 * What the reader clicked when they clicked a place. A workspace becomes their
 * context; a folder is a location inside it. The board says which, because it
 * already knows — the shell must not have to hold a copy of the tree to find out
 * (CANON D42).
 */
export type ContainerTarget = { nodeId: string; workspaceId?: string };

export function WorkBoard({
  scopeNodeId,
  groupBy,
  typeFilter = "all",
  selectionMode = false,
  selectedObjectKeys,
  busy = false,
  onOpen,
  onOpenContainer,
  onToggleContext,
  onCreate,
  onContextMenu,
  onBeginDrag,
}: {
  /** The folder or workspace the board covers; null is the whole account. */
  scopeNodeId: string | null;
  groupBy: BoardGroupBy;
  /** One shared vocabulary with the List's filter and the server's `typeKey`. */
  typeFilter?: string;
  selectionMode?: boolean;
  selectedObjectKeys?: Set<string>;
  busy?: boolean;
  onOpen: (node: TreeNode) => void;
  onOpenContainer: (target: ContainerTarget) => void;
  onToggleContext?: (node: TreeNode) => void;
  /**
   * Make something in a column. The column has already decided everything it
   * can (D43), so this is handed both halves and asks the reader for neither.
   */
  onCreate?: (input: {
    blueprintKey: BlueprintChoiceKey;
    parentNodeId: string | null;
  }) => void;
  onContextMenu?: (event: MouseEvent, node: TreeNode) => void;
  onBeginDrag?: (event: PointerEvent, node: TreeNode) => void;
}) {
  const board = useBoardColumns(scopeNodeId, groupBy, typeFilter);
  const placementBoard = useBoardColumns(
    scopeNodeId,
    "folder",
    typeFilter,
    groupBy === "type",
  );

  /* One clock for the whole board, frozen at mount. A recency band whose
     boundary moved between two pages of one column would drop a card or show it
     twice, and neither is survivable in a surface people file work with. */
  const nowRef = useRef(Date.now());
  const now = nowRef.current;

  if (board.loading)
    return (
      <div className="flex min-h-[280px] items-center gap-2 px-1 py-10 text-[13px] text-[var(--text-tertiary)]">
        <Loader2 className="size-3.5 animate-spin" />
        Laying out the board
      </div>
    );

  if (board.columns.length === 0)
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-[var(--border-default)] text-center">
        <Layers className="size-5 text-[var(--text-tertiary)]" strokeWidth={1.6} />
        <p className="text-[13px] font-medium text-[var(--text-primary)]">
          Nothing to lay out yet
        </p>
        <p className="max-w-[320px] text-[12px] text-[var(--text-secondary)]">
          The board shows work from every folder in this scope. Make something
          and it appears here.
        </p>
      </div>
    );

  return (
    /* The row fills the frame and scrolls sideways; each column scrolls its own
       cards (D44). Nothing here can push the page past the edge of the screen,
       which is what a board of 241 cards in one column and none in the next
       would otherwise do. */
    <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden pb-1">
      <div
        className="grid h-full min-h-0 items-stretch gap-3.5"
        style={{
          gridTemplateColumns: `repeat(${board.columns.length}, clamp(268px, 25vw, 352px))`,
          width: "max-content",
        }}
      >
        {board.columns.map((column, index) => (
          <BoardColumnView
            key={column.key}
            column={column}
            color={columnColor(column, index)}
            label={columnLabel(column)}
            scopeNodeId={scopeNodeId}
            groupBy={groupBy}
            typeFilter={typeFilter}
            now={now}
            busy={busy}
            selectionMode={selectionMode}
            selectedObjectKeys={selectedObjectKeys}
            onOpen={onOpen}
            onOpenContainer={onOpenContainer}
            onToggleContext={onToggleContext}
            onCreate={onCreate}
            onContextMenu={onContextMenu}
            onBeginDrag={onBeginDrag}
            placementColumns={placementBoard.columns}
          />
        ))}
      </div>
    </div>
  );
}

function BoardColumnView({
  column,
  color,
  label,
  scopeNodeId,
  groupBy,
  typeFilter,
  now,
  busy,
  selectionMode,
  selectedObjectKeys,
  onOpen,
  onOpenContainer,
  onToggleContext,
  onCreate,
  onContextMenu,
  onBeginDrag,
  placementColumns,
}: {
  column: BoardColumn;
  color: string;
  label: string;
  scopeNodeId: string | null;
  groupBy: BoardGroupBy;
  typeFilter: string;
  now: number;
  busy: boolean;
  selectionMode: boolean;
  selectedObjectKeys?: Set<string>;
  onOpen: (node: TreeNode) => void;
  onOpenContainer: (target: ContainerTarget) => void;
  onToggleContext?: (node: TreeNode) => void;
  onCreate?: (input: {
    blueprintKey: BlueprintChoiceKey;
    parentNodeId: string | null;
  }) => void;
  onContextMenu?: (event: MouseEvent, node: TreeNode) => void;
  onBeginDrag?: (event: PointerEvent, node: TreeNode) => void;
  placementColumns: BoardColumn[];
}) {
  const page = useBoardColumnCards(
    scopeNodeId,
    groupBy,
    column.key,
    typeFilter,
    now,
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /* The next page arrives as the reader nears the end of this column, and only
     this column: a board of ten columns must not fetch ten pages because one of
     them was scrolled. */
  const maybeLoadMore = useCallback(() => {
    const element = scrollRef.current;
    if (!element || page.status !== "CanLoadMore") return;
    const remaining =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining < 320) page.loadMore(20);
  }, [page]);

  /* A column shorter than its own box never fires a scroll event, so it would
     stop at its first page and quietly claim that is all there is. */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || page.status !== "CanLoadMore") return;
    if (element.scrollHeight <= element.clientHeight + 8) page.loadMore(20);
  }, [page]);

  const cards = page.cards;
  const openNodeId = column.openNodeId;

  return (
    <section
      data-board-column={column.key}
      className="flex min-h-0 flex-col overflow-hidden rounded-[10px] border p-2.5"
      style={{
        borderColor: `color-mix(in oklab, ${color} 26%, var(--border-default))`,
        background: `color-mix(in oklab, ${color} 3.5%, var(--bg-primary))`,
      }}
    >
      <header className="mb-2 flex min-w-0 shrink-0 items-center gap-2 px-1">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ background: color }}
        />
        {openNodeId ? (
          <button
            type="button"
            onClick={() =>
              onOpenContainer({
                nodeId: openNodeId,
                workspaceId:
                  column.identity.kind === "workspace"
                    ? column.identity.workspaceId
                    : undefined,
              })
            }
            className="min-w-0 truncate text-left text-[13px] font-semibold capitalize text-[var(--text-primary)] hover:underline"
          >
            {label}
          </button>
        ) : (
          <h3 className="min-w-0 truncate text-[13px] font-semibold capitalize text-[var(--text-primary)]">
            {label}
          </h3>
        )}
        <span
          className="shrink-0 text-[12px] tabular-nums text-[var(--text-tertiary)]"
          title={`${column.count ?? cards.length} in total`}
        >
          {page.loading ? "" : (column.count ?? cards.length)}
        </span>
      </header>
      {column.sublabel ? (
        <p className="mb-2 shrink-0 truncate px-1 text-[11px] text-[var(--text-tertiary)]">
          {column.sublabel}
        </p>
      ) : null}

      {/* Rows sized to the card, not to the space. Both a flex column and a grid
          with `auto` rows collapse here: the box has a definite height and its
          contents overflow it, so there is no free space to grow a row past its
          min-content — and a card whose every line is clamped measures its
          padding alone, 30px, which shows a type and half a title. */}
      <div
        ref={scrollRef}
        onScroll={maybeLoadMore}
        className="grid min-h-0 min-w-0 flex-1 auto-rows-max content-start gap-2.5 overflow-y-auto pr-0.5"
      >
        {page.loading ? (
          <div className="grid gap-2.5">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="h-[74px] animate-pulse rounded-[8px] bg-[var(--bg-secondary)]"
                style={{ animationDelay: `${index * 70}ms` }}
              />
            ))}
          </div>
        ) : null}
        {!page.loading && cards.length === 0 ? (
          <p className="rounded-[8px] border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center text-[12px] text-[var(--text-tertiary)]">
            Empty
          </p>
        ) : null}
        {cards.map((card) =>
          card.kind === "workspace" || card.kind === "folder" ? (
            <PlaceCard
              key={card.nodeId}
              node={card}
              onOpen={() =>
                onOpenContainer({
                  nodeId: card.nodeId,
                  workspaceId: card.workspace?.workspaceId,
                })
              }
              onContextMenu={
                onContextMenu
                  ? (event) => onContextMenu(event, card)
                  : undefined
              }
              onBeginDrag={
                onBeginDrag ? (event) => onBeginDrag(event, card) : undefined
              }
            />
          ) : (
            <ArtifactCard
              key={card.nodeId}
              artifact={cardViewOf(card, now, label)}
              quiet
              className="spectra-card--board"
              onSelect={() => onOpen(card)}
              selectionMode={selectionMode}
              contextSelected={
                card.sourceId
                  ? (selectedObjectKeys?.has(
                      `${card.kind === "thread" ? "thread" : "artifact"}:${card.sourceId}`,
                    ) ?? false)
                  : false
              }
              onToggleContext={
                onToggleContext ? () => onToggleContext(card) : undefined
              }
              onContextMenu={
                onContextMenu
                  ? (event) => onContextMenu(event, card)
                  : undefined
              }
              onBeginDrag={
                onBeginDrag ? (event) => onBeginDrag(event, card) : undefined
              }
            />
          ),
        )}
        {page.status === "LoadingMore" ? (
          <p className="flex items-center justify-center gap-1.5 py-2 text-[11px] text-[var(--text-tertiary)]">
            <Loader2 className="size-3 animate-spin" />
            Loading more
          </p>
        ) : null}
      </div>

      {onCreate && column.identity.kind !== "band" ? (
        <ColumnCreate
          column={column}
          busy={busy}
          label={label}
          onCreate={onCreate}
          placementColumns={placementColumns}
        />
      ) : null}
    </section>
  );
}

/**
 * Make something in this column.
 *
 * The column already decided half the question, so this asks the other half and
 * nothing more (CANON D43): a column of quizzes fixes the type and offers the
 * places; a workspace or folder column fixes the place and offers the types. It
 * never asks for both, and it never asks again for what the reader answered by
 * clicking here rather than there.
 */
function ColumnCreate({
  column,
  busy,
  label,
  onCreate,
  placementColumns,
}: {
  column: BoardColumn;
  busy: boolean;
  label: string;
  onCreate: (input: {
    blueprintKey: BlueprintChoiceKey;
    parentNodeId: string | null;
  }) => void;
  placementColumns: BoardColumn[];
}) {
  const fixedType = column.fixes.typeKey;
  /* A type column has no place of its own, so new work goes where the surface
     is pointing — which is exactly what `parentNodeId: undefined` means to the
     server: file it in this scope, or in General at the root (D31). */
  const parentNodeId =
    column.fixes.parentNodeId === undefined
      ? null
      : column.fixes.parentNodeId;

  /* Threads and nested workspaces are not made from a board column: a thread
     begins as a conversation and a workspace is a place, not a piece of work. */
  if (fixedType === "thread" || fixedType === "workspace") return null;

  return (
    <div className="mt-2 shrink-0">
      <SurfaceNewMenu
        disabled={busy}
        align="start"
        fixedTypeKey={fixedType}
        placeLabel={fixedType ? undefined : label}
        label={fixedType ? `New ${label.toLowerCase()}` : "New here"}
        onNewWork={(blueprintKey) => onCreate({ blueprintKey, parentNodeId })}
        placeChoices={
          fixedType
            ? placementColumns.flatMap((place) =>
                place.fixes.parentNodeId === undefined
                  ? []
                  : [
                      {
                        key: place.key,
                        label: columnLabel(place),
                        onSelect: () =>
                          onCreate({
                            blueprintKey: fixedType as BlueprintChoiceKey,
                            parentNodeId: place.fixes.parentNodeId ?? null,
                          }),
                      },
                    ],
              )
            : undefined
        }
        trigger={
          fixedType ? undefined : (
            <button
              type="button"
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[7px] border border-dashed border-[var(--border-default)] text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <span aria-hidden className="text-[14px] leading-none">
                +
              </span>
              New here
            </button>
          )
        }
      />
    </div>
  );
}

/**
 * A nested workspace or folder on the board. It is a place, so it gets a card
 * that says how much is inside and opens it — not a work card pretending a
 * container is a document.
 */
function PlaceCard({
  node,
  onOpen,
  onContextMenu,
  onBeginDrag,
}: {
  node: TreeNode;
  onOpen: () => void;
  onContextMenu?: (event: MouseEvent) => void;
  onBeginDrag?: (event: PointerEvent) => void;
}) {
  const identity = nodeIdentity(node);
  const Icon = identity.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onContextMenu}
      onPointerDown={onBeginDrag}
      className="group flex w-full min-w-0 items-center gap-2.5 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2.5 text-left transition-colors hover:border-[var(--border-strong)]"
    >
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-[6px]"
        style={{ backgroundColor: identity.soft }}
      >
        <Icon className="size-4" style={{ color: identity.color }} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
          {node.workspace?.title ?? node.name}
        </span>
        <span className="block truncate text-[11px] text-[var(--text-tertiary)]">
          {identity.label} · {node.childCount ?? 0}{" "}
          {(node.childCount ?? 0) === 1 ? "item" : "items"} inside
        </span>
      </span>
      <FolderOpen
        className={cn(
          "size-3.5 shrink-0 text-[var(--text-tertiary)] transition-colors",
          "group-hover:text-[var(--text-primary)]",
        )}
        aria-hidden
      />
    </button>
  );
}
