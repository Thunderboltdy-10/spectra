"use client";

import { CalendarDays } from "@/components/icons/glyph-icons";
import { cn } from "@/lib/utils";
import { DuePicker } from "./due-picker";
import { dueDistance, dueSentence, taskInputs } from "./task-time";

/*
 * When a task is due, said under its title (EDITORS.md, "Planner task"): the
 * day, and how near it is. The words themselves open the due picker, so a
 * task with no date and one with a date change the same way. A school's date
 * reads as the school wrote it; the student's own day for it is in More
 * options (TaskTarget). A task with a start fills those hours: "Friday
 * 13 November, 16:00 to 18:00".
 */

/** When a task that fills hours happens, in words. */
export function spanSentence(start: number, end: number, timeZone: string) {
  return `${dueSentence(start, false, timeZone)} to ${taskInputs(end, timeZone).time}`;
}

export function TaskWhen({
  due,
  start = null,
  allDay,
  done,
  now,
  timeZone,
  reminderTime,
  editable,
  onDue,
}: {
  due: number | null;
  /** When it starts, if it fills hours. */
  start?: number | null;
  allDay: boolean;
  done: boolean;
  now: number;
  timeZone: string;
  /** The learner's reminder time, for what a date-only task says it does. */
  reminderTime?: string;
  /** Whether the due date itself can change (not a school's, not read-only). */
  editable: boolean;
  onDue: (date: string, time: string | null, from?: string | null) => void;
}) {
  const late = due !== null && !done && due < now;
  const span = due !== null && start !== null && start < due;
  const sentence =
    due === null ? (
      <span>No due date</span>
    ) : (
      <>
        <CalendarDays className="size-4" aria-hidden />
        <span>{span ? spanSentence(start, due, timeZone) : `Due ${dueSentence(due, allDay, timeZone)}`}</span>
        {done ? null : <span className={cn("task-when-distance", late && "is-late")}>{dueDistance(span ? start : due, now, timeZone)}</span>}
      </>
    );

  return editable ? (
    // The words are the control: pressing when it is due changes it.
    <DuePicker due={due} start={start} spans allDay={allDay} now={now} timeZone={timeZone} reminderTime={reminderTime} className="task-when-sentence task-when-pick" onDue={onDue}>
      {due === null ? (
        <>
          <CalendarDays className="size-4" aria-hidden />
          <span>Add a due date</span>
        </>
      ) : (
        sentence
      )}
    </DuePicker>
  ) : (
    <p className="task-when-sentence">{sentence}</p>
  );
}

/** The student's own day to have a school task done by, ahead of the school's. */
export function TaskTarget({
  target,
  now,
  timeZone,
  canEdit,
  onTarget,
}: {
  target: number | null;
  now: number;
  timeZone: string;
  canEdit: boolean;
  onTarget: (date: string) => void;
}) {
  return (
    <DuePicker due={target} allDay now={now} timeZone={timeZone} disabled={!canEdit} className="task-when-target" onDue={(date) => onTarget(date)}>
      <CalendarDays className="size-3.5" aria-hidden />
      {target === null ? "Set your own date" : dueSentence(target, true, timeZone)}
    </DuePicker>
  );
}
