"use client";

import { FolderCards } from "./folder-cards";
import { useMemo, useState } from "react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { api } from "../../../../convex/_generated/api";
import { classIdentity, type ClassIdentity } from "../../../../shared/class-identity";
import { useAuthedArgs } from "../data/use-authed-args";
import { startOfDay, type SchoolTask } from "../school/school-model";
import { inkStyle, type ClassBook } from "../school/use-class-book";
import { DueTask, TaskLink, useTaskPicking, type TaskOpen } from "./due-task";
import type { WorkPicking } from "./library-note";
import { ShelfNotes, useShelfStacks } from "./shelf-stacks";
import { SharedWorkGroups, useSharedWorks } from "./shared-works";
import { useTreeChildren, type TreeNode } from "./tree-client";
import { ShelfSection, useShelfFold } from "./shelf-fold";

/*
 * A class's workspace as the class rather than a folder of rows (LIBRARY.md,
 * "A class"): the next few things to do, by their date, the work the student
 * made for the class, and the tasks already past, by month. The ManageBac
 * tasks are read from School, which knows their dates; pressing one opens the
 * planner work Spectra made for it. Each list shows a few and folds the rest,
 * so arriving at a class is a glance, not a term's worth of rows.
 */

/** How many tasks to do show before the rest fold away: the next few, not the term. */
const AHEAD_SHOWN = 3;
/** How many of the student's own works show before the rest fold away. */
const WORK_SHOWN = 4;
/** How many months of past tasks show, and how many tasks of each, before the rest fold away. */
const MONTHS_SHOWN = 2;
const MONTH_TASKS_SHOWN = 4;

type Month = { key: string; label: string; tasks: SchoolTask[] };

function split(tasks: readonly SchoolTask[], now: number) {
  // A current task stays ahead even once its day has gone: it is late, not done.
  const ahead = tasks.filter((task) => !task.past);
  const behind = tasks.filter((task) => task.past);
  ahead.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
  behind.sort((a, b) => (b.dueAt ?? 0) - (a.dueAt ?? 0));
  const months: Month[] = [];
  const thisYear = new Date(now).getFullYear();
  for (const task of behind) {
    const date = new Date(task.dueAt ?? 0);
    const key = task.dueAt === null ? "undated" : `${date.getFullYear()}-${date.getMonth()}`;
    let month = months.at(-1);
    if (month?.key !== key) {
      const label =
        task.dueAt === null
          ? "Without a date"
          : date.toLocaleDateString(undefined, { month: "long", ...(date.getFullYear() === thisYear ? {} : { year: "numeric" }) });
      month = { key, label, tasks: [] };
      months.push(month);
    }
    month.tasks.push(task);
  }
  return { ahead, months };
}

/** A class's tasks from School, split into what is still to do and what is past by month. */
export function useClassTasks(providerClassId: string | null, now: number) {
  const school = useQuery(api.school.tasks, useAuthedArgs(providerClassId ? { view: "all" as const, providerClassId } : "skip"));
  const split_ = useMemo(() => split(school?.tasks ?? [], now), [school, now]);
  return { loading: Boolean(providerClassId) && school === undefined, ...split_ };
}

/** The line under a class's name: its code, then what is to do and how much of it is late. */
export function classSentence(identity: ClassIdentity, name: string, ahead: readonly SchoolTask[], now: number) {
  const late = ahead.filter((task) => task.dueAt !== null && task.dueAt < startOfDay(now)).length;
  const todo = ahead.length
    ? `${ahead.length} to do${late ? `, ${late === ahead.length ? (late === 1 ? "and it is late" : "all of them late") : `${late} of them late`}` : ""}.`
    : "Nothing to do for now.";
  return `${identity.code && identity.code !== name ? `${identity.code}. ` : ""}${todo}`;
}

