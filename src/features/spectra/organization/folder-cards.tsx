"use client";

import { forwardRef, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import { presentWork } from "../artifacts/presentation";
import { PickMark, pickable, workType, type WorkPicking } from "./library-note";
import { relativeTime } from "./node-identity";
import { isPlaceNode, useTreeChildren, type TreeNode } from "./tree-client";

/*
 * Folders on a shelf (LIBRARY.md, "The shelf"): each one a kraft folder, wider
 * than a work's card, with its name on the front. What it holds peeks over its
 * edge: its newest artifacts, named. Resting on a folder lists its contents
 * beside it, a list the pointer can move onto to open any of them. A press
 * goes into the folder; work can be dropped on it to file it there. Stacks
 * wear the same folder.
 */

const PEEK_DELAY = 380;
const PEEK_SHOWN = 6;
const PEEK_WIDTH = 288;
const GAP = 10;
/** Long enough to cross the gap from the folder onto its list. */
const LEAVE_DELAY = 300;

type Gather = (event: React.PointerEvent<HTMLElement>, nodeId: string, fromStack: boolean, placesOnly?: boolean) => void;

export function FolderCards({
  folders,
  now,
  onOpen,
  onMenu,
  picking,
  onGather,
}: {
  folders: readonly TreeNode[];
  now: number;
  onOpen: (node: TreeNode) => void;
  onMenu: (event: React.MouseEvent, node: TreeNode) => void;
  picking?: WorkPicking;
  /** Picks a folder up to drop it in another folder or workspace. */
  onGather?: Gather;
}) {
  if (!folders.length) return null;
  return (
    <ul className="library-notes library-folders" aria-label="Folders">
      {folders.map((node) => (
        <FolderCard
          key={node.nodeId}
          node={node}
          now={now}
          onOpen={onOpen}
          onMenu={onMenu}
          picking={picking}
          onGather={onGather}
        />
      ))}
    </ul>
  );
}

function FolderCard({
  node,
  now,
  onOpen,
  onMenu,
  picking,
  onGather,
}: {
  node: TreeNode;
  now: number;
  onOpen: (node: TreeNode) => void;
  onMenu: (event: React.MouseEvent, node: TreeNode) => void;
  picking?: WorkPicking;
  onGather?: Gather;
}) {
  const card = useRef<HTMLButtonElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  const pick = picking && pickable(node) ? picking : null;
  const count = node.childCount ?? 0;
  // A reference shows, and files into, the folder it stands for.
  const folderId = node.kind === "link" ? (node.target?.available ? node.target.nodeId : null) : node.nodeId;
  const seen = useSeen(card, Boolean(folderId));
  const contents = useTreeChildren(folderId, {
    enabled: seen && Boolean(folderId),
    pageSize: PEEK_SHOWN,
    sortKey: "updated",
    direction: "desc",
    withoutThreads: true,
  });
  const inside = contents.nodes.slice(0, PEEK_SHOWN);
  const held = Math.max(count, inside.length);
  const sheets = inside.slice(0, 2);
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    // Its own list keeps it open; anywhere else, a scroll or Escape closes it.
    const outside = (event: Event) => !peekRef.current?.contains(event.target as Node);
    const close = (event: Event) => {
      if (outside(event)) setOpen(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(null);
      if (peekRef.current?.contains(document.activeElement)) card.current?.focus();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const stay = () => window.clearTimeout(timer.current);
  const rest = (event: React.PointerEvent) => {
    if (!held || event.pointerType !== "mouse" || event.buttons) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const box = card.current?.getBoundingClientRect();
      if (!box) return;
      const right = box.right + GAP + PEEK_WIDTH <= window.innerWidth - GAP;
      setOpen({
        left: right ? box.right + GAP : Math.max(GAP, box.left - GAP - PEEK_WIDTH),
        top: Math.max(GAP, Math.min(box.top, window.innerHeight - 340)),
      });
    }, PEEK_DELAY);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      // Keyboard focus inside the list keeps it open until it leaves.
      if (!peekRef.current?.contains(document.activeElement)) setOpen(null);
    }, LEAVE_DELAY);
  };
  const go = (target: TreeNode) => {
    window.clearTimeout(timer.current);
    setOpen(null);
    onOpen(target);
  };

  return (
    <li
      className="folder-card-slot"
      data-shelf-drag={onGather ? node.nodeId : undefined}
      onPointerDown={onGather ? (event) => onGather(event, node.nodeId, false, true) : undefined}
      onPointerEnter={rest}
      onPointerLeave={leave}
    >
      <button
        ref={card}
        type="button"
        data-node-row={node.nodeId}
        data-drop-node={node.nodeId}
        data-drop-kind="container"
        data-shelf-place={folderId ?? undefined}
        data-shelf-name={node.name}
        data-life-launch
        data-picked={pick?.has(node) || undefined}
        data-peek
        aria-pressed={pick ? pick.has(node) : undefined}
        aria-label={`${node.name}, folder${held ? ` of ${held}` : ""}`}
        onClick={() => (pick ? pick.toggle(node) : onOpen(node))}
        onContextMenu={(event) => onMenu(event, node)}
        className="folder-card"
      >
        <span aria-hidden className="folder-card-tab">
          <Icon name="folder" size={12} />
          Folder
        </span>
        <span aria-hidden className="folder-card-sheets">
          {sheets.length
            ? sheets.map((child) => <Sheet key={child.nodeId} node={child} />)
            : [count > 0 ? <span key="a" /> : null, count > 1 ? <span key="b" /> : null]}
        </span>
        <span className="folder-card-front">
          <span className="folder-card-name">{node.name}</span>
          <span className="folder-card-meta">
            {held ? `${held} ${held === 1 ? "item" : "items"}` : "Empty"}
            <span aria-hidden> · </span>
            {relativeTime(node.activityAt, now)}
          </span>
        </span>
        {pick ? <PickMark /> : null}
      </button>
      {open && !pick && typeof document !== "undefined"
        ? createPortal(
            <FolderPeek
              ref={peekRef}
              onPointerEnter={stay}
              onPointerLeave={leave}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) leave();
              }}
              onOpen={go}
              folder={node}
              left={open.left}
              top={open.top}
              name={node.name}
              nodes={inside}
              more={Math.max(0, held - inside.length)}
              now={now}
              loading={contents.isLoading}
            />,
            document.body,
          )
        : null}
    </li>
  );
}

