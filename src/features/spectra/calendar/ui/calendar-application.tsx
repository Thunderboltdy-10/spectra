"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  GripVertical,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
  | { type: "task"; item: CalendarItem }
  | { type: "block"; item: CalendarItem };

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
      await calendarPost(action);
      await load(true);
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : "Calendar action failed.");
    }
  }

  function resolveDrop(event: React.DragEvent<HTMLDivElement>, day: Date) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    const minutes = Math.round((START_HOUR * 60 + ratio * (END_HOUR - START_HOUR) * 60) / 15) * 15;
    const startAt = new Date(day);
    startAt.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return startAt.getTime();
  }

  function dropOnDay(event: React.DragEvent<HTMLDivElement>, day: Date) {
    event.preventDefault();
    const payload = dragRef.current;
    dragRef.current = null;
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
    void commit({
      action: "moveWorkBlock",
      itemId: payload.item.id,
      startAt,
      endAt: startAt + duration,
      expectedRevision: payload.item.revision,
    });
  }

  return (
    <main className="spectra-wave-y flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <header className="shrink-0 border-b border-[var(--border-subtle)] px-5 py-4 lg:px-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-emerald-700/15 bg-emerald-500/10 text-emerald-800">
              <CalendarDays className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-[25px] font-semibold tracking-[-0.025em]">Calendar</h1>
                {overview ? <CapabilityTruthBadge state={overview.sourceState} /> : null}
              </div>
              <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                Official time stays fixed. Your tasks become movable work blocks.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void load(true)} disabled={refreshing} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border-default)] px-3 text-[12px] font-semibold hover:bg-[var(--bg-hover)] disabled:opacity-50">
              {refreshing ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Refresh
            </button>
            <button type="button" onClick={() => setComposerOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--text-primary)] px-3.5 text-[12px] font-semibold text-[var(--bg-primary)]">
              <Plus className="size-3.5" />
              Add event
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-[var(--border-default)] p-1">
            <button type="button" aria-label="Previous week" onClick={() => setAnchor((current) => new Date(current.getTime() - 7 * DAY))} className="grid size-7 place-items-center rounded-md hover:bg-[var(--bg-hover)]"><ChevronLeft className="size-4" /></button>
            <button type="button" onClick={() => setAnchor(new Date())} className="h-7 rounded-md px-2.5 text-[11px] font-semibold hover:bg-[var(--bg-hover)]">Today</button>
            <button type="button" aria-label="Next week" onClick={() => setAnchor((current) => new Date(current.getTime() + 7 * DAY))} className="grid size-7 place-items-center rounded-md hover:bg-[var(--bg-hover)]"><ChevronRight className="size-4" /></button>
          </div>
          <p className="font-display text-[16px] font-semibold">
            {new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(days[0])}
            {" – "}
            {new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(days[6])}
          </p>
          <span className="text-[11px] text-[var(--text-tertiary)]">{formatFreshness(overview?.lastUpdatedAt)}</span>
        </div>
      </header>

      {error ? (
        <div role="alert" className="mx-5 mt-4 rounded-xl border border-rose-600/20 bg-rose-500/8 px-4 py-3 text-[12px] text-rose-800">{error}</div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="order-2 flex w-full shrink-0 flex-col border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] lg:order-1 lg:w-[270px] lg:border-r lg:border-t-0">
          <section className="border-b border-[var(--border-subtle)] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Unscheduled</h2>
              <span className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-micro font-semibold">{overview?.unscheduledTasks.length ?? 0}</span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-[var(--text-secondary)]">Drag a task into the week. Its official deadline will not move.</p>
          </section>
          <div className="max-h-[220px] flex-1 space-y-2 overflow-y-auto p-3 lg:max-h-none">
            {loading ? <div className="flex items-center gap-2 p-3 text-[11px] text-[var(--text-tertiary)]"><LoaderCircle className="size-3.5 animate-spin" /> Loading tasks…</div> : null}
            {!loading && !(overview?.unscheduledTasks.length) ? <div className="rounded-xl border border-dashed border-[var(--border-default)] p-4 text-center text-[11px] leading-5 text-[var(--text-tertiary)]">No unscheduled tasks. Create one here or from a Plan.</div> : null}
            {overview?.unscheduledTasks.map((task) => (
              <button key={task.id} type="button" draggable onDragStart={() => { dragRef.current = { type: "task", item: task }; }} onClick={() => setSelected(task)} className="group flex w-full items-start gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] p-2.5 text-left shadow-sm hover:border-amber-600/30">
                <GripVertical className="mt-0.5 size-3.5 shrink-0 text-[var(--text-tertiary)]" />
                <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold">{task.title}</span><span className="mt-1 block text-micro text-[var(--text-tertiary)]">{task.planArtifactId ? "From Plan" : task.source?.provider ? "From school" : "Personal task"}</span></span>
              </button>
            ))}
          </div>
          <section className="border-t border-[var(--border-subtle)] p-4">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Layers</h2>
            <div className="mt-2 space-y-1">
              {CALENDAR_LAYERS.filter((layer) => layer.key !== "shared").map((layer) => (
                <label key={layer.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-[11px] hover:bg-[var(--bg-hover)]">
                  <input type="checkbox" checked={visibleLayers.has(layer.key)} onChange={() => setVisibleLayers((current) => { const next = new Set(current); if (next.has(layer.key)) next.delete(layer.key); else next.add(layer.key); return next; })} />
                  <span className="size-2 rounded-full" style={{ background: layer.color }} />
                  <span className="flex-1">{layer.label}</span>
                </label>
              ))}
            </div>
          </section>
        </aside>

        <section className="order-1 min-h-[520px] min-w-0 flex-1 overflow-auto lg:order-2 lg:min-h-0">
          <div className="min-w-[760px] p-3 lg:p-4">
            {overview ? <CapabilityTruthState state={overview.sourceState} title="School calendar" onRetry={() => void load(true)} /> : null}
            <div className="mt-3 grid grid-cols-[54px_repeat(7,minmax(96px,1fr))] overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)]">
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
                return <div key={day.toISOString()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropOnDay(event, day)} className="relative border-r border-[var(--border-subtle)] last:border-r-0" style={{ height: (END_HOUR - START_HOUR) * 52 }}>
                  {Array.from({ length: END_HOUR - START_HOUR }, (_, index) => <div key={index} className="absolute inset-x-0 border-t border-[var(--border-subtle)]" style={{ top: index * 52 }} />)}
                  {dayItems.map((item) => {
                    const layer = CALENDAR_LAYERS.find((candidate) => candidate.key === layerFor(item))!;
                    const top = Math.max(0, (((new Date(item.startAt!).getHours() + new Date(item.startAt!).getMinutes() / 60) - START_HOUR) / (END_HOUR - START_HOUR)) * 100);
                    const duration = Math.max(30 * 60_000, item.endAt! - item.startAt!);
                    const height = Math.max(24, (duration / HOUR) * 52);
                    return <button key={item.id} type="button" draggable={item.kind === "scheduled_work_block"} onDragStart={() => { if (item.kind === "scheduled_work_block") dragRef.current = { type: "block", item }; }} onClick={() => setSelected(item)} className="absolute inset-x-1 z-10 overflow-hidden rounded-lg border px-2 py-1.5 text-left shadow-sm hover:z-20 hover:shadow-md" style={{ top: `${top}%`, height, borderColor: `${layer.color}55`, background: `color-mix(in oklab, ${layer.color} 13%, var(--bg-elevated))`, color: layer.color }}>
                      <span className="flex items-center gap-1 text-micro font-bold"><span className="truncate">{formatTime(item.startAt!, timezone)}</span>{item.sourceLocked ? <LockKeyhole className="size-2.5" /> : null}</span><span className="mt-0.5 block truncate text-micro font-semibold text-[var(--text-primary)]">{item.title}</span>
                    </button>;
                  })}
                </div>;
              })}
            </div>

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
