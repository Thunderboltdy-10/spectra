"use client";

import Link from "next/link";
import { useMemo, type CSSProperties } from "react";
import type { ClassIdentity } from "../../../../shared/class-identity";
import { CALENDAR_LAYERS, type CalendarItem } from "../calendar/domain/model";
import { addLocalDays, startOfLocalDay } from "../calendar/domain/local-days";
import { planWorkId, usePlanGroups } from "../calendar/ui/calendar-plans";
import { openWorkInSide, sideClick } from "../components/side-open";
import { schoolTaskHref, useOpenSchoolTask } from "../school/open-school-task";
import { useDueByClass } from "../school/school-classes";
import type { SchoolTask } from "../school/school-model";
import { inkStyle } from "../school/use-class-book";
import { useDeadlineClasses } from "../school/use-deadline-classes";
import type { TodayAgenda } from "./today-model";
import { useWorkspaceCatalog } from "../data/use-catalog-pages";
import { workspaceHref } from "../pages/shell-location";

/*
 * The week across the top of Home, as a desk calendar laid open: today wide
 * on the left with everything in it by the hour, then the six days after it
 * with what falls due on each. A deadline from ManageBac wears its class's
 * ink and opens beside Home as the planner work Spectra made for it; a plan
 * opens as its work there too. A class opens its workspace when one exists;
 * anything else opens the Calendar. Above it, the two things a student checks before anything else: what is late,
 * and how much has no date yet.
 */

const WEEK_DAYS = 7;
const KIND_LABEL: Partial<Record<CalendarItem["kind"], string>> = {
  official_event: "Class",
  official_deadline: "Deadline",
  task: "Plan",
  milestone: "Milestone",
  reminder: "Reminder",
  scheduled_work_block: "Work block",
  personal_event: "Event",
};
/** How many items a day shows before the rest wait in the Calendar. */
const PER_DAY = 4;
const PER_TODAY = 6;

type Entry = {
  item: CalendarItem;
  identity: ClassIdentity | null;
  task: SchoolTask | null;
};

const NO_PLANS: CalendarItem[] = [];
const dayKey = (at: number) => startOfLocalDay(at);
const layerColour = (item: CalendarItem) =>
  CALENDAR_LAYERS.find((layer) => layer.itemKinds.includes(item.kind))?.color ?? "var(--text-tertiary)";
const time = (at: number) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(at);
/** A deadline at the very end of the day is "by the end of the day", not a time. */
const endOfDay = (at: number) => {
  const date = new Date(at);
  return date.getHours() === 23 && date.getMinutes() >= 59;
};

export function TodayWeek({ agenda, failed, now }: { agenda: TodayAgenda | null; failed: boolean; now: number }) {
  const { tasks } = useDueByClass();
  const classOf = useDeadlineClasses();
  const workspaces = useWorkspaceCatalog().items;
  const start = startOfLocalDay(now);

  const days = useMemo(() => {
    const entries = new Map<number, Entry[]>();
    for (const item of [...(agenda?.today ?? []), ...(agenda?.upcoming ?? [])]) {
      if (item.startAt === undefined) continue;
      const day = dayKey(item.startAt);
      const match = classOf(item.title, item.startAt);
      entries.set(day, [...(entries.get(day) ?? []), { item, identity: match?.identity ?? null, task: match?.task ?? null }]);
    }
    return Array.from({ length: WEEK_DAYS }, (_, index) => {
      const at = addLocalDays(start, index);
      return { at, entries: entries.get(dayKey(at)) ?? [] };
    });
  }, [agenda, classOf, start]);

  const late = (tasks ?? []).filter((task) => !task.past && task.dueAt !== null && task.dueAt < start).length;
  // School tasks already past are not waiting for a date; only what is still to do is.
  const plans = usePlanGroups(agenda?.open ?? NO_PLANS);
  const undated = plans.toDo.length + plans.own.length;

  return (
    <section aria-labelledby="today-week">
      <div className="today-section-head">
        <h2 id="today-week">This week</h2>
        <span className="ml-auto flex items-baseline gap-5">
          {late ? (
            <Link href="/school?section=tasks" prefetch={false} className="today-link today-link--late">
              {late} late
            </Link>
          ) : null}
          {undated ? (
            <Link href="/calendar" prefetch={false} className="today-link">
              {undated} to plan
            </Link>
          ) : null}
          <Link href="/calendar" prefetch={false} className="today-link">
            Calendar
          </Link>
        </span>
      </div>

      {failed ? (
        <p className="today-week today-week--quiet">Your calendar couldn&apos;t load. Open Calendar to see your week.</p>
      ) : (
        <ol className="today-week">
          {days.map(({ at, entries }, index) => {
            const today = index === 0;
            const date = new Date(at);
            const weekend = date.getDay() === 0 || date.getDay() === 6;
            const limit = today ? PER_TODAY : PER_DAY;
            return (
              <li key={at} className="today-day" data-today={today || undefined} data-weekend={weekend || undefined}>
                <p className="today-day-head">
                  <span className="today-day-date">{date.getDate()}</span>
                  <span className="today-day-name">
                    {today ? "Today" : new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date)}
                    {today ? <span className="block font-normal text-[var(--text-tertiary)]">{new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date)}</span> : null}
                  </span>
                </p>
                {!agenda ? (
                  <span data-life-ghost-bar className="mt-2 block h-2.5 w-3/4 animate-pulse rounded-full bg-[var(--bg-tertiary)]" />
                ) : entries.length ? (
                  <ul className="today-day-items">
                    {entries.slice(0, limit).map((entry) => (
                      <DayItem key={entry.item.id} entry={entry} now={now} showTime={today}
                        classWorkspaceId={entry.item.kind === "official_event" ? workspaces.find((workspace) => workspace.title === entry.item.title)?._id : undefined} />
                    ))}
                    {entries.length > limit ? (
                      <li>
                        <Link href="/calendar" prefetch={false} className="today-day-more">
                          {entries.length - limit} more
                        </Link>
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <p className="today-day-free">{today ? "Nothing on today." : "Free"}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function DayItem({ entry, now, showTime, classWorkspaceId }: { entry: Entry; now: number; showTime: boolean; classWorkspaceId?: string }) {
  const { item, identity, task } = entry;
  const at = item.startAt!;
  const over = (item.endAt ?? at) < now;
  const style = identity ? inkStyle(identity) : ({ "--class-ink": layerColour(item) } as CSSProperties);
  const when = item.allDay || endOfDay(at) ? null : time(at);
  const { onTaskClick } = useOpenSchoolTask();
  const work = planWorkId(item);
  return (
    <li>
      <Link
        href={classWorkspaceId ? workspaceHref(classWorkspaceId) : task ? schoolTaskHref(task.recordId) : work ? `/library/${encodeURIComponent(work)}` : "/calendar"}
        onClick={task ? onTaskClick(task.recordId) : work ? sideClick(() => openWorkInSide(work)) : undefined}
        prefetch={false}
        style={style}
        data-past={(showTime && over) || undefined}
        data-class={item.kind === "official_event" || undefined}
        className="today-day-item"
      >
        <span className="today-day-item-title">{item.title}</span>
        <span className="today-day-item-meta">
          <span className="truncate">{identity?.name ?? KIND_LABEL[item.kind]}</span>
          {showTime && when ? <span className="ml-auto shrink-0 tabular-nums">{when}</span> : null}
        </span>
      </Link>
    </li>
  );
}
