"use client";

import { useState, type ReactNode } from "react";
import { CalendarDays, X } from "@/components/icons/glyph-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { quickDays, taskInputs, taskInstant } from "./task-time";

/*
 * Choosing when a task is due, in one place: the days a student usually
 * means as a short list with their dates beside them, then a day and an
 * optional time of their own. Without a time the task is due by the end of
 * the day, and its reminders come at the reminder time from Settings.
 */

function shortDay(date: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, { timeZone, weekday: "short", day: "numeric", month: "short" }).format(
    new Date(taskInstant(date, "12:00", timeZone)),
  );
}

export function DuePicker({
  due,
  allDay,
  now,
  timeZone,
  reminderTime,
  disabled,
  className,
  children,
  onDue,
}: {
  due: number | null;
  allDay: boolean;
  now: number;
  timeZone: string;
  /** The learner's reminder time, named so a date-only task says when it reminds. */
  reminderTime?: string;
  disabled?: boolean;
  className?: string;
  /** What the trigger says, when the place it sits in reads better than a short date. */
  children?: ReactNode;
  /** An empty date clears the due date; a null time keeps it date-only. */
  onDue: (date: string, time: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const inputs = due === null ? null : taskInputs(due, timeZone);
  const [date, setDate] = useState(inputs?.date ?? "");
  const [time, setTime] = useState(inputs && !allDay ? inputs.time : "");
  const label = inputs
    ? `${shortDay(inputs.date, timeZone)}${allDay ? "" : `, ${inputs.time}`}`
    : "Add a date";

  const choose = (nextDate: string, nextTime: string | null) => {
    onDue(nextDate, nextTime);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDate(inputs?.date ?? "");
          setTime(inputs && !allDay ? inputs.time : "");
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        <button type="button" className={cn("due-picker-trigger", className)} data-empty={due === null || undefined}>
          {children ?? (
            <>
              <CalendarDays className="size-3.5" aria-hidden />
              {label}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="due-picker">
        <ul className="due-picker-days">
          {quickDays(now, timeZone).map((day) => (
            <li key={day.label}>
              <button type="button" onClick={() => choose(day.date, time || null)} aria-current={inputs?.date === day.date || undefined}>
                <span>{day.label}</span>
                <span className="due-picker-date">{shortDay(day.date, timeZone)}</span>
              </button>
            </li>
          ))}
        </ul>
        <form
          className="due-picker-own"
          onSubmit={(event) => {
            event.preventDefault();
            if (date) choose(date, time || null);
          }}
        >
          <label>
            <span>Day</span>
            <input type="date" className="sheet-input" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            <span>Time</span>
            <input type="time" className="sheet-input" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
          <button type="submit" className="due-picker-set" disabled={!date}>
            Set
          </button>
          <p className="due-picker-hint">
            {time
              ? "Due at that time."
              : reminderTime
                ? `No time: due by the end of the day, reminded at ${reminderTime}.`
                : "No time: due by the end of the day."}
          </p>
        </form>
        {due !== null ? (
          <button type="button" className="due-picker-clear" onClick={() => choose("", null)}>
            <X className="size-3.5" aria-hidden />
            Remove the date
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
