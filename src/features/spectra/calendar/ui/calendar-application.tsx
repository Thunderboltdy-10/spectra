"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  GripVertical,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Layers3,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ProductErrorState } from "../../components/product-state";
import { AuxiliaryRail, AuxiliaryRailTrigger } from "../../components/auxiliary-rail";
import { spectraBus } from "../../events";
import { CapabilityTruthBadge, CapabilityTruthState } from "../../integrations/status/capability-truth";
import {
  CALENDAR_LAYERS,
  calendarItemFromWire,
  type CalendarItem,
  type CalendarLayerKey,
  type CalendarOverview,
} from "../domain/model";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const START_HOUR = 7;
const END_HOUR = 22;

function startOfWeek(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

function daysForWeek(anchor: Date) {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) =>
    new Date(start.getTime() + index * DAY),
  );
}

function formatTime(value: number, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(value);
}

function formatFreshness(value?: number) {
  if (!value) return "No successful update yet";
  return `Updated ${new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(value)}`;
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

type DragPayload =
  | { type: "task"; item: CalendarItem; grabOffsetMinutes: number }
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
  const [anchor, setAnchor] = useState(() => new Date());
  const [overview, setOverview] = useState<CalendarOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState<Set<CalendarLayerKey>>(
    () => new Set(CALENDAR_LAYERS.map((layer) => layer.key)),
  );
  const [sideOpen, setSideOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [taskQuery, setTaskQuery] = useState("");
  const [gesturePreview, setGesturePreview] = useState<GesturePreview | null>(null);
  const [resizeGesture, setResizeGesture] = useState<ResizeGesture | null>(null);
  const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(() => new Set());
  const dragRef = useRef<DragPayload | null>(null);
  const days = useMemo(() => daysForWeek(anchor), [anchor]);
  const range = useMemo(
    () => ({
      from: days[0]!.getTime(),
      to: days[6]!.getTime() + DAY - 1,
    }),
    [days],
  );

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/spectra/calendar?from=${range.from}&to=${range.to}`,
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload?.error?.message ?? "Could not load Calendar.");
      const data = payload.data as Record<string, unknown>;
      setOverview({
        timezone: String(data.timezone ?? "UTC"),
        range: data.range as CalendarOverview["range"],
        items: Array.isArray(data.items)
          ? data.items.map(calendarItemFromWire)
          : [],
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
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load Calendar.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    let cancelled = false;
    void calendarPost({ action: "ensureMigration" })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) void load();
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const timezone = overview?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const positioned = useMemo(
    () =>
      (overview?.items ?? []).filter(
        (item) =>
          item.startAt !== undefined &&
          item.endAt !== undefined &&
          item.timePrecision !== "unknown" &&
          visibleLayers.has(layerFor(item)),
      ),
    [overview?.items, visibleLayers],
  );

  async function commit(action: Record<string, unknown>) {
    try {
      const wire = await calendarPost(action);
      if (wire && typeof wire === "object" && typeof (wire as Record<string, unknown>).id === "string") {
        const nextItem = calendarItemFromWire(wire as Record<string, unknown>);
        replaceOverviewItem(nextItem);
        setSelected((current) => current?.id === nextItem.id ? nextItem : current);
      } else {
        await load(true);
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Calendar action failed.";
      if (message.includes("CALENDAR_GESTURE_CONFLICT")) {
        await load(true);
        setSelected(null);
        toast.error("Calendar changed, so the latest block position was restored. Open it again to continue.");
      } else {
        toast.error(message);
      }
    }
  }

  function replaceOverviewItem(nextItem: CalendarItem) {
    setOverview((current) => current ? {
      ...current,
      items: current.items.map((item) => item.id === nextItem.id ? nextItem : item),
    } : current);
  }

  async function commitWorkGesture(item: CalendarItem, startAt: number, endAt: number) {
    if (pendingItemIds.has(item.id)) return;
    const optimistic = { ...item, startAt, endAt };
    replaceOverviewItem(optimistic);
    setPendingItemIds((current) => new Set(current).add(item.id));
    try {
      const wire = await calendarPost({
        action: "moveWorkBlock",
        itemId: item.id,
        startAt,
        endAt,
        expectedRevision: item.revision,
      });
      replaceOverviewItem(calendarItemFromWire(wire as Record<string, unknown>));
    } catch (nextError) {
      replaceOverviewItem(item);
      const message = nextError instanceof Error ? nextError.message : "Calendar action failed.";
      if (message.includes("CALENDAR_GESTURE_CONFLICT")) {
        await load(true);
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

  function resolveDrop(event: React.DragEvent<HTMLDivElement>, day: Date) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    const cursorMinutes = START_HOUR * 60 + ratio * (END_HOUR - START_HOUR) * 60;
    const minutes = Math.max(
      START_HOUR * 60,
      Math.min(
        END_HOUR * 60 - 15,
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
    setGesturePreview(null);
    if (!payload) return;
    const startAt = resolveDrop(event, day);
    if (payload.type === "task") {
      void commit({
        action: "scheduleTask",
        taskItemId: payload.item.id.startsWith("plan:") ? undefined : payload.item.id,
        planArtifactId: payload.item.planArtifactId,
        planTaskId: payload.item.planTaskId,
        startAt,
        endAt: startAt + HOUR,
        timezone,
      });
      return;
    }
    const duration = Math.max(15 * 60_000, (payload.item.endAt ?? startAt + HOUR) - (payload.item.startAt ?? startAt));
    void commitWorkGesture(payload.item, startAt, startAt + duration);
  }

  function previewDrop(event: React.DragEvent<HTMLDivElement>, day: Date) {
    event.preventDefault();
    const payload = dragRef.current;
    if (!payload) return;
    const startAt = resolveDrop(event, day);
    const duration = payload.type === "task"
      ? HOUR
      : Math.max(15 * 60_000, (payload.item.endAt ?? startAt + HOUR) - (payload.item.startAt ?? startAt));
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
    if (item.startAt === undefined || item.endAt === undefined || pendingItemIds.has(item.id)) return;
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
      const delta = Math.round((((clientY - gesture.originY) / 52) * 60) / 15) * 15 * 60_000;
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

  const sourceBlocked = Boolean(
    overview &&
      [
        "not_connected",
        "permission_denied",
        "unsupported",
        "schema_incompatible",
        "unavailable",
      ].includes(overview.sourceState.kind),
  );
  const visibleUnscheduledTasks = (overview?.unscheduledTasks ?? []).filter((task) =>
    task.title.toLocaleLowerCase().includes(taskQuery.trim().toLocaleLowerCase()),
  );

  return (
    <main className="spectra-wave-y flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <header className="shrink-0 px-5 py-3 lg:px-7">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="font-display text-[27px] font-semibold tracking-[-0.03em]">Calendar</h1>
            {overview && overview.sourceState.kind !== "available" ? (
              <CapabilityTruthBadge state={overview.sourceState} />
            ) : null}
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
            <div className="flex items-center gap-0.5">
              <button type="button" aria-label="Previous week" onClick={() => setAnchor((current) => new Date(current.getTime() - 7 * DAY))} className="grid size-7 place-items-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><ChevronLeft className="size-4" /></button>
              <button type="button" onClick={() => setAnchor(new Date())} className="h-7 rounded-md px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">Today</button>
              <button type="button" aria-label="Next week" onClick={() => setAnchor((current) => new Date(current.getTime() + 7 * DAY))} className="grid size-7 place-items-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><ChevronRight className="size-4" /></button>
            </div>
            <p className="truncate font-display text-[15px] font-semibold">
              {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(days[0])}
              {" – "}
              {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(days[6])}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="hidden text-[10px] text-[var(--text-tertiary)] xl:inline">{formatFreshness(overview?.lastUpdatedAt)}</span>
            <button type="button" onClick={() => void load(true)} disabled={refreshing} className="inline-flex size-9 items-center justify-center rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50" aria-label="Refresh calendar" title="Refresh calendar">
              {refreshing ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            </button>
            {!sideOpen ? <AuxiliaryRailTrigger label="calendar tasks" onOpen={() => setSideOpen(true)} /> : null}
            <button type="button" onClick={() => setComposerOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--text-primary)] px-3.5 text-[12px] font-semibold text-[var(--bg-primary)]">
              <Plus className="size-3.5" />
              Add event
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {sideOpen ? <AuxiliaryRail label={`Unscheduled work · ${overview?.unscheduledTasks.length ?? 0}`} onClose={() => setSideOpen(false)} className="order-2 lg:order-2">
          <p className="px-4 pb-2 pt-1 text-[11px] leading-5 text-[var(--text-secondary)]">Drag a task into the week. Its official deadline stays fixed.</p>
          <label className="relative mx-3 mb-2 block">
            <span className="sr-only">Search unscheduled work</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <input value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="Find a task" className="h-9 w-full rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] pl-8 pr-8 text-[11px] outline-none transition focus:border-[var(--border-strong)]" />
            {taskQuery ? <button type="button" onClick={() => setTaskQuery("")} className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" aria-label="Clear task search"><X className="size-3" /></button> : null}
          </label>
          <div className="space-y-1 px-3 py-2">
            {loading ? <div className="flex items-center gap-2 p-3 text-[11px] text-[var(--text-tertiary)]"><LoaderCircle className="size-3.5 animate-spin" /> Loading tasks…</div> : null}
            {!loading && !(overview?.unscheduledTasks.length) ? <div className="p-4 text-center text-[11px] leading-5 text-[var(--text-tertiary)]">No unscheduled tasks. Create one here or from a Plan.</div> : null}
            {!loading && taskQuery && !visibleUnscheduledTasks.length ? <div className="p-4 text-center text-[11px] leading-5 text-[var(--text-tertiary)]">No tasks match “{taskQuery}”.</div> : null}
            {visibleUnscheduledTasks.map((task) => (
              <button key={task.id} type="button" title={task.title} draggable onDragStart={() => { dragRef.current = { type: "task", item: task, grabOffsetMinutes: 0 }; }} onDragEnd={() => { dragRef.current = null; setGesturePreview(null); }} onClick={() => setSelected(task)} className="group flex w-full items-start gap-2 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]">
                <GripVertical className="mt-0.5 size-3.5 shrink-0 text-[var(--text-tertiary)]" />
                <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium">{task.title}</span><span className="mt-0.5 block text-micro text-[var(--text-tertiary)]">{task.planArtifactId ? "From Plan" : task.source?.provider ? "From school" : "Personal task"}</span></span>
              </button>
            ))}
          </div>
          <section className="mt-3 px-3 pb-4">
            <button type="button" onClick={() => setLayersOpen((open) => !open)} className="flex h-11 w-full items-center gap-2 px-4 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]" aria-expanded={layersOpen}>
              <Layers3 className="size-3.5" />
              <span className="flex-1">Layers</span>
              <ChevronDown className={cn("size-3.5 transition-transform", layersOpen && "rotate-180")} />
            </button>
            {layersOpen ? <div className="space-y-1 px-3 pb-3">
              {CALENDAR_LAYERS.filter((layer) => layer.key !== "shared").map((layer) => (
                <label key={layer.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-[11px] hover:bg-[var(--bg-hover)]">
                  <input type="checkbox" checked={visibleLayers.has(layer.key)} onChange={() => setVisibleLayers((current) => { const next = new Set(current); if (next.has(layer.key)) next.delete(layer.key); else next.add(layer.key); return next; })} />
                  <span className="size-2 rounded-full" style={{ background: layer.color }} />
                  <span className="flex-1">{layer.label}</span>
                </label>
              ))}
            </div> : null}
          </section>
        </AuxiliaryRail> : null}

        <section className="order-1 min-h-[520px] min-w-0 flex-1 overflow-auto lg:order-1 lg:min-h-0">
          <div className="min-w-[760px] p-3 lg:p-4">
            {error ? (
              <ProductErrorState
                title="Calendar could not be loaded"
                detail={error}
                action={<button type="button" onClick={() => void load(true)} className="h-9 rounded-lg bg-[var(--text-primary)] px-3.5 text-[12px] font-semibold text-[var(--bg-primary)]">Try again</button>}
              />
            ) : sourceBlocked && overview ? (
              <CapabilityTruthState state={overview.sourceState} title="School calendar" onRetry={() => void load(true)} />
            ) : null}
            {!error ? <div className={cn("grid grid-cols-[54px_repeat(7,minmax(96px,1fr))] overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)]", sourceBlocked && "mt-3")}>
              <div className="border-b border-r border-[var(--border-subtle)]" />
              {days.map((day) => {
                const today = dayKey(day.getTime()) === dayKey(Date.now());
                return <div key={day.toISOString()} className={cn("border-b border-r border-[var(--border-subtle)] px-2 py-2 text-center last:border-r-0", today && "bg-emerald-500/7")}><span className="block text-micro font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(day)}</span><span className={cn("mt-0.5 inline-grid size-7 place-items-center rounded-full font-display text-[15px] font-semibold", today && "bg-emerald-700 text-white")}>{day.getDate()}</span></div>;
              })}
              <div className="relative border-r border-[var(--border-subtle)]" style={{ height: (END_HOUR - START_HOUR) * 52 }}>
                {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => <span key={index} className="absolute right-2 -translate-y-1/2 text-micro text-[var(--text-tertiary)]" style={{ top: index * 52 }}>{String(START_HOUR + index).padStart(2, "0")}:00</span>)}
              </div>
              {days.map((day) => {
                const dayItems = positioned.filter((item) => item.startAt !== undefined && dayKey(item.startAt) === dayKey(day.getTime()));
                const preview = gesturePreview && dayKey(gesturePreview.startAt) === dayKey(day.getTime()) ? gesturePreview : null;
                return <div key={day.toISOString()} onDragOver={(event) => previewDrop(event, day)} onDrop={(event) => dropOnDay(event, day)} className="relative border-r border-[var(--border-subtle)] last:border-r-0" style={{ height: (END_HOUR - START_HOUR) * 52 }}>
                  {Array.from({ length: END_HOUR - START_HOUR }, (_, index) => <div key={index} className="absolute inset-x-0 border-t border-[var(--border-subtle)]" style={{ top: index * 52 }} />)}
                  {preview ? (() => {
                    const layer = CALENDAR_LAYERS.find((candidate) => candidate.key === preview.layer)!;
                    const top = Math.max(0, (((new Date(preview.startAt).getHours() + new Date(preview.startAt).getMinutes() / 60) - START_HOUR) / (END_HOUR - START_HOUR)) * 100);
                    const height = Math.max(24, ((preview.endAt - preview.startAt) / HOUR) * 52);
                    return <div className="pointer-events-none absolute inset-x-1 z-30 overflow-hidden rounded-lg border-2 border-dashed px-2 py-1.5 text-left shadow-lg" style={{ top: `${top}%`, height, borderColor: layer.color, background: `color-mix(in oklab, ${layer.color} 20%, var(--bg-elevated))`, color: layer.color }}>
                      <span className="block text-micro font-bold">{formatTime(preview.startAt, timezone)} – {formatTime(preview.endAt, timezone)}</span>
                      <span className="mt-0.5 block truncate text-micro font-semibold text-[var(--text-primary)]">{preview.title}</span>
                    </div>;
                  })() : null}
                  {dayItems.map((item) => {
                    const layer = CALENDAR_LAYERS.find((candidate) => candidate.key === layerFor(item))!;
                    const top = Math.max(0, (((new Date(item.startAt!).getHours() + new Date(item.startAt!).getMinutes() / 60) - START_HOUR) / (END_HOUR - START_HOUR)) * 100);
                    const duration = Math.max(30 * 60_000, item.endAt! - item.startAt!);
                    const height = Math.max(24, (duration / HOUR) * 52);
                    const movable = item.kind === "scheduled_work_block";
                    const previewing = gesturePreview?.itemId === item.id;
                    return <button key={item.id} type="button" title={item.title} draggable={movable && !pendingItemIds.has(item.id) && !resizeGesture} onDragStart={(event) => { if (movable) { const bounds = event.currentTarget.getBoundingClientRect(); dragRef.current = { type: "block", item, grabOffsetMinutes: Math.round((((event.clientY - bounds.top) / 52) * 60) / 15) * 15 }; } }} onDragEnd={() => { dragRef.current = null; setGesturePreview(null); }} onClick={() => setSelected(item)} className={cn("group absolute inset-x-1 z-10 overflow-hidden rounded-lg border px-2 py-1.5 text-left shadow-sm transition hover:z-20 hover:shadow-md", previewing && "opacity-25", pendingItemIds.has(item.id) && "animate-pulse")} style={{ top: `${top}%`, height, borderColor: `${layer.color}55`, background: `color-mix(in oklab, ${layer.color} 13%, var(--bg-elevated))`, color: layer.color }}>
                      {movable ? <span role="presentation" onPointerDown={(event) => beginResize(event, item, "start")} className="absolute inset-x-1 top-0 z-20 h-2 cursor-ns-resize rounded-t opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-100" /> : null}
                      <span className="flex items-center gap-1 text-micro font-bold"><span className="truncate">{formatTime(item.startAt!, timezone)}{item.endAt ? ` – ${formatTime(item.endAt, timezone)}` : ""}</span>{item.sourceLocked ? <LockKeyhole className="size-2.5" /> : null}</span>
                      <span className="mt-0.5 block truncate text-micro font-semibold text-[var(--text-primary)]">{item.title}</span>
                      {movable ? <span role="presentation" onPointerDown={(event) => beginResize(event, item, "end")} className="absolute inset-x-1 bottom-0 z-20 h-2 cursor-ns-resize rounded-b opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-100" /> : null}
                    </button>;
                  })}
                </div>;
              })}
            </div> : null}

            {overview?.partialTimeItems.length ? <section className="mt-3 rounded-xl border border-amber-600/20 bg-amber-500/7 p-3"><div className="flex items-center gap-2 text-[11px] font-semibold text-amber-900"><Clock3 className="size-3.5" />Time not supplied by the source</div><div className="mt-2 flex flex-wrap gap-2">{overview.partialTimeItems.map((item) => <button key={item.id} type="button" onClick={() => setSelected(item)} className="rounded-lg border border-amber-700/20 bg-[var(--bg-elevated)] px-2.5 py-1.5 text-micro font-semibold text-[var(--text-primary)]">{item.title} · {item.timePrecision === "unknown" ? "period/date unavailable" : "date only"}</button>)}</div></section> : null}
          </div>
        </section>
      </div>

      {selected ? <CalendarItemPanel item={selected} timezone={timezone} onClose={() => setSelected(null)} onCommit={commit} /> : null}
      {composerOpen ? <CalendarComposer timezone={timezone} onClose={() => setComposerOpen(false)} onCreated={() => { setComposerOpen(false); void load(true); }} /> : null}
    </main>
  );
}

function CalendarItemPanel({ item, timezone, onClose, onCommit }: { item: CalendarItem; timezone: string; onClose: () => void; onCommit: (action: Record<string, unknown>) => Promise<void> }) {
  const layer = CALENDAR_LAYERS.find((candidate) => candidate.key === layerFor(item))!;
  return <aside className="fixed inset-y-0 right-0 z-[87] w-full max-w-[390px] border-l border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[-20px_0_60px_rgba(31,38,34,.12)]" aria-label={`${item.title} details`}>
    <div className="flex items-start justify-between gap-3"><div><span className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-micro font-bold" style={{ background: `${layer.color}18`, color: layer.color }}>{item.sourceLocked ? <LockKeyhole className="size-3" /> : null}{layer.label}</span><h2 className="mt-3 font-display text-[23px] font-semibold tracking-[-0.02em]">{item.title}</h2></div><button type="button" onClick={onClose} aria-label="Close details" className="grid size-8 place-items-center rounded-lg hover:bg-[var(--bg-hover)]"><X className="size-4" /></button></div>
    <dl className="mt-5 space-y-3 text-[12px]">
      <div><dt className="text-micro font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">Time</dt><dd className="mt-1">{item.startAt !== undefined ? `${formatTime(item.startAt, timezone)}${item.endAt !== undefined && item.endAt !== item.startAt ? ` – ${formatTime(item.endAt, timezone)}` : ""}` : "Exact time unavailable"}</dd></div>
      {item.location ? <div><dt className="text-micro font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">Location</dt><dd className="mt-1">{item.location}</dd></div> : null}
      {item.notes ? <div><dt className="text-micro font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">Notes</dt><dd className="mt-1 whitespace-pre-wrap leading-5 text-[var(--text-secondary)]">{item.notes}</dd></div> : null}
    </dl>
    {item.kind === "scheduled_work_block" && item.endAt !== undefined ? <section className="mt-5 rounded-xl border border-[var(--border-default)] p-3"><p className="text-micro font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">Duration</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => void onCommit({ action: "resizeWorkBlock", itemId: item.id, endAt: Math.max((item.startAt ?? 0) + 15 * 60_000, item.endAt! - 30 * 60_000), expectedRevision: item.revision })} className="h-8 rounded-lg border border-[var(--border-default)] px-3 text-[11px] font-semibold">− 30 min</button><button type="button" onClick={() => void onCommit({ action: "resizeWorkBlock", itemId: item.id, endAt: item.endAt! + 30 * 60_000, expectedRevision: item.revision })} className="h-8 rounded-lg border border-[var(--border-default)] px-3 text-[11px] font-semibold">+ 30 min</button></div></section> : null}
    {item.linkedWorkIds.length ? <section className="mt-5"><p className="text-micro font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">Linked work</p><div className="mt-2 space-y-2">{item.linkedWorkIds.map((workId) => <button key={workId} type="button" onClick={() => void spectraBus.command("work.open", { workId, surface: "panel" })} className="flex w-full items-center gap-2 rounded-xl border border-[var(--border-default)] px-3 py-2 text-left text-[11px] font-semibold hover:bg-[var(--bg-hover)]"><Link2 className="size-3.5" />Open linked work<ExternalLink className="ml-auto size-3" /></button>)}</div></section> : null}
    {item.source ? <section className="mt-5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]/40 p-3"><p className="flex items-center gap-2 text-[11px] font-semibold"><LockKeyhole className="size-3.5" />Official source</p><p className="mt-1 text-micro leading-4 text-[var(--text-secondary)]">{item.source.provider} controls the official time and deadline. Schedule your work separately.</p>{item.source.url ? <a href={item.source.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-micro font-semibold underline underline-offset-2">Open source<ExternalLink className="size-3" /></a> : null}</section> : null}
    <div className="absolute bottom-5 left-5 right-5"><button type="button" className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border-default)] py-2.5 text-[11px] font-semibold hover:bg-[var(--bg-hover)]"><Sparkles className="size-3.5" />Ask Spectra about this time</button></div>
  </aside>;
}

function CalendarComposer({ timezone, onClose, onCreated }: { timezone: string; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(() => new Date(Date.now() + HOUR).toISOString().slice(0, 16));
  const [end, setEnd] = useState(() => new Date(Date.now() + 2 * HOUR).toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false);
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-black/25 p-4" role="dialog" aria-modal="true" aria-label="Add personal event"><form onSubmit={(event) => { event.preventDefault(); setBusy(true); void calendarPost({ action: "createPersonalItem", kind: "personal_event", title, startAt: Date.parse(start), endAt: Date.parse(end), timezone }).then(onCreated).catch((error) => toast.error(error instanceof Error ? error.message : "Could not add event.")).finally(() => setBusy(false)); }} className="w-full max-w-[460px] rounded-2xl border border-white/50 bg-[var(--bg-elevated)] p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="font-display text-[21px] font-semibold">Add personal event</h2><button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-lg hover:bg-[var(--bg-hover)]"><X className="size-4" /></button></div><label className="mt-5 block text-[11px] font-semibold">Title<input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] outline-none focus:border-[var(--brand-primary)]" /></label><div className="mt-3 grid grid-cols-2 gap-3"><label className="text-[11px] font-semibold">Starts<input type="datetime-local" required value={start} onChange={(event) => setStart(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-[11px]" /></label><label className="text-[11px] font-semibold">Ends<input type="datetime-local" required value={end} onChange={(event) => setEnd(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-[11px]" /></label></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-[12px] font-semibold hover:bg-[var(--bg-hover)]">Cancel</button><button type="submit" disabled={busy || !title.trim()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--text-primary)] px-4 text-[12px] font-semibold text-[var(--bg-primary)] disabled:opacity-40">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}Add event</button></div></form></div>;
}
