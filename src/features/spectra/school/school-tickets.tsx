"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { ClassIdentity } from "../../../../shared/class-identity";
import { dateLabel, daysFrom, startOfDay, type SchoolTask } from "./school-model";
import { inkStyle, type ClassBook } from "./use-class-book";

/*
 * A task as School shows it: a ticket with its day on a leaf in its class's
 * ink, the title in the reading face, and its class and hour beneath. The
 * week strip above the tickets is the same week at a glance: a dot for every
 * task, in the colours of the classes it belongs to.
 */

const DAY = 24 * 60 * 60 * 1000;

/** "Today, 17:30", "Friday, 17:30", "3 days late". */
function whenLabel(dueAt: number | null, now: number, past: boolean) {
  if (!dueAt) return past ? null : "No due date";
  const time = new Date(dueAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (past) return dateLabel(dueAt, now);
  const days = daysFrom(dueAt, now);
  if (dueAt < now) return days === 0 ? `Was due ${time}` : `${-days} day${days === -1 ? "" : "s"} late`;
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days < 7) return `${new Date(dueAt).toLocaleDateString(undefined, { weekday: "long" })}, ${time}`;
  return time;
}

/** The day a task is due, on a leaf in its class's ink. */
function DayLeaf({ dueAt }: { dueAt: number | null }) {
  const due = dueAt ? new Date(dueAt) : null;
  return (
    <span aria-hidden className="school-ticket-leaf">
      {due ? (
        <>
          <span className="school-ticket-month">{due.toLocaleDateString(undefined, { month: "short" })}</span>
          <span className="school-ticket-day">{due.getDate()}</span>
        </>
      ) : (
        <span className="school-ticket-month">Any</span>
      )}
    </span>
  );
}

export function TaskTicket({
  task,
  identity,
  now,
  selected,
  compact = false,
  onSelect,
}: {
  task: SchoolTask;
  identity: ClassIdentity | null;
  now: number;
  selected: boolean;
  compact?: boolean;
  onSelect: () => void;
}) {
  const late = !task.past && task.dueAt !== null && task.dueAt < now;
  const when = whenLabel(task.dueAt, now, task.past);
  return (
    <button
      type="button"
      data-school-task={task.recordId}
      data-life-launch
      data-late={late || undefined}
      data-past={task.past || undefined}
      aria-pressed={selected}
      onClick={onSelect}
      style={inkStyle(identity)}
      className={cn("school-ticket", compact && "school-ticket--compact")}
    >
      <DayLeaf dueAt={task.dueAt} />
      <span className="min-w-0 flex-1">
        <span className="school-ticket-title">{task.title}</span>
        <span className="school-ticket-meta">
          {identity ? (
            <span className="school-ticket-class">
              <span aria-hidden className="school-class-dot" />
              {identity.name}
            </span>
          ) : null}
          {when ? <span className={late ? "text-[var(--danger)]" : undefined}>{when}</span> : null}
          {task.status && !compact ? <span>{task.status}</span> : null}
        </span>
      </span>
    </button>
  );
}

/** This week, Monday to Sunday: each day with a dot per task due, in its class's ink. */
export function WeekStrip({ tasks, book, now }: { tasks: readonly SchoolTask[]; book: ClassBook; now: number }) {
  const today = startOfDay(now);
  const monday = today - ((new Date(today).getDay() + 6) % 7) * DAY;
  const days = Array.from({ length: 7 }, (_, index) => {
    const start = monday + index * DAY;
    // Days are counted from midnight; a change of clocks moves a day by an hour, never by a day.
    const due = tasks.filter((task) => task.dueAt !== null && startOfDay(task.dueAt) === startOfDay(start + DAY / 2));
    return { start, due };
  });
  return (
    <ol aria-label="This week" className="school-week">
      {days.map(({ start, due }) => {
        const date = new Date(start + DAY / 2);
        const isToday = startOfDay(start + DAY / 2) === today;
        return (
          <li key={start} data-today={isToday || undefined} data-past={start + DAY <= now || undefined} className="school-week-day">
            <span className="school-week-name">{date.toLocaleDateString(undefined, { weekday: "short" })}</span>
            <span className="school-week-date">{date.getDate()}</span>
            <span className="school-week-dots" aria-label={due.length ? `${due.length} due` : "Nothing due"}>
              {due.slice(0, 4).map((task) => (
                <span key={task.recordId} aria-hidden className="school-class-dot" style={inkStyle(book.of(task.providerClassId, task.className))} />
              ))}
              {due.length > 4 ? <span className="school-week-more">+{due.length - 4}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const ghostBar = "block animate-pulse rounded-full bg-[var(--bg-tertiary)]";

/** The week on its way: its seven days in place, so the strip that comes stands where its ghost stood. */
export function WeekStripSkeleton() {
  return (
    <ol data-life-ghost aria-hidden className="school-week">
      {Array.from({ length: 7 }, (_, day) => (
        <li key={day} className="school-week-day">
          <span data-life-ghost-bar className={`${ghostBar} h-2.5 w-7`} />
          <span data-life-ghost-bar className={`${ghostBar} mt-1 h-5 w-6`} />
        </li>
      ))}
    </ol>
  );
}

/** Tickets on their way, in the tickets' grid: a heading, then a few slips with a stamp, a title and a line. */
export function TicketsSkeleton({ count = 4, label = "Loading tasks" }: { count?: number; label?: string }) {
  return (
    <div role="status" aria-label={label}>
      <span data-life-ghost-bar className={`${ghostBar} mb-3 mt-8 h-4 w-28`} />
      <div className="school-tickets">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} data-life-ghost className="school-ticket">
            <span data-life-ghost-bar className="block size-9 shrink-0 animate-pulse rounded-card bg-[var(--bg-tertiary)]" />
            <span className="min-w-0 flex-1 space-y-2 pt-1">
              <span data-life-ghost-bar className={`${ghostBar} h-3.5`} style={{ width: `${72 - ((index * 13) % 28)}%` }} />
              <span data-life-ghost-bar className={`${ghostBar} h-2.5`} style={{ width: `${44 - ((index * 7) % 14)}%` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One group of tickets under a heading that folds it away. Late work starts
 * folded: it is there, counted, but it does not push the week down. A search
 * opens every group, so what matches is never hidden.
 */
export function TaskGroup({
  label,
  name,
  count,
  late = false,
  open: forced,
  style,
  children,
}: {
  label: ReactNode;
  /** The group's name for screen readers, when `label` is more than words. */
  name?: string;
  count?: number;
  late?: boolean;
  /** Set while searching: every group shows what it holds. */
  open?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [chosen, setChosen] = useState(!late);
  const open = forced ?? chosen;
  return (
    <section aria-label={name ?? (typeof label === "string" ? label : undefined)} style={style} data-folded={!open || undefined}>
      <h3 className="school-heading" data-late={late || undefined}>
        <button type="button" className="school-heading-toggle" aria-expanded={open} disabled={forced !== undefined} onClick={() => setChosen(!open)}>
          <Icon name="chevronDown" size={14} className="school-heading-chevron" />
          {label}
          {count !== undefined ? <span className="school-heading-count">{count}</span> : null}
        </button>
      </h3>
      {open ? children : null}
    </section>
  );
}
