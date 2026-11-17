"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import { presentWork } from "../artifacts/presentation";
import { useSpectraPreferences } from "../settings/preference-store";
import { PickMark, pickable, workType, type WorkPicking } from "./library-note";
import { relativeTime } from "./node-identity";
import { isPlaceNode, useTreeChildren, type TreeNode } from "./tree-client";

/*
 * Folders on a shelf (LIBRARY.md, "The shelf"): each one a kraft folder, wider
 * than a work's card, with its name on the front. What it holds peeks over its
 * edge: its newest artifacts, named, when the folder shows what's inside (the
 * default); plain sheets when it doesn't. Resting on a folder that shows what's
 * inside lists its contents beside it. A press goes into the folder; work can
 * be dropped on it to file it there. Stacks wear the same folder.
 */

const PEEK_DELAY = 380;
const PEEK_SHOWN = 6;
const PEEK_WIDTH = 288;
const GAP = 10;

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
  const { preferences, update } = useSpectraPreferences();
  const { folderLook, folderLookFlipped } = preferences.appearance;
  if (!folders.length) return null;
  const flip = (nodeId: string) =>
    update("appearance", {
      folderLookFlipped: folderLookFlipped.includes(nodeId)
        ? folderLookFlipped.filter((id) => id !== nodeId)
        : [...folderLookFlipped, nodeId].slice(-300),
    });
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
          peek={(folderLook === "peek") !== folderLookFlipped.includes(node.nodeId)}
          onFlip={() => flip(node.nodeId)}
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
  peek,
  onFlip,
}: {
  node: TreeNode;
  now: number;
  onOpen: (node: TreeNode) => void;
  onMenu: (event: React.MouseEvent, node: TreeNode) => void;
  picking?: WorkPicking;
  onGather?: Gather;
  peek: boolean;
  onFlip: () => void;
}) {
  const card = useRef<HTMLButtonElement>(null);
  const pick = picking && pickable(node) ? picking : null;
  const count = node.childCount ?? 0;
  // A reference shows, and files into, the folder it stands for.
  const folderId = node.kind === "link" ? (node.target?.available ? node.target.nodeId : null) : node.nodeId;
  const seen = useSeen(card, peek && Boolean(folderId));
  const contents = useTreeChildren(folderId, {
    enabled: peek && seen && Boolean(folderId),
    pageSize: PEEK_SHOWN,
    sortKey: "updated",
    direction: "desc",
    withoutThreads: true,
  });
  const inside = peek ? contents.nodes.slice(0, PEEK_SHOWN) : [];
  const held = Math.max(count, inside.length);
  const sheets = peek ? inside.slice(0, 2) : [];
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("pointerdown", close, true);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("pointerdown", close, true);
    };
  }, [open]);
  useEffect(() => {
    if (!peek) setOpen(null);
  }, [peek]);

  const rest = (event: React.PointerEvent) => {
    if (!peek || !held || event.pointerType !== "mouse" || event.buttons) return;
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
    timer.current = window.setTimeout(() => setOpen(null), 120);
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
        data-peek={peek || undefined}
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
      {pick ? null : (
        <button
          type="button"
          className="folder-card-look"
          aria-label={peek ? `Keep ${node.name} plain` : `Show what's inside ${node.name}`}
          title={peek ? "Keep this folder plain" : "Show what's inside this folder"}
          aria-pressed={peek}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onFlip}
        >
          <Icon name={peek ? "hidden" : "layers"} size={14} />
        </button>
      )}
      {open && typeof document !== "undefined"
        ? createPortal(
            <FolderPeek
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

/** What a folder holds, beside it while the pointer rests there. Never takes the pointer. */
function FolderPeek({
  left,
  top,
  name,
  nodes,
  more,
  now,
  loading,
}: {
  left: number;
  top: number;
  name: string;
  nodes: readonly TreeNode[];
  more: number;
  now: number;
  loading: boolean;
}) {
  return (
    <div aria-hidden className="folder-peek" style={{ left, top, width: PEEK_WIDTH }}>
      <p className="folder-peek-title">In {name}</p>
      {loading && !nodes.length ? <p className="folder-peek-more">Looking inside…</p> : null}
      <ul>
        {nodes.map((child) => {
          const place = isPlaceNode(child);
          const meta = presentWork(workType(child), child.name);
          return (
            <li key={child.nodeId} style={{ "--sheet-hue": place ? "var(--folder-kraft)" : meta.color } as CSSProperties}>
              <Icon name={place ? "folder" : meta.glyph} size={14} />
              <span className="folder-peek-name">{child.name}</span>
              <span className="folder-peek-when">{relativeTime(child.activityAt, now)}</span>
            </li>
          );
        })}
      </ul>
      {more ? <p className="folder-peek-more">and {more} more</p> : null}
    </div>
  );
}

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
