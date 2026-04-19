"use client";

import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { Icon, type IconName } from "./icons";
import type { V2Item } from "./data";

export type WidgetKind =
  | "timer"
  | "planner"
  | "today"
  | "scratch"
  | "library"
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
};

const WIDGET_META: Record<WidgetKind, { label: string; short: string; icon: IconName; defaultSize: { w: number; h: number }; color: string }> = {
  timer:    { label: "Focus timer",  short: "Timer",    icon: "timer",    defaultSize: { w: 288, h: 132 }, color: "#e05137" },
  planner:  { label: "Week planner", short: "Plan",     icon: "planner",  defaultSize: { w: 300, h: 278 }, color: "#0e8ee8" },
  today:    { label: "Today",        short: "Today",    icon: "schedule", defaultSize: { w: 296, h: 230 }, color: "#20b8b2" },
  scratch:  { label: "Scratchpad",   short: "Note",     icon: "note",     defaultSize: { w: 304, h: 232 }, color: "#b67616" },
  library:  { label: "Library",      short: "Library",  icon: "reading",  defaultSize: { w: 308, h: 276 }, color: "#148f5d" },
  calendar: { label: "Calendar",     short: "Calendar", icon: "schedule", defaultSize: { w: 312, h: 270 }, color: "#6b5f52" },
  thread:   { label: "Thread",        short: "Thread",   icon: "thread",   defaultSize: { w: 340, h: 320 }, color: "#0e8ee8" },
  artifact: { label: "Artifact",      short: "Artifact", icon: "note",     defaultSize: { w: 380, h: 300 }, color: "#b67616" },
};

export const WIDGET_KINDS: WidgetKind[] = ["timer", "planner", "today", "scratch", "library", "calendar"];

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

