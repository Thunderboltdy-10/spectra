"use client";

import { useState, type ReactNode } from "react";
import { CalendarDays, X } from "@/components/icons/glyph-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { DayField, TimeField } from "@/components/ui/when-fields";
import { quickDays, taskInputs, taskInstant } from "./task-time";

/*
 * Choosing when a task is due, in one place: the days a student usually
 * means as a short list with their dates beside them, then a day and an
 * optional time of their own. Without a time the task is due by the end of
 * the day, and its reminders come at the reminder time from Settings. A task
 * that fills hours takes a start too ("From"), and its time is then when it
 * ends: one task can be a day, a deadline, or a stretch of time.
 */

function shortDay(date: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, { timeZone, weekday: "short", day: "numeric", month: "short" }).format(
    new Date(taskInstant(date, "12:00", timeZone)),
  );
}

export function DuePicker({
  due,
  start = null,
  spans = false,
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
  /** When the task starts, if it fills hours. */
  start?: number | null;
  /** Whether it may take a start (a task's own day, not a school's or a target). */
  spans?: boolean;
  allDay: boolean;
  now: number;
  timeZone: string;
  /** The learner's reminder time, named so a date-only task says when it reminds. */
  reminderTime?: string;
  disabled?: boolean;
  className?: string;
  /** What the trigger says, when the place it sits in reads better than a short date. */
  children?: ReactNode;
  /** An empty date clears the due date; a null time keeps it date-only; a start makes it fill hours. */
  onDue: (date: string, time: string | null, from?: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const inputs = due === null ? null : taskInputs(due, timeZone);
  const startTime = spans && start !== null && due !== null && start < due ? taskInputs(start, timeZone).time : "";
  const [date, setDate] = useState(inputs?.date ?? "");
  const [time, setTime] = useState(inputs && !allDay ? inputs.time : "");
  const [from, setFrom] = useState(startTime);
  const [fromOpen, setFromOpen] = useState(Boolean(startTime));
  const label = inputs
    ? `${shortDay(inputs.date, timeZone)}${allDay ? "" : `, ${inputs.time}`}`
    : "Add a date";

  const choose = (nextDate: string, nextTime: string | null, nextFrom: string | null = null) => {
    // A start alone is a time to have it done by; a start after the end is dropped.
    if (nextFrom && !nextTime) onDue(nextDate, nextFrom, null);
    else onDue(nextDate, nextTime, nextFrom && nextTime && nextFrom < nextTime ? nextFrom : null);
    setOpen(false);
  };
  const spanning = spans && fromOpen;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDate(inputs?.date ?? "");
          setTime(inputs && !allDay ? inputs.time : "");
          setFrom(startTime);
          setFromOpen(Boolean(startTime));
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
              <button type="button" onClick={() => choose(day.date, time || null, spanning ? from || null : null)} aria-current={inputs?.date === day.date || undefined}>
                <span>{day.label}</span>
                <span className="due-picker-date">{shortDay(day.date, timeZone)}</span>
              </button>
            </li>
          ))}
        </ul>
        <form
          className="due-picker-own"
          data-span={spanning || undefined}
          onSubmit={(event) => {
            event.preventDefault();
            if (date) choose(date, time || null, spanning ? from || null : null);
          }}
        >
          <DayField label="Day" value={date} onChange={setDate} />
          {spanning ? <TimeField label="From" placeholder="Start" value={from} onChange={setFrom} opensAt="16:00" /> : null}
          <TimeField label={spanning ? "To" : "Time"} placeholder={spanning ? "End" : "Any time"} value={time} onChange={setTime} opensAt="17:00" />
          <button type="submit" className="due-picker-set" disabled={!date}>
            Set
          </button>
          <p className="due-picker-hint">
            {spanning && from && time && from < time
              ? `Fills ${from} to ${time} on the calendar.`
              : spanning && from && time
                ? "The end has to come after the start."
                : time || from
                  ? "Due at that time."
                  : reminderTime
                    ? `No time: it sits at the top of the day, reminded at ${reminderTime}.`
                    : "No time: it sits at the top of the day."}
          </p>
          {spans ? (
            <button
              type="button"
              className="due-picker-span"
              aria-pressed={spanning}
              onClick={() => {
                setFromOpen((value) => !value);
                setFrom("");
              }}
            >
              {spanning ? "Just a due time" : "Add a start time"}
            </button>
          ) : null}
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
