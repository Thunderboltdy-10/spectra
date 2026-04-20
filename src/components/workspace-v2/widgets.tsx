"use client";

import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { Icon, type IconName } from "./icons";
import type { V2Item } from "./data";

export type WidgetKind =
  | "timer"
  | "planner"
  | "today"
  | "timetable"
  | "scratch"
  | "calendar"
  | "thread"
  | "artifact";

export type FloatingWidgetData = {
  id: string;
  kind: WidgetKind;
  x: number;
  y: number;
  w: number;
  h: number;
  state: Record<string, unknown>;
  collapsed?: boolean;
  /** Anchor side used when collapsed; computed at drop (mouse-up). */
  collapseAnchor?: "left" | "right";
};

const WIDGET_META: Record<WidgetKind, { label: string; short: string; icon: IconName; defaultSize: { w: number; h: number }; color: string }> = {
  timer:    { label: "Focus timer",  short: "Timer",    icon: "timer",    defaultSize: { w: 288, h: 132 }, color: "#e05137" },
  planner:  { label: "Week planner", short: "Plan",     icon: "planner",  defaultSize: { w: 300, h: 278 }, color: "#0e8ee8" },
  today:    { label: "Today",        short: "Today",    icon: "schedule", defaultSize: { w: 296, h: 230 }, color: "#20b8b2" },
  timetable:{ label: "Timetable",    short: "Table",    icon: "schedule", defaultSize: { w: 308, h: 248 }, color: "#6b5f52" },
  scratch:  { label: "Scratchpad",   short: "Note",     icon: "note",     defaultSize: { w: 304, h: 232 }, color: "#b67616" },
  calendar: { label: "Calendar",     short: "Calendar", icon: "schedule", defaultSize: { w: 312, h: 270 }, color: "#6b5f52" },
  thread:   { label: "Thread",        short: "Thread",   icon: "thread",   defaultSize: { w: 340, h: 320 }, color: "#0e8ee8" },
  artifact: { label: "Artifact",      short: "Artifact", icon: "note",     defaultSize: { w: 380, h: 300 }, color: "#b67616" },
};

export const WIDGET_KINDS: WidgetKind[] = ["timer", "planner", "today", "timetable", "scratch", "calendar", "artifact"];

export function defaultWidgetSize(kind: WidgetKind) {
  return WIDGET_META[kind].defaultSize;
}

/* ─── Inner widgets ─── */

function TimerInner({
  widget, onToggle, onReset,
}: {
  widget: FloatingWidgetData;
  onToggle: () => void;
  onReset: (secs: number) => void;
}) {
  const s = (widget.state.secs as number) ?? 25 * 60;
  const total = Math.max(1, Number(widget.state.totalSecs ?? 25 * 60));
  const running = Boolean(widget.state.running);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  const pct = Math.max(0, Math.min(1, 1 - s / total));
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="font-display text-[34px] tabular-nums leading-none" style={{ color: "var(--ink-100)" }}>
          {mm}:{ss}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] mt-1.5" style={{ color: "var(--ink-400)" }}>
          {running ? "focus in progress" : "pomodoro · 25/5"}
        </div>
        <div className="mt-2 h-[3px] w-[120px] rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
          <div className="h-full" style={{
            width: `${Math.round(pct * 100)}%`,
            background: running ? "var(--accent)" : "var(--ink-300)",
            transition: "width 400ms cubic-bezier(0.22,1,0.36,1)"
          }} />
        </div>
      </div>
      <div data-nodrag className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onReset(25 * 60)}
          className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--bg2)]"
          style={{ border: "1px solid var(--line)", color: "var(--ink-400)" }}
          title="Reset"
        >
          <Icon name="undo" size={11} />
        </button>
        <button
          onClick={onToggle}
          className="h-8 px-3 rounded-full text-[10.5px] font-mono uppercase tracking-[0.14em] font-medium transition-transform hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: running ? "var(--coral)" : "var(--accent)", color: "#fff" }}
        >
          {running ? "Pause" : "Start"}
        </button>
      </div>
    </div>
  );
}

