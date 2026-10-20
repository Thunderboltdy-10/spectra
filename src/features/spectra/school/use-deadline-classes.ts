"use client";

import { useMemo } from "react";
import type { ClassIdentity } from "../../../../shared/class-identity";
import { useDueByClass } from "./school-classes";
import { startOfDay, type SchoolTask } from "./school-model";
import { useClassBook } from "./use-class-book";

/*
 * A deadline on the calendar is a ManageBac task seen from the calendar, but
 * the calendar does not carry its class. Matching it to the task by title and
 * day finds the class, so Home and the Calendar can draw it in its class's ink
 * and open the task itself.
 */

export type DeadlineClass = { task: SchoolTask; identity: ClassIdentity | null };

export function useDeadlineClasses() {
  const book = useClassBook();
  const { tasks } = useDueByClass();
  return useMemo(() => {
    const byTitleAndDay = new Map<string, SchoolTask>();
    for (const task of tasks ?? []) if (task.dueAt) byTitleAndDay.set(`${task.title.trim()}|${startOfDay(task.dueAt)}`, task);
    return (title: string, at: number | undefined): DeadlineClass | null => {
      if (at === undefined) return null;
      const task = byTitleAndDay.get(`${title.trim()}|${startOfDay(at)}`);
      return task ? { task, identity: book.of(task.providerClassId, task.className) } : null;
    };
  }, [book, tasks]);
}
