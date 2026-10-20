"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { startOfDay, type SchoolTask } from "../school/school-model";

/*
 * A ManageBac task as a shelf lists it (LIBRARY.md, "A class"): a class's
 * shelf, and the top of the Library where what is coming up from every class
 * leads.
 */

const DAY = 86_400_000;

/** Where pressing a task goes: its planner work, or the task in School. A link may open it in place. */
export type TaskOpen = { onClick: () => void } | { href: string; onClick?: (event: MouseEvent) => void };

/** A task opens as its planner work when there is one, and in School otherwise. */
export function TaskLink({ open, className, late, soon, children }: { open: TaskOpen; className: string; late?: boolean; soon?: boolean; children: React.ReactNode }) {
  const marks = { "data-late": late ? "" : undefined, "data-soon": soon ? "" : undefined };
  if ("href" in open)
    return (
      <Link href={open.href} onClick={open.onClick} prefetch={false} className={className} {...marks}>
        {children}
      </Link>
    );
  return (
    <button type="button" data-life-launch onClick={open.onClick} className={className} {...marks}>
      {children}
    </button>
  );
}

/**
 * A task ahead: its day as a date block in its class's ink (`--class-ink`),
 * its title, and when in the day it is due; where tasks from every class
 * share a list, its class is named first.
 */
export function DueTask({ task, now, open, place }: { task: SchoolTask; now: number; open: TaskOpen; place?: string | null }) {
  const at = task.dueAt === null ? null : new Date(task.dueAt);
  const days = task.dueAt === null ? null : Math.round((startOfDay(task.dueAt) - startOfDay(now)) / DAY);
  return (
    <TaskLink open={open} className="class-due-task" soon={days !== null && days >= 0 && days <= 1} late={days !== null && days < 0}>
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