function PlannerInner({ onAsk, onOpenItem, widget }: { onAsk: (q: string) => void; onOpenItem?: (id: string) => void; widget: FloatingWidgetData }) {
  const plannedItems = useMemo(() => {
    const raw = Array.isArray(widget.state.items) ? widget.state.items : [];
    return raw
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const r = entry as Record<string, unknown>;
        return {
          id: typeof r.id === "string" ? r.id : "",
          title: typeof r.title === "string" ? r.title : "Untitled",
          status: typeof r.status === "string" ? r.status : "pending",
          dueAt: typeof r.dueAt === "number" ? r.dueAt : undefined,
        };
      })
      .filter((e): e is NonNullable<typeof e> => Boolean(e?.id));
  }, [widget.state.items]);

  return (
    <div data-nodrag>
      <div className="flex items-center justify-between mb-2">
        <span className="font-display text-[15px]" style={{ color: "var(--ink-100)" }}>This week</span>
        <button
          onClick={() => onAsk("Rebalance my plan for this week")}
          className="text-[10px] font-mono uppercase tracking-[0.12em] flex items-center gap-1 transition-colors hover:text-[var(--mint)]"
          style={{ color: "var(--accent)" }}
        >
          <Icon name="sparkle" size={9} />auto-balance
        </button>
      </div>
      <div className="space-y-1">
        {plannedItems.length > 0 ? plannedItems.slice(0, 5).map((it) => (
          <button
            key={it.id}
            onClick={() => onOpenItem?.(it.id)}
            className="w-full flex gap-2 items-start py-1 rounded transition-colors hover:bg-[var(--bg2)] px-1 -mx-1 text-left"
            style={{ borderTop: "1px solid rgba(221,216,207,0.5)" }}
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] w-8 pt-0.5"
                  style={{ color: "var(--ink-400)" }}>{it.dueAt ? new Date(it.dueAt).toLocaleDateString(undefined, { weekday: "short" }) : "—"}</span>
            <div className="flex-1 text-[11.5px] flex items-center gap-1.5"
                 style={{ color: it.status === "completed" ? "var(--ok)" : "var(--ink-200)" }}>
              <div className="w-1 h-1 rounded-full shrink-0"
                   style={{ background: it.status === "completed" ? "var(--ok)" : "var(--accent)" }} />
              <span className="truncate" style={{ fontWeight: it.status === "completed" ? 600 : 400 }}>{it.title}</span>
            </div>
          </button>
        )) : (
          <div className="text-[12px] leading-relaxed py-3" style={{ color: "var(--ink-400)" }}>
            No planner items yet. Ask quick chat to build a weekly plan.
          </div>
        )}
      </div>
    </div>
  );
}

function TodayInner({ onAsk, onOpenItem, widget }: { onAsk: (q: string) => void; onOpenItem?: (id: string) => void; widget: FloatingWidgetData }) {
  const tasks = useMemo(() => {
    const raw = Array.isArray(widget.state.items) ? widget.state.items : [];
    return raw
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const r = entry as Record<string, unknown>;
        return {
          id: typeof r.id === "string" ? r.id : "",
          title: typeof r.title === "string" ? r.title : "Untitled",
          status: typeof r.status === "string" ? r.status : "pending",
        };
      })
      .filter((e): e is { id: string; title: string; status: string } => Boolean(e?.id));
  }, [widget.state.items]);
  const completedCount = typeof widget.state.completedCount === "number" ? widget.state.completedCount : tasks.filter((t) => t.status === "completed").length;
  const count = typeof widget.state.total === "number" ? widget.state.total : tasks.length;

  return (
    <div data-nodrag>
      <div className="flex items-center justify-between mb-2">
        <span className="font-display text-[15px]" style={{ color: "var(--ink-100)" }}>Today · {count}</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: "var(--ok)" }}>{completedCount} done</span>
      </div>
      <div className="space-y-1.5">
        {tasks.length > 0 ? tasks.slice(0, 4).map((it) => {
          const done = it.status === "completed";
          return (
            <button key={it.id} onClick={() => onOpenItem?.(it.id)}
                 className="w-full flex items-center gap-2 py-1 rounded transition-colors hover:bg-[var(--bg2)] px-1 -mx-1 text-left">
              <div className="w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0"
                   style={{ borderColor: "var(--accent)", background: done ? "var(--accent)" : "transparent" }}>
                {done && <Icon name="check" size={8} stroke="#fff" />}
              </div>
              <Icon name="schedule" size={11} style={{ color: "var(--ink-400)" }} />
              <span className="text-[11.5px] flex-1 truncate"
                    style={{
                      color: done ? "var(--ink-400)" : "var(--ink-200)",
                      textDecoration: done ? "line-through" : "none",
                    }}>{it.title}</span>
            </button>
          );
        }) : (
          <div className="text-[12px] leading-relaxed py-3" style={{ color: "var(--ink-400)" }}>
            Nothing scheduled. Ask: &ldquo;what should I start?&rdquo;
          </div>
        )}
      </div>
      <button
        onClick={() => onAsk("What's the most impactful thing to do right now?")}
        className="mt-2 w-full text-[10.5px] font-mono uppercase tracking-[0.12em] flex items-center gap-1 justify-center py-1 rounded transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        style={{ color: "var(--ink-300)", border: "1px dashed var(--line)" }}
      >
        <Icon name="sparkle" size={9} />what should I start?
      </button>
    </div>
  );
}

function ScratchpadInner({ widget, onEdit }: { widget: FloatingWidgetData; onEdit?: (state: Record<string, unknown>) => void }) {
  const [txt, setTxt] = useState((widget.state.text as string) ?? "");
  useEffect(() => {
    setTxt((widget.state.text as string) ?? "");
  }, [widget.state.text]);
  return (
    <textarea
      data-nodrag
      value={txt}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => onEdit?.({ text: txt })}
      placeholder="Jot anything here. Outlast the noise."
      className="w-full h-[160px] bg-transparent outline-none font-mono text-[12px] resize-none sv2-slim placeholder:text-[var(--ink-400)]"
      style={{ color: "var(--ink-100)" }}
    />
  );
}

