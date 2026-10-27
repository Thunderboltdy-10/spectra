"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { api } from "../../../../convex/_generated/api";
import {
  classIdentity,
  type ClassIdentity,
} from "../../../../shared/class-identity";
import {
  inkStyle,
  useClassBook,
  type ClassBook,
} from "../school/use-class-book";
import { useAuthedArgs } from "../data/use-authed-args";
import { schoolTaskHref, useOpenSchoolTask } from "../school/open-school-task";
import { startOfDay } from "../school/school-model";
import { classWorkspaceIdentity, isClassWorkspace } from "./class-shelf";
import { DueTask } from "./due-task";
import { PlaceRow, type WorkPicking } from "./library-note";
import { relativeTime } from "./node-identity";
import { groupByWhen } from "./shelf-model";
import { ShelfNotes, useShelfStacks } from "./shelf-stacks";
import { useShelfGather } from "./shelf-gather";
import { treeFailureMessage, useTreeActions, useTreeQuickView, type TreeNode } from "./tree-client";
import { useLoadOnApproach } from "./use-load-on-approach";

/*
 * The top of the Library as a shelf rather than a list (LIBRARY.md, "The
 * shelf"): every workspace as a book on the shelf, classes and the student's
 * own alike (a class is a workspace marked as one), the next few tasks from
 * every class, the work touched lately as cards showing what they hold, and
 * what is in no workspace. The work keeps coming as the reader scrolls,
 * newest first, by when it was touched. A class keeps the colour School
 * gives it, so it is the same thing wherever it shows, and a note wears the
 * colour of the place it lives in. A card or a loose thing let go on a
 * workspace (or a loose folder) moves into it. The plain list is one press
 * away, in the view switch, for anyone who wants every row.
 */

/** How many workspaces show before the rest fold away: three rows of books. */
const WORKSPACES_SHOWN = 9;
/** How many loose things at the top show before the rest fold away. */
const LOOSE_SHOWN = 4;
/** How many tasks lead the shelf: the next few, not the term. */
const COMING_UP_SHOWN = 3;

type Place = { node: TreeNode; identity: ClassIdentity; subject: boolean };

/** Every workspace: subject classes first in School's order, then the rest as the student last used them. */
function places(nodes: readonly TreeNode[], book: ClassBook) {
  const subjects: Place[] = [];
  const others: Place[] = [];
  for (const node of nodes) {
    if (node.kind !== "workspace" || node.workspace?.status === "archived")
      continue;
    const isClass = isClassWorkspace(node);
    const identity = isClass
      ? classWorkspaceIdentity(node, book)
      : {
          ...classIdentity({ providerClassId: node.nodeId, title: node.name }),
          ink: node.workspace?.color ?? "var(--ink-violet)",
        };
    const subject = isClass && identity.subject;
    (subject ? subjects : others).push({ node, identity, subject });
  }
  others.sort((a, b) => (b.node.activityAt ?? 0) - (a.node.activityAt ?? 0));
  return [...subjects, ...others];
}

const bar = "block animate-pulse rounded-full bg-[var(--bg-tertiary)]";

/**
 * The shelf on its way, in the shelf's own grid: notes where the notes will
 * be and places down the side, so each ghost's lines flow into the card that
 * takes its place.
 */
export function LibraryShelfSkeleton() {
  return (
    <div className="library-shelf" role="status" aria-label="Opening the Library">
      <div className="min-w-0">
        <span data-life-ghost-bar className={cn(bar, "mb-[18px] h-4 w-20")} />
        <ul className="library-notes">
          {[78, 64, 70, 58].map((width, index) => (
            <li key={index} data-life-ghost className="library-note-ghost">
              <span data-life-ghost-bar className={cn(bar, "h-4")} style={{ width: `${width - 24}%` }} />
              <span data-life-ghost-bar className={cn(bar, "mt-3 h-2.5")} style={{ width: "94%" }} />
              <span data-life-ghost-bar className={cn(bar, "h-2.5")} style={{ width: `${width + 12}%` }} />
              <span data-life-ghost-bar className={cn(bar, "h-2.5")} style={{ width: `${width - 10}%` }} />
            </li>
          ))}
        </ul>
      </div>
      <aside className="library-shelf-side">
        <span data-life-ghost-bar className={cn(bar, "mb-[16px] h-3.5 w-28")} />
        <div data-life-ghost className="school-tiles school-tiles--narrow">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} data-life-ghost-bar className="block h-10 animate-pulse rounded-l-chip rounded-r-[var(--radius-lg)] bg-[var(--bg-secondary)]" />
          ))}
        </div>
      </aside>
    </div>
  );
}

