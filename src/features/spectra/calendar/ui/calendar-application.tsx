"use client";

import { ChevronLeft, ChevronRight, LockKeyhole, School } from "@/components/icons/glyph-icons";
import Link from "next/link";
import type { BarCommand } from "@/components/ui/adaptive-bar";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { useLifeArrival, useLifeDeparture } from "../../life/use-life";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { uniqueToken } from "@/lib/unique-token";
import { describeFailure } from "@/components/ui/truthful-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProductEmptyState, ProductErrorState } from "../../components/product-state";
import { spectraBus } from "../../events";
import { syncSpectraManageBac } from "../../data/api";
import {
  CALENDAR_LAYERS,
  calendarItemFromWire,
  type CalendarItem,
  type CalendarLayerKey,
  type CalendarOverview,
} from "../domain/model";
import { fetchCalendarOverview, mergeCalendarPages, type CalendarContinuation } from "../data/overview-client";
import {
  addLocalDays,
  endOfLocalDay,
  localDaysAround,
  startOfLocalDay,
  startOfLocalWeek,
} from "../domain/local-days";
import { requestSpectra } from "../../data/request";
import { layoutTimedLanes, type TimedLane } from "../domain/timed-lanes";
import { useClassBook } from "../../school/use-class-book";
import { useDeadlineClasses, type DeadlineClass } from "../../school/use-deadline-classes";
import { planWorkId } from "./calendar-plans";
import { TaskPeek } from "./task-peek";
import { schoolRecordOf, useTaskPeek } from "./use-task-peek";
import { useOpenSchoolTask } from "../../school/open-school-task";
import { formatTime, isDeadline, isReschedulable, layerFor } from "../domain/item-format";
import { CalendarItemCard, type OpenedCalendarItem } from "./calendar-item-card";
import { CalendarComposer } from "./calendar-composer";
import { firstTipMoment } from "../../onboarding/first-tips";

const HOUR = 60 * 60_000;
// Tall enough that a school day, 07:00 to about 20:00, fills the grid and a lesson has room for its title.
const HOUR_PX = 60;
const WORKDAY_START_HOUR = 7;
const HOURS = 24;
const MIN_DAYS = 1;
const MAX_DAYS = 10;
/** The days the week narrows to while a work stands open beside it. */
const BESIDE_SIDE_DAYS = 3;
const EXTEND_DAYS = 7;
const MAX_LOADED_DAYS = 42;
const SCROLL_LOAD_PX = 280;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Each day's width so `span` days fill the scroller beside the hours column; set on it as `--day-width`. */
function fitDayWidth(scroller: HTMLElement, span: number) {
  const width = Math.max(88, (scroller.clientWidth - 54) / span);
  scroller.style.setProperty("--day-width", `${width}px`);
  return width;
}

function daysAround(center: number) {
  return localDaysAround(center, EXTEND_DAYS, EXTEND_DAYS * 2);
}

function formatRange(rangeStart: number, span: number) {
  const start = new Date(rangeStart);
  const end = new Date(addLocalDays(rangeStart, span - 1));
  if (span === 1) {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(start);
  }
  // "12–18 Oct 2026", "29 Sept – 5 Oct 2026": the range names what the two ends share once.
  return new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric", year: "numeric" }).formatRange(start, end);
}

function monthCells(year: number, month: number) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() || 7) - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const cells: Array<{ date: Date; muted: boolean }> = [];
  for (let index = offset - 1; index >= 0; index -= 1) {
    cells.push({ date: new Date(year, month - 1, prevDays - index), muted: true });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: new Date(year, month, day), muted: false });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]!.date;
    cells.push({
      date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
      muted: true,
    });
  }
  return cells;
}

