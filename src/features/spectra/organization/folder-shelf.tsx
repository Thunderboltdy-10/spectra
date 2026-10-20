"use client";

import { PlaceRow, type WorkPicking } from "./library-note";
import { LibraryShelfSkeleton } from "./library-shelf";
import { groupByWhen } from "./shelf-model";
import { ShelfNotes, useShelfStacks } from "./shelf-stacks";
import { useTreeChildren, type TreeNode } from "./tree-client";
import { useLoadOnApproach } from "./use-load-on-approach";

/*
 * A folder, or a workspace that is not a class, as a shelf (LIBRARY.md, "The
 * shelf"): its work as cards, newest first, by when it was touched, and the
 * places inside it down the side. The shelf keeps going as the reader
 * scrolls; nothing is folded behind a "show all".
 */
export function FolderShelf({
  folderId,
  name,
  now,
  onOpen,
  onMenu,
  onCreate,
  picking,
}: {
  folderId: string;
  name: string;
  now: number;
  onOpen: (node: TreeNode) => void;
  onMenu: (event: React.MouseEvent, node: TreeNode) => void;
  onCreate?: () => void;
  picking?: WorkPicking;
}) {
  const children = useTreeChildren(folderId, { sortKey: "updated", direction: "desc", pageSize: 24, withoutThreads: true });
  const mark = useLoadOnApproach(children.status, children.loadMore);
  const places = children.nodes.filter((node) => node.kind === "folder" || node.kind === "workspace");
  const work = children.nodes.filter((node) => node.kind !== "folder" && node.kind !== "workspace");
  const items = useShelfStacks(work);
  if (children.isLoading) return <LibraryShelfSkeleton />;
  const groups = groupByWhen(items, (item) => item.node.activityAt, now);

  return (
    <div className="library-shelf">
      <div className="min-w-0">
        {groups.map((group) => (
          <section key={group.key} aria-label={group.label}>
            <h2 className="library-shelf-heading">{group.label}</h2>
            <ShelfNotes items={group.items} now={now} onOpen={onOpen} onMenu={onMenu} picking={picking} />
          </section>
        ))}
        {work.length === 0 && children.status === "Exhausted" ? (
          <div className="class-shelf-empty">
            <p>{places.length ? `No work in ${name} itself yet; it is in the folders beside.` : `Nothing in ${name} yet.`}</p>
            {onCreate ? (
              <button type="button" data-life-launch className="library-shelf-new" onClick={onCreate}>
                Start a document
              </button>
            ) : null}
          </div>
        ) : null}
        <div ref={mark} aria-hidden />
      </div>

      {places.length ? (
        <aside aria-label="Folders" className="library-shelf-side">
          <section>
            <h2 className="library-shelf-heading">
              Folders <span className="school-heading-count">{places.length}</span>
            </h2>
            <ul className="library-loose">
              {places.map((node) => (
                <li key={node.nodeId}>
                  <PlaceRow node={node} onOpen={onOpen} onMenu={onMenu} picking={picking} />
                </li>
              ))}
            </ul>
          </section>
        </aside>
      ) : null}
    </div>
  );
}
