"use client";

import { Icon } from "@/components/icons";
import { PickMark, pickable, type WorkPicking } from "./library-note";
import { relativeTime } from "./node-identity";
import type { TreeNode } from "./tree-client";

/*
 * Folders on a shelf (LIBRARY.md, "The shelf"): each one a kraft folder, wider
 * than a work's card, with its name on the front and a few sheets showing over
 * its edge. A press goes into the folder, still inside the workspace; work can
 * be dropped on it to file it there. Stacks wear the same folder.
 */
export function FolderCards({
  folders,
  now,
  onOpen,
  onMenu,
  picking,
}: {
  folders: readonly TreeNode[];
  now: number;
  onOpen: (node: TreeNode) => void;
  onMenu: (event: React.MouseEvent, node: TreeNode) => void;
  picking?: WorkPicking;
}) {
  if (!folders.length) return null;
  return (
    <ul className="library-notes library-folders" aria-label="Folders">
      {folders.map((node) => {
        const pick = picking && pickable(node) ? picking : null;
        const count = node.childCount ?? 0;
        return (
          <li key={node.nodeId}>
            <button
              type="button"
              data-node-row={node.nodeId}
              data-drop-node={node.nodeId}
              data-drop-kind="container"
              data-shelf-place={node.nodeId}
              data-life-launch
              data-picked={pick?.has(node) || undefined}
              aria-pressed={pick ? pick.has(node) : undefined}
              aria-label={`${node.name}, folder${count ? ` of ${count}` : ""}`}
              onClick={() => (pick ? pick.toggle(node) : onOpen(node))}
              onContextMenu={(event) => onMenu(event, node)}
              className="folder-card"
            >
              <span aria-hidden className="folder-card-tab">
                <Icon name="folder" size={12} />
                Folder
              </span>
              <span aria-hidden className="folder-card-sheets">
                {count > 0 ? <span /> : null}
                {count > 1 ? <span /> : null}
              </span>
              <span className="folder-card-front">
                <span className="folder-card-name">{node.name}</span>
                <span className="folder-card-meta">
                  {count ? `${count} ${count === 1 ? "item" : "items"}` : "Empty"}
                  <span aria-hidden> · </span>
                  {relativeTime(node.activityAt, now)}
                </span>
              </span>
              {pick ? <PickMark /> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
