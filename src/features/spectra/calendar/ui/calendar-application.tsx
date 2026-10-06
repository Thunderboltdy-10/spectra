"use client";

import { ChevronLeft, ChevronRight, CheckCircle2, ExternalLink, Link2, LoaderCircle, LockKeyhole, Plus } from "@/components/icons/glyph-icons";
import { Icon } from "@/components/icons";
import type { BarCommand } from "@/components/ui/adaptive-bar";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, LoadingRows } from "@/components/ui/page-state";
import { PanelTabs, SidePanel } from "@/components/ui/side-panel";
import { plainText } from "../../../../../shared/semantic-chunks";
import { beginCreation, useLifeArrival, useLifeDeparture, useLifeLanding } from "../../life/use-life";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { uniqueToken } from "@/lib/unique-token";
import { describeFailure } from "@/components/ui/truthful-state";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProductErrorState } from "../../components/product-state";
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
  defaultLocalEventTimes,
} from "../domain/local-days";
import { requestSpectra } from "../../data/request";
import { layoutTimedLanes, type TimedLane } from "../domain/timed-lanes";

const HOUR = 60 * 60_000;
const HOUR_PX = 48;
const WORKDAY_START_HOUR = 7;
const HOURS = 24;
const MIN_DAYS = 1;
const MAX_DAYS = 10;
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

function daysAround(center: number) {
  return localDaysAround(center, EXTEND_DAYS, EXTEND_DAYS * 2);
}

function formatTime(value: number, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(value);
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
  const startLabel = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
  }).format(start);
  const endLabel = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(end);
  return `${startLabel} · ${endLabel}`;
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
            {level === "years" ? `${years[0]} · ${years[years.length - 1]}` : `${MONTHS[month]} ${year}`}
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
                  entry === year && "bg-[var(--text-primary)] text-[var(--bg-primary)]",
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
                  index === month && "bg-[var(--text-primary)] text-[var(--bg-primary)]",
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
            <div className="spectra-calendar-date-grid mb-1 text-micro font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
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

function planSubtitle(item: CalendarItem) {
  const notes = item.notes?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (notes && notes.length <= 48 && !notes.includes("**")) return notes;
  return "Plan";
}