/** One of the folder's artifacts, peeking over its edge: its kind's colour and its name. */
function Sheet({ node }: { node: TreeNode }) {
  const type = workType(node);
  const meta = presentWork(type, node.name);
  const place = isPlaceNode(node);
  return (
    <span className="folder-card-sheet" style={{ "--sheet-hue": place ? "var(--folder-kraft)" : meta.color } as CSSProperties}>
      <Icon name={place ? "folder" : meta.glyph} size={11} />
      <span>{node.name}</span>
    </span>
  );
}

/**
 * What a folder holds, beside it while the pointer rests there. The pointer
 * can cross onto it: each artifact opens from here, and the folder's name
 * goes into the folder, for the rest of what it holds.
 */
const FolderPeek = forwardRef<
  HTMLDivElement,
  {
    left: number;
    top: number;
    folder: TreeNode;
    name: string;
    nodes: readonly TreeNode[];
    more: number;
    now: number;
    loading: boolean;
    onOpen: (node: TreeNode) => void;
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onBlur: (event: React.FocusEvent<HTMLDivElement>) => void;
  }
>(function FolderPeek({ left, top, folder, name, nodes, more, now, loading, onOpen, onPointerEnter, onPointerLeave, onBlur }, ref) {
  return (
    <div
      ref={ref}
      role="group"
      aria-label={`In ${name}`}
      className="folder-peek"
      style={{ left, top, width: PEEK_WIDTH }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      // Rendered elsewhere but still the folder's child to React: a press here
      // must not pick the folder up to drag it.
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={onBlur}
    >
      <button type="button" className="folder-peek-title" onClick={() => onOpen(folder)}>
        <span className="min-w-0 truncate">In {name}</span>
        <Icon name="chevronRight" size={12} />
      </button>
      {loading && !nodes.length ? <p className="folder-peek-more">Looking inside…</p> : null}
      <ul>
        {nodes.map((child) => {
          const place = isPlaceNode(child);
          const meta = presentWork(workType(child), child.name);
          return (
            <li key={child.nodeId} style={{ "--sheet-hue": place ? "var(--folder-kraft)" : meta.color } as CSSProperties}>
              <button type="button" className="folder-peek-item" onClick={() => onOpen(child)}>
                <Icon name={place ? "folder" : meta.glyph} size={14} />
                <span className="folder-peek-name">{child.name}</span>
                <span className="folder-peek-when">{relativeTime(child.activityAt, now)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {more ? (
        <button type="button" className="folder-peek-more" onClick={() => onOpen(folder)}>
          and {more} more
        </button>
      ) : null}
    </div>
  );
});

/** True once the element has come near the screen, so folders far down cost nothing. */
function useSeen(ref: React.RefObject<HTMLElement | null>, wanted: boolean) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!wanted || seen) return;
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    }, { rootMargin: "200px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, wanted, seen]);
  return seen;
}
