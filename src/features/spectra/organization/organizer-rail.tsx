"use client";

import { useEffect } from "react";
import { ChevronRight, Home, Star, Trash2, Users, Clock } from "@/components/icons/glyph-icons";
import { cn } from "@/lib/utils";
import { useTreeContainers, type QuickViewKey, type TreeNode } from "./tree-client";
import { nodeIdentity } from "./node-identity";

/**
 * The navigation rail: containers only, one subscription per open branch, so an
 * unopened folder costs nothing and an open one stays live.
 *
 * Recent, Favorites and Shared sit with the top rather than among the
 * places, because they are ways of looking across the same tree, not a
 * second place where things live.
 */

export type OrganizerLocation =
  | { kind: "folder"; nodeId: string | null }
  | { kind: "quick"; view: QuickViewKey }
  | { kind: "trash" };

export type RailHandlers = {
  /** `trail` is the way down to a folder from the top, the folder last. */
  onNavigate: (location: OrganizerLocation, trail?: readonly TreeNode[]) => void;
  onToggle: (nodeId: string) => void;
  onBeginDrag: (event: React.PointerEvent, node: TreeNode) => void;
  onContextMenu: (event: React.MouseEvent, node: TreeNode) => void;
  onNodesSeen: (nodes: readonly TreeNode[]) => void;
};

const QUICK_VIEWS: Array<{
  view: QuickViewKey;
  label: string;
  icon: typeof Clock;
}> = [
  { view: "recent", label: "Recent", icon: Clock },
  { view: "favorites", label: "Favorites", icon: Star },
  { view: "shared", label: "Shared", icon: Users },
];