export function LibraryShelf({
  nodes,
  loading = false,
  now,
  onOpen,
  onMenu,
  onNewWorkspace,
  picking,
}: {
  /** The top level of the Library, as the list would show it. */
  nodes: readonly TreeNode[];
  /** The top level is still on its way. */
  loading?: boolean;
  now: number;
  onOpen: (node: TreeNode) => void;
  onMenu: (event: React.MouseEvent, node: TreeNode) => void;
  onNewWorkspace?: () => void;
  picking?: WorkPicking;
}) {
  const book = useClassBook();
  // A task coming up opens as its planner work beside the shelf.
  const { onTaskClick } = useOpenSchoolTask();
  const recent = useTreeQuickView("recent", ["work"]);
  const mark = useLoadOnApproach(recent.status, recent.loadMore);
  const comingUp = useComingUp(now);
  const [allWorkspaces, setAllWorkspaces] = useState(false);
  const [allLoose, setAllLoose] = useState(false);
  const workspaces = places(nodes, book);
  const shownPlaces = allWorkspaces ? workspaces : workspaces.slice(0, WORKSPACES_SHOWN);
  const actions = useTreeActions();
  const moveInto = (nodeId: string, placeId: string) => {
    if (nodeId === placeId) return;
    const place = nodes.find((node) => node.nodeId === placeId);
    actions
      .move([nodeId], placeId)
      .then(() => toast.success(`Moved to ${place?.name ?? "the workspace"}.`))
      .catch((error) => toast.error(treeFailureMessage(error, "That move did not go through.")));
  };
  const beginDrag = useShelfGather(
    ({ nodeId, intoPlaceId }) => (intoPlaceId ? moveInto(nodeId, intoPlaceId) : undefined),
    !picking,
  );
  const loose = [
    ...nodes.filter((node) => node.kind === "folder"),
    ...nodes.filter(
      (node) => node.kind !== "folder" && node.kind !== "workspace",
    ),
  ];
  const shownLoose = allLoose ? loose : loose.slice(0, LOOSE_SHOWN);
  // ManageBac's tasks are touched by every sync, not by the student; they live on each class's page.
  const recentWork = recent.nodes.filter((node) => node.source?.blueprintKey !== "planner_task");
  const recentItems = useShelfStacks(recentWork);
  const recentGroups = groupByWhen(recentItems, (item) => item.node.activityAt, now);
  const inkOf = (node: TreeNode) => {
    const workspace = node.parentPath?.[0];
    if (!workspace) return null;
    return book.named(workspace) ?? workspaces.find((place) => place.node.name === workspace)?.identity ?? null;
  };

  const tile = ({ node, identity }: Place) => (
    <button
      key={node.nodeId}
      type="button"
      data-node-row={node.nodeId}
      data-shelf-place={node.nodeId}
      data-life-launch
      onClick={() => onOpen(node)}
      onContextMenu={(event) => onMenu(event, node)}
      title={identity.code ?? undefined}
      style={inkStyle(identity)}
      className="school-tile"
    >
      <span className="min-w-0 flex-1">
        <span className="school-tile-name">{node.name}</span>
      </span>
      <span className="school-tile-foot">
        <span>
          {node.childCount
            ? `${node.childCount} item${node.childCount === 1 ? "" : "s"}`
            : "Empty"}
        </span>
        <span className="ml-auto text-[var(--text-tertiary)]">
          {relativeTime(node.activityAt, now)}
        </span>
      </span>
    </button>
  );

  if (loading || recent.status === "LoadingFirstPage") return <LibraryShelfSkeleton />;

  return (
    <div className="library-shelf">
      <div className="min-w-0">
        {workspaces.length || onNewWorkspace ? (
          <section aria-labelledby="shelf-workspaces">
            <h2 id="shelf-workspaces" className="library-shelf-heading">
              Workspaces{" "}
              <span className="school-heading-count">{workspaces.length}</span>
            </h2>
            <div className="school-tiles">
              {shownPlaces.map((place) => tile(place))}
              {onNewWorkspace ? (
                <button
                  type="button"
                  data-life-launch
                  onClick={onNewWorkspace}
                  className="library-shelf-new library-shelf-new--book"
                >
                  New workspace
                </button>
              ) : null}
            </div>
            {workspaces.length > WORKSPACES_SHOWN ? (
              <button
                type="button"
                className="today-link mt-3 inline-block"
                aria-expanded={allWorkspaces}
                onClick={() => setAllWorkspaces((open) => !open)}
              >
                {allWorkspaces ? "Show fewer" : `Show all ${workspaces.length}`}
              </button>
            ) : null}
          </section>
        ) : null}

        {comingUp.length ? (
          <section aria-labelledby="shelf-coming-up">
            <h2 id="shelf-coming-up" className="library-shelf-heading">
              Coming up
            </h2>
            <ol className="class-due">
              {comingUp.map((task) => {
                const identity = book.of(task.providerClassId, task.className);
                return (
                <li key={task.recordId} style={inkStyle(identity)}>
                  <DueTask
                    task={task}
                    now={now}
                    place={identity?.name ?? task.className}
                    open={{ href: schoolTaskHref(task.recordId), onClick: onTaskClick(task.recordId) }}
                  />
                </li>
                );
              })}
            </ol>
            <Link href="/school" className="today-link mt-3 inline-block">
              Every task in School
            </Link>
          </section>
        ) : null}

      </div>

      {loose.length ? (
        <aside aria-label="Not in a workspace" className="library-shelf-side">
          <section aria-labelledby="shelf-loose">
            <h2 id="shelf-loose" className="library-shelf-heading">
              Not in a workspace
            </h2>
            <ul className="library-loose">
              {shownLoose.map((node) => (
                <li
                  key={node.nodeId}
                  data-shelf-drag={node.nodeId}
                  data-shelf-place={node.kind === "folder" ? node.nodeId : undefined}
                  onPointerDown={(event) => beginDrag(event, node.nodeId, false, true)}
                >
                  <PlaceRow node={node} onOpen={onOpen} onMenu={onMenu} picking={picking} />
                </li>
              ))}
            </ul>
            {loose.length > LOOSE_SHOWN ? (
              <button
                type="button"
                className="today-link mt-3 inline-block"
                aria-expanded={allLoose}
                onClick={() => setAllLoose((open) => !open)}
              >
                {allLoose ? "Show fewer" : `Show all ${loose.length}`}
              </button>
            ) : null}
          </section>
        </aside>
      ) : null}

      {/* The work touched lately runs the shelf's whole width, as many cards to a row as fit. */}
      <div className="library-shelf-wide">
        {recentGroups.map((group) => (
          <section key={group.key} aria-label={group.label}>
            <h2 className="library-shelf-heading">{group.label}</h2>
            <ShelfNotes
              items={group.items}
              now={now}
              placeOf={inkOf}
              whereOf={(node) => node.parentPath?.[node.parentPath.length - 1]}
              onOpen={onOpen}
              onMenu={onMenu}
              picking={picking}
              onMoveInto={moveInto}
            />
          </section>
        ))}
        <div ref={mark} aria-hidden />
      </div>
    </div>
  );
}

/**
 * The next few tasks from every class, from today on. Tasks already gone by
 * stay in their class and in School; the top of the Library looks ahead.
 */
function useComingUp(now: number) {
  const school = useQuery(api.school.tasks, useAuthedArgs({ view: "current" as const }));
  const today = startOfDay(now);
  return useMemo(
    () =>
      (school?.tasks ?? [])
        .filter((task) => task.dueAt !== null && task.dueAt >= today)
        .slice(0, COMING_UP_SHOWN),
    [school, today],
  );
}