function TimetableInner({ widget, onOpenItem }: { widget: FloatingWidgetData; onOpenItem?: (id: string) => void }) {
  const entries = useMemo(() => Array.isArray(widget.state.days) ? widget.state.days as Array<Record<string, unknown>> : [], [widget.state.days]);
  const grouped = entries
    .map((entry) => ({
      day: typeof entry.day === "string" ? entry.day : "",
      count: typeof entry.count === "number" ? entry.count : 0,
      items: Array.isArray(entry.items) ? entry.items as Array<Record<string, unknown>> : [],
    }))
    .filter((entry) => entry.day);
  return (
    <div data-nodrag className="space-y-1">
      {grouped.slice(0, 5).map((entry, i) => {
        const top = entry.items[0];
        const topId = typeof top?.id === "string" ? top.id : undefined;
        const label = new Date(entry.day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
        return (
          <button key={entry.day} onClick={() => { if (topId) onOpenItem?.(topId); }}
               className="w-full flex items-start gap-2 py-1.5 rounded transition-colors hover:bg-[var(--bg2)] px-1 -mx-1 text-left"
               style={{ borderTop: i === 0 ? "none" : "1px solid rgba(221,216,207,0.5)" }}>
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] w-16 pt-0.5" style={{ color: "var(--ink-400)" }}>{label}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11.5px] truncate" style={{ color: "var(--ink-200)" }}>
                {entry.count > 0 ? `${entry.count} scheduled item${entry.count === 1 ? "" : "s"}` : "Open schedule"}
              </div>
              {typeof top?.title === "string" && (
                <div className="text-[10.5px] truncate mt-0.5" style={{ color: "var(--ink-400)" }}>{top.title}</div>
              )}
            </div>
          </button>
        );
      })}
      {grouped.length === 0 && (
        <div className="text-[12px] leading-relaxed py-3" style={{ color: "var(--ink-400)" }}>
          No upcoming schedule yet in this workspace.
        </div>
      )}
    </div>
  );
}

