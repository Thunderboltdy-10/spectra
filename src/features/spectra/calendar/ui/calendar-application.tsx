"use client";

import dynamic from "next/dynamic";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Layers3,
  Link2,
  LoaderCircle,
  LockKeyhole,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProductErrorState } from "../../components/product-state";
import { ProductPageHeader } from "../../components/product-page-header";
import {
  StudioSplitPlaceholder,
  useArtifactStudioState,
} from "../../components/artifact-studio-shell";
import { StudioItemRail } from "../../components/studio-item-rail";
import { spectraBus } from "../../events";
import { getSpectraArtifact, syncSpectraManageBac, type SpectraArtifact } from "../../data/api";
import {
  CALENDAR_LAYERS,
  calendarItemFromWire,
  type CalendarItem,
  type CalendarLayerKey,
  type CalendarOverview,
} from "../domain/model";

const ArtifactStudio = dynamic(
  () =>
    import("../../components/artifact-studio").then((module) => module.ArtifactStudio),
  { loading: () => <StudioSplitPlaceholder /> },
);

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const HOUR_PX = 48;
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

function startOfWeek(value: Date | number) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

function startOfDayMs(value: Date | number) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result.getTime();
}

function weekStartMs(value: Date | number) {
  return startOfWeek(value).getTime();
}