function CalendarDatePicker({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (date: Date) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<"days" | "months" | "years">("days");
  const [cursor, setCursor] = useState(() => new Date(value));
  useEffect(() => {
    if (!open) return;
    setCursor(new Date(value));
    setLevel("days");
  }, [open, value]);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const selected = startOfLocalDay(value);
  const today = startOfLocalDay(Date.now());
  const years = Array.from({ length: 21 }, (_, index) => year - 10 + index);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="spectra-calendar-week-label max-w-[16rem] rounded-control px-2 py-1 text-left hover:bg-[var(--bg-hover)]"
          aria-label="Choose a date"
          title="Choose a date"
        >
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[280px] p-3">
        <div className="mb-2 flex items-center gap-1">
          <button
            type="button"
            className="spectra-calendar-week-step"
            aria-label={level === "days" ? "Previous month" : "Previous year"}
            onClick={() =>
              setCursor(
                new Date(
                  year - (level === "years" ? 21 : 0),
                  month - (level === "days" ? 1 : 0),
                  1,
                ),
              )
            }
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            className="min-w-0 flex-1 truncate rounded-control px-2 py-1 text-center text-ui font-semibold hover:bg-[var(--bg-hover)]"
            onClick={() =>
              setLevel((current) => (current === "days" ? "months" : "years"))
            }
          >
            {level === "years" ? `${years[0]}–${years[years.length - 1]}` : `${MONTHS[month]} ${year}`}
          </button>
          <button
            type="button"
            className="spectra-calendar-week-step"
            aria-label={level === "days" ? "Next month" : "Next year"}
            onClick={() =>
              setCursor(
                new Date(
                  year + (level === "years" ? 21 : 0),
                  month + (level === "days" ? 1 : 0),
                  1,
                ),
              )
            }
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        {level === "years" ? (
          <div className="grid grid-cols-3 gap-1">
            {years.map((entry) => (
              <button
                key={entry}
                type="button"
                className={cn(
                  "h-9 rounded-control text-caption font-semibold hover:bg-[var(--bg-hover)]",
                  entry === year && "bg-[var(--bg-hover)] text-[var(--text-primary)]",
                )}
                onClick={() => {
                  setCursor(new Date(entry, month, 1));
                  setLevel("months");
                }}
              >
                {entry}
              </button>
            ))}
          </div>
        ) : level === "months" ? (
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((name, index) => (
              <button
                key={name}
                type="button"
                className={cn(
                  "h-9 rounded-control text-caption font-semibold hover:bg-[var(--bg-hover)]",
                  index === month && "bg-[var(--bg-hover)] text-[var(--text-primary)]",
                )}
                onClick={() => {
                  setCursor(new Date(year, index, 1));
                  setLevel("days");
                }}
              >
                {name.slice(0, 3)}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="spectra-calendar-date-grid mb-1 text-micro font-bold text-[var(--text-tertiary)]">
              {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
                <span key={`${day}-${index}`} className="grid h-6 place-items-center">
                  {day}
                </span>
              ))}
            </div>
            <div className="spectra-calendar-date-grid">
              {monthCells(year, month).map((cell) => {
                const stamp = startOfLocalDay(cell.date);
                return (
                  <button
                    key={stamp + (cell.muted ? "-m" : "")}
                    type="button"
                    className={cn(
                      "spectra-calendar-date-cell",
                      cell.muted && "is-muted",
                      stamp === today && "is-today",
                      stamp === selected && "is-selected",
                    )}
                    onClick={() => {
                      onChange(cell.date);
                      setOpen(false);
                    }}
                  >
                    {cell.date.getDate()}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function localDayKey(value: number) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function zonedParts(value: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function zonedDayKey(value: number, timezone: string) {
  const parts = zonedParts(value, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function minutesOnDay(value: number, timezone: string) {
  const parts = zonedParts(value, timezone);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function isDayItem(item: CalendarItem) {
  return Boolean(
    item.startAt !== undefined &&
      (item.allDay ||
        item.timePrecision === "date_only" ||
        (item.timePrecision === "unknown" && item.endAt === undefined)),
  );
}

function isTimedItem(item: CalendarItem) {
  return Boolean(
    item.startAt !== undefined &&
      item.endAt !== undefined &&
      !isDayItem(item) &&
      item.timePrecision !== "unknown",
  );
}

function mergeById(current: CalendarItem[], incoming: CalendarItem[]) {
  const next = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) next.set(item.id, item);
  return [...next.values()];
}

/** A failed Calendar action. The route strips the code from `message`, so the
 * code travels separately and is what callers branch on. */
class CalendarActionError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

function isGestureConflict(error: unknown) {
  return (
    error instanceof CalendarActionError &&
    error.code === "CALENDAR_GESTURE_CONFLICT"
  );
}

/**
 * One notice for every stale Calendar gesture. It is shown as soon as the
 * conflict arrives, before the reload, and under one id, so a second conflict
 * replaces the first instead of stacking or racing it.
 */
const GESTURE_CONFLICT_TOAST_ID = "calendar-gesture-conflict";
function announceGestureConflict(reopen: boolean) {
  toast.error(
    reopen
      ? "Calendar changed elsewhere, so it now shows the latest version. Open the block again to continue."
      : "Calendar changed elsewhere, so it now shows the block's latest position.",
    { id: GESTURE_CONFLICT_TOAST_ID, duration: 8_000 },
  );
}

async function calendarPost(body: Record<string, unknown>) {
  const response = await requestSpectra("/api/spectra/calendar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new CalendarActionError(
      payload?.error?.message ?? "Calendar action failed.",
      typeof payload?.error?.code === "string" ? payload.error.code : undefined,
    );
  return payload.data;
}

type DragPayload =
  | { type: "plan"; item: CalendarItem; grabOffsetMinutes: number }
  | { type: "block"; item: CalendarItem; grabOffsetMinutes: number };

type GesturePreview = {
  itemId?: string;
  title: string;
  startAt: number;
  endAt: number;
  layer: CalendarLayerKey;
};

type ResizeGesture = {
  item: CalendarItem;
  edge: "start" | "end";
  originY: number;
  startAt: number;
  endAt: number;
};

/** `startAt` opens the calendar on that day instead of this week's Monday (the landing page shows the days ahead). */
/** `still`: a picture of the calendar (the landing page), where a wheel always scrolls the page around it. */
export function CalendarApplication({ startAt, still = false }: { startAt?: number; still?: boolean } = {}) {
  const initialStart = startAt ?? startOfLocalWeek(Date.now());
  const [daySpan, setDaySpanState] = useState(7);
  const [days, setDays] = useState(() => daysAround(initialStart));
  const [focusedStart, setFocusedStart] = useState(initialStart);
  const [overview, setOverview] = useState<CalendarOverview | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [continuation, setContinuation] = useState<CalendarContinuation | null>(null);
  const overviewRequestRef = useRef<AbortController | null>(null);
  const [error, setError] = useState("");
  const [needsSchool, setNeedsSchool] = useState(false);
  const [opened, setOpened] = useState<OpenedCalendarItem | null>(null);
  const schoolTask = useOpenSchoolTask();
  const taskPeek = useTaskPeek();
  const [composerOpen, setComposerOpen] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState<Set<CalendarLayerKey>>(
    () => new Set(CALENDAR_LAYERS.map((layer) => layer.key)),
  );
  const [layersOpen, setLayersOpen] = useState(false);
  const [gesturePreview, setGesturePreview] = useState<GesturePreview | null>(null);
  const [resizeGesture, setResizeGesture] = useState<ResizeGesture | null>(null);
  const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(() => new Set());
  const dragRef = useRef<DragPayload | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const loadLockRef = useRef(false);
  const scrollWeekRef = useRef<number | null>(initialStart);
  const staleSyncRef = useRef(false);
  const ignoreScrollRef = useRef(true);
  const zoomAccumRef = useRef(0);
  const daySpanRef = useRef(daySpan);
  daySpanRef.current = daySpan;
  const dayWidthRef = useRef(140);
  const daysRef = useRef(days);
  daysRef.current = days;
  const focusedStartRef = useRef(focusedStart);
  focusedStartRef.current = focusedStart;
  const loadRef = useRef<(
    mode?: "replace" | "merge",
    from?: number,
    to?: number,
    showRefresh?: boolean,
  ) => Promise<void>>(async () => undefined);
  const visibleRange = useMemo(
    () => ({
      from: days[0]!,
      to: endOfLocalDay(days[days.length - 1]!),
    }),
    [days],
  );

  const applyOverview = useCallback(
    (incoming: CalendarOverview, mode: "replace" | "merge", appendPage = false) => {
      setOverview((current) => {
        if (!current || mode === "replace") return incoming;
        if (appendPage) {
          const merged = mergeCalendarPages(current, incoming);
          merged.migration.complete = (merged.migration.pageComplete ?? false) && incoming.migration.complete;
          return merged;
        }
        const retainFrom = addLocalDays(visibleRange.from, -EXTEND_DAYS);
        const retainTo = addLocalDays(visibleRange.to, EXTEND_DAYS);
        return {
          ...incoming,
          items: mergeById(current.items, incoming.items).filter(
            (item) =>
              item.id.startsWith("pending:") ||
              item.startAt === undefined ||
              (item.startAt <= retainTo && (item.endAt ?? item.startAt) >= retainFrom),
          ),
          unscheduledTasks: incoming.unscheduledTasks,
        };
      });
    },
    [visibleRange.from, visibleRange.to],
  );

  const load = useCallback(
    async (mode: "replace" | "merge" = "replace", from?: number, to?: number, showRefresh = false, nextPage?: CalendarContinuation) => {
      // Extending the view while its old range is incomplete must not discard
      // that range's undiscovered tail. Restart the bounded combined range;
      // completed ordinary extensions still read only the newly exposed days.
      const includeCurrentRange = mode === "merge" && !nextPage && Boolean(continuation || overviewRequestRef.current);
      const requestFrom = includeCurrentRange ? Math.min(from ?? visibleRange.from, visibleRange.from) : from ?? visibleRange.from;
      const requestTo = includeCurrentRange ? Math.max(to ?? visibleRange.to, visibleRange.to) : to ?? visibleRange.to;
      overviewRequestRef.current?.abort();
      const request = new AbortController();
      overviewRequestRef.current = request;
      if (!nextPage) setContinuation(null);
      if (showRefresh) setRefreshing(true);
      setError("");
      try {
        const result = await fetchCalendarOverview(requestFrom, requestTo, { signal: request.signal, continuation: nextPage });
        if (request.signal.aborted || overviewRequestRef.current !== request) return;
        applyOverview(result.overview, mode, Boolean(nextPage));
        setContinuation(result.continuation);
      } catch (nextError) {
        if (request.signal.aborted || overviewRequestRef.current !== request) return;
        setNeedsSchool(nextError instanceof Error && nextError.message.startsWith("AUTH_NO_SCHOOL"));
        setError(
          describeFailure(nextError, {
            fallback: "Check your connection, then try loading Calendar again.",
          }).message,
        );
      } finally {
        if (overviewRequestRef.current === request) {
          overviewRequestRef.current = null;
          setRefreshing(false);
        }
      }
    },
    [applyOverview, continuation, visibleRange.from, visibleRange.to],
  );
  loadRef.current = load;

  useEffect(() => () => overviewRequestRef.current?.abort(), []);

  useEffect(() => {
    // The week loads at once; moving old timetables onto the calendar runs
    // beside it, once, and reloads only if it moved something.
    let cancelled = false;
    void loadRef.current("replace");
    void calendarPost({ action: "ensureMigration" })
      .then((result) => {
        const moved = (result as { data?: { migratedEvents?: number } } | null)?.data?.migratedEvents ?? 0;
        if (!cancelled && moved > 0) void loadRef.current("merge");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // A run that finished may have planned work onto the calendar.
  useEffect(() => spectraBus.on("calendar.changed", () => void loadRef.current("merge")), []);

  useEffect(() => {
    if (overview?.sourceState.kind !== "stale" || staleSyncRef.current) return;
    staleSyncRef.current = true;
    void syncSpectraManageBac()
      .then(() => load("merge", visibleRange.from, visibleRange.to))
      .catch(() => {
        staleSyncRef.current = false;
      });
  }, [load, overview?.sourceState.kind, visibleRange.from, visibleRange.to]);

  // Lands on the day asked for (this week, on opening), at the width the days
  // really have. Until the days are laid out the scroll cannot reach it and
  // the browser clamps it; the target then waits for the next layout, and the
  // clamped scroll is never read as the reader moving to the past.
  useLayoutEffect(() => {
    const target = scrollWeekRef.current;
    const scroller = scrollerRef.current;
    if (target === null || !scroller) return;
    const index = days.findIndex((day) => day === target);
    if (index < 0) return;
    ignoreScrollRef.current = true;
    const width = fitDayWidth(scroller, daySpanRef.current);
    dayWidthRef.current = width;
    scroller.style.setProperty("--loaded-days", String(days.length));
    scroller.scrollLeft = index * width;
    if (Math.abs(scroller.scrollLeft - index * width) > 1) return;
    scrollWeekRef.current = null;
    window.requestAnimationFrame(() => {
      ignoreScrollRef.current = false;
    });
  }, [days, overview, daySpan]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () => {
      const previous = dayWidthRef.current;
      const width = fitDayWidth(scroller, daySpanRef.current);
      dayWidthRef.current = width;
      scroller.style.setProperty("--loaded-days", String(daysRef.current.length));
      if (loadLockRef.current || Math.abs(previous - width) < 0.5) return;
      const index = daysRef.current.findIndex((day) => day === focusedStartRef.current);
      if (index < 0) return;
      ignoreScrollRef.current = true;
      scroller.scrollLeft = index * width;
      window.requestAnimationFrame(() => {
        ignoreScrollRef.current = false;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [daySpan, days.length, error, overview === null]);

  // The grid opens on working hours (SHELL.md): 07:00 just under the day heads,
  // before its first paint, so it never shows the night while the week loads.
  const openedOnHoursRef = useRef(false);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (openedOnHoursRef.current || !scroller) return;
    const hours = scroller.querySelector<HTMLElement>("[data-calendar-hours]");
    const head = scroller.querySelector<HTMLElement>(".spectra-calendar-day-head");
    const undated = scroller.querySelector<HTMLElement>(".spectra-calendar-allday-cell");
    if (!hours) return;
    openedOnHoursRef.current = true;
    // The day heads and the undated row stay pinned over the hours.
    const pinned = (head?.offsetHeight ?? 0) + (undated?.offsetHeight ?? 0);
    const hoursTop = hours.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTop = Math.max(0, hoursTop + WORKDAY_START_HOUR * HOUR_PX - pinned - 8);
  }, [overview, error]);

  // The grid's columns, drops and resizes are all in the browser's zone, so
  // every time on it is too. The overview's zone is only a guess from stored
  // rows (UTC for a student without school data), and rendering in it put an
  // 11:00 Madrid event at 09:00.
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const timedItems = useMemo(
    () =>
      (overview?.items ?? []).filter(
        (item) => isTimedItem(item) && visibleLayers.has(layerFor(item)),
      ),
    [overview?.items, visibleLayers],
  );
  const dayItems = useMemo(
    () =>
      (overview?.items ?? []).filter(
        (item) => isDayItem(item) && visibleLayers.has(layerFor(item)),
      ),
    [overview?.items, visibleLayers],
  );
  // A deadline, and time given to one, wears its class's ink; so does a lesson.
  const classOf = useDeadlineClasses();
  const book = useClassBook();
  const lessonInkOf = useCallback((item: CalendarItem) => (item.classId ? book.of(item.classId, item.title)?.ink : undefined), [book]);
  const schoolClassOf = useMemo(() => {
    const byId = new Map((overview?.items ?? []).map((item) => [item.id, item]));
    return (item: CalendarItem) => {
      const due = isDeadline(item) ? item : item.officialDeadlineItemId ? byId.get(item.officialDeadlineItemId) : undefined;
      return due ? classOf(due.title, due.startAt) : null;
    };
  }, [classOf, overview?.items]);

  // Time given to a school deadline is the same task: it opens the deadline's task work.
  const recordOf = useMemo(() => {
    const byId = new Map((overview?.items ?? []).map((item) => [item.id, item]));
    return (item: CalendarItem) => {
      const deadline = item.officialDeadlineItemId ? byId.get(item.officialDeadlineItemId) : undefined;
      return schoolRecordOf(item) ?? (deadline ? schoolRecordOf(deadline) : undefined);
    };
  }, [overview?.items]);

  // A school deadline cannot move, but the plan behind it can be given time:
  // dragging the deadline into the week places that plan.
  const planOfDeadline = useMemo(() => {
    const plans = (overview?.unscheduledTasks ?? []).filter((item) => item.planArtifactId);
    const byRecord = new Map<string, CalendarItem>();
    const byTitle = new Map<string, CalendarItem | null>();
    for (const plan of plans) {
      const recordId = plan.source?.recordId;
      if (recordId) byRecord.set(recordId, plan);
      const title = plan.title.trim();
      byTitle.set(title, byTitle.has(title) ? null : plan);
    }
    return (item: CalendarItem) => {
      if (item.kind !== "official_deadline") return undefined;
      const recordId = item.source?.recordId;
      return (recordId ? byRecord.get(recordId) : undefined) ?? byTitle.get(item.title.trim()) ?? undefined;
    };
  }, [overview?.unscheduledTasks]);

  function beginPlanDrag(plan: CalendarItem) {
    dragRef.current = { type: "plan", item: plan, grabOffsetMinutes: 0 };
  }

  function upsertItem(nextItem: CalendarItem, removeUnscheduled?: CalendarItem) {
    setOverview((current) => {
      if (!current) return current;
      const exists = current.items.some((item) => item.id === nextItem.id);
      const items = exists
        ? current.items.map((item) => (item.id === nextItem.id ? nextItem : item))
        : [...current.items, nextItem];
      return {
        ...current,
        items,
        unscheduledTasks: current.unscheduledTasks.filter((item) => {
          if (removeUnscheduled && item.id === removeUnscheduled.id) return false;
          if (nextItem.planArtifactId && item.planArtifactId === nextItem.planArtifactId)
            return false;
          if (nextItem.taskItemId && item.id === nextItem.taskItemId) return false;
          return true;
        }),
      };
    });
  }

  function replacePending(pendingId: string, nextItem: CalendarItem) {
    setOverview((current) =>
      current
        ? {
            ...current,
            items: current.items.some((item) => item.id === pendingId)
              ? current.items.map((item) => (item.id === pendingId ? nextItem : item))
              : [...current.items.filter((item) => item.id !== pendingId), nextItem],
          }
        : current,
    );
  }

  async function commit(action: Record<string, unknown>) {
    try {
      const wire = await calendarPost(action);
      if (wire && typeof wire === "object" && typeof (wire as Record<string, unknown>).id === "string") {
        const nextItem = calendarItemFromWire(wire as Record<string, unknown>);
        upsertItem(nextItem);
        setOpened((current) => (current?.item.id === nextItem.id ? { ...current, item: nextItem } : current));
      } else {
        await load("merge", visibleRange.from, visibleRange.to, true);
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Calendar action failed.";
      if (isGestureConflict(nextError)) {
        setOpened(null);
        announceGestureConflict(true);
        await load("replace", visibleRange.from, visibleRange.to, true);
      } else {
        toast.error(message);
      }
    }
  }

  async function removeItem(item: CalendarItem) {
    try {
      await calendarPost({ action: "removePersonalItem", itemId: item.id });
    } catch (nextError) {
      toast.error(
        nextError instanceof Error ? nextError.message : "Could not remove this from Calendar.",
      );
      return false;
    }
    setOverview((current) =>
      current
        ? { ...current, items: current.items.filter((entry) => entry.id !== item.id) }
        : current,
    );
    setOpened(null);
    // A removed work block returns its plan to the unscheduled list.
    if (item.kind === "scheduled_work_block")
      void load("merge", visibleRange.from, visibleRange.to);
    return true;
  }

  /** Time given to a deadline goes back into it: the block is taken off. */
  async function mergeBack(block: CalendarItem) {
    if (await removeItem(block)) toast.success(`Merged back into “${block.title}”.`);
  }

  function mergeTarget(deadline: CalendarItem) {
    const dragged = () => {
      const payload = dragRef.current;
      return payload?.type === "block" && payload.item.officialDeadlineItemId === deadline.id ? payload.item : null;
    };
    return {
      accepts: () => {
        const block = dragged();
        if (block) setGesturePreview(null);
        return Boolean(block);
      },
      onMerge: () => {
        const block = dragged();
        dragRef.current = null;
        if (block) void mergeBack(block);
      },
    };
  }

  async function commitWorkGesture(item: CalendarItem, startAt: number, endAt: number) {
    if (pendingItemIds.has(item.id)) return;
    const optimistic = { ...item, startAt, endAt };
    upsertItem(optimistic);
    setPendingItemIds((current) => new Set(current).add(item.id));
    try {
      const wire = await calendarPost({
        action: "moveWorkBlock",
        itemId: item.id,
        startAt,
        endAt,
        expectedRevision: item.revision,
      });
      upsertItem(calendarItemFromWire(wire as Record<string, unknown>));
    } catch (nextError) {
      upsertItem(item);
      const message = nextError instanceof Error ? nextError.message : "Calendar action failed.";
      if (isGestureConflict(nextError)) {
        announceGestureConflict(false);
        await load("replace", visibleRange.from, visibleRange.to, true);
      } else {
        toast.error(message);
      }
    } finally {
      setPendingItemIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      setGesturePreview(null);
    }
  }

  async function schedulePlan(item: CalendarItem, startAt: number, endAt: number) {
    const idempotencyKey = `human:${uniqueToken()}`;
    const pendingId = `pending:${item.id}:${idempotencyKey}`;
    const optimistic: CalendarItem = {
      ...item,
      id: pendingId,
      kind: "scheduled_work_block",
      startAt,
      endAt,
      allDay: false,
      timePrecision: "exact",
      sourceLocked: false,
      revision: 0,
    };
    upsertItem(optimistic, item);
    try {
      const wire = await calendarPost({
        action: "scheduleTask",
        taskItemId: item.id.startsWith("plan:") ? undefined : item.id,
        planArtifactId: item.planArtifactId,
        planTaskId: item.planTaskId,
        startAt,
        endAt,
        timezone,
        idempotencyKey,
      });
      replacePending(pendingId, calendarItemFromWire(wire as Record<string, unknown>));
      void load("merge", visibleRange.from, visibleRange.to);
    } catch (nextError) {
      setOverview((current) =>
        current
          ? {
              ...current,
              items: current.items.filter((entry) => entry.id !== pendingId),
              unscheduledTasks: [item, ...current.unscheduledTasks],
            }
          : current,
      );
      toast.error(nextError instanceof Error ? nextError.message : "Could not place this plan.");
    } finally {
      setGesturePreview(null);
    }
  }

  function resolveDrop(event: React.DragEvent<HTMLDivElement>, day: Date, grabOffsetMinutes: number) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    const cursorMinutes = ratio * HOURS * 60;
    const minutes = Math.max(
      0,
      Math.min(
        HOURS * 60 - 15,
        Math.round((cursorMinutes - grabOffsetMinutes) / 15) * 15,
      ),
    );
    const startAt = new Date(day);
    startAt.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return startAt.getTime();
  }

  function dropOnDay(event: React.DragEvent<HTMLDivElement>, day: Date) {
    event.preventDefault();
    const payload = dragRef.current;
    dragRef.current = null;
    setGesturePreview(null);
    if (!payload) return;
    // An all-day item stays all-day: let go anywhere on a day, it moves to that day.
    if (payload.type === "block" && payload.item.allDay && payload.item.startAt !== undefined) {
      moveToDay(payload.item, day);
      return;
    }
    const startAt = resolveDrop(event, day, payload.grabOffsetMinutes);
    if (payload.type === "plan") {
      void schedulePlan(payload.item, startAt, startAt + HOUR);
      return;
    }
    const duration = Math.max(
      15 * 60_000,
      (payload.item.endAt ?? startAt + HOUR) - (payload.item.startAt ?? startAt),
    );
    void commitWorkGesture(payload.item, startAt, startAt + duration);
  }

  /** An item let go on a day's all-day row keeps its time of day (or stays all-day) and moves to that day. */
  function dropOnAllDay(event: React.DragEvent<HTMLDivElement>, day: Date) {
    const payload = dragRef.current;
    if (payload?.type !== "block" || payload.item.startAt === undefined) return;
    event.preventDefault();
    dragRef.current = null;
    setGesturePreview(null);
    moveToDay(payload.item, day);
  }

  function moveToDay(item: CalendarItem, day: Date) {
    const was = new Date(item.startAt!);
    const next = new Date(day);
    next.setHours(was.getHours(), was.getMinutes(), 0, 0);
    if (next.getTime() === item.startAt) return;
    void commitWorkGesture(item, next.getTime(), next.getTime() + ((item.endAt ?? item.startAt!) - item.startAt!));
  }

  function previewDrop(event: React.DragEvent<HTMLDivElement>, day: Date) {
    event.preventDefault();
    const payload = dragRef.current;
    if (!payload) return;
    const startAt = resolveDrop(event, day, payload.grabOffsetMinutes);
    const duration =
      payload.type === "plan"
        ? HOUR
        : Math.max(
            15 * 60_000,
            (payload.item.endAt ?? startAt + HOUR) - (payload.item.startAt ?? startAt),
          );
    setGesturePreview({
      itemId: payload.type === "block" ? payload.item.id : undefined,
      title: payload.item.title,
      startAt,
      endAt: startAt + duration,
      layer: payload.type === "block" ? layerFor(payload.item) : "work",
    });
  }

  function beginResize(
    event: React.PointerEvent<HTMLSpanElement>,
    item: CalendarItem,
    edge: "start" | "end",
  ) {
    if (item.startAt === undefined || item.endAt === undefined || pendingItemIds.has(item.id))
      return;
    event.preventDefault();
    event.stopPropagation();
    const gesture: ResizeGesture = {
      item,
      edge,
      originY: event.clientY,
      startAt: item.startAt,
      endAt: item.endAt,
    };
    setResizeGesture(gesture);
    const resolve = (clientY: number) => {
      const delta =
        Math.round((((clientY - gesture.originY) / HOUR_PX) * 60) / 15) * 15 * 60_000;
      return edge === "start"
        ? { startAt: Math.min(gesture.endAt - 15 * 60_000, gesture.startAt + delta), endAt: gesture.endAt }
        : { startAt: gesture.startAt, endAt: Math.max(gesture.startAt + 15 * 60_000, gesture.endAt + delta) };
    };
    const move = (pointerEvent: PointerEvent) => {
      const next = resolve(pointerEvent.clientY);
      setGesturePreview({
        itemId: item.id,
        title: item.title,
        ...next,
        layer: layerFor(item),
      });
    };
    const up = (pointerEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const next = resolve(pointerEvent.clientY);
      setResizeGesture(null);
      setGesturePreview(null);
      if (next.startAt !== item.startAt || next.endAt !== item.endAt) {
        void commitWorkGesture(item, next.startAt, next.endAt);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }

  // Beside an open work the week narrows to a few days around what was opened,
  // and widens back when the Side closes.
  const openedOn = useRef<number | undefined>(undefined);
  const wideSpan = useRef<number | null>(null);

  function openWork(workId: string) {
    setOpened(null);
    // Work opens in the Side (SHELL.md); its "Open full" goes on to Library.
    void spectraBus.command("work.open", { workId });
  }

  function openItem(item: CalendarItem, from?: HTMLElement) {
    openedOn.current = item.startAt;
    // Every task opens as its work in the Side, a block of time for it too;
    // a block's own actions (length, done, remove) are a right-click away.
    const workId = planWorkId(item);
    if (workId) {
      openWork(workId);
      return;
    }
    taskPeek.close();
    // A school deadline opens as its task work, made now if sync has not made it.
    const recordId = recordOf(item);
    if (recordId) {
      void schoolTask.workOf(recordId).then((planner) => (planner ? openWork(planner) : showDetails(item, from)));
      return;
    }
    showDetails(item, from);
  }

  function showDetails(item: CalendarItem, from?: HTMLElement) {
    if (from) setOpened({ item, anchor: from.getBoundingClientRect() });
  }

  function jumpTo(date: Date) {
    const start = startOfLocalDay(date);
    const nextDays = daysAround(start);
    setDays(nextDays);
    setFocusedStart(start);
    scrollWeekRef.current = start;
    void load("replace", nextDays[0]!, endOfLocalDay(nextDays[nextDays.length - 1]!));
  }

  /** Sets how many days show; `around` keeps that day in view, one day in from the left. */
  const changeDaySpan = useCallback((next: number, around?: number) => {
    const span = Math.max(MIN_DAYS, Math.min(MAX_DAYS, next));
    if (span === daySpanRef.current) return;
    setDaySpanState(span);
    const scroller = scrollerRef.current;
    const anchor = around === undefined ? -1 : daysRef.current.indexOf(startOfLocalDay(around));
    const index = anchor >= 0 ? Math.max(0, anchor - (span > 1 ? 1 : 0)) : daysRef.current.findIndex((day) => day === focusedStartRef.current);
    // The resize that follows realigns on the focused day, so it must already be the new one.
    const start = daysRef.current[index];
    if (start !== undefined) {
      focusedStartRef.current = start;
      setFocusedStart(start);
    }
    requestAnimationFrame(() => {
      if (!scroller) return;
      const width = fitDayWidth(scroller, span);
      dayWidthRef.current = width;
      if (index >= 0) scroller.scrollLeft = index * width;
    });
  }, []);

  useEffect(
    () =>
      spectraBus.subscribe("side.open", () => {
        const open = Boolean(spectraBus.getQuery("side.open"));
        if (open && wideSpan.current === null && daySpanRef.current > BESIDE_SIDE_DAYS) {
          wideSpan.current = daySpanRef.current;
          // Narrow around what was opened here; something opened from
          // elsewhere (a thread, a search) keeps today in view when it shows.
          const today = startOfLocalDay(Date.now());
          const first = focusedStartRef.current;
          const todayShows = today >= first && today < addLocalDays(first, daySpanRef.current);
          changeDaySpan(BESIDE_SIDE_DAYS, openedOn.current ?? (todayShows ? today : undefined));
          openedOn.current = undefined;
        } else if (!open && wideSpan.current !== null) {
          changeDaySpan(wideSpan.current);
          wideSpan.current = null;
        }
      }),
    [changeDaySpan],
  );

  async function extendDays(direction: "before" | "after") {
    if (loadLockRef.current) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const current = daysRef.current;
    const edge =
      direction === "before"
        ? addLocalDays(current[0]!, -EXTEND_DAYS)
        : addLocalDays(current[current.length - 1]!, 1);
    const incoming = Array.from({ length: EXTEND_DAYS }, (_, index) =>
      addLocalDays(edge, index),
    );
    loadLockRef.current = true;
    const dayWidth = dayWidthRef.current;
    const overflow = current.length + incoming.length - MAX_LOADED_DAYS;
    const trimmed = overflow > 0 ? overflow : 0;
    setDays((existing) => {
      const next =
        direction === "before" ? [...incoming, ...existing] : [...existing, ...incoming];
      return next.length > MAX_LOADED_DAYS
        ? direction === "before"
          ? next.slice(0, MAX_LOADED_DAYS)
          : next.slice(next.length - MAX_LOADED_DAYS)
        : next;
    });
    try {
      await load(
        "merge",
        incoming[0]!,
        endOfLocalDay(incoming[incoming.length - 1]!),
      );
      ignoreScrollRef.current = true;
      requestAnimationFrame(() => {
        if (direction === "before") scroller.scrollLeft += incoming.length * dayWidth;
        else if (trimmed > 0) scroller.scrollLeft -= trimmed * dayWidth;
        requestAnimationFrame(() => {
          ignoreScrollRef.current = false;
          // A scroll made while the days were added still moves the range named above.
          onScrollerScroll();
        });
      });
    } finally {
      loadLockRef.current = false;
    }
  }

  function onScrollerScroll() {
    setOpened(null);
    const scroller = scrollerRef.current;
    if (!scroller || ignoreScrollRef.current) return;
    const width = dayWidthRef.current || 140;
    const index = Math.max(
      0,
      Math.min(daysRef.current.length - 1, Math.round(scroller.scrollLeft / width)),
    );
    const next = daysRef.current[index];
    if (next !== undefined && next !== focusedStart) setFocusedStart(next);
    if (scroller.scrollLeft < SCROLL_LOAD_PX) void extendDays("before");
    if (scroller.scrollWidth - scroller.scrollLeft - scroller.clientWidth < SCROLL_LOAD_PX)
      void extendDays("after");
  }

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || still) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomAccumRef.current += event.deltaY;
      if (Math.abs(zoomAccumRef.current) < 70) return;
      const direction = zoomAccumRef.current > 0 ? 1 : -1;
      zoomAccumRef.current = 0;
      changeDaySpan(daySpanRef.current + direction);
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [changeDaySpan, error, overview, still]);

  const commands: BarCommand[] = [
    { id: "add", icon: "add", label: "Add", pinned: true, onSelect: () => setComposerOpen(true) },
    {
      id: "layers",
      icon: "layers",
      label: "Layers",
      active: layersOpen,
      onSelect: () => setLayersOpen((open) => !open),
    },
    {
      id: "refresh",
      icon: "retry",
      label: "Refresh calendar",
      labelPolicy: "never",
      disabled: refreshing,
      onSelect: () => void load("merge", visibleRange.from, visibleRange.to, true),
    },
  ];

  return (
    <div className="spectra-wave-y relative flex h-full min-h-0 overflow-hidden text-[var(--text-primary)]">
      <div className="spectra-calendar-page flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-spectra-app-surface="true">
        <div className="shrink-0 px-4 pb-3 pt-5 sm:px-6 lg:px-8 page-title-lane">
          <PageHeader title="Calendar" commands={commands} plan={CALENDAR_BAR_PLAN} barLabel="Calendar commands" />
          <div className="spectra-calendar-toolbar mt-4">
            <div className="spectra-calendar-week-nav">
              <IconButton icon="chevronLeft" label="Previous range" onClick={() => jumpTo(new Date(addLocalDays(focusedStart, -daySpan)))} />
              <CalendarDatePicker value={focusedStart} label={formatRange(focusedStart, daySpan)} onChange={(date) => jumpTo(date)} />
              <IconButton icon="chevronRight" label="Next range" onClick={() => jumpTo(new Date(addLocalDays(focusedStart, daySpan)))} />
              <Button variant="ghost" size="sm" onClick={() => jumpTo(new Date())}>
                Today
              </Button>
            </div>
            <div className="spectra-calendar-zoom">
              <IconButton icon="zoomOut" label="Show more days" disabled={daySpan >= MAX_DAYS} onClick={() => changeDaySpan(daySpan + 1)} />
              <span className="spectra-calendar-zoom-label">
                {daySpan} {daySpan === 1 ? "day" : "days"}
              </span>
              <IconButton icon="zoomIn" label="Show fewer days" disabled={daySpan <= MIN_DAYS} onClick={() => changeDaySpan(daySpan - 1)} />
            </div>
          </div>
          {continuation && !error ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-caption text-[var(--text-secondary)]" role="status">
              <span>Calendar is partly loaded.</span>
              <Button variant="secondary" size="sm" disabled={refreshing} onClick={() => void load("merge", continuation.from, continuation.to, true, continuation)}>
                {refreshing ? "Loading more…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </div>

        <section className="relative min-h-0 min-w-0 flex-1">
          {layersOpen ? (
            <aside
              className="absolute right-4 top-1 z-dropdown w-[240px] rounded-card border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 shadow-[var(--shadow-lg)] sm:right-6 lg:right-8"
              aria-label="Calendar layers"
            >
              <div className="flex items-center justify-between gap-2 pb-1 pl-2">
                <span className="text-caption font-medium text-[var(--text-secondary)]">Layers</span>
                <IconButton icon="close" label="Close layers" size="compact" onClick={() => setLayersOpen(false)} />
              </div>
              {CALENDAR_LAYERS.filter((layer) => layer.key !== "shared").map((layer) => (
                <label
                  key={layer.key}
                  className="flex cursor-pointer items-center gap-2.5 rounded-control px-2 py-1.5 text-caption hover:bg-[var(--bg-hover)]"
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--text-primary)]"
                    checked={visibleLayers.has(layer.key)}
                    onChange={() =>
                      setVisibleLayers((current) => {
                        const next = new Set(current);
                        if (next.has(layer.key)) next.delete(layer.key);
                        else next.add(layer.key);
                        return next;
                      })
                    }
                  />
                  <span className="h-3 w-[3px] rounded-full" style={{ background: layer.color }} />
                  <span className="flex-1">{layer.label}</span>
                </label>
              ))}
            </aside>
          ) : null}

          {error && needsSchool ? (
            <div className="p-4">
              <ProductEmptyState
                icon={School}
                title="Join your school to see your calendar"
                detail="You are signed in, but not part of a school in Spectra yet. Open the invitation your school sent you, or ask a teacher or your school's Spectra administrator to invite you."
                action={
                  <Button variant="primary" size="sm" asChild>
                    <Link href="/join">Open my invitation</Link>
                  </Button>
                }
              />
            </div>
          ) : error ? (
            <div className="p-4">
              <ProductErrorState
                title="Calendar could not be loaded"
                detail={error}
                action={
                  <Button variant="primary" size="sm" onClick={() => void load("replace", visibleRange.from, visibleRange.to, true)}>
                    Try again
                  </Button>
                }
              />
            </div>
          ) : (
            <div ref={scrollerRef} className="spectra-calendar-scroll" onScroll={onScrollerScroll}>
              {/* The week appears with what is in it, never empty first and filled after. */}
              {days.length && overview ? (
                <WeekGrid
                  days={days}
                  timezone={timezone}
                  timedItems={timedItems}
                  dayItems={dayItems}
                  gesturePreview={gesturePreview}
                  pendingItemIds={pendingItemIds}
                  resizeGesture={Boolean(resizeGesture)}
                  onPreview={previewDrop}
                  onDrop={dropOnDay}
                  onDropAllDay={dropOnAllDay}
                  onOpen={openItem}
                  onDetails={(item, from) => {
                    taskPeek.close();
                    showDetails(item, from);
                  }}
                  onRest={taskPeek.rest}
                  merge={mergeTarget}
                  planOf={planOfDeadline}
                  schoolClassOf={schoolClassOf}
                  lessonInkOf={lessonInkOf}
                  onPlanDragStart={beginPlanDrag}
                  onBlockDragStart={(item, offset) => {
                    dragRef.current = { type: "block", item, grabOffsetMinutes: offset };
                  }}
                  onBlockDragEnd={() => {
                    dragRef.current = null;
                    setGesturePreview(null);
                  }}
                  onResizeStart={beginResize}
                />
              ) : (
                <CalendarWeekGhost span={daySpan} />
              )}
            </div>
          )}
        </section>

        <CalendarComposer
          open={composerOpen}
          onClose={() => setComposerOpen(false)}
          onCreate={async (draft) => {
            await calendarPost({ action: "createPersonalItem", ...draft, timezone });
            setComposerOpen(false);
            firstTipMoment("task");
            void load("merge", visibleRange.from, visibleRange.to, true);
          }}
        />
      </div>

      {taskPeek.peek ? (
        <TaskPeek
          key={taskPeek.peek.item.id}
          anchor={taskPeek.peek.anchor}
          resolveWork={() => {
            const item = taskPeek.peek!.item;
            const workId = planWorkId(item);
            const recordId = recordOf(item);
            return workId ? Promise.resolve(workId) : recordId ? schoolTask.workOf(recordId) : Promise.resolve(null);
          }}
          onOpenFull={(workId) => {
            taskPeek.close();
            openWork(workId);
          }}
          onPointerEnter={taskPeek.hold}
          onPointerLeave={taskPeek.release}
          onClose={taskPeek.close}
        />
      ) : null}

      <CalendarItemCard
        opened={opened}
        schoolClass={opened ? schoolClassOf(opened.item) : null}
        timezone={timezone}
        onCommit={commit}
        onRemove={removeItem}
        onMerge={mergeBack}
        onClose={() => setOpened(null)}
      />
    </div>
  );
}

const CALENDAR_BAR_PLAN = [{ hideLabel: "layers" }, { toMenu: "refresh" }, { toMenu: "layers" }] as const;

/** While the week loads: its days as ghosts, so it opens with what is in it rather than empty. */
function CalendarWeekGhost({ span }: { span: number }) {
  return (
    <div className="spectra-calendar-ghost" role="status" aria-label="Loading the week" style={{ ["--ghost-days" as string]: span }}>
      {Array.from({ length: span }, (_, day) => (
        <div key={day} data-life-ghost className="spectra-calendar-ghost-day">
          <Skeleton bar className="h-4 w-1/3" />
          <Skeleton bar className="h-6 w-2/3" />
          {day % 2 ? <Skeleton bar className="mt-16 h-6 w-full" /> : <Skeleton bar className="mt-28 h-6 w-4/5" />}
        </div>
      ))}
    </div>
  );
}

/**
 * A deadline the block of time dragged out of it can be dropped back on: the
 * block goes, and the task is whole again. `accepts` says whether the block
 * being dragged is one of its own.
 */
type MergeTarget = { accepts: () => boolean; onMerge: () => void };

function mergeHandlers(target: MergeTarget, onOver?: (over: boolean) => void) {
  return {
    onDragOver(event: React.DragEvent<HTMLElement>) {
      if (!target.accepts()) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      onOver?.(true);
    },
    onDragLeave() {
      onOver?.(false);
    },
    onDrop(event: React.DragEvent<HTMLElement>) {
      onOver?.(false);
      if (!target.accepts()) return;
      event.preventDefault();
      event.stopPropagation();
      target.onMerge();
    },
  };
}

function WeekGrid({
  days,
  timezone,
  timedItems,
  dayItems,
  gesturePreview,
  pendingItemIds,
  resizeGesture,
  onPreview,
  onDrop,
  onDropAllDay,
  onOpen,
  onDetails,
  onRest,
  merge,
  planOf,
  schoolClassOf,
  lessonInkOf,
  onPlanDragStart,
  onBlockDragStart,
  onBlockDragEnd,
  onResizeStart,
}: {
  days: number[];
  timezone: string;
  timedItems: CalendarItem[];
  dayItems: CalendarItem[];
  gesturePreview: GesturePreview | null;
  pendingItemIds: Set<string>;
  resizeGesture: boolean;
  onPreview: (event: React.DragEvent<HTMLDivElement>, day: Date) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>, day: Date) => void;
  onDropAllDay: (event: React.DragEvent<HTMLDivElement>, day: Date) => void;
  onOpen: (item: CalendarItem, from: HTMLElement) => void;
  /** Its details and actions, on a right-click. */
  onDetails: (item: CalendarItem, from: HTMLElement) => void;
  /** The pointer rests on an item (its element), or leaves it (null): a task opens beside it. */
  onRest: (item: CalendarItem, element: HTMLElement | null) => void;
  /** How a deadline takes back the time given to it when that block is dropped on it. */
  merge: (item: CalendarItem) => MergeTarget;
  /** The plan a deadline's task has, which dragging the deadline places. */
  planOf: (item: CalendarItem) => CalendarItem | undefined;
  schoolClassOf: (item: CalendarItem) => DeadlineClass | null;
  lessonInkOf: (item: CalendarItem) => string | undefined;
  onPlanDragStart: (plan: CalendarItem) => void;
  onBlockDragStart: (item: CalendarItem, grabOffsetMinutes: number) => void;
  onBlockDragEnd: () => void;
  onResizeStart: (
    event: React.PointerEvent<HTMLSpanElement>,
    item: CalendarItem,
    edge: "start" | "end",
  ) => void;
}) {
  const dayDates = days.map((stamp) => new Date(stamp));
  const now = Date.now();
  const hoursHeight = HOURS * HOUR_PX;
  const first = dayDates[0];
  return (
    <article className="spectra-calendar-week">
      <div
        className="spectra-calendar-grid"
        style={{ ["--loaded-days" as string]: String(days.length) }}
      >
        <div className="spectra-calendar-gutter spectra-calendar-week-caption">
          {first
            ? new Intl.DateTimeFormat(undefined, { month: "short" }).format(first)
            : null}
        </div>
        {dayDates.map((day) => {
          const today = localDayKey(day.getTime()) === zonedDayKey(now, timezone);
          return (
            <div
              key={day.toISOString()}
              className={cn("spectra-calendar-day-head", today && "is-today")}
            >
              <span>{new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(day)}</span>
              <strong>{day.getDate()}</strong>
            </div>
          );
        })}
        <div className="spectra-calendar-gutter spectra-calendar-allday-label" />
        {dayDates.map((day) => {
          const items = dayItems.filter(
            (item) => item.startAt !== undefined && zonedDayKey(item.startAt, timezone) === localDayKey(day.getTime()),
          );
          return (
            <div
              key={`${day.toISOString()}-allday`}
              className="spectra-calendar-allday-cell"
              data-life-receive
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDropAllDay(event, day)}
            >
              {items.map((item) => {
                const layer = CALENDAR_LAYERS.find((candidate) => candidate.key === layerFor(item))!;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.title}
                    data-life-launch
                    onClick={(event) => onOpen(item, event.currentTarget)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onDetails(item, event.currentTarget);
                    }}
                    onPointerEnter={(event) => onRest(item, event.currentTarget)}
                    onPointerLeave={() => onRest(item, null)}
                    {...mergeHandlers(merge(item))}
                    draggable={isReschedulable(item) && !pendingItemIds.has(item.id)}
                    onDragStart={() => onBlockDragStart(item, 0)}
                    onDragEnd={onBlockDragEnd}
                    className="spectra-calendar-chip"
                    style={{ boxShadow: `inset 3px 0 0 ${layer.color}` }}
                  >
                    {item.title}
                  </button>
                );
              })}
            </div>
          );
        })}
        <div className="spectra-calendar-gutter relative" style={{ height: hoursHeight }} data-calendar-hours>
          {Array.from({ length: HOURS }, (_, hour) =>
            hour === 0 ? null : (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-micro tabular-nums text-[var(--text-tertiary)]"
                style={{ top: hour * HOUR_PX }}
              >
                {String(hour).padStart(2, "0")}:00
              </span>
            ),
          )}
        </div>
        {dayDates.map((day) => {
          const columnItems = timedItems.filter(
            (item) => item.startAt !== undefined && zonedDayKey(item.startAt, timezone) === localDayKey(day.getTime()),
          );
          const lanes = layoutTimedLanes(
            columnItems.map((item) => ({
              id: item.id,
              start: item.startAt!,
              end: item.startAt! + timedBlockDuration(item),
            })),
          );
          const preview =
            gesturePreview && zonedDayKey(gesturePreview.startAt, timezone) === localDayKey(day.getTime())
              ? gesturePreview
              : null;
          const today = localDayKey(day.getTime()) === zonedDayKey(now, timezone);
          const nowTop = today ? (minutesOnDay(now, timezone) / 60) * HOUR_PX : null;
          return (
            <div
              key={`${day.toISOString()}-hours`}
              onDragOver={(event) => onPreview(event, day)}
              onDrop={(event) => onDrop(event, day)}
              data-life-receive
              // Its own stacking context: blocks layer within their day and pass under the hour gutter.
              className="relative isolate border-r border-[var(--border-subtle)] last:border-r-0"
              style={{ height: hoursHeight }}
            >
              {Array.from({ length: HOURS }, (_, hour) => (
                <div
                  key={hour}
                  className="absolute inset-x-0 border-t border-[color-mix(in_oklab,var(--border-subtle)_60%,transparent)]"
                  style={{ top: hour * HOUR_PX }}
                />
              ))}
              {nowTop !== null ? (
                <span
                  aria-hidden
                  className="spectra-calendar-now pointer-events-none absolute inset-x-0 z-chrome h-px"
                  style={{ top: nowTop }}
                />
              ) : null}
              {preview ? <PreviewBlock preview={preview} timezone={timezone} /> : null}
              {columnItems.map((item) => {
                const plan = resizeGesture ? undefined : planOf(item);
                return (
                  <TimedBlock
                    key={item.id}
                    item={item}
                    schoolClass={schoolClassOf(item)}
                    lessonInk={lessonInkOf(item)}
                    lane={lanes.get(item.id) ?? { lane: 0, lanes: 1 }}
                    timezone={timezone}
                    previewing={gesturePreview?.itemId === item.id}
                    pending={pendingItemIds.has(item.id)}
                    canMove={isReschedulable(item) && !pendingItemIds.has(item.id) && !resizeGesture}
                    givesTime={Boolean(plan)}
                    merge={merge(item)}
                    onOpen={(from) => onOpen(item, from)}
                    onDetails={(from) => onDetails(item, from)}
                    onRest={(element) => onRest(item, element)}
                    onDragStart={(offset) => (plan ? onPlanDragStart(plan) : onBlockDragStart(item, offset))}
                    onDragEnd={onBlockDragEnd}
                    onResizeStart={(event, edge) => onResizeStart(event, item, edge)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </article>
  );
}

function PreviewBlock({
  preview,
  timezone,
}: {
  preview: GesturePreview;
  timezone: string;
}) {
  const layer = CALENDAR_LAYERS.find((candidate) => candidate.key === preview.layer)!;
  const top = (minutesOnDay(preview.startAt, timezone) / 60) * HOUR_PX;
  const height = Math.max(24, ((preview.endAt - preview.startAt) / HOUR) * HOUR_PX);
  return (
    <div
      className="pointer-events-none absolute inset-x-1 z-chrome overflow-hidden rounded-lg border-2 border-dashed px-2 py-1.5 text-left shadow-lg"
      style={{
        top,
        height,
        borderColor: layer.color,
        background: `color-mix(in oklab, ${layer.color} 20%, var(--bg-elevated))`,
        color: layer.color,
      }}
    >
      <span className="block text-micro font-bold">
        {formatTime(preview.startAt, timezone)} – {formatTime(preview.endAt, timezone)}
      </span>
      <span className="mt-0.5 block truncate text-micro font-semibold text-[var(--text-primary)]">
        {preview.title}
      </span>
    </div>
  );
}

/** How much of the grid a timed block covers: never less than 30 minutes. */
function timedBlockDuration(item: CalendarItem) {
  return Math.max(30 * 60_000, item.endAt! - item.startAt!);
}

function TimedBlock({
  item,
  schoolClass,
  lessonInk,
  lane,
  timezone,
  previewing,
  pending,
  canMove,
  givesTime,
  merge,
  onOpen,
  onDetails,
  onRest,
  onDragStart,
  onDragEnd,
  onResizeStart,
}: {
  item: CalendarItem;
  /** The class a deadline, or time given to it, belongs to, when School knows it. */
  schoolClass: DeadlineClass | null;
  /** The ink of the class a lesson is for. */
  lessonInk?: string;
  lane: TimedLane;
  timezone: string;
  previewing: boolean;
  pending: boolean;
  canMove: boolean;
  /** A deadline whose plan can be dragged out of it into the week. */
  givesTime: boolean;
  merge: MergeTarget;
  onOpen: (from: HTMLElement) => void;
  onDetails: (from: HTMLElement) => void;
  onRest: (element: HTMLElement | null) => void;
  onDragStart: (grabOffsetMinutes: number) => void;
  onDragEnd: () => void;
  onResizeStart: (
    event: React.PointerEvent<HTMLSpanElement>,
    edge: "start" | "end",
  ) => void;
}) {
  const layer = CALENDAR_LAYERS.find((candidate) => candidate.key === layerFor(item))!;
  const ref = useRef<HTMLButtonElement>(null);
  const placed = !item.id.startsWith("pending:");
  // A new event forms where it was placed; a removed one parts there.
  useLifeArrival(ref, placed ? item.id : undefined, "human");
  useLifeDeparture(ref, placed, undefined, placed ? item.id : undefined);
  const top = (minutesOnDay(item.startAt!, timezone) / 60) * HOUR_PX;
  const duration = timedBlockDuration(item);
  const height = Math.max(24, (duration / HOUR) * HOUR_PX);
  // Blocks sharing time sit side by side, so each one stays clickable.
  const laneWidth = 100 / lane.lanes;
  const ink = schoolClass?.identity?.ink ?? lessonInk ?? layer.color;
  /* A deadline is a moment, so it is a pin: when it is due and what, on one
     line in its class's ink. A short block keeps its title on one line too. */
  const due = isDeadline(item);
  const short = due || height < 40;
  const [merging, setMerging] = useState(false);
  return (
    <button
      ref={ref}
      {...mergeHandlers(merge, setMerging)}
      data-merge-target={merging || undefined}
      type="button"
      title={
        due
          ? `Due ${formatTime(item.startAt!, timezone)}: ${item.title}${givesTime ? ". Drag to give it time" : ""}`
          : `${formatTime(item.startAt!, timezone)}${item.endAt ? ` – ${formatTime(item.endAt, timezone)}` : ""}: ${item.title}${item.kind === "scheduled_work_block" ? `. Right-click to change or finish it${item.officialDeadlineItemId ? ", or drop it on its deadline to merge it back" : ""}` : ""}`
      }
      data-life-launch
      draggable={canMove || givesTime}
      onDragStart={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        onDragStart(Math.round((((event.clientY - bounds.top) / HOUR_PX) * 60) / 15) * 15);
      }}
      onDragEnd={onDragEnd}
      onClick={(event) => onOpen(event.currentTarget)}
      onContextMenu={(event) => {
        event.preventDefault();
        onDetails(event.currentTarget);
      }}
      onPointerEnter={(event) => onRest(event.currentTarget)}
      onPointerLeave={() => onRest(null)}
      data-due={due || undefined}
      className={cn(
        "spectra-calendar-block group absolute z-chrome overflow-hidden text-left",
        short && "spectra-calendar-block--short",
        previewing && "opacity-25",
        pending && "animate-pulse",
      )}
      style={{
        top,
        height: due ? 24 : height,
        left: `calc(${lane.lane * laneWidth}% + 4px)`,
        width: `calc(${laneWidth}% - 8px)`,
        ["--block-ink" as string]: ink,
      }}
    >
      {canMove && !due ? (
        <span
          role="presentation"
          onPointerDown={(event) => onResizeStart(event, "start")}
          className="absolute inset-x-1 top-0 z-chrome h-2 cursor-ns-resize rounded-t opacity-0 transition-opacity hover:bg-[var(--bg-hover)] group-hover:opacity-100"
        />
      ) : null}
      <span className="spectra-calendar-block-time">
        {formatTime(item.startAt!, timezone)}
        {item.endAt && !due && !short ? ` – ${formatTime(item.endAt, timezone)}` : ""}
        {item.sourceLocked && !short ? <LockKeyhole className="ml-1 inline size-2.5" /> : null}
      </span>
      <span className="spectra-calendar-block-title">{item.title}</span>
      {canMove && !due ? (
        <span
          role="presentation"
          onPointerDown={(event) => onResizeStart(event, "end")}
          className="absolute inset-x-1 bottom-0 z-chrome h-2 cursor-ns-resize rounded-b opacity-0 transition-opacity hover:bg-[var(--bg-hover)] group-hover:opacity-100"
        />
      ) : null}
    </button>
  );
}