function CalendarInner({ widget, onOpenItem }: { widget: FloatingWidgetData; onOpenItem?: (id: string) => void }) {
  const days = ["S", "M", "T", "W", "T", "F", "S"];
  const entries = useMemo(() => Array.isArray(widget.state.days) ? widget.state.days as Array<Record<string, unknown>> : [], [widget.state.days]);
  const byDay = new Map(entries.map((entry) => [typeof entry.day === "string" ? entry.day : "", entry]));
  const today = new Date();
  const month = today.getMonth();
  const year = today.getFullYear();
  const todayKey = today.toISOString().slice(0, 10);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return (
    <div data-nodrag>
      <div className="flex items-center justify-between mb-2">
        <span className="font-display text-[14px]" style={{ color: "var(--ink-100)" }}>
          {today.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: "var(--ink-400)" }}>
          Week {Math.ceil((today.getDate() + new Date(year, month, 1).getDay()) / 7)}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {days.map((d, i) => (
          <div key={i} className="font-mono text-[9px] uppercase py-1" style={{ color: "var(--ink-400)" }}>{d}</div>
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const date = new Date(year, month, day);
          const key = date.toISOString().slice(0, 10);
          const entry = byDay.get(key);
          const hasItems = Boolean(entry && Number(entry.count ?? 0) > 0);
          const isToday = key === todayKey;
          const itemId = Array.isArray(entry?.items) && entry?.items[0] && typeof (entry.items[0] as Record<string, unknown>).id === "string"
            ? ((entry.items[0] as Record<string, unknown>).id as string)
            : undefined;
          return (
            <button
              type="button"
              key={i}
              className="text-[10.5px] py-1 rounded relative"
              style={{
                background: isToday ? "var(--accent)" : hasItems ? "rgba(14,142,232,0.12)" : "transparent",
                color: isToday ? "#fff" : hasItems ? "var(--accent)" : "var(--ink-200)",
                fontWeight: isToday || hasItems ? 600 : 400,
              }}
              onClick={() => { if (itemId) onOpenItem?.(itemId); }}
              disabled={!itemId && !isToday}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Widget body switch ─── */
function WidgetBody({ widget, onTimerToggle, onTimerReset, onAsk, onWidgetEdit, onOpenItem, items }: {
  widget: FloatingWidgetData;
  onTimerToggle: (id: string) => void;
  onTimerReset: (id: string, secs: number) => void;
  onAsk: (text: string) => void;
  onWidgetEdit?: (id: string, state: Record<string, unknown>) => void;
  onOpenItem?: (id: string) => void;
  items: V2Item[];
}) {
  void items;
  switch (widget.kind) {
    case "timer":    return <TimerInner widget={widget} onToggle={() => onTimerToggle(widget.id)} onReset={(s) => onTimerReset(widget.id, s)} />;
    case "planner":  return <PlannerInner widget={widget} onAsk={onAsk} onOpenItem={onOpenItem} />;
    case "today":    return <TodayInner widget={widget} onAsk={onAsk} onOpenItem={onOpenItem} />;
    case "scratch":  return <ScratchpadInner widget={widget} onEdit={(s) => onWidgetEdit?.(widget.id, s)} />;
    case "timetable": return <TimetableInner widget={widget} onOpenItem={onOpenItem} />;
    case "calendar": return <CalendarInner widget={widget} onOpenItem={onOpenItem} />;
  }
}

/* ─── Live chip preview (still-carries-info when collapsed) ─── */
function ChipPreview({ widget, tick }: { widget: FloatingWidgetData; tick: number }) {
  void tick; /* forces re-render on timer tick */
  if (widget.kind === "timer") {
    const s = (widget.state.secs as number) ?? 25 * 60;
    const running = Boolean(widget.state.running);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return (
      <span className="font-mono text-[11px] tabular-nums" style={{ color: running ? "var(--accent)" : "var(--ink-200)", fontWeight: 600 }}>
        {mm}:{ss}
      </span>
    );
  }
  if (widget.kind === "today") {
    const total = typeof widget.state.total === "number" ? widget.state.total : 0;
    const done = typeof widget.state.completedCount === "number" ? widget.state.completedCount : 0;
    return <span className="font-mono text-[10.5px]" style={{ color: "var(--ink-300)" }}>{done}/{total}</span>;
  }
  if (widget.kind === "planner") {
    const items = Array.isArray(widget.state.items) ? widget.state.items.length : 0;
    return <span className="font-mono text-[10.5px]" style={{ color: "var(--ink-300)" }}>{items}</span>;
  }
  if (widget.kind === "timetable") {
    const days = Array.isArray(widget.state.days) ? widget.state.days.length : 0;
    return <span className="font-mono text-[10.5px]" style={{ color: "var(--ink-300)" }}>{days}</span>;
  }
  if (widget.kind === "scratch") {
    const t = typeof widget.state.text === "string" ? (widget.state.text as string).trim() : "";
    const words = t ? t.split(/\s+/).length : 0;
    return <span className="font-mono text-[10.5px]" style={{ color: "var(--ink-300)" }}>{words}w</span>;
  }
  if (widget.kind === "calendar") {
    const d = new Date();
    return <span className="font-mono text-[10.5px]" style={{ color: "var(--ink-300)" }}>{d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>;
  }
  return null;
}

/* ─── FloatingWidget (expanded + in-place collapsed) ─── */

type FloatingProps = {
  widget: FloatingWidgetData;
  workspaceItems?: V2Item[];
  /** Tick counter to force rerender of collapsed live-preview. */
  tick?: number;
  onMove: (id: string, x: number, y: number) => void;
  onClose: (id: string) => void;
  onCollapse: (id: string) => void;
  onExpand: (id: string) => void;
  onTimerToggle: (id: string) => void;
  onTimerReset: (id: string, secs: number) => void;
  aiTouched?: boolean;
  onAsk: (text: string) => void;
  onWidgetEdit?: (id: string, state: Record<string, unknown>) => void;
  onOpenItem?: (id: string) => void;
  /** Optional expand-to-bloom handler; wired by Agent A later. */
  onExpandEdit?: (id: string) => void;
  /** Called on drag end with the anchor side (left/right) computed from drop x. */
  onDropAnchor?: (id: string, anchor: "left" | "right") => void;
  /** Whether this widget is currently in its reveal pulse. */
  isRevealing?: boolean;
};

const COLLAPSED_W = 260;
const COLLAPSED_H = 56;

export function FloatingWidget({
  widget, workspaceItems = [], tick = 0, onMove, onClose, onCollapse, onExpand,
  onTimerToggle, onTimerReset, aiTouched, onAsk, onWidgetEdit, onOpenItem, onExpandEdit,
  onDropAnchor, isRevealing,
}: FloatingProps) {
  void onExpandEdit;
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  // `mounted` gates any viewport-dependent clamp logic so server and client
  // render the exact same positions on first paint → no hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const isCollapsed = Boolean(widget.collapsed);
  const anchor: "left" | "right" = widget.collapseAnchor ?? "left";

  const measureBounds = useCallback(() => {
    const rect = frameRef.current?.getBoundingClientRect();
    const viewportW = typeof window !== "undefined" ? window.innerWidth : 0;
    const viewportH = typeof window !== "undefined" ? window.innerHeight : 0;
    const currentW = rect?.width ?? (isCollapsed ? COLLAPSED_W : widget.w);
    const currentH = rect?.height ?? (isCollapsed ? COLLAPSED_H : widget.h);
    return {
      width: currentW,
      height: currentH,
      maxX: Math.max(16, viewportW - currentW - 16),
      maxY: Math.max(84, viewportH - currentH - 20),
    };
  }, [isCollapsed, widget.h, widget.w]);

  const onDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: widget.x, oy: widget.y, moved: false };
    let lastX = widget.x;
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const bounds = measureBounds();
      const nx = Math.max(16, Math.min(bounds.maxX, d.ox + (ev.clientX - d.sx)));
      const ny = Math.max(84, Math.min(bounds.maxY, d.oy + (ev.clientY - d.sy)));
      if (Math.abs(ev.clientX - d.sx) > 2 || Math.abs(ev.clientY - d.sy) > 2) d.moved = true;
      lastX = nx;
      onMove(widget.id, nx, ny);
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (!d?.moved) return;
      // Compute collapse anchor from drop x (widget center vs viewport midline)
      if (onDropAnchor && typeof window !== "undefined") {
        const bounds = measureBounds();
        const center = lastX + bounds.width / 2;
        const side: "left" | "right" = center < window.innerWidth / 2 ? "left" : "right";
        if (side !== widget.collapseAnchor) onDropAnchor(widget.id, side);
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const meta = WIDGET_META[widget.kind];

  // When anchored right, shift `left` by (expanded.w - collapsed.w) so the expanded
  // panel's RIGHT edge aligns with the collapsed pill's right edge. This makes the
  // morph appear to slide/grow from the right side. Clamp to viewport on both ends.
  // Render-only shift (does not mutate widget.x).
  let renderLeft = widget.x;
  if (!isCollapsed && mounted) {
    if (anchor === "right") {
      renderLeft = widget.x + (COLLAPSED_W - widget.w);
    }
    if (typeof window !== "undefined") {
      const maxLeft = window.innerWidth - widget.w - 16;
      if (renderLeft > maxLeft) renderLeft = Math.max(16, maxLeft);
      if (renderLeft < 16) renderLeft = 16;
    }
  }

  const morphClass = anchor === "right" ? "sv2-morph-right" : "sv2-morph-left";

  return (
    <div
      ref={frameRef}
      data-widget
      className={`absolute z-20 pointer-events-auto overflow-hidden sv2-widget-morph ${morphClass} anchor-${anchor} sv2-widget-in ${
        isCollapsed ? "is-collapsed" : ""
      } ${aiTouched ? "sv2-ai-touched" : ""} ${isRevealing ? "sv2-chip-reveal" : ""}`}
      style={{
        left: renderLeft,
        top: widget.y,
        width: isCollapsed ? COLLAPSED_W : widget.w,
        height: isCollapsed ? COLLAPSED_H : widget.h,
        borderRadius: isCollapsed ? 14 : 16,
        background: isCollapsed ? `${meta.color}12` : "rgba(251,250,246,0.97)",
        border: `1px solid ${isCollapsed ? `${meta.color}28` : "var(--line)"}`,
        boxShadow: isCollapsed ? "0 3px 10px rgba(8,22,40,0.06)" : "0 24px 54px -30px rgba(8,22,40,0.22)",
        backdropFilter: "blur(12px)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* ─── Rich in-place collapsed pill (layered; opacity-toggled by .is-collapsed) ─── */}
      <div
        onMouseDown={onDown}
        onClick={() => {
          if (!isCollapsed) return;
          if (!dragRef.current?.moved) onExpand(widget.id);
        }}
        className="sv2-widget-collapsed-shell absolute inset-0 flex items-center gap-2.5 px-3 cursor-pointer"
        style={{ background: "transparent", border: "none", borderRadius: 14 }}
        title={`Expand ${meta.label}`}
      >
        <span
          className="flex items-center justify-center w-8 h-8 rounded-xl shrink-0"
          style={{ color: meta.color, background: `${meta.color}16` }}
        >
          <Icon name={meta.icon} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="font-mono text-[9px] uppercase tracking-[0.13em] truncate"
            style={{ color: "var(--ink-400)" }}
          >
            {meta.short}
          </div>
          <div className="text-[11.5px] truncate" style={{ color: "var(--ink-200)" }}>
            {meta.label}
          </div>
        </div>
        <span className="ml-auto pl-1 shrink-0">
          <ChipPreview widget={widget} tick={tick} />
        </span>
      </div>

      {/* ─── Expanded shell (layered; opacity-toggled by .is-collapsed) ─── */}
      <div className="sv2-widget-expanded-shell absolute inset-0 flex flex-col">
        <div
          onMouseDown={onDown}
          className="cursor-grab active:cursor-grabbing flex items-center justify-between px-2.5 shrink-0"
          style={{
            height: 40,
            borderBottom: "1px solid rgba(221,216,207,0.55)",
            background: `linear-gradient(90deg, ${meta.color}12, transparent 60%)`,
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="shrink-0 flex items-center justify-center" style={{ color: meta.color }}>
              <Icon name={meta.icon} size={11} />
            </div>
            <span
              className="font-mono text-[10px] uppercase tracking-[0.14em] truncate"
              style={{ color: "var(--ink-300)" }}
            >
              {meta.label}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0" data-nodrag>
            <button
              onClick={(e) => { e.stopPropagation(); onCollapse(widget.id); }}
              className="w-7 h-7 rounded flex items-center justify-center hover:bg-[var(--bg2)]"
              style={{ color: "var(--ink-400)" }}
              title="Collapse"
            >
              <Icon name="collapse" size={10} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(widget.id); }}
              className="w-7 h-7 rounded flex items-center justify-center hover:bg-[var(--bg2)]"
              style={{ color: "var(--ink-400)" }}
              title="Remove widget"
            >
              <Icon name="close" size={10} />
            </button>
          </div>
        </div>
        <div className="p-3.5 flex-1 overflow-y-auto sv2-slim">
          <WidgetBody
            widget={widget}
            items={workspaceItems}
            onTimerToggle={onTimerToggle}
            onTimerReset={onTimerReset}
            onAsk={onAsk}
            onWidgetEdit={onWidgetEdit}
            onOpenItem={onOpenItem}
          />
        </div>
      </div>
    </div>
  );
}

/* ─── ArtifactWidget — single-instance content panel (single-click open) ─── */

type ArtifactWidgetProps = {
  item: V2Item;
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed?: boolean;
  onMove: (x: number, y: number) => void;
  onClose: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  onEdit: (patch: { title?: string; body?: string }) => void;
};

export function ArtifactWidget({ item, x, y, w, h, collapsed, onMove, onClose, onCollapse, onExpand, onEdit }: ArtifactWidgetProps) {
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const onDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: x, oy: y };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const rect = frameRef.current?.getBoundingClientRect();
      const width = rect?.width ?? (collapsed ? 120 : w);
      const height = rect?.height ?? (collapsed ? 36 : h);
      onMove(
        Math.max(16, Math.min(window.innerWidth - width - 16, d.ox + (ev.clientX - d.sx))),
        Math.max(84, Math.min(window.innerHeight - height - 20, d.oy + (ev.clientY - d.sy))),
      );
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body ?? item.preview ?? "");
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setTitle(item.title);
    setBody(item.body ?? item.preview ?? "");
    setHydrated(false);
  }, [item.id, item.title, item.body, item.preview]);

  useEffect(() => {
    if (hydrated) return;
    let cancelled = false;
    const fetchArtifact = async () => {
      if (item.sourceArtifactId) {
        try {
          const res = await fetch(`/api/artifacts?artifactId=${item.sourceArtifactId}`);
          const data = await res.json();
          if (!cancelled && (data.artifact?.contentPlaintext || data.artifact?.content)) {
            setBody(data.artifact.contentPlaintext || data.artifact.content);
          }
        } catch { /* best-effort */ }
      } else if (item.sourcePlannerItemId) {
        try {
          const res = await fetch(`/api/planner-items?plannerItemId=${item.sourcePlannerItemId}`);
          const data = await res.json();
          if (!cancelled && data.plannerItem?.description) {
            setBody(data.plannerItem.description);
          }
        } catch { /* best-effort */ }
      }
      if (!cancelled) setHydrated(true);
    };
    fetchArtifact();
    return () => { cancelled = true; };
  }, [hydrated, item.sourceArtifactId, item.sourcePlannerItemId]);

  const kindColor = item.color;
  const isCollapsed = Boolean(collapsed);
  const isWorkspacePanel = item.id === "artifact-panel";

  // Inline title rename — read-only until double-clicked
  const [titleEditing, setTitleEditing] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  // Reset edit state when item changes
  useEffect(() => { setTitleEditing(false); }, [item.id]);

  const commitTitle = useCallback(() => {
    setTitleEditing(false);
    if (isWorkspacePanel) return;
    const next = title.trim();
    if (!next || next === item.title) {
      setTitle(item.title);
      return;
    }
    onEdit({ title: next });
  }, [isWorkspacePanel, item.title, onEdit, title]);

  const cancelTitle = useCallback(() => {
    setTitle(item.title);
    setTitleEditing(false);
  }, [item.title]);

  const beginTitleEdit = () => {
    if (isWorkspacePanel) return;
    setTitleEditing(true);
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  };

  return (
    <div
      ref={frameRef}
      data-widget data-bloom-editor="1"
      className={`absolute z-30 pointer-events-auto overflow-hidden sv2-widget-morph sv2-morph-left anchor-left sv2-widget-in ${
        isCollapsed ? "is-collapsed" : ""
      }`}
      style={{
        left: x, top: y,
        width: isCollapsed ? 240 : w,
        height: isCollapsed ? 44 : h,
        borderRadius: isCollapsed ? 14 : 16,
        background: "var(--paper)",
        border: `1px solid ${isCollapsed ? `${kindColor}30` : "var(--line)"}`,
        boxShadow: isCollapsed ? "0 3px 10px rgba(8,22,40,0.06)" : "0 40px 80px -30px rgba(8,22,40,0.28), 0 0 0 1px rgba(14,142,232,0.06)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* ─── Rich collapsed pill ─── */}
      <div
        onMouseDown={onDown}
        onClick={() => { if (isCollapsed) onExpand(); }}
        className="sv2-widget-collapsed-shell absolute inset-0 flex items-center gap-2.5 px-3 cursor-pointer"
        style={{ background: "transparent", border: "none", borderRadius: 14 }}
        title={`Expand ${isWorkspacePanel ? "Artifacts" : item.title}`}
      >
        <span className="flex items-center justify-center w-7 h-7 rounded-xl shrink-0"
              style={{ color: kindColor, background: `${kindColor}16` }}>
          <Icon name="note" size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[9px] uppercase tracking-[0.13em]"
               style={{ color: "var(--ink-400)" }}>Artifact</div>
          <div className="text-[11.5px] truncate" style={{ color: "var(--ink-200)" }}>
            {isWorkspacePanel ? "Artifacts" : item.title}
          </div>
        </div>
      </div>

      {/* ─── Expanded shell ─── */}
      <div className="sv2-widget-expanded-shell absolute inset-0 flex flex-col">
          <div
            onMouseDown={onDown}
            className="cursor-grab active:cursor-grabbing flex items-center justify-between px-4 shrink-0"
            style={{
              height: 44,
              borderBottom: "1px solid rgba(221,216,207,0.55)",
              background: `linear-gradient(90deg, ${kindColor}14, transparent 60%)`,
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: kindColor }} />
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] shrink-0" style={{ color: "var(--ink-400)" }}>
                Artifact
              </span>
              <span className="font-mono text-[10px] tracking-[0.1em] opacity-60 shrink-0" style={{ color: "var(--ink-400)" }}>
                · {item.updated || "open"}
              </span>
            </div>
            <div className="flex items-center gap-1" data-nodrag>
              <button
                onClick={(e) => { e.stopPropagation(); onCollapse(); }}
                className="w-7 h-7 rounded flex items-center justify-center hover:bg-[var(--bg2)]"
                style={{ color: "var(--ink-400)" }}
                title="Collapse"
              >
                <Icon name="collapse" size={11} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="w-7 h-7 rounded flex items-center justify-center hover:bg-[var(--bg2)]"
                style={{ color: "var(--ink-400)" }}
                title="Close (Esc)"
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          </div>
          {isWorkspacePanel ? (
            /* ─── Blueprint empty-state ─── */
            <div className="flex-1 flex flex-col p-5" data-nodrag>
              <div className="sv2-artifact-blueprint flex-1 flex flex-col items-center justify-center gap-4 p-6 rounded-xl">
                <div className="text-center">
                  <div className="font-display text-[18px] leading-tight" style={{ color: "var(--ink-100)" }}>
                    Start a new artifact
                  </div>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--ink-400)" }}>
                    Pick a starting point
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 w-full max-w-[260px]">
                  {([
                    { label: "Note", action: "newNote", icon: "note" as IconName },
                    { label: "Visual", action: "newVisual", icon: "layers" as IconName },
                    { label: "Code", action: "newCode", icon: "pset" as IconName },
                    { label: "Thread", action: "newThread", icon: "thread" as IconName },
                  ] as const).map((b) => (
                    <button
                      key={b.action}
                      type="button"
                      className="sv2-quick-create-btn justify-center"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent("workspace:context-action", { detail: { action: b.action } }));
                      }}
                    >
                      <Icon name={b.icon} size={11} />
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em]">{b.label}</span>
                    </button>
                  ))}
                </div>
                <div className="text-[11px] italic" style={{ color: "var(--ink-400)" }}>
                  or ask the quick chat below
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="px-6 pt-5 pb-2 shrink-0" data-nodrag>
                <input
                  ref={titleInputRef}
                  value={title}
                  readOnly={!titleEditing}
                  onChange={(e) => setTitle(e.target.value)}
                  onDoubleClick={beginTitleEdit}
                  onBlur={() => { if (titleEditing) commitTitle(); }}
                  onKeyDown={(e) => {
                    if (!titleEditing) return;
                    if (e.key === "Enter") { e.preventDefault(); commitTitle(); titleInputRef.current?.blur(); }
                    else if (e.key === "Escape") { e.preventDefault(); cancelTitle(); titleInputRef.current?.blur(); }
                  }}
                  className="w-full bg-transparent outline-none font-display text-[24px] leading-[1.1]"
                  style={{ color: "var(--ink-100)", cursor: titleEditing ? "text" : "pointer" }}
                  title={titleEditing ? "Press Enter to save, Esc to cancel" : "Double-click to rename"}
                />
                <div className="mt-2 h-px w-12" style={{ background: kindColor, opacity: 0.55 }} />
              </div>
              <div className="flex-1 overflow-y-auto sv2-slim px-6 pb-5" data-nodrag>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onBlur={() => onEdit({ body })}
                  placeholder="Start writing…"
                  className="w-full h-full bg-transparent outline-none resize-none text-[13.5px] leading-[1.72] font-display placeholder:text-[var(--ink-400)]"
                  style={{ color: "var(--ink-200)", minHeight: 240 }}
                />
              </div>
            </>
          )}
      </div>
    </div>
  );
}