function layerFor(item: CalendarItem): CalendarLayerKey {
  if (item.kind === "official_event") return "classes";
  if (item.kind === "official_deadline") return "deadlines";
  if (item.kind === "scheduled_work_block") return "work";
  if (item.kind === "personal_event") return "personal";
  return "tasks";
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

/** The owner's own work blocks and personal events move and resize; official
    and imported source events do not (the server enforces the same rule). */
function isReschedulable(item: CalendarItem) {
  return (
    item.kind === "scheduled_work_block" ||
    (item.kind === "personal_event" && !item.sourceLocked)
  );
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

function planWorkId(item: CalendarItem) {
  return item.planArtifactId || (item.planTaskId ? item.linkedWorkIds[0] : undefined);
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

export function CalendarApplication() {
  const initialStart = startOfLocalWeek(Date.now());
  const [daySpan, setDaySpanState] = useState(7);
  const [days, setDays] = useState(() => daysAround(initialStart));
  const [focusedStart, setFocusedStart] = useState(initialStart);
  const [overview, setOverview] = useState<CalendarOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [continuation, setContinuation] = useState<CalendarContinuation | null>(null);
  const overviewRequestRef = useRef<AbortController | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState<Set<CalendarLayerKey>>(
    () => new Set(CALENDAR_LAYERS.map((layer) => layer.key)),
  );
  const [sideTab, setSideTab] = useState<"plans" | "details">("plans");
  const [reveal, setReveal] = useState(0);
  const [layersOpen, setLayersOpen] = useState(false);
  const [planQuery, setPlanQuery] = useState("");
  const [draggingPlanId, setDraggingPlanId] = useState<string>();
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
        setError(
          describeFailure(nextError, {
            fallback: "Check your connection, then try loading Calendar again.",
          }).message,
        );
      } finally {
        if (overviewRequestRef.current === request) {
          overviewRequestRef.current = null;
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [applyOverview, continuation, visibleRange.from, visibleRange.to],
  );
  loadRef.current = load;

  useEffect(() => () => overviewRequestRef.current?.abort(), []);

  useEffect(() => {
    let cancelled = false;
    void calendarPost({ action: "ensureMigration" })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) void loadRef.current("replace");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (overview?.sourceState.kind !== "stale" || staleSyncRef.current) return;
    staleSyncRef.current = true;
    void syncSpectraManageBac()
      .then(() => load("merge", visibleRange.from, visibleRange.to))
      .catch(() => {
        staleSyncRef.current = false;
      });
  }, [load, overview?.sourceState.kind, visibleRange.from, visibleRange.to]);

  useEffect(() => {
    const target = scrollWeekRef.current;
    const scroller = scrollerRef.current;
    if (target === null || !scroller) return;
    const index = days.findIndex((day) => day === target);
    if (index < 0) return;
    ignoreScrollRef.current = true;
    scroller.scrollLeft = index * dayWidthRef.current;
    scrollWeekRef.current = null;
    window.requestAnimationFrame(() => {
      ignoreScrollRef.current = false;
    });
  }, [days, overview, daySpan]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () => {
      const width = Math.max(88, (scroller.clientWidth - 54) / daySpanRef.current);
      const previous = dayWidthRef.current;
      dayWidthRef.current = width;
      scroller.style.setProperty("--day-width", `${width}px`);
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
  }, [daySpan, days.length, error]);

  // The grid opens on working hours (SHELL.md): 07:00 just under the day heads.
  const openedOnHoursRef = useRef(false);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (openedOnHoursRef.current || !scroller || !overview) return;
    const hours = scroller.querySelector<HTMLElement>("[data-calendar-hours]");
    const head = scroller.querySelector<HTMLElement>(".spectra-calendar-day-head");
    if (!hours) return;
    openedOnHoursRef.current = true;
    const hoursTop = hours.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTop = Math.max(0, hoursTop + WORKDAY_START_HOUR * HOUR_PX - (head?.offsetHeight ?? 0) - 8);
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
  const unscheduledPlans = useMemo(
    () =>
      (overview?.unscheduledTasks ?? []).filter(
        (item) =>
          Boolean(item.planArtifactId) &&
          item.title.toLocaleLowerCase().includes(planQuery.trim().toLocaleLowerCase()),
      ),
    [overview?.unscheduledTasks, planQuery],
  );

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
        setSelected((current) => (current?.id === nextItem.id ? nextItem : current));
      } else {
        await load("merge", visibleRange.from, visibleRange.to, true);
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Calendar action failed.";
      if (isGestureConflict(nextError)) {
        setSelected(null);
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
    setSelected(null);
    // A removed work block returns its plan to the unscheduled list.
    if (item.kind === "scheduled_work_block")
      void load("merge", visibleRange.from, visibleRange.to);
    return true;
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

  function resolveDrop(event: React.DragEvent<HTMLDivElement>, day: Date) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    const cursorMinutes = ratio * HOURS * 60;
    const minutes = Math.max(
      0,
      Math.min(
        HOURS * 60 - 15,
        Math.round((cursorMinutes - (dragRef.current?.grabOffsetMinutes ?? 0)) / 15) * 15,
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
    setDraggingPlanId(undefined);
    setGesturePreview(null);
    if (!payload) return;
    const startAt = resolveDrop(event, day);
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

  function previewDrop(event: React.DragEvent<HTMLDivElement>, day: Date) {
    event.preventDefault();
    const payload = dragRef.current;
    if (!payload) return;
    const startAt = resolveDrop(event, day);
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

  function openWork(workId: string) {
    setActivePlanId(workId);
    setSelected(null);
    // Work opens in the Side (SHELL.md); its "Open full" goes on to Library.
    void spectraBus.command("work.open", { workId });
  }

  function openItem(item: CalendarItem) {
    // A scheduled block has its own actions (duration, complete, remove); its
    // plan is one click away in the details. Only an unscheduled plan opens
    // straight into the plan.
    const workId = item.kind === "scheduled_work_block" ? undefined : planWorkId(item);
    if (workId) {
      openWork(workId);
      return;
    }
    setSelected(item);
    setSideTab("details");
    setReveal((count) => count + 1);
  }

  function jumpTo(date: Date) {
    const start = startOfLocalDay(date);
    const nextDays = daysAround(start);
    setDays(nextDays);
    setFocusedStart(start);
    scrollWeekRef.current = start;
    void load("replace", nextDays[0]!, endOfLocalDay(nextDays[nextDays.length - 1]!));
  }

  const changeDaySpan = useCallback((next: number) => {
    const span = Math.max(MIN_DAYS, Math.min(MAX_DAYS, next));
    if (span === daySpanRef.current) return;
    setDaySpanState(span);
    const scroller = scrollerRef.current;
    const index = daysRef.current.findIndex((day) => day === focusedStartRef.current);
    requestAnimationFrame(() => {
      if (!scroller) return;
      const width = Math.max(88, (scroller.clientWidth - 54) / span);
      dayWidthRef.current = width;
      scroller.style.setProperty("--day-width", `${width}px`);
      if (index >= 0) scroller.scrollLeft = index * width;
    });
  }, []);

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
        });
      });
    } finally {
      loadLockRef.current = false;
    }
  }

  function onScrollerScroll() {
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
    if (!scroller) return;
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
  }, [changeDaySpan, error, overview]);

  const commands: BarCommand[] = [
    { id: "add", icon: "add", label: "Add event", pinned: true, onSelect: () => setComposerOpen(true) },
    { id: "layers", icon: "layers", label: "Layers", active: layersOpen, onSelect: () => setLayersOpen((open) => !open) },
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
        <div className="shrink-0 px-4 pb-3 pt-5 sm:px-6 lg:px-8 lg:pt-7">
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

          {error ? (
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
              {days.length ? (
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
                  onOpen={openItem}
                  onBlockDragStart={(item, offset) => {
                    dragRef.current = { type: "block", item, grabOffsetMinutes: offset };
                  }}
                  onBlockDragEnd={() => {
                    dragRef.current = null;
                    setGesturePreview(null);
                  }}
                  onResizeStart={beginResize}
                />
              ) : null}
            </div>
          )}
        </section>

        <CalendarComposer
          open={composerOpen}
          timezone={timezone}
          onClose={() => setComposerOpen(false)}
          onCreated={() => {
            setComposerOpen(false);
            void load("merge", visibleRange.from, visibleRange.to, true);
          }}
        />
      </div>

      <SidePanel
        id="calendar.plans"
        title="Plans"
        icon="checklist"
        stageMin={640}
        revealKey={reveal || null}
        header={
          <PanelTabs
            label="Calendar side"
            tabs={[
              { id: "plans", label: "Plans", icon: "checklist" },
              { id: "details", label: "Details", icon: "info" },
            ]}
            value={sideTab}
            onChange={(id) => setSideTab(id as "plans" | "details")}
          />
        }
      >
        {sideTab === "plans" ? (
          <div data-life-receive className="min-w-0">
            <Input value={planQuery} onChange={(event) => setPlanQuery(event.target.value)} placeholder="Find a plan" aria-label="Find a plan" />
            <p className="px-1 pb-1 pt-3 text-caption text-[var(--text-tertiary)]">Drag a plan onto a day to give it time.</p>
            {loading ? (
              <LoadingRows label="Loading plans" count={4} />
            ) : error ? (
              <p className="px-1 py-3 text-caption leading-5 text-[var(--text-secondary)]">Plans could not be read just now.</p>
            ) : !unscheduledPlans.length ? (
              <p className="px-1 py-3 text-caption leading-5 text-[var(--text-secondary)]">
                {continuation?.cursors.planner
                  ? "Load more to finish checking plans."
                  : planQuery
                    ? `No plans match “${planQuery}”.`
                    : "Every plan has its time. New plans from Library show up here."}
              </p>
            ) : (
              <ul className="-mx-1.5 space-y-0.5">
                {unscheduledPlans.map((item) => (
                  <PlanRow
                    key={item.id}
                    item={item}
                    active={Boolean(activePlanId && planWorkId(item) === activePlanId)}
                    dragging={draggingPlanId === item.id}
                    onOpen={() => openItem(item)}
                    onDragStart={() => {
                      setDraggingPlanId(item.id);
                      dragRef.current = { type: "plan", item, grabOffsetMinutes: 0 };
                    }}
                    onDragEnd={() => {
                      setDraggingPlanId(undefined);
                      dragRef.current = null;
                      setGesturePreview(null);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        ) : selected ? (
          <CalendarItemDetails key={selected.id} item={selected} timezone={timezone} onCommit={commit} onRemove={removeItem} />
        ) : (
          <EmptyState compact icon="info" title="Nothing chosen" detail="Choose an event or a block of work to see its details." />
        )}
      </SidePanel>
    </div>
  );
}

const CALENDAR_BAR_PLAN = [{ hideLabel: "layers" }, { toMenu: "refresh" }, { toMenu: "layers" }] as const;

/** An unscheduled plan: open it, or drag it onto a day. */
function PlanRow({
  item,
  active,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  item: CalendarItem;
  active: boolean;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useLifeArrival(ref, item.id, "human");
  const subtitle = planSubtitle(item);
  return (
    <li
      ref={ref}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", item.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn("group", dragging && "opacity-40")}
    >
      <button
        type="button"
        data-life-launch
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-control px-2 py-2 text-left outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] aria-[current=true]:bg-[var(--bg-hover)]"
      >
        <Icon name="task" size={16} accent="var(--accent-gold)" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-medium text-[var(--text-primary)]">{item.title}</span>
          {subtitle ? <span className="block truncate text-caption text-[var(--text-tertiary)]">{subtitle}</span> : null}
        </span>
        <Icon name="grip" size={14} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    </li>
  );
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
  onOpen,
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
  onOpen: (item: CalendarItem) => void;
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
            <div key={`${day.toISOString()}-allday`} className="spectra-calendar-allday-cell" data-life-receive>
              {items.map((item) => {
                const layer = CALENDAR_LAYERS.find((candidate) => candidate.key === layerFor(item))!;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.title}
                    data-life-launch
                    onClick={() => onOpen(item)}
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
              className="relative border-r border-[var(--border-subtle)] last:border-r-0"
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
              {columnItems.map((item) => (
                <TimedBlock
                  key={item.id}
                  item={item}
                  lane={lanes.get(item.id) ?? { lane: 0, lanes: 1 }}
                  timezone={timezone}
                  previewing={gesturePreview?.itemId === item.id}
                  pending={pendingItemIds.has(item.id)}
                  canMove={isReschedulable(item) && !pendingItemIds.has(item.id) && !resizeGesture}
                  onOpen={() => onOpen(item)}
                  onDragStart={(offset) => onBlockDragStart(item, offset)}
                  onDragEnd={onBlockDragEnd}
                  onResizeStart={(event, edge) => onResizeStart(event, item, edge)}
                />
              ))}
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
  lane,
  timezone,
  previewing,
  pending,
  canMove,
  onOpen,
  onDragStart,
  onDragEnd,
  onResizeStart,
}: {
  item: CalendarItem;
  lane: TimedLane;
  timezone: string;
  previewing: boolean;
  pending: boolean;
  canMove: boolean;
  onOpen: () => void;
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
  return (
    <button
      ref={ref}
      type="button"
      title={item.title}
      data-life-launch
      draggable={canMove}
      onDragStart={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        onDragStart(Math.round((((event.clientY - bounds.top) / HOUR_PX) * 60) / 15) * 15);
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cn(
        "group absolute z-chrome overflow-hidden rounded-control border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1 pl-2.5 pr-2 text-left transition-shadow hover:shadow-[var(--shadow-sm)]",
        previewing && "opacity-25",
        pending && "animate-pulse",
      )}
      style={{
        top,
        height,
        left: `calc(${lane.lane * laneWidth}% + 4px)`,
        width: `calc(${laneWidth}% - 8px)`,
        boxShadow: `inset 3px 0 0 ${layer.color}`,
      }}
    >
      {canMove ? (
        <span
          role="presentation"
          onPointerDown={(event) => onResizeStart(event, "start")}
          className="absolute inset-x-1 top-0 z-chrome h-2 cursor-ns-resize rounded-t opacity-0 transition-opacity hover:bg-[var(--bg-hover)] group-hover:opacity-100"
        />
      ) : null}
      <span className="flex items-center gap-1 text-micro tabular-nums text-[var(--text-secondary)]">
        <span className="truncate">
          {formatTime(item.startAt!, timezone)}
          {item.endAt ? ` – ${formatTime(item.endAt, timezone)}` : ""}
        </span>
        {item.sourceLocked ? <LockKeyhole className="size-2.5" /> : null}
      </span>
      <span className="block truncate text-caption font-medium text-[var(--text-primary)]">
        {item.title}
      </span>
      {canMove ? (
        <span
          role="presentation"
          onPointerDown={(event) => onResizeStart(event, "end")}
          className="absolute inset-x-1 bottom-0 z-chrome h-2 cursor-ns-resize rounded-b opacity-0 transition-opacity hover:bg-[var(--bg-hover)] group-hover:opacity-100"
        />
      ) : null}
    </button>
  );
}

function CalendarItemDetails({
  item,
  timezone,
  onCommit,
  onRemove,
}: {
  item: CalendarItem;
  timezone: string;
  onCommit: (action: Record<string, unknown>) => Promise<void>;
  onRemove: (item: CalendarItem) => Promise<boolean>;
}) {
  const layer = CALENDAR_LAYERS.find((candidate) => candidate.key === layerFor(item))!;
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // The block it was opened from grows into these details.
  useLifeLanding(ref, `calendar:${item.id}`);
  // School records belong to their source; everything a person placed here
  // (events, scheduled work) can be taken off again.
  const removable = !item.sourceLocked;
  // Notes can arrive as rich text from a plan or from ManageBac: read them as words.
  const notes = item.notes ? plainText(item.notes) : "";
  return (
    <div ref={ref} aria-label={`${item.title} details`} className="min-w-0 px-1 pb-4">
      <span className="inline-flex items-center gap-2 text-caption font-medium text-[var(--text-secondary)]">
        <span className="h-3 w-[3px] rounded-full" style={{ background: layer.color }} />
        {layer.label}
        {item.sourceLocked ? <LockKeyhole className="size-3" /> : null}
      </span>
      <h2 className="mt-2 text-title font-semibold leading-tight">{item.title}</h2>
      <dl className="mt-4 space-y-3 text-ui">
        <div>
          <dt className="text-caption text-[var(--text-tertiary)]">Time</dt>
          <dd className="mt-0.5">
            {item.allDay
              ? "All day"
              : item.startAt !== undefined
                ? `${formatTime(item.startAt, timezone)}${item.endAt !== undefined && item.endAt !== item.startAt ? ` – ${formatTime(item.endAt, timezone)}` : ""}`
                : "Date only"}
          </dd>
        </div>
        {item.location ? (
          <div>
            <dt className="text-caption text-[var(--text-tertiary)]">Location</dt>
            <dd className="mt-0.5">{item.location}</dd>
          </div>
        ) : null}
        {notes ? (
          <div>
            <dt className="text-caption text-[var(--text-tertiary)]">Notes</dt>
            <dd className="mt-0.5 whitespace-pre-wrap leading-5 text-[var(--text-secondary)]">{notes}</dd>
          </div>
        ) : null}
      </dl>
      {isReschedulable(item) && item.endAt !== undefined ? (
        <div className="mt-4">
          <p className="text-caption text-[var(--text-tertiary)]">Duration</p>
          <div className="mt-1.5 flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void onCommit({
                  action: "resizeWorkBlock",
                  itemId: item.id,
                  endAt: Math.max((item.startAt ?? 0) + 15 * 60_000, item.endAt! - 30 * 60_000),
                  expectedRevision: item.revision,
                })
              }
            >
              − 30 min
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void onCommit({
                  action: "resizeWorkBlock",
                  itemId: item.id,
                  endAt: item.endAt! + 30 * 60_000,
                  expectedRevision: item.revision,
                })
              }
            >
              + 30 min
            </Button>
          </div>
        </div>
      ) : null}
      <div className="mt-5 flex flex-col gap-2">
        {item.kind === "scheduled_work_block" ? (
          <Button
            variant="primary"
            size="sm"
            disabled={item.status === "completed"}
            onClick={() => void onCommit({ action: "completeWorkBlock", itemId: item.id, expectedRevision: item.revision })}
          >
            <CheckCircle2 className="size-3.5" />
            {item.status === "completed" ? "Completed" : "Mark complete"}
          </Button>
        ) : null}
        {item.linkedWorkIds.map((workId) => (
          <Button
            key={workId}
            variant="secondary"
            size="sm"
            data-life-launch
            onClick={() => void spectraBus.command("work.open", { workId })}
          >
            <Link2 className="size-3.5" />
            {workId === item.planArtifactId ? "Open plan" : "Open linked work"}
          </Button>
        ))}
        {removable ? (
          <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>
            Remove from Calendar
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmRemove}
        title={`Remove “${item.title}”?`}
        detail={
          item.kind === "scheduled_work_block"
            ? "The scheduled time is removed from Calendar. The plan itself is kept and can be placed again."
            : "This event is removed from your Calendar."
        }
        confirmLabel="Remove"
        destructive
        pending={removing}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          setRemoving(true);
          void onRemove(item).then((removed) => {
            setRemoving(false);
            if (!removed) setConfirmRemove(false);
          });
        }}
      />
      {item.source ? (
        <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
          <p className="flex items-center gap-2 text-caption font-medium">
            <LockKeyhole className="size-3.5" />
            From {item.source.provider}
          </p>
          <p className="mt-1 text-caption leading-5 text-[var(--text-secondary)]">
            {item.source.provider} sets the official time and deadline. Schedule your own work separately.
          </p>
          {item.source.url ? (
            <a
              href={item.source.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-caption font-medium underline underline-offset-2"
            >
              Open in {item.source.provider}
              <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CalendarComposer({
  open,
  timezone,
  onClose,
  onCreated,
}: {
  open: boolean;
  timezone: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [{ start, end }, setTimes] = useState(() => defaultLocalEventTimes(Date.now()));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setTimes(defaultLocalEventTimes(Date.now()));
  }, [open]);
  const startAt = Date.parse(start);
  const endAt = Date.parse(end);
  const endBeforeStart =
    Number.isFinite(startAt) && Number.isFinite(endAt) && endAt <= startAt;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-[460px] gap-0 p-5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (endBeforeStart) return;
            setBusy(true);
            // Dots gather at the press; the event grows out of them where it lands.
            const creation = beginCreation({ into: "item" });
            void calendarPost({
              action: "createPersonalItem",
              kind: "personal_event",
              title,
              startAt,
              endAt,
              timezone,
            })
              .then(() => {
                creation.land();
                onCreated();
              })
              .catch((error) => {
                creation.cancel();
                toast.error(error instanceof Error ? error.message : "Could not add event.");
              })
              .finally(() => setBusy(false));
          }}
        >
          <DialogTitle>Add personal event</DialogTitle>
          <label className="mt-5 block text-micro font-semibold">
            Title
            <input
              autoFocus
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-ui outline-none focus:border-[var(--brand-primary)]"
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-micro font-semibold">
              Starts
              <input
                type="datetime-local"
                required
                value={start}
                onChange={(event) => {
                  const start = event.target.value;
                  setTimes((current) => ({ ...current, start }));
                }}
                className="mt-1.5 h-10 w-full rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-micro"
              />
            </label>
            <label className="text-micro font-semibold">
              Ends
              <input
                type="datetime-local"
                required
                min={start}
                value={end}
                aria-invalid={endBeforeStart || undefined}
                onChange={(event) => {
                  const end = event.target.value;
                  setTimes((current) => ({ ...current, end }));
                }}
                className="mt-1.5 h-10 w-full rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-micro"
              />
            </label>
          </div>
          {endBeforeStart ? (
            <p role="alert" className="mt-2 text-micro text-[var(--danger)]">
              End must be after start.
            </p>
          ) : null}
          <DialogFooter className="mt-5">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={busy || !title.trim() || endBeforeStart}
            >
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Add event
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