function daysAround(center: number, before = EXTEND_DAYS, after = EXTEND_DAYS * 2) {
  return Array.from({ length: before + after + 1 }, (_, index) => center + (index - before) * DAY);
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
  const end = new Date(rangeStart + (span - 1) * DAY);
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
  const selected = startOfDayMs(value);
  const today = startOfDayMs(Date.now());
  const years = Array.from({ length: 21 }, (_, index) => year - 10 + index);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="spectra-calendar-week-label max-w-[16rem] rounded-[8px] px-2 py-1 text-left hover:bg-[var(--bg-hover)]"
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
            className="min-w-0 flex-1 truncate rounded-[8px] px-2 py-1 text-center text-[13px] font-semibold hover:bg-[var(--bg-hover)]"
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
                  "h-9 rounded-[8px] text-[12px] font-semibold hover:bg-[var(--bg-hover)]",
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
                  "h-9 rounded-[8px] text-[12px] font-semibold hover:bg-[var(--bg-hover)]",
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
                const stamp = startOfDayMs(cell.date);
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

function dayKey(value: number) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function minutesOnDay(value: number) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
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

function parseOverview(data: Record<string, unknown>): CalendarOverview {
  return {
    timezone: String(data.timezone ?? "UTC"),
    range: data.range as CalendarOverview["range"],
    items: Array.isArray(data.items) ? data.items.map(calendarItemFromWire) : [],
    unscheduledTasks: Array.isArray(data.unscheduledTasks)
      ? data.unscheduledTasks.map(calendarItemFromWire)
      : [],
    partialTimeItems: Array.isArray(data.partialTimeItems)
      ? data.partialTimeItems.map(calendarItemFromWire)
      : [],
    sourceState: data.sourceState as CalendarOverview["sourceState"],
    lastUpdatedAt:
      typeof data.lastUpdatedAt === "number" ? data.lastUpdatedAt : undefined,
    migration: data.migration as CalendarOverview["migration"],
  };
}

async function calendarPost(body: Record<string, unknown>) {
  const response = await fetch("/api/spectra/calendar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload?.error?.message ?? "Calendar action failed.");
  return payload.data;
}

async function fetchOverview(from: number, to: number) {
  const response = await fetch(`/api/spectra/calendar?from=${from}&to=${to}`);
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload?.error?.message ?? "Could not load Calendar.");
  return parseOverview(payload.data as Record<string, unknown>);
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
  const initialStart = weekStartMs(Date.now());
  const [daySpan, setDaySpanState] = useState(7);
  const [days, setDays] = useState(() => daysAround(initialStart));
  const [focusedStart, setFocusedStart] = useState(initialStart);
  const [overview, setOverview] = useState<CalendarOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState<Set<CalendarLayerKey>>(
    () => new Set(CALENDAR_LAYERS.map((layer) => layer.key)),
  );
  const [plansOpen, setPlansOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [planQuery, setPlanQuery] = useState("");
  const [draggingPlanId, setDraggingPlanId] = useState<string>();
  const [gesturePreview, setGesturePreview] = useState<GesturePreview | null>(null);
  const [resizeGesture, setResizeGesture] = useState<ResizeGesture | null>(null);
  const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(() => new Set());
  const [openedArtifacts, setOpenedArtifacts] = useState<SpectraArtifact[]>([]);
  const [panelWidth, setPanelWidth] = useState(780);
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
  const studio = useArtifactStudioState("spectra.calendar.studio", openedArtifacts);
  const visibleRange = useMemo(
    () => ({
      from: days[0]!,
      to: days[days.length - 1]! + DAY - 1,
    }),
    [days],
  );

  const applyOverview = useCallback(
    (incoming: CalendarOverview, mode: "replace" | "merge") => {
      setOverview((current) => {
        if (!current || mode === "replace") return incoming;
        const retainFrom = visibleRange.from - EXTEND_DAYS * DAY;
        const retainTo = visibleRange.to + EXTEND_DAYS * DAY;
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
    async (mode: "replace" | "merge" = "replace", from?: number, to?: number, showRefresh = false) => {
      if (showRefresh) setRefreshing(true);
      setError("");
      try {
        const data = await fetchOverview(from ?? visibleRange.from, to ?? visibleRange.to);
        applyOverview(data, mode);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Could not load Calendar.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [applyOverview, visibleRange.from, visibleRange.to],
  );
  loadRef.current = load;

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
    void syncSpectraManageBac("manual")
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
  }, [daySpan, days.length, error, plansOpen, studio.mode]);

  const timezone = overview?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
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
      if (message.includes("CALENDAR_GESTURE_CONFLICT")) {
        await load("replace", visibleRange.from, visibleRange.to, true);
        setSelected(null);
        toast.error("Calendar changed, so the latest block position was restored. Open it again to continue.");
      } else {
        toast.error(message);
      }
    }
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
      if (message.includes("CALENDAR_GESTURE_CONFLICT")) {
        await load("replace", visibleRange.from, visibleRange.to, true);
        toast.error("The block changed elsewhere, so Calendar restored its latest position.");
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
    const pendingId = `pending:${item.id}:${startAt}`;
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
    void (async () => {
      try {
        let artifact = openedArtifacts.find((entry) => entry._id === workId);
        if (!artifact) {
          const result = await getSpectraArtifact(workId);
          artifact = result.artifact;
          setOpenedArtifacts((current) =>
            current.some((entry) => entry._id === artifact!._id)
              ? current
              : [...current, artifact!],
          );
        }
        studio.openSplit(artifact);
      } catch (nextError) {
        toast.error(
          nextError instanceof Error ? nextError.message : "Could not open this work.",
        );
      }
    })();
  }

  function openItem(item: CalendarItem) {
    const workId = planWorkId(item);
    if (workId) {
      openWork(workId);
      return;
    }
    setSelected(item);
  }

  function jumpTo(date: Date) {
    const start = startOfDayMs(date);
    setDays(daysAround(start));
    setFocusedStart(start);
    scrollWeekRef.current = start;
    void load("replace", start - EXTEND_DAYS * DAY, start + EXTEND_DAYS * 2 * DAY - 1);
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
        ? current[0]! - EXTEND_DAYS * DAY
        : current[current.length - 1]! + DAY;
    const incoming = Array.from({ length: EXTEND_DAYS }, (_, index) =>
      direction === "before" ? edge + index * DAY : edge + index * DAY,
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
        incoming[incoming.length - 1]! + DAY - 1,
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
    const openSplit = studio.openSplit;
    const openTab = studio.openTab;
    return spectraBus.handle("work.open", (command) => {
      void (async () => {
        try {
          setActivePlanId(command.workId);
          setSelected(null);
          let artifact = openedArtifacts.find((entry) => entry._id === command.workId);
          if (!artifact) {
            const result = await getSpectraArtifact(command.workId);
            artifact = result.artifact;
            setOpenedArtifacts((current) =>
              current.some((entry) => entry._id === artifact!._id)
                ? current
                : [...current, artifact!],
            );
          }
          if (command.surface === "full") openTab(artifact);
          else openSplit(artifact);
        } catch (nextError) {
          toast.error(
            nextError instanceof Error ? nextError.message : "Could not open this work.",
          );
        }
      })();
    });
  }, [openedArtifacts, studio.openSplit, studio.openTab]);

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

  function closeOpenedTab(artifactId: string) {
    if (studio.dirtyIds.has(artifactId)) {
      toast.message("Wait for this work to synchronize before closing it.");
      return;
    }
    studio.closeTab(artifactId);
  }

  if (studio.mode === "tab" && studio.activeArtifact) {
    return (
      <div className="relative h-full min-h-0">
        <ArtifactStudio
          mode="tab"
          artifact={studio.activeArtifact}
          artifacts={openedArtifacts}
          tabs={studio.tabs}
          dirtyIds={studio.dirtyIds}
          sourceLabel="Calendar"
          onClose={studio.closeStudio}
          onExpand={studio.openTab}
          onActivateTab={studio.activateTab}
          onCloseTab={closeOpenedTab}
          onDirtyChange={studio.setDirty}
        />
      </div>
    );
  }

  return (
    <div className="spectra-wave-y relative flex h-full min-h-0 overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="spectra-calendar-page flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-5 pb-4 pt-6 sm:px-8 lg:px-10">
        <ProductPageHeader
          title="Calendar"
          description="See school time and place Plans on it."
          actions={
            <>
              <button
                type="button"
                className={`relative grid size-10 shrink-0 place-items-center rounded-[8px] border transition ${layersOpen ? "border-[var(--text-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                data-active={layersOpen || undefined}
                aria-pressed={layersOpen}
                aria-label={layersOpen ? "Hide layers" : "Show layers"}
                title="Layers"
                onClick={() => setLayersOpen((open) => !open)}
              >
                <Layers3 className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => void load("merge", visibleRange.from, visibleRange.to, true)}
                disabled={refreshing}
                className="grid size-10 shrink-0 place-items-center rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
                aria-label="Refresh calendar"
                title="Refresh calendar"
              >
                {refreshing ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setComposerOpen(true)}
                className="agent-library-create"
              >
                <Plus className="size-3.5" />
                Add event
              </button>
            </>
          }
        />
        <div className="spectra-calendar-toolbar mt-6">
          <div className="spectra-calendar-week-nav">
            {!plansOpen ? (
              <button
                type="button"
                className="spectra-calendar-week-step"
                aria-label="Show plans"
                title="Show plans"
                onClick={() => setPlansOpen(true)}
              >
                <PanelLeft className="size-4" />
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Previous range"
              onClick={() => jumpTo(new Date(focusedStart - daySpan * DAY))}
              className="spectra-calendar-week-step"
            >
              <ChevronLeft className="size-4" />
            </button>
            <CalendarDatePicker
              value={focusedStart}
              label={formatRange(focusedStart, daySpan)}
              onChange={(date) => jumpTo(date)}
            />
            <button
              type="button"
              aria-label="Next range"
              onClick={() => jumpTo(new Date(focusedStart + daySpan * DAY))}
              className="spectra-calendar-week-step"
            >
              <ChevronRight className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => jumpTo(new Date())}
              className="spectra-calendar-today"
            >
              Today
            </button>
          </div>
          <div className="spectra-calendar-zoom">
            <button
              type="button"
              className="spectra-calendar-icon"
              aria-label="Zoom out, show more days"
              title="Zoom out"
              disabled={daySpan >= MAX_DAYS}
              onClick={() => changeDaySpan(daySpan + 1)}
            >
              <ZoomOut className="size-4" />
            </button>
            <span className="spectra-calendar-zoom-label">
              {daySpan} {daySpan === 1 ? "day" : "days"}
            </span>
            <button
              type="button"
              className="spectra-calendar-icon"
              aria-label="Zoom in, show fewer days"
              title="Zoom in"
              disabled={daySpan <= MIN_DAYS}
              onClick={() => changeDaySpan(daySpan - 1)}
            >
              <ZoomIn className="size-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="spectra-item-rail-stage spectra-calendar-body min-h-0 flex-1">
        <StudioItemRail
          label="Plans"
          count={unscheduledPlans.length}
          collapsed={!plansOpen}
          onToggleCollapsed={() => setPlansOpen(false)}
          items={unscheduledPlans.map((item) => ({
            id: item.id,
            title: item.title,
            subtitle: planSubtitle(item),
            active: Boolean(activePlanId && planWorkId(item) === activePlanId),
          }))}
          onSelect={(id) => {
            const item = unscheduledPlans.find((entry) => entry.id === id);
            if (item) openItem(item);
          }}
          canEdit
          exportable
          showIndex={false}
          draggingId={draggingPlanId}
          onDragStart={(id) => {
            const item = (overview?.unscheduledTasks ?? []).find((entry) => entry.id === id);
            if (!item) return;
            setDraggingPlanId(id);
            dragRef.current = { type: "plan", item, grabOffsetMinutes: 0 };
          }}
          onDragEnd={() => {
            setDraggingPlanId(undefined);
            dragRef.current = null;
            setGesturePreview(null);
          }}
          tools={
            <div className="mt-2 grid gap-1.5">
              <label className="flex h-8 min-w-0 items-center gap-1.5 rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-[var(--text-secondary)]">
                <Search className="size-3.5 shrink-0" />
                <input
                  value={planQuery}
                  onChange={(event) => setPlanQuery(event.target.value)}
                  placeholder="Find a plan"
                  aria-label="Find a plan"
                  className="min-w-0 flex-1 bg-transparent text-micro text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]"
                />
              </label>
            </div>
          }
          footer={
            loading ? (
              <div className="flex items-center gap-2 px-1 py-3 text-[11px] text-[var(--text-tertiary)]">
                <LoaderCircle className="size-3.5 animate-spin" />
                Loading plans
              </div>
            ) : !unscheduledPlans.length ? (
              <p className="px-1 py-3 text-[11px] leading-5 text-[var(--text-tertiary)]">
                {planQuery
                  ? `No plans match “${planQuery}”.`
                  : "No unscheduled plans. Create one from Library, then drag it onto a day."}
              </p>
            ) : null
          }
        />

        <section className="relative min-h-0 min-w-0 flex-1">
          {layersOpen ? (
            <aside
              className="spectra-studio-inspector-overlay absolute right-3 top-3 z-20 w-[240px] rounded-[10px] border border-[var(--border-default)] bg-[var(--wave-paper,var(--bg-primary))] p-3 shadow-[0_18px_40px_-28px_rgba(31,27,22,0.35)]"
              aria-label="Calendar layers"
            >
              <p className="px-1 pb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                Layers
              </p>
              <div className="space-y-1">
                {CALENDAR_LAYERS.filter((layer) => layer.key !== "shared").map((layer) => (
                  <label
                    key={layer.key}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-[11px] hover:bg-[var(--bg-hover)]"
                  >
                    <input
                      type="checkbox"
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
                    <span className="size-2 rounded-full" style={{ background: layer.color }} />
                    <span className="flex-1">{layer.label}</span>
                  </label>
                ))}
              </div>
            </aside>
          ) : null}

          {error ? (
            <div className="p-4">
              <ProductErrorState
                title="Calendar could not be loaded"
                detail={error}
                action={
                  <button
                    type="button"
                    onClick={() => void load("replace", visibleRange.from, visibleRange.to, true)}
                    className="h-9 rounded-lg bg-[var(--text-primary)] px-3.5 text-[12px] font-semibold text-[var(--bg-primary)]"
                  >
                    Try again
                  </button>
                }
              />
            </div>
          ) : (
            <div
              ref={scrollerRef}
              className="spectra-calendar-scroll"
              onScroll={onScrollerScroll}
            >
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
      </div>

      {selected ? (
        <CalendarItemPanel
          item={selected}
          timezone={timezone}
          onClose={() => setSelected(null)}
          onCommit={commit}
        />
      ) : null}
      {composerOpen ? (
        <CalendarComposer
          timezone={timezone}
          onClose={() => setComposerOpen(false)}
          onCreated={() => {
            setComposerOpen(false);
            void load("merge", visibleRange.from, visibleRange.to, true);
          }}
        />
      ) : null}
      </div>
      {studio.mode === "split" && studio.activeArtifact ? (
        <ArtifactStudio
          mode="split"
          artifact={studio.activeArtifact}
          artifacts={openedArtifacts}
          tabs={studio.tabs}
          dirtyIds={studio.dirtyIds}
          panelWidth={panelWidth}
          sourceLabel="Calendar"
          onPanelWidthChange={setPanelWidth}
          onClose={studio.closeStudio}
          onExpand={studio.openTab}
          onActivateTab={studio.activateTab}
          onCloseTab={closeOpenedTab}
          onDirtyChange={studio.setDirty}
        />
      ) : null}
    </div>
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
          const today = dayKey(day.getTime()) === dayKey(now);
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
            (item) => item.startAt !== undefined && dayKey(item.startAt) === dayKey(day.getTime()),
          );
          return (
            <div key={`${day.toISOString()}-allday`} className="spectra-calendar-allday-cell">
              {items.map((item) => {
                const layer = CALENDAR_LAYERS.find((candidate) => candidate.key === layerFor(item))!;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.title}
                    onClick={() => onOpen(item)}
                    className="spectra-calendar-chip"
                    style={{
                      borderColor: `${layer.color}55`,
                      background: `color-mix(in oklab, ${layer.color} 16%, var(--bg-elevated))`,
                      color: layer.color,
                    }}
                  >
                    {item.title}
                  </button>
                );
              })}
            </div>
          );
        })}
        <div className="spectra-calendar-gutter relative" style={{ height: hoursHeight }}>
          {Array.from({ length: HOURS }, (_, hour) => (
            <span
              key={hour}
              className="absolute right-2 -translate-y-1/2 text-micro text-[var(--text-tertiary)]"
              style={{ top: hour * HOUR_PX }}
            >
              {String(hour).padStart(2, "0")}:00
            </span>
          ))}
        </div>
        {dayDates.map((day) => {
          const columnItems = timedItems.filter(
            (item) => item.startAt !== undefined && dayKey(item.startAt) === dayKey(day.getTime()),
          );
          const preview =
            gesturePreview && dayKey(gesturePreview.startAt) === dayKey(day.getTime())
              ? gesturePreview
              : null;
          const today = dayKey(day.getTime()) === dayKey(now);
          const nowTop = today ? (minutesOnDay(now) / 60) * HOUR_PX : null;
          return (
            <div
              key={`${day.toISOString()}-hours`}
              onDragOver={(event) => onPreview(event, day)}
              onDrop={(event) => onDrop(event, day)}
              className="relative border-r border-[var(--border-subtle)] last:border-r-0"
              style={{ height: hoursHeight }}
            >
              {Array.from({ length: HOURS }, (_, hour) => (
                <div
                  key={hour}
                  className="absolute inset-x-0 border-t border-[var(--border-subtle)]"
                  style={{ top: hour * HOUR_PX }}
                />
              ))}
              {nowTop !== null ? (
                <span
                  className="pointer-events-none absolute inset-x-0 z-20 h-px bg-emerald-700"
                  style={{ top: nowTop }}
                />
              ) : null}
              {preview ? <PreviewBlock preview={preview} timezone={timezone} /> : null}
              {columnItems.map((item) => (
                <TimedBlock
                  key={item.id}
                  item={item}
                  timezone={timezone}
                  previewing={gesturePreview?.itemId === item.id}
                  pending={pendingItemIds.has(item.id)}
                  canMove={item.kind === "scheduled_work_block" && !pendingItemIds.has(item.id) && !resizeGesture}
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
  const top = (minutesOnDay(preview.startAt) / 60) * HOUR_PX;
  const height = Math.max(24, ((preview.endAt - preview.startAt) / HOUR) * HOUR_PX);
  return (
    <div
      className="pointer-events-none absolute inset-x-1 z-30 overflow-hidden rounded-lg border-2 border-dashed px-2 py-1.5 text-left shadow-lg"
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

function TimedBlock({
  item,
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
  const top = (minutesOnDay(item.startAt!) / 60) * HOUR_PX;
  const duration = Math.max(30 * 60_000, item.endAt! - item.startAt!);
  const height = Math.max(24, (duration / HOUR) * HOUR_PX);
  return (
    <button
      type="button"
      title={item.title}
      draggable={canMove}
      onDragStart={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        onDragStart(Math.round((((event.clientY - bounds.top) / HOUR_PX) * 60) / 15) * 15);
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cn(
        "group absolute inset-x-1 z-10 overflow-hidden rounded-lg border px-2 py-1.5 text-left shadow-sm transition hover:z-20 hover:shadow-md",
        previewing && "opacity-25",
        pending && "animate-pulse",
      )}
      style={{
        top,
        height,
        borderColor: `${layer.color}55`,
        background: `color-mix(in oklab, ${layer.color} 13%, var(--bg-elevated))`,
        color: layer.color,
      }}
    >
      {canMove ? (
        <span
          role="presentation"
          onPointerDown={(event) => onResizeStart(event, "start")}
          className="absolute inset-x-1 top-0 z-20 h-2 cursor-ns-resize rounded-t opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-100"
        />
      ) : null}
      <span className="flex items-center gap-1 text-micro font-bold">
        <span className="truncate">
          {formatTime(item.startAt!, timezone)}
          {item.endAt ? ` – ${formatTime(item.endAt, timezone)}` : ""}
        </span>
        {item.sourceLocked ? <LockKeyhole className="size-2.5" /> : null}
      </span>
      <span className="mt-0.5 block truncate text-micro font-semibold text-[var(--text-primary)]">
        {item.title}
      </span>
      {canMove ? (
        <span
          role="presentation"
          onPointerDown={(event) => onResizeStart(event, "end")}
          className="absolute inset-x-1 bottom-0 z-20 h-2 cursor-ns-resize rounded-b opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-100"
        />
      ) : null}
    </button>
  );
}

function CalendarItemPanel({
  item,
  timezone,
  onClose,
  onCommit,
}: {
  item: CalendarItem;
  timezone: string;
  onClose: () => void;
  onCommit: (action: Record<string, unknown>) => Promise<void>;
}) {
  const layer = CALENDAR_LAYERS.find((candidate) => candidate.key === layerFor(item))!;
  return (
    <aside
      className="fixed inset-y-0 right-0 z-[87] w-full max-w-[390px] border-l border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[-20px_0_60px_rgba(31,38,34,.12)]"
      aria-label={`${item.title} details`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-micro font-bold"
            style={{ background: `${layer.color}18`, color: layer.color }}
          >
            {item.sourceLocked ? <LockKeyhole className="size-3" /> : null}
            {layer.label}
          </span>
          <h2 className="mt-3 font-display text-[23px] font-semibold tracking-[-0.02em]">
            {item.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="grid size-8 place-items-center rounded-lg hover:bg-[var(--bg-hover)]"
        >
          <X className="size-4" />
        </button>
      </div>
      <dl className="mt-5 space-y-3 text-[12px]">
        <div>
          <dt className="text-micro font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            Time
          </dt>
          <dd className="mt-1">
            {item.allDay
              ? "All day"
              : item.startAt !== undefined
                ? `${formatTime(item.startAt, timezone)}${item.endAt !== undefined && item.endAt !== item.startAt ? ` – ${formatTime(item.endAt, timezone)}` : ""}`
                : "Date only"}
          </dd>
        </div>
        {item.location ? (
          <div>
            <dt className="text-micro font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Location
            </dt>
            <dd className="mt-1">{item.location}</dd>
          </div>
        ) : null}
        {item.notes ? (
          <div>
            <dt className="text-micro font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Notes
            </dt>
            <dd className="mt-1 whitespace-pre-wrap leading-5 text-[var(--text-secondary)]">
              {item.notes}
            </dd>
          </div>
        ) : null}
      </dl>
      {item.kind === "scheduled_work_block" && item.endAt !== undefined ? (
        <section className="mt-5 rounded-xl border border-[var(--border-default)] p-3">
          <p className="text-micro font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            Duration
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() =>
                void onCommit({
                  action: "resizeWorkBlock",
                  itemId: item.id,
                  endAt: Math.max((item.startAt ?? 0) + 15 * 60_000, item.endAt! - 30 * 60_000),
                  expectedRevision: item.revision,
                })
              }
              className="h-8 rounded-lg border border-[var(--border-default)] px-3 text-[11px] font-semibold"
            >
              − 30 min
            </button>
            <button
              type="button"
              onClick={() =>
                void onCommit({
                  action: "resizeWorkBlock",
                  itemId: item.id,
                  endAt: item.endAt! + 30 * 60_000,
                  expectedRevision: item.revision,
                })
              }
              className="h-8 rounded-lg border border-[var(--border-default)] px-3 text-[11px] font-semibold"
            >
              + 30 min
            </button>
          </div>
        </section>
      ) : null}
      {item.linkedWorkIds.length ? (
        <section className="mt-5">
          <p className="text-micro font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            Linked work
          </p>
          <div className="mt-2 space-y-2">
            {item.linkedWorkIds.map((workId) => (
              <button
                key={workId}
                type="button"
                onClick={() => void spectraBus.command("work.open", { workId, surface: "panel" })}
                className="flex w-full items-center gap-2 rounded-xl border border-[var(--border-default)] px-3 py-2 text-left text-[11px] font-semibold hover:bg-[var(--bg-hover)]"
              >
                <Link2 className="size-3.5" />
                Open linked work
                <ExternalLink className="ml-auto size-3" />
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {item.source ? (
        <section className="mt-5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]/40 p-3">
          <p className="flex items-center gap-2 text-[11px] font-semibold">
            <LockKeyhole className="size-3.5" />
            Official source
          </p>
          <p className="mt-1 text-micro leading-4 text-[var(--text-secondary)]">
            {item.source.provider} controls the official time and deadline. Schedule your work separately.
          </p>
          {item.source.url ? (
            <a
              href={item.source.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-micro font-semibold underline underline-offset-2"
            >
              Open source
              <ExternalLink className="size-3" />
            </a>
          ) : null}
        </section>
      ) : null}
      <div className="absolute bottom-5 left-5 right-5">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border-default)] py-2.5 text-[11px] font-semibold hover:bg-[var(--bg-hover)]"
        >
          <Sparkles className="size-3.5" />
          Ask Spectra about this time
        </button>
      </div>
    </aside>
  );
}

function CalendarComposer({
  timezone,
  onClose,
  onCreated,
}: {
  timezone: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(() => new Date(Date.now() + HOUR).toISOString().slice(0, 16));
  const [end, setEnd] = useState(() => new Date(Date.now() + 2 * HOUR).toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/25 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add personal event"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void calendarPost({
            action: "createPersonalItem",
            kind: "personal_event",
            title,
            startAt: Date.parse(start),
            endAt: Date.parse(end),
            timezone,
          })
            .then(onCreated)
            .catch((error) =>
              toast.error(error instanceof Error ? error.message : "Could not add event."),
            )
            .finally(() => setBusy(false));
        }}
        className="w-full max-w-[460px] rounded-2xl border border-white/50 bg-[var(--bg-elevated)] p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[21px] font-semibold">Add personal event</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-lg hover:bg-[var(--bg-hover)]"
          >
            <X className="size-4" />
          </button>
        </div>
        <label className="mt-5 block text-[11px] font-semibold">
          Title
          <input
            autoFocus
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] outline-none focus:border-[var(--brand-primary)]"
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-[11px] font-semibold">
            Starts
            <input
              type="datetime-local"
              required
              value={start}
              onChange={(event) => setStart(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-[11px]"
            />
          </label>
          <label className="text-[11px] font-semibold">
            Ends
            <input
              type="datetime-local"
              required
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-[11px]"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg px-3 text-[12px] font-semibold hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--text-primary)] px-4 text-[12px] font-semibold text-[var(--bg-primary)] disabled:opacity-40"
          >
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Add event
          </button>
        </div>
      </form>
    </div>
  );
}
