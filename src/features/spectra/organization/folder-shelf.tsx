"use client";

import type { WorkPicking } from "./library-note";
import { FolderCards } from "./folder-cards";
import { LibraryShelfSkeleton } from "./library-shelf";
import { groupByWhen } from "./shelf-model";
import { ShelfNotes, useShelfStacks } from "./shelf-stacks";
import { SharedWorkGroups, useSharedWorks } from "./shared-works";
import { isPlaceNode, useTreeChildren, type TreeNode } from "./tree-client";
import { useLoadOnApproach } from "./use-load-on-approach";

/*
 * A folder, or a workspace that is not a class, as a shelf (LIBRARY.md, "The
 * shelf"): the folders inside it first, as folders a press goes into, then
 * its work as cards, newest first, by when it was touched. The shelf keeps going as the reader
 * scrolls; nothing is folded behind a "show all".
 */
export function FolderShelf({
  folderId,
  workspaceId,
  name,
  now,
  onOpen,
  onMenu,
  onCreate,
  picking,
}: {
  folderId: string;
  /** When the place is a workspace: works others shared in it, or in workspaces linked into it, show too. */
  workspaceId?: string;
  name: string;
  now: number;
  onOpen: (node: TreeNode) => void;
  onMenu: (event: React.MouseEvent, node: TreeNode) => void;
  onCreate?: () => void;
  picking?: WorkPicking;
}) {
  const children = useTreeChildren(folderId, { sortKey: "updated", direction: "desc", pageSize: 24, withoutThreads: true });
  const mark = useLoadOnApproach(children.status, children.loadMore);
  const shared = useSharedWorks(workspaceId);
  const sharedCount = shared.reduce((sum, group) => sum + group.works.length, 0);
  const places = children.nodes.filter(isPlaceNode);
  const work = children.nodes.filter((node) => !isPlaceNode(node));
  const items = useShelfStacks(work);
  if (children.isLoading) return <LibraryShelfSkeleton />;
  const groups = groupByWhen(items, (item) => item.node.activityAt, now);

  return (
    <div className="library-shelf">
      <div className="min-w-0">
        {places.length ? (
          <section aria-labelledby="shelf-folders">
            <h2 id="shelf-folders" className="library-shelf-heading">
              Folders <span className="school-heading-count">{places.length}</span>
            </h2>
            <FolderCards folders={places} now={now} onOpen={onOpen} onMenu={onMenu} picking={picking} />
          </section>
        ) : null}
        {groups.map((group) => (
          <section key={group.key} aria-label={group.label}>
            <h2 className="library-shelf-heading">{group.label}</h2>
            <ShelfNotes items={group.items} now={now} onOpen={onOpen} onMenu={onMenu} picking={picking} whereOf={sharedMark} />
          </section>
        ))}
        <SharedWorkGroups groups={shared} place={name} workspaceId={workspaceId} now={now} onOpen={onOpen} picking={picking} />
        {work.length === 0 && children.status === "Exhausted" && !sharedCount ? (
          <div className="class-shelf-empty">
            <p>{places.length ? `No artifacts in ${name} itself yet; it is in the folders above.` : `Nothing in ${name} yet.`}</p>
            {onCreate ? (
              <button type="button" data-life-launch className="library-shelf-new" onClick={onCreate}>
                Start a document
              </button>
            ) : null}
          </div>
        ) : null}
        <div ref={mark} aria-hidden />
      </div>
    </div>
  );
}

/** Your own work its workspace's people can see says so; private work, the default, says nothing. */
const sharedMark = (node: TreeNode) => (node.sharedWithWorkspace ? "Shared" : undefined);
