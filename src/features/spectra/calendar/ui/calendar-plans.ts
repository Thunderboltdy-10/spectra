"use client";

import { useMemo } from "react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { api } from "../../../../../convex/_generated/api";
import type { ClassIdentity } from "../../../../../shared/class-identity";
import { useAuthedArgs } from "../../data/use-authed-args";
import type { SchoolTask } from "../../school/school-model";
import { useClassBook } from "../../school/use-class-book";
import type { CalendarItem } from "../domain/model";

/*
 * Tasks without a time yet (CALENDAR.md, "Plans"), as Home's week lists
 * them: the school tasks still to do, by when they are due and in their
 * class's ink; the student's own; and the school tasks already past.
 */

type Placed = { item: CalendarItem; task: SchoolTask | null; identity: ClassIdentity | null };

/**
 * Sorts the plans by what School knows of them. A ManageBac plan carries its
 * task's record; a plan without one is matched by title only when that title
 * is unique, since a class can set a dozen tasks called "Quiz".
 */
export function usePlanGroups(plans: readonly CalendarItem[]) {
  const book = useClassBook();
  const school = useQuery(api.school.tasks, useAuthedArgs({ view: "all" as const }));
  return useMemo(() => {
    const tasks = school?.tasks ?? [];
    const byRecord = new Map(tasks.map((task) => [task.recordId as string, task]));
    const titled = new Map<string, SchoolTask | null>();
    for (const task of tasks) {
      const title = task.title.trim();
      titled.set(title, titled.has(title) ? null : task);
    }
    const toDo: Placed[] = [];
    const own: Placed[] = [];
    const past: Placed[] = [];
    for (const item of plans) {
      const recordId = item.source?.recordId;
      const task = (recordId ? byRecord.get(recordId) : titled.get(item.title.trim())) ?? null;
      const placed = { item, task, identity: task ? book.of(task.providerClassId, task.className) : null };
      if (task) (task.past ? past : toDo).push(placed);
      // A school plan School no longer lists is an old one.
      else (recordId && item.source?.provider === "managebac" ? past : own).push(placed);
    }
    toDo.sort((a, b) => (a.task?.dueAt ?? Infinity) - (b.task?.dueAt ?? Infinity));
    return { toDo, own, past };
  }, [book, plans, school]);
}

/** The task work a calendar item opens as, when it has one. */
export function planWorkId(item: CalendarItem) {
  return item.planArtifactId || (item.planTaskId ? item.linkedWorkIds[0] : undefined);
}