function LibraryInner({ onOpenItem, widget }: { onOpenItem?: (id: string) => void; widget: FloatingWidgetData }) {
  const artifacts = useMemo(() => Array.isArray(widget.state.artifacts) ? widget.state.artifacts as Array<Record<string, unknown>> : [], [widget.state.artifacts]);
  const resources = useMemo(() => Array.isArray(widget.state.resources) ? widget.state.resources as Array<Record<string, unknown>> : [], [widget.state.resources]);
  return (
    <div data-nodrag className="space-y-1">
      {artifacts.slice(0, 6).map((s, i) => (
        <button key={String(s.id ?? i)} onClick={() => typeof s.id === "string" ? onOpenItem?.(s.id) : undefined}
             className="w-full flex items-center gap-2 py-1 rounded transition-colors hover:bg-[var(--bg2)] px-1 -mx-1 text-left"
             style={{ borderTop: i === 0 ? "none" : "1px solid rgba(221,216,207,0.5)" }}>
          <Icon name="reading" size={10} style={{ color: "var(--ink-400)" }} />
          <span className="text-[11.5px] flex-1 truncate" style={{ color: "var(--ink-200)" }} title={typeof s.title === "string" ? s.title : undefined}>{typeof s.title === "string" ? s.title : "Untitled"}</span>
          <span className="font-mono text-[9px] uppercase" style={{ color: "var(--ink-400)" }}>{typeof s.type === "string" ? s.type : "artifact"}</span>
        </button>
      ))}
      {resources.slice(0, 3).map((s, i) => (
        <div key={String(s.id ?? i)} className="flex items-center gap-2 py-1 px-1 -mx-1"
             style={{ borderTop: artifacts.length === 0 && i === 0 ? "none" : "1px solid rgba(221,216,207,0.5)" }}>
          <Icon name="reading" size={10} style={{ color: "var(--ink-400)" }} />
          <span className="text-[11.5px] flex-1 truncate" style={{ color: "var(--ink-200)" }}>{typeof s.title === "string" ? s.title : "Untitled resource"}</span>
          <span className="font-mono text-[9px] uppercase" style={{ color: "var(--ink-400)" }}>resource</span>
        </div>
      ))}
      {artifacts.length === 0 && resources.length === 0 && (
        <div className="text-[12px] leading-relaxed py-3" style={{ color: "var(--ink-400)" }}>
          No sources yet in this workspace.
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
    case "library":  return <LibraryInner widget={widget} onOpenItem={onOpenItem} />;
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
  if (widget.kind === "library") {
    const arts = Array.isArray(widget.state.artifacts) ? widget.state.artifacts.length : 0;
    return <span className="font-mono text-[10.5px]" style={{ color: "var(--ink-300)" }}>{arts}</span>;
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

/* ─── Widget chip rail ─── */
/*
 * The rail renders on the LEFT edge, below the top chrome. It contains chips
 * for each collapsed utility widget. Chips still show live info. Clicking
 * a chip expands the widget into a floating panel near the chip.
 *
 * The rail also houses a small "add" control that opens a menu to add more
 * widget kinds (singleton-enforced in the parent), plus expand-all /
 * collapse-all options.
 */
type ChipRailProps = {
  widgets: FloatingWidgetData[];
  tick: number;                              // forces re-render on timer tick
  aiTouched: Record<string, boolean>;
  onExpand: (id: string) => void;
  onAddWidget: (kind: WidgetKind) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  allCollapsed: boolean;
  someCollapsed: boolean;
  /** ID of a widget to briefly highlight (singleton reveal animation). */
  revealingWidgetId?: string | null;
};

export function WidgetChipRail({
  widgets, tick, aiTouched, onExpand, onAddWidget,
  onCollapseAll, onExpandAll, allCollapsed, someCollapsed, revealingWidgetId,
}: ChipRailProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // mounted guard prevents SSR/client mismatch on widget chip count
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const present = new Set(widgets.map((w) => w.kind));
  const addableKinds = WIDGET_KINDS.filter((k) => !present.has(k));
  const collapsedWidgets = widgets.filter((w) => Boolean(w.collapsed));

  if (!mounted) return null;

  return (
    <div className="absolute left-3 top-[68px] z-30 pointer-events-auto flex flex-col gap-1.5">
      {collapsedWidgets.map((w) => {
        const meta = WIDGET_META[w.kind];
        const isRevealing = revealingWidgetId === w.id;
        return (
          <button
            key={w.id}
            onClick={() => onExpand(w.id)}
            className={`sv2-chip-rail-item group transition-all ${aiTouched[w.id] ? "sv2-ai-touched-subtle" : ""} ${isRevealing ? "sv2-chip-reveal" : ""}`}
            title={`Expand ${meta.label}`}
            style={{ background: `${meta.color}12`, borderColor: `${meta.color}28` }}
          >
            <span className="flex items-center justify-center w-5 h-5 rounded-md shrink-0" style={{ color: meta.color }}>
              <Icon name={meta.icon} size={13} />
            </span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.13em] min-w-0 truncate" style={{ color: "var(--ink-300)" }}>{meta.short}</span>
            <span className="ml-auto pl-1 shrink-0"><ChipPreview widget={w} tick={tick} /></span>
          </button>
        );
      })}

      {/* Add / manage — info icon replaces dots */}
      <div className="relative mt-1">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="sv2-chip-rail-item sv2-chip-rail-add"
          title="Manage widgets"
        >
          <span className="flex items-center justify-center w-5 h-5 rounded-md shrink-0" style={{ color: "var(--accent)" }}>
            <Icon name="info" size={12} />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.13em]" style={{ color: "var(--ink-200)" }}>Widgets</span>
          <span className="ml-auto pl-2 font-mono text-[10px]" style={{ color: "var(--ink-400)" }}>
            {widgets.length}
          </span>
        </button>
        {menuOpen && (
          <div className="absolute left-full ml-2 top-0 w-[220px] rounded-xl p-1.5 sv2-drift-in shadow-xl"
               style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
               onMouseLeave={() => setMenuOpen(false)}>
            <div className="px-2 pt-1 pb-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>
              Add widget
            </div>
            {addableKinds.length === 0 ? (
              <div className="text-[11px] italic px-2 py-1.5" style={{ color: "var(--ink-400)" }}>
                All widget types present.
              </div>
            ) : (
              <div className="space-y-0.5 mb-1">
                {addableKinds.map((k) => {
                  const m = WIDGET_META[k];
                  return (
                    <button
                      key={k}
                      onClick={() => { onAddWidget(k); setMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] hover:bg-[var(--bg2)] text-left"
                      style={{ color: "var(--ink-200)" }}
                    >
                      <div className="w-5 h-5 rounded flex items-center justify-center shrink-0" style={{ background: `${m.color}14` }}>
                        <Icon name={m.icon} size={11} style={{ color: m.color }} />
                      </div>
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="h-px my-1" style={{ background: "var(--line)" }} />
            <div className="space-y-0.5">
              <button
                onClick={() => { onCollapseAll(); setMenuOpen(false); }}
                disabled={allCollapsed}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] hover:bg-[var(--bg2)] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ color: "var(--ink-200)" }}
              >
                <Icon name="collapse" size={11} />Collapse all
              </button>
              <button
                onClick={() => { onExpandAll(); setMenuOpen(false); }}
                disabled={!someCollapsed}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] hover:bg-[var(--bg2)] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ color: "var(--ink-200)" }}
              >
                <Icon name="expand" size={11} />Expand all
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── FloatingWidget (expanded state) ─── */

type FloatingProps = {
  widget: FloatingWidgetData;
  workspaceItems?: V2Item[];
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
};

export function FloatingWidget({
  widget, workspaceItems = [], onMove, onClose, onCollapse, onExpand,
  onTimerToggle, onTimerReset, aiTouched, onAsk, onWidgetEdit, onOpenItem, onExpandEdit,
}: FloatingProps) {
  void onExpandEdit; // reserved for Agent A
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const onDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: widget.x, oy: widget.y };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      onMove(widget.id, Math.max(0, Math.min(window.innerWidth - 40, d.ox + (ev.clientX - d.sx))), Math.max(0, Math.min(window.innerHeight - 40, d.oy + (ev.clientY - d.sy))));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const meta = WIDGET_META[widget.kind];
  const isCollapsed = Boolean(widget.collapsed);

  // Position-aware expansion: prefer expanding rightward, but if widget is in right half
  // of screen expand leftward so it doesn't overflow
  const expandedX = useMemo(() => {
    if (typeof window === "undefined") return widget.x;
    const midScreen = window.innerWidth / 2;
    // If widget is in the right half, anchor the right edge
    if (widget.x > midScreen) {
      return Math.max(16, widget.x + 44 - widget.w);
    }
    // Left half: just prevent overflow at right edge
    const rightEdge = widget.x + widget.w;
    if (rightEdge > window.innerWidth - 16) {
      return Math.max(16, window.innerWidth - widget.w - 16);
    }
    return widget.x;
  }, [widget.x, widget.w]);

  return (
    <div
      data-widget
      className={`absolute z-20 pointer-events-auto overflow-hidden sv2-widget-in ${
        aiTouched ? "sv2-ai-touched" : ""
      }`}
      style={{
        left: isCollapsed ? widget.x : expandedX,
        top: widget.y,
        width: isCollapsed ? 52 : widget.w,
        height: isCollapsed ? 52 : widget.h,
        borderRadius: isCollapsed ? 14 : 16,
        background: isCollapsed ? `${meta.color}18` : "rgba(251,250,246,0.97)",
        border: `1px solid ${isCollapsed ? `${meta.color}35` : "var(--line)"}`,
        boxShadow: isCollapsed ? `0 3px 10px ${meta.color}20` : "0 24px 54px -30px rgba(8,22,40,0.22)",
        backdropFilter: "blur(12px)",
        transition: "width 260ms cubic-bezier(0.22,1,0.36,1), height 260ms cubic-bezier(0.22,1,0.36,1), left 260ms cubic-bezier(0.22,1,0.36,1), border-radius 200ms ease, box-shadow 200ms ease",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        onMouseDown={onDown}
        onClick={() => { if (isCollapsed) onExpand(widget.id); }}
        className={`${isCollapsed ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"} flex items-center justify-between px-2.5`}
        style={{
          height: isCollapsed ? "100%" : 40,
          borderBottom: isCollapsed ? "none" : "1px solid rgba(221,216,207,0.55)",
          background: isCollapsed ? "transparent" : `linear-gradient(90deg, ${meta.color}12, transparent 60%)`,
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className={`shrink-0 flex items-center justify-center ${isCollapsed ? "w-full h-full flex-col gap-1" : ""}`}
               style={{ color: meta.color }}>
            <Icon name={meta.icon} size={isCollapsed ? 18 : 11} />
            {isCollapsed && (
              <span className="font-mono text-[8px] uppercase tracking-[0.1em] opacity-70" style={{ color: meta.color }}>
                {meta.short}
              </span>
            )}
          </div>
          {!isCollapsed && (
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] truncate" style={{ color: "var(--ink-300)" }}>
              {meta.label}
            </span>
          )}
        </div>
        {!isCollapsed && (
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
        )}
      </div>
      {!isCollapsed && (
        <div className="p-3.5 h-[calc(100%-40px)] overflow-y-auto sv2-slim">
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
      )}
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
  const onDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: x, oy: y };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      onMove(Math.max(0, Math.min(window.innerWidth - 40, d.ox + (ev.clientX - d.sx))), Math.max(0, Math.min(window.innerHeight - 40, d.oy + (ev.clientY - d.sy))));
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

  return (
    <div
      data-widget data-bloom-editor="1"
      className="absolute z-30 pointer-events-auto overflow-hidden transition-all duration-300 ease-out sv2-widget-in flex flex-col"
      style={{
        left: x, top: y,
        width: isCollapsed ? 120 : w,
        height: isCollapsed ? 36 : h,
        borderRadius: isCollapsed ? 18 : 16,
        background: "var(--paper)",
        border: "1px solid var(--line)",
        boxShadow: isCollapsed ? "0 4px 12px rgba(0,0,0,0.05)" : "0 40px 80px -30px rgba(8,22,40,0.28), 0 0 0 1px rgba(14,142,232,0.06)",
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
          background: `linear-gradient(90deg, ${kindColor}14, transparent 60%)`,
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: kindColor }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] shrink-0" style={{ color: "var(--ink-400)" }}>
            Artifact
          </span>
          {!isCollapsed && (
            <span className="font-mono text-[10px] tracking-[0.1em] opacity-60 shrink-0" style={{ color: "var(--ink-400)" }}>
              · {item.updated || "open"}
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
          <div className="px-6 pt-5 pb-2 shrink-0" data-nodrag>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => { if (title !== item.title) onEdit({ title }); }}
              className="w-full bg-transparent outline-none font-display text-[24px] leading-[1.1]"
              style={{ color: "var(--ink-100)" }}
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
  const onDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: x, oy: y };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      onMove(Math.max(0, Math.min(window.innerWidth - 40, d.ox + (ev.clientX - d.sx))), Math.max(0, Math.min(window.innerHeight - 40, d.oy + (ev.clientY - d.sy))));
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