export function OrganizerRail({
  location,
  expanded,
  dropNodeId,
  floorId = null,
  floorLabel = "Home",
  handlers,
  className,
}: {
  location: OrganizerLocation;
  expanded: ReadonlySet<string>;
  /** The rail branch a drag is currently hovering, or "root". */
  dropNodeId: string | null | undefined;
  /** The subtree this rail is confined to; null is the account root. */
  floorId?: string | null;
  floorLabel?: string;
  handlers: RailHandlers;
  className?: string;
}) {
  const atFloor = location.kind === "folder" && location.nodeId === floorId;
  const row = (active: boolean) =>
    cn(
      "flex h-9 w-full shrink-0 items-center gap-2.5 rounded-chip px-2 text-left text-body transition-colors",
      active
        ? "bg-[var(--bg-hover)] font-medium text-[var(--text-primary)]"
        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
    );
  return (
    <nav
      aria-label="Quick access"
      className={cn(
        "flex w-[248px] shrink-0 flex-col overflow-hidden px-2 py-3",
        className,
      )}
    >
      {/* The way File Explorer opens: the top, the ways of looking across
          everything, then every place, with the Trash at the foot. */}
      <button
        type="button"
        data-drop-node={floorId ?? "root"}
        data-drop-kind="container"
        data-life-receive
        onClick={() => handlers.onNavigate({ kind: "folder", nodeId: floorId })}
        className={cn(row(atFloor), dropNodeId === (floorId ?? "root") && "ring-2 ring-brand")}
      >
        <Home className="size-4 shrink-0" strokeWidth={1.9} />
        <span className="min-w-0 truncate">{floorLabel}</span>
      </button>
      {QUICK_VIEWS.map(({ view, label, icon: Icon }) => (
        <button
          key={view}
          type="button"
          onClick={() => handlers.onNavigate({ kind: "quick", view })}
          className={row(location.kind === "quick" && location.view === view)}
        >
          <Icon className="size-4 shrink-0" strokeWidth={1.9} />
          {label}
        </button>
      ))}

      <div className="mt-4 shrink-0 px-2 pb-1 text-caption font-medium text-[var(--text-tertiary)]">
        Places
      </div>
      {/* A long tree scrolls inside its own region instead of pushing the Trash away. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <RailBranch
          parentId={floorId}
          depth={0}
          trail={[]}
          location={location}
          expanded={expanded}
          dropNodeId={dropNodeId}
          handlers={handlers}
        />
      </div>

      <button
        type="button"
        onClick={() => handlers.onNavigate({ kind: "trash" })}
        className={cn(row(location.kind === "trash"), "mt-2")}
      >
        <Trash2 className="size-4 shrink-0" strokeWidth={1.9} />
        Trash
      </button>
    </nav>
  );
}

function RailBranch({
  parentId,
  depth,
  trail,
  location,
  expanded,
  dropNodeId,
  handlers,
}: {
  parentId: string | null;
  depth: number;
  trail: readonly TreeNode[];
  location: OrganizerLocation;
  expanded: ReadonlySet<string>;
  dropNodeId: string | null | undefined;
  handlers: RailHandlers;
}) {
  /* This component only exists while its parent is open, so the subscription
     lives exactly as long as the branch the reader can see. */
  const { nodes, status, loadMore } = useTreeContainers(parentId, true);
  const seen = handlers.onNodesSeen;
  useEffect(() => {
    if (nodes) seen(nodes);
  }, [nodes, seen]);

  if (status === "LoadingFirstPage") return <RailSkeleton />;
  if (nodes.length === 0 && status === "Exhausted")
    return depth === 0 ? null : (
      <p
        className="py-1 text-caption text-[var(--text-tertiary)]"
        style={{ paddingLeft: 10 + depth * 13 }}
      >
        No folders inside
      </p>
    );

  return (
    <div role="tree" aria-label={depth === 0 ? "Top level" : undefined}>
      {nodes.map((node) => {
        const open = expanded.has(node.nodeId);
        const selected =
          location.kind === "folder" && location.nodeId === node.nodeId;
        const identity = nodeIdentity(node, open);
        const Icon = identity.icon;
        const hasChildren = (node.childCount ?? 0) > 0;
        return (
          <div
            key={node.nodeId}
            role="treeitem"
            aria-expanded={open}
            aria-selected={selected}
          >
            <div
              data-drop-node={node.nodeId}
              data-drop-kind="container"
              data-life-receive
              onPointerDown={(event) => handlers.onBeginDrag(event, node)}
              onContextMenu={(event) => handlers.onContextMenu(event, node)}
              onClick={() =>
                handlers.onNavigate({ kind: "folder", nodeId: node.nodeId }, [...trail, node])
              }
              className={cn(
                "group flex h-9 cursor-default items-center gap-1.5 rounded-chip pr-1.5 text-body transition-colors",
                selected
                  ? "bg-[var(--bg-hover)] font-medium text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                dropNodeId === node.nodeId &&
                  "ring-2 ring-brand",
              )}
              style={{ paddingLeft: 2 + depth * 13 }}
            >
              <button
                type="button"
                aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
                tabIndex={-1}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  handlers.onToggle(node.nodeId);
                }}
                className={cn(
                  "grid size-4 shrink-0 place-items-center rounded-chip text-[var(--text-tertiary)]",
                  hasChildren
                    ? "hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                    : "invisible",
                )}
              >
                <ChevronRight
                  className={cn(
                    "size-3 transition-transform duration-[var(--motion-fast)] ease-standard",
                    open && "rotate-90",
                  )}
                />
              </button>
              <span
                aria-hidden
                className="flex size-[22px] shrink-0 items-center justify-center rounded-chip"
                style={{ backgroundColor: identity.soft }}
              >
                <Icon
                  className="size-[14px]"
                  style={{ color: identity.color }}
                  strokeWidth={1.9}
                />
              </span>
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              {node.kind === "workspace" && node.workspace?.status === "archived" ? (
                <span className="shrink-0 text-micro text-[var(--text-tertiary)]">
                  Archived
                </span>
              ) : null}
            </div>
            {open ? (
              <RailBranch
                parentId={node.nodeId}
                depth={depth + 1}
                trail={[...trail, node]}
                location={location}
                expanded={expanded}
                dropNodeId={dropNodeId}
                handlers={handlers}
              />
            ) : null}
          </div>
        );
      })}
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <button
          type="button"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(50)}
          className="mx-2 my-1 rounded-control px-2 py-1 text-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] disabled:opacity-50"
        >
          {status === "LoadingMore" ? "Loading folders…" : "Load more folders"}
        </button>
      ) : null}
    </div>
  );
}

function RailSkeleton() {
  return (
    <div data-life-ghost className="flex flex-col gap-1 py-1" aria-hidden>
      {[0, 1, 2, 3].map((row) => (
        <div data-life-ghost-bar
          key={row}
          className="h-6 animate-pulse rounded-chip bg-[var(--bg-tertiary)]"
          style={{ width: `${88 - row * 9}%` }}
        />
      ))}
    </div>
  );
}
