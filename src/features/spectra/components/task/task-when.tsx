"use client";

import { CalendarDays } from "@/components/icons/glyph-icons";
import { cn } from "@/lib/utils";
import { DuePicker } from "./due-picker";
import { dueDistance, dueSentence } from "./task-time";

/*
 * When a task is due, said as a sentence under its title (EDITORS.md,
 * "Planner task"). The sentence itself opens the due picker, so a task with
 * no date and one with a date change the same way. A school's date reads as
 * the school wrote it, with the student's own target beside it.
 */

export function TaskWhen({
  due,
  allDay,
  done,
  now,
  timeZone,
  reminderTime,
  editable,
  canEdit,
  fromSchool,
  target,
  onDue,
  onTarget,
}: {
  due: number | null;
  allDay: boolean;
  done: boolean;
  now: number;
  timeZone: string;
  /** The learner's reminder time, for what a date-only task says it does. */
  reminderTime?: string;
  /** Whether the due date itself can change (not a school's, not read-only). */
  editable: boolean;
  /** Whether the student can write here at all (their target, for a school's task). */
  canEdit: boolean;
  fromSchool: boolean;
  target: number | null;
  onDue: (date: string, time: string | null) => void;
  onTarget: (date: string) => void;
}) {
  const late = due !== null && !done && due < now;
  const sentence =
    due === null ? (
      <span>No due date</span>
    ) : (
      <>
        <span>Due {dueSentence(due, allDay, timeZone)}</span>
        <span className={cn("task-when-distance", late && "is-late")}>{dueDistance(due, now, timeZone)}</span>
      </>
    );

  return (
    <div className="task-when">
      {editable ? (
        // The sentence is the control: pressing when it is due changes it.
        <DuePicker
          due={due}
          allDay={allDay}
          now={now}
          timeZone={timeZone}
          reminderTime={reminderTime}
          className="task-when-sentence task-when-pick"
          onDue={onDue}
        >
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
      )}
      {fromSchool && due !== null ? (
        // The student's own day to have it done by, ahead of the school's.
        <DuePicker
          due={target}
          allDay
          now={now}
          timeZone={timeZone}
          disabled={!canEdit}
          className="task-when-target"
          onDue={(date) => onTarget(date)}
        >
          <CalendarDays className="size-3.5" aria-hidden />
          {target === null ? "Set your own date" : `Your date: ${dueSentence(target, true, timeZone)}`}
        </DuePicker>
      ) : null}
    </div>
  );
}
