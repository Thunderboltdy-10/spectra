import type { TreeNode } from "./tree-client";
import { compareOrderKeys } from "./order-key";

/**
 * The organizer's interaction rules, kept out of the component so they can be
 * reasoned about and tested: what a click extends, what an arrow key lands on,
 * what a drop is allowed to do. A file manager whose selection logic lives
 * inside render callbacks is a file manager that loses your selection.
 */

export type SortKey = "name" | "updated" | "type";
export type SortDirection = "asc" | "desc";
/** `"all"`, or one `orgNodes.typeKey` — the one vocabulary every view shares. */
export type TypeFilter = "all" | string;

export type RowSelection = {
  /** Every selected node id, in no particular order. */
  ids: ReadonlySet<string>;
  /** The row a shift-range extends from, and where the keyboard cursor sits. */
  anchorId: string | null;
  cursorId: string | null;
};

export const EMPTY_SELECTION: RowSelection = {
  ids: new Set(),
  anchorId: null,
  cursorId: null,
};

export type ClickIntent = "replace" | "toggle" | "range";

export function clickIntent(event: {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): ClickIntent {
  if (event.shiftKey) return "range";
  if (event.metaKey || event.ctrlKey) return "toggle";
  return "replace";
}

export function opensOnPlainClick(event: {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}, selectionMode: boolean) {
  return !selectionMode && !event.shiftKey && !event.metaKey && !event.ctrlKey;
}

/** Apply a click to a selection, given the rows currently on screen. */
export function selectRow(
  selection: RowSelection,
  rows: readonly TreeNode[],
  nodeId: string,
  intent: ClickIntent,
): RowSelection {
  if (intent === "toggle") {
    const ids = new Set(selection.ids);
    if (ids.has(nodeId)) ids.delete(nodeId);
    else ids.add(nodeId);
    return {
      ids,
      /* Toggling makes the touched row the new anchor, so a following
         shift-click extends from where the reader last acted. */
      anchorId: nodeId,
      cursorId: nodeId,
    };
  }
  if (intent === "range" && selection.anchorId) {
    const from = rows.findIndex((row) => row.nodeId === selection.anchorId);
    const to = rows.findIndex((row) => row.nodeId === nodeId);
    if (from !== -1 && to !== -1) {
      const [low, high] = from <= to ? [from, to] : [to, from];
      const ids = new Set<string>();
      for (let index = low; index <= high; index += 1)
        ids.add(rows[index]!.nodeId);
      return { ids, anchorId: selection.anchorId, cursorId: nodeId };
    }
  }
  return { ids: new Set([nodeId]), anchorId: nodeId, cursorId: nodeId };
}

export function selectAll(rows: readonly TreeNode[]): RowSelection {
  return {
    ids: new Set(rows.map((row) => row.nodeId)),
    anchorId: rows[0]?.nodeId ?? null,
    cursorId: rows[rows.length - 1]?.nodeId ?? null,
  };
}

/** Work/thread source ids in a row selection — what Group as tiles consumes. */
export function selectedWorkSourceIds(
  selection: RowSelection,
  rows: readonly TreeNode[],
): string[] {
  return rows.flatMap((row) =>
    selection.ids.has(row.nodeId) &&
    row.sourceId &&
    (row.kind === "work" || row.kind === "thread")
      ? [row.sourceId]
      : [],
  );
}

/** Keep only ids that still exist, so a live delete cannot strand a selection. */
export function pruneSelection(
  selection: RowSelection,
  rows: readonly TreeNode[],
): RowSelection {
  const present = new Set(rows.map((row) => row.nodeId));
  const ids = new Set([...selection.ids].filter((id) => present.has(id)));
  if (ids.size === selection.ids.size) return selection;
  return {
    ids,
    anchorId:
      selection.anchorId && present.has(selection.anchorId)
        ? selection.anchorId
        : null,
    cursorId:
      selection.cursorId && present.has(selection.cursorId)
        ? selection.cursorId
        : null,
  };
}

export type KeyAction =
  | { type: "move"; nodeId: string; extend: boolean }
  | { type: "open"; nodeId: string }
  | { type: "enter"; nodeId: string }
  | { type: "leave" }
  | { type: "rename"; nodeId: string }
  | { type: "trash"; nodeIds: string[] }
  | { type: "selectAll" }
  | { type: "clear" }
  | null;

/**
 * One place that decides what a key means. `→` enters a container and `←` goes
 * back up, which is the only reading of those keys that stays true when the row
 * surface shows a single level.
 */
export function resolveKey(
  key: string,
  modifiers: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  rows: readonly TreeNode[],
  selection: RowSelection,
): KeyAction {
  const cursorIndex = selection.cursorId
    ? rows.findIndex((row) => row.nodeId === selection.cursorId)
    : -1;
  const at = (index: number) => rows[Math.max(0, Math.min(rows.length - 1, index))];
  const cursor = cursorIndex === -1 ? undefined : rows[cursorIndex];

  if (key === "ArrowDown") {
    const next = cursorIndex === -1 ? rows[0] : at(cursorIndex + 1);
    return next ? { type: "move", nodeId: next.nodeId, extend: modifiers.shiftKey } : null;
  }
  if (key === "ArrowUp") {
    const next = cursorIndex === -1 ? rows[0] : at(cursorIndex - 1);
    return next ? { type: "move", nodeId: next.nodeId, extend: modifiers.shiftKey } : null;
  }
  if (key === "Home")
    return rows[0] ? { type: "move", nodeId: rows[0].nodeId, extend: modifiers.shiftKey } : null;
  if (key === "End") {
    const last = rows[rows.length - 1];
    return last ? { type: "move", nodeId: last.nodeId, extend: modifiers.shiftKey } : null;
  }
  if (key === "ArrowRight")
    return cursor?.isContainer ? { type: "enter", nodeId: cursor.nodeId } : null;
  if (key === "ArrowLeft") return { type: "leave" };
  /* Checked before plain Enter, or the rename shortcut would never be reached. */
  if (key === "F2" || (key === "Enter" && (modifiers.metaKey || modifiers.ctrlKey)))
    return cursor ? { type: "rename", nodeId: cursor.nodeId } : null;
  if (key === "Enter") {
    if (!cursor) return null;
    return cursor.isContainer
      ? { type: "enter", nodeId: cursor.nodeId }
      : { type: "open", nodeId: cursor.nodeId };
  }
  if (key === "Delete" || key === "Backspace") {
    const ids = selection.ids.size > 0 ? [...selection.ids] : cursor ? [cursor.nodeId] : [];
    return ids.length > 0 ? { type: "trash", nodeIds: ids } : null;
  }
  if (key === "a" && (modifiers.metaKey || modifiers.ctrlKey))
    return { type: "selectAll" };
  if (key === "Escape") return { type: "clear" };
  return null;
}

/* --------------------------------------------------------------- drop rules */

export type DropVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Whether a drag may land here, decided the same way the server decides it so a
 * refused drop never reaches the network. The server is still authoritative;
 * this exists so the cursor tells the truth while it hovers.
 */
export function canDrop(
  dragged: readonly TreeNode[],
  destination: TreeNode | null,
  ancestorIdsOf: (nodeId: string) => readonly string[],
): DropVerdict {
  if (dragged.length === 0) return { allowed: false, reason: "Nothing to move." };
  if (destination && !destination.isContainer)
    return {
      allowed: false,
      reason:
        destination.kind === "link"
          ? "A reference cannot contain items."
          : "Only folders and workspaces can contain items.",
    };
  if (destination?.trashedAt !== undefined && destination !== null)
    return { allowed: false, reason: "That destination is in the trash." };
  for (const node of dragged) {
    if (destination && node.nodeId === destination.nodeId)
      return { allowed: false, reason: "A folder cannot be moved inside itself." };
    if (destination && ancestorIdsOf(destination.nodeId).includes(node.nodeId))
      return { allowed: false, reason: "A folder cannot be moved inside itself." };
    if (node.parentId === (destination?.nodeId ?? null))
      return { allowed: false, reason: "Already here." };
  }
  return { allowed: true };
}

/* ------------------------------------------------------- ordering and filters */

const KIND_RANK: Record<TreeNode["kind"], number> = {
  workspace: 0,
  folder: 1,
  thread: 2,
  work: 3,
  link: 4,
};

export function sortRows(
  rows: readonly TreeNode[],
  key: SortKey,
  direction: SortDirection,
): TreeNode[] {
  const factor = direction === "asc" ? 1 : -1;
  const activity = (row: TreeNode) => row.source?.updatedAt ?? row.updatedAt;
  return [...rows].sort((a, b) => {
    /* Containers lead every ordering: a reader scanning for a folder should not
       have to read past forty documents to find it. */
    if (a.isContainer !== b.isContainer) return a.isContainer ? -1 : 1;
    if (key === "name")
      return factor * a.name.localeCompare(b.name, undefined, { numeric: true });
    if (key === "updated") return factor * (activity(a) - activity(b));
    if (KIND_RANK[a.kind] !== KIND_RANK[b.kind])
      return factor * (KIND_RANK[a.kind] - KIND_RANK[b.kind]);
    const typeA = a.source?.blueprintKey ?? "";
    const typeB = b.source?.blueprintKey ?? "";
    if (typeA !== typeB) return factor * typeA.localeCompare(typeB);
    return compareOrderKeys(a.orderKey, b.orderKey);
  });
}

/**
 * Type filtering, expressed over the tree rather than over a parallel index:
 * "folders" means containers, "work"/"threads" mean kinds, and anything else is
 * a blueprint key, so a new work type needs no change here.
 */
/**
 * Narrow rows to one kind of thing.
 *
 * The vocabulary is the server's `orgNodes.typeKey`, which is also what the board
 * keys its columns on — one filter, one set of words, understood identically by
 * every view (CANON D41). It used to add "All work", "Threads" and "Folders and
 * workspaces", three options the board could not honour, which is how the same
 * control came to mean two different things in two places.
 */
export function filterRows(rows: readonly TreeNode[], filter: TypeFilter) {
  if (filter === "all") return [...rows];
  return rows.filter((row) => typeKeyOf(row) === filter);
}

/**
 * A row's type, from the tree row alone. Prefers the server's cached value and
 * derives it the same way when an older row has none, so the client and the
 * board's indexes never disagree about what something is.
 */
export function typeKeyOf(row: TreeNode) {
  if (row.typeKey) return row.typeKey;
  if (row.kind === "link") return row.target?.kind ?? "link";
  if (row.kind !== "work") return row.kind;
  return row.source?.blueprintKey ?? "document";
}

/** A window over a uniform-height list: enough rows to fill the viewport. */
export function windowRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  total: number,
  overscan = 8,
) {
  if (total === 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visible = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(total, first + visible);
  return {
    start: first,
    end,
    padTop: first * rowHeight,
    padBottom: Math.max(0, (total - end) * rowHeight),
  };
}