/* ─── ThreadWidget — single-instance, read-only view (typing happens in quick chat) ─── */

type ThreadWidgetProps = {
  item: V2Item;
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed?: boolean;
  onMove: (x: number, y: number) => void;
  onClose: () => void;
  onCollapse: () => void;
  onExpand: () => void;
};

export function ThreadWidget({ item, x, y, w, h, collapsed, onMove, onClose, onCollapse, onExpand }: ThreadWidgetProps) {
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const onDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: x, oy: y };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const rect = frameRef.current?.getBoundingClientRect();
      const width = rect?.width ?? (collapsed ? 120 : w);
      const height = rect?.height ?? (collapsed ? 36 : h);
      onMove(
        Math.max(16, Math.min(window.innerWidth - width - 16, d.ox + (ev.clientX - d.sx))),
        Math.max(84, Math.min(window.innerHeight - height - 20, d.oy + (ev.clientY - d.sy))),
      );
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const [messages, setMessages] = useState<{ role: string; text: string }[]>(item.messages ?? []);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setMessages(item.messages ?? []); }, [item.id, item.messages]);
  useEffect(() => {
    if (!item.sourceChatId) return;
    let cancelled = false;
    fetch(`/api/chat?chatId=${item.sourceChatId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.chat?.messages) {
          setMessages(data.chat.messages.map((m: { role: string; content: string }) => ({ role: m.role, text: m.content })));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.sourceChatId]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const isCollapsed = Boolean(collapsed);

  return (
    <div
      ref={frameRef}
      data-widget data-bloom-editor="1"
      className="absolute z-30 pointer-events-auto overflow-hidden transition-all duration-300 ease-out sv2-widget-in flex flex-col"
      style={{
        left: x, top: y,
        width: isCollapsed ? 120 : w,
        height: isCollapsed ? 36 : h,
        borderRadius: isCollapsed ? 18 : 16,
        background: "var(--paper)",
        border: "1px solid var(--line)",
        boxShadow: isCollapsed ? "0 4px 12px rgba(0,0,0,0.05)" : "0 40px 80px -30px rgba(8,22,40,0.28), 0 0 0 1px rgba(14,142,232,0.10)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        onMouseDown={onDown}
        onClick={() => { if (isCollapsed) onExpand(); }}
        className={`${isCollapsed ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"} flex items-center justify-between px-4 shrink-0 h-full`}
        style={{
          height: isCollapsed ? "100%" : 44,
          borderBottom: isCollapsed ? "none" : "1px solid rgba(221,216,207,0.55)",
          background: `linear-gradient(90deg, ${item.color}1f, transparent 60%)`,
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon name="thread" size={12} style={{ color: item.color }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-400)" }}>
            Thread
          </span>
          {!isCollapsed && (
            <span className="font-mono text-[10px] tracking-[0.1em] opacity-60" style={{ color: "var(--ink-400)" }}>
              · {messages.length} messages
            </span>
          )}
        </div>
        {!isCollapsed && (
          <div className="flex items-center gap-1" data-nodrag>
            <button
              onClick={(e) => { e.stopPropagation(); onCollapse(); }}
              className="w-7 h-7 rounded flex items-center justify-center hover:bg-[var(--bg2)]"
              style={{ color: "var(--ink-400)" }}
              title="Collapse"
            >
              <Icon name="collapse" size={11} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="w-7 h-7 rounded flex items-center justify-center hover:bg-[var(--bg2)]"
              style={{ color: "var(--ink-400)" }}
              title="Close (Esc)"
            >
              <Icon name="close" size={11} />
            </button>
          </div>
        )}
      </div>
      {!isCollapsed && (
        <>
          <div className="px-6 pt-4 pb-2 shrink-0">
            <div className="font-display text-[20px] leading-[1.15]" style={{ color: "var(--ink-100)" }}>
              {item.title}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[10.5px] font-mono" style={{ color: "var(--ink-400)" }}>
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
                Quick chat is typing here
              </span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto sv2-slim px-6 pb-4 space-y-3" data-nodrag>
            {messages.length === 0 && (
              <div className="text-[12.5px] italic opacity-70 py-4" style={{ color: "var(--ink-400)" }}>
                No messages yet. Reply from the quick chat below.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[86%] text-[12.5px] leading-[1.58] rounded-xl px-3 py-2 whitespace-pre-wrap ${
                    m.role === "user" ? "rounded-br-sm text-white" : "rounded-bl-sm"
                  }`}
                  style={{
                    background: m.role === "user" ? "var(--accent)" : "var(--bg2)",
                    border: `1px solid ${m.role === "user" ? "transparent" : "var(--line)"}`,
                    color: m.role === "user" ? "#fff" : "var(--ink-200)",
                  }}
                >
                  {m.text}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </>
      )}
    </div>
  );
}

/* ─── WidgetBloom — full-screen bloom for a utility widget ─── */

type WidgetBloomProps = {
  widget: FloatingWidgetData;
  workspaceItems?: V2Item[];
  onClose: () => void;
  onTimerToggle: (id: string) => void;
  onTimerReset: (id: string, secs: number) => void;
  onAsk: (text: string) => void;
  onWidgetEdit?: (id: string, state: Record<string, unknown>) => void;
  onOpenItem?: (id: string) => void;
};

export function WidgetBloom({
  widget, workspaceItems = [], onClose,
  onTimerToggle, onTimerReset, onAsk, onWidgetEdit, onOpenItem,
}: WidgetBloomProps) {
  const meta = WIDGET_META[widget.kind];
  return (
    <div
      data-widget
      className="w-full h-full rounded-2xl overflow-hidden flex flex-col"
      style={{
        background: "var(--paper)",
        border: "1px solid var(--line)",
        boxShadow: "0 40px 80px -30px rgba(8,22,40,0.22)",
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{
          borderBottom: "1px solid rgba(221,216,207,0.55)",
          background: "rgba(237,233,227,0.35)",
        }}
      >
        <div className="flex items-center gap-2">
          <Icon name={meta.icon} size={13} style={{ color: "var(--ink-300)" }} />
          <span className="font-display text-[18px]" style={{ color: "var(--ink-100)" }}>{meta.label}</span>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[var(--bg2)]"
          style={{ border: "1px solid var(--line)", color: "var(--ink-400)" }}
          title="Close (Esc)"
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto sv2-slim p-5">
        <WidgetBody
          widget={widget}
          items={workspaceItems}
          onTimerToggle={onTimerToggle}
          onTimerReset={onTimerReset}
          onAsk={onAsk}
          onWidgetEdit={onWidgetEdit}
          onOpenItem={onOpenItem}
        />
      </div>
    </div>
  );
}

export function useTimerTick(
  widgets: FloatingWidgetData[],
  setWidgets: React.Dispatch<React.SetStateAction<FloatingWidgetData[]>>,
) {
  const hasRunningTimer = widgets.some((w) => w.kind === "timer" && Boolean(w.state.running));
  const setRef = useRef(setWidgets);
  useEffect(() => { setRef.current = setWidgets; }, [setWidgets]);
  const cb = useCallback(() => {
    setRef.current((ws) =>
      ws.map((w) => {
        if (w.kind !== "timer" || !Boolean(w.state.running)) return w;
        const s = (w.state.secs as number) - 1;
        if (s <= 0) return { ...w, state: { ...w.state, secs: 25 * 60, running: false } };
        return { ...w, state: { ...w.state, secs: s } };
      }),
    );
  }, []);
  useEffect(() => {
    if (!hasRunningTimer) return;
    const id = setInterval(cb, 1000);
    return () => clearInterval(id);
  }, [hasRunningTimer, cb]);
}
