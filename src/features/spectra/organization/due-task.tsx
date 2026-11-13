"use client";

import Link from "next/link";
import { useCallback, useState, type MouseEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { toast } from "@/components/ui/toast";
import { startOfDay, type SchoolTask } from "../school/school-model";
import { PickMark, type WorkPicking } from "./library-note";

/*
 * A ManageBac task as a shelf lists it (LIBRARY.md, "A class"): a class's
 * shelf, and the top of the Library where what is coming up from every class
 * leads.
 */

const DAY = 86_400_000;

/** Where pressing a task goes: its planner work, or the task in School. A link may open it in place. */
export type TaskOpen = { onClick: () => void } | { href: string; onClick?: (event: MouseEvent) => void };

/** A task opens as its planner work when there is one, and in School otherwise. */
export function TaskLink({
  open,
  className,
  late,
  soon,
  picked,
  children,
}: {
  open: TaskOpen;
  className: string;
  late?: boolean;
  soon?: boolean;
  /** While picking (Select): whether this task's work is picked. */
  picked?: boolean;
  children: React.ReactNode;
}) {
  const marks = {
    "data-late": late ? "" : undefined,
    "data-soon": soon ? "" : undefined,
    "data-picking": picked === undefined ? undefined : "",
    "data-picked": picked ? "" : undefined,
    "aria-pressed": picked,
  };
  const content = (
    <>
      {children}
      {picked === undefined ? null : <PickMark />}
    </>
  );
  if ("href" in open)
    return (
      <Link href={open.href} onClick={open.onClick} prefetch={false} className={className} {...marks}>
        {content}
      </Link>
    );
  return (
    <button type="button" data-life-launch onClick={open.onClick} className={className} {...marks}>
      {content}
    </button>
  );
}

/**
 * Picking ManageBac tasks (Select): a task is picked as the planner work
 * Spectra keeps for it, made on the spot when it has none yet.
 */
export function useTaskPicking(picking: WorkPicking | undefined) {
  const ensure = useMutation(api.school.ensureTaskWork);
  const [works, setWorks] = useState<Record<string, string>>({});
  const toggle = useCallback(
    async (task: SchoolTask) => {
      if (!picking) return;
      let workId: string | null | undefined = works[task.recordId];
      if (!workId) {
        workId = await ensure({ recordId: task.recordId }).catch(() => null);
        if (!workId) {
          toast.error(`${task.title} can't be picked right now.`);
          return;
        }
        const id = workId;
        setWorks((current) => ({ ...current, [task.recordId]: id }));
      }
      picking.toggleWork(workId, { title: task.title, type: "planner_task" });
    },
    [ensure, picking, works],
  );
  if (!picking) return null;
  return {
    picked: (task: SchoolTask) => {
      const workId = works[task.recordId];
      return Boolean(workId && picking.hasWork(workId));
    },
    open: (task: SchoolTask): TaskOpen => ({ onClick: () => void toggle(task) }),
  };
}

/**
 * A task ahead: its day as a date block in its class's ink (`--class-ink`),
 * its title, and when in the day it is due; where tasks from every class
 * share a list, its class is named first.
 */
export function DueTask({ task, now, open, place, picked }: { task: SchoolTask; now: number; open: TaskOpen; place?: string | null; picked?: boolean }) {
  const at = task.dueAt === null ? null : new Date(task.dueAt);
  const days = task.dueAt === null ? null : Math.round((startOfDay(task.dueAt) - startOfDay(now)) / DAY);
  return (
    <TaskLink open={open} picked={picked} className="class-due-task" soon={days !== null && days >= 0 && days <= 1} late={days !== null && days < 0}>
      <span aria-hidden className="class-due-date">
        <span className="class-due-day">{at ? at.getDate() : "?"}</span>
        <span className="class-due-month">{at ? at.toLocaleDateString(undefined, { month: "short" }) : ""}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="class-due-title">{task.title}</span>
        <span className="class-due-meta">
          {place ? `${place}. ` : ""}
          {whenLabel(at, days)}
          {at ? `, ${at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : ""}
          {task.taskType ? `. ${task.taskType}` : ""}
        </span>
      </span>
    </TaskLink>
  );
}

/** "2 days late", "Today", "Tomorrow", a weekday this week, then "In 2 weeks". */
function whenLabel(at: Date | null, days: number | null) {
  if (at === null || days === null) return "No date";
  if (days < 0) return days === -1 ? "1 day late" : `${-days} days late`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return at.toLocaleDateString(undefined, { weekday: "long" });
  const weeks = Math.max(1, Math.round(days / 7));
  return `In ${weeks} week${weeks === 1 ? "" : "s"}`;
}