export function ClassShelf({
  folderId,
  workspaceId,
  name,
  identity,
  providerClassId,
  now,
  onOpen,
  onMenu,
  onCreate,
  picking,
}: {
  folderId: string;
  /** The class's workspace, whose linked workspaces (a teacher's) show their shared works here. */
  workspaceId?: string;
  name: string;
  identity: ClassIdentity;
  providerClassId: string | null;
  now: number;
  onOpen: (node: TreeNode) => void;
  onMenu: (event: React.MouseEvent, node: TreeNode) => void;
  onCreate?: () => void;
  picking?: WorkPicking;
}) {
  const [allAhead, setAllAhead] = useState(false);
  const [allWork, setAllWork] = useState(false);
  const [allMonths, setAllMonths] = useState(false);
  const { loading, ahead, months } = useClassTasks(providerClassId, now);
  const children = useTreeChildren(folderId, { sortKey: "updated", direction: "desc", pageSize: 100, withoutThreads: true });
  const shared = useSharedWorks(workspaceId);

  const folders = children.nodes.filter((node) => node.kind === "folder");
  const work = children.nodes.filter((node) => node.kind !== "folder" && node.source?.blueprintKey !== "planner_task");
  const allTasks = useMemo(() => ahead.concat(months.flatMap((month) => month.tasks)), [ahead, months]);
  // Tasks the student or Spectra added belong to the class too; those made for a ManageBac task show in To do.
  const ownTasks = useMemo(() => {
    const school = new Set(allTasks.map((task) => task.title.trim()));
    return children.nodes.filter((node) => node.source?.blueprintKey === "planner_task" && !school.has(node.name.trim()));
  }, [allTasks, children.nodes]);
  const ownTaskItems = useShelfStacks(ownTasks);
  const workItems = useShelfStacks(work);
  const shownWork = allWork ? workItems : workItems.slice(0, WORK_SHOWN);
  // Late tasks can be put out of sight, so To do shows what can still be done on time.
  const [hideLate, toggleHideLate] = useShelfFold("class:todo:hide-late");
  const today = startOfDay(now);
  const isLate = (task: SchoolTask) => task.dueAt !== null && task.dueAt < today;
  const late = ahead.filter(isLate).length;
  const todo = hideLate ? ahead.filter((task) => !isLate(task)) : ahead;
  const shownAhead = allAhead ? todo : todo.slice(0, AHEAD_SHOWN);
  // Each ManageBac task has a planner work Spectra made for it; a task opens as that work.
  const plannerOf = usePlannerWorks(children.nodes);
  const taskPicking = useTaskPicking(picking);
  const open = (task: SchoolTask): TaskOpen => {
    if (taskPicking) return taskPicking.open(task);
    const planner = plannerOf(task);
    return planner ? { onClick: () => onOpen(planner) } : { href: `/school?task=${encodeURIComponent(task.recordId)}` };
  };
  const shownMonths = allMonths ? months : months.slice(0, MONTHS_SHOWN);
  const pastCount = months.reduce((sum, month) => sum + month.tasks.length, 0);
  return (
    <div className="class-shelf" style={inkStyle(identity)}>
      <div className="class-shelf-columns">
        <div className="min-w-0">
          <ShelfSection
            foldKey="class:todo"
            id="class-due"
            level={3}
            title="To do"
            count={ahead.length}
            extra={
              late ? (
                <button type="button" className="shelf-chip" aria-pressed={hideLate} onClick={toggleHideLate}>
                  {hideLate ? `Show ${late} late` : "Hide late"}
                </button>
              ) : null
            }
          >
            {loading ? (
              <div aria-hidden className="class-due-ghost" />
            ) : !todo.length ? (
              <p className="class-shelf-quiet">
                {ahead.length
                  ? `Only late tasks here, ${late} of them, hidden for now.`
                  : providerClassId
                    ? "Nothing to do for this class. New tasks from ManageBac show here with their dates."
                    : "No tasks from School for this class yet."}
              </p>
            ) : (
              <ol className="class-due">
                {shownAhead.map((task) => (
                  <li key={task.recordId}>
                    <DueTask task={task} now={now} open={open(task)} picked={taskPicking?.picked(task)} />
                  </li>
                ))}
              </ol>
            )}
            {!loading && todo.length > AHEAD_SHOWN ? (
              <button type="button" className="today-link mt-3 inline-block" aria-expanded={allAhead} onClick={() => setAllAhead((more) => !more)}>
                {allAhead ? "Show fewer" : `Show all ${todo.length}`}
              </button>
            ) : null}
          </ShelfSection>

          {ownTaskItems.length ? (
            <ShelfSection foldKey="class:own-tasks" id="class-own-tasks" level={3} title="Your tasks" count={ownTasks.length}>
              <ShelfNotes items={ownTaskItems} now={now} onOpen={onOpen} onMenu={onMenu} picking={picking} whereOf={sharedMark} />
            </ShelfSection>
          ) : null}
          <ShelfSection foldKey="class:work" id="class-work" level={3} title="Your artifacts" count={work.length}>
            {work.length || folders.length ? (
              <>
                {folders.length ? (
                  <div className="mb-6">
                    <FolderCards folders={folders} now={now} onOpen={onOpen} onMenu={onMenu} picking={picking} />
                  </div>
                ) : null}
                {/* Inside the class every card is the class's, so each keeps its kind's colour. */}
                <ShelfNotes items={shownWork} now={now} onOpen={onOpen} onMenu={onMenu} picking={picking} whereOf={sharedMark} />
                {workItems.length > WORK_SHOWN ? (
                  <button type="button" className="today-link mt-3 inline-block" aria-expanded={allWork} onClick={() => setAllWork((open) => !open)}>
                    {allWork ? "Show fewer" : `Show all ${workItems.length}`}
                  </button>
                ) : null}
              </>
            ) : (
              <div className="class-shelf-empty">
                <p>Nothing made for {name} yet. Notes, essays and decks you keep here show up on this page.</p>
                {onCreate ? (
                  <button type="button" data-life-launch className="library-shelf-new" onClick={onCreate}>
                    Start a document
                  </button>
                ) : null}
              </div>
            )}
          </ShelfSection>

          <SharedWorkGroups groups={shared} place={name} workspaceId={workspaceId} now={now} onOpen={onOpen} picking={picking} />
        </div>

        {months.length ? (
          <aside aria-labelledby="class-past" className="library-shelf-side">
            <ShelfSection foldKey="class:past" id="class-past" level={3} title="Past tasks" count={pastCount}>
              {shownMonths.map((month) => (
                <div key={month.key} className="class-past-month">
                  <h4 className="class-past-label">{month.label}</h4>
                  <ul>
                    {(allMonths ? month.tasks : month.tasks.slice(0, MONTH_TASKS_SHOWN)).map((task) => (
                      <li key={task.recordId}>
                        <TaskLink open={open(task)} picked={taskPicking?.picked(task)} className="class-past-task">
                          <span className="min-w-0 flex-1 truncate">{task.title}</span>
                          {task.dueAt !== null ? <span className="class-past-day">{new Date(task.dueAt).getDate()}</span> : null}
                        </TaskLink>
                      </li>
                    ))}
                  </ul>
                  {!allMonths && month.tasks.length > MONTH_TASKS_SHOWN ? (
                    <p className="class-past-more">and {month.tasks.length - MONTH_TASKS_SHOWN} more</p>
                  ) : null}
                </div>
              ))}
              {months.length > MONTHS_SHOWN || months.some((month) => month.tasks.length > MONTH_TASKS_SHOWN) ? (
                <button type="button" className="today-link mt-3 inline-block" aria-expanded={allMonths} onClick={() => setAllMonths((more) => !more)}>
                  {allMonths ? "Show fewer" : `Show all ${pastCount}`}
                </button>
              ) : null}
            </ShelfSection>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The planner work Spectra made for each ManageBac task, found by title among
 * the class's works when no other planner work there shares that title.
 */
function usePlannerWorks(nodes: readonly TreeNode[]) {
  return useMemo(() => {
    const byTitle = new Map<string, TreeNode | null>();
    for (const node of nodes) {
      if (node.source?.blueprintKey !== "planner_task") continue;
      const title = node.name.trim();
      byTitle.set(title, byTitle.has(title) ? null : node);
    }
    return (task: SchoolTask) => byTitle.get(task.title.trim()) ?? null;
  }, [nodes]);
}

/** Whether a folder is a class's workspace, for the organizer to choose the shelf. */
export const isClassWorkspace = (node: TreeNode | null | undefined) =>
  node?.kind === "workspace" && (node.workspace?.isClass ?? node.workspace?.starterKey === "managebac-class");

/** The identity a class workspace is drawn in: School's, or one from its own name when School does not list it. */
export const classWorkspaceIdentity = (node: TreeNode, book: ClassBook) =>
  book.named(node.name) ?? classIdentity({ providerClassId: node.workspace?.workspaceId ?? node.nodeId, title: node.name });

/** Your own work its workspace's people can see says so; private work, the default, says nothing. */
const sharedMark = (node: TreeNode) => (node.sharedWithWorkspace ? "Shared with the class" : undefined);
