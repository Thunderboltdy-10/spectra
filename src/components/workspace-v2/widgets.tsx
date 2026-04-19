"use client";

import { useRef, useState, useEffect } from "react";
import { Icon, type IconName } from "./icons";

export type WidgetKind = "timer" | "planner" | "today" | "scratch" | "library" | "calendar";

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

const WIDGET_META: Record<WidgetKind, { label: string; icon: IconName }> = {
  timer: { label: "Focus timer", icon: "timer" },
  planner: { label: "This week", icon: "planner" },
  today: { label: "Today's queue", icon: "schedule" },
  scratch: { label: "Scratchpad", icon: "note" },
  library: { label: "Library", icon: "reading" },
  calendar: { label: "Calendar", icon: "schedule" },
};

/* ─── Inner widgets ─── */

function TimerInner({
  widget, onToggle, onReset,
}: {
  widget: FloatingWidgetData;
  onToggle: () => void;
  onReset: (secs: number) => void;
}) {
  const s = (widget.state.secs as number) ?? 25 * 60;
  const running = (widget.state.running as boolean) ?? false;
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="font-display text-[32px] tabular-nums leading-none" style={{ color: "var(--ink-100)" }}>
          {mm}:{ss}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] mt-1" style={{ color: "var(--ink-400)" }}>
          {running ? "focus in progress" : "Pomodoro · 25/5"}
        </div>
      </div>
      <div data-nodrag className="flex items-center gap-1">
        <button
          onClick={() => onReset(25 * 60)}
          className="w-7 h-7 rounded-full flex items-center justify-center"
          style={{ border: "1px solid var(--line)", color: "var(--ink-400)" }}
          title="Reset"
        >
          <Icon name="undo" size={11} />
        </button>
        <button
          onClick={onToggle}
          className="h-8 px-3 rounded-full text-[11px] font-mono uppercase tracking-[0.12em]"
          style={{ background: running ? "var(--coral)" : "var(--accent)", color: "#fff" }}
        >
          {running ? "Pause" : "Start"}
        </button>
      </div>
    </div>
  );
}

function PlannerInner({ onAsk }: { onAsk: (q: string) => void }) {
  const days = [
    { d: "Mon", tasks: ["Essay draft §1-2", "Calc pset Q1-3"] },
    { d: "Tue", tasks: ["Bio: Glycolysis review", "Spanish review 30m"] },
    { d: "Wed", tasks: ["Full Bio practice test"] },
    { d: "Thu", tasks: ["BIO MIDTERM 9:00"] },
    { d: "Fri", tasks: ["Calc pset Q4-7", "Essay draft §3-4"] },
  ];
  return (
    <div data-nodrag>
      <div className="flex items-center justify-between mb-2">
        <span className="font-display text-[15px]" style={{ color: "var(--ink-100)" }}>This week</span>
        <button
          onClick={() => onAsk("Rebalance my plan for this week")}
          className="text-[10px] font-mono uppercase tracking-[0.12em] flex items-center gap-1"
          style={{ color: "var(--accent)" }}
        >
          <Icon name="sparkle" size={9} />auto-balance
        </button>
      </div>
      <div className="space-y-1">
        {days.map((d) => (
          <div key={d.d} className="flex gap-2 items-start py-1"
               style={{ borderTop: "1px solid rgba(221,216,207,0.5)" }}>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] w-8 pt-0.5"
                  style={{ color: "var(--ink-400)" }}>{d.d}</span>
            <div className="flex-1 flex flex-col gap-0.5">
              {d.tasks.map((t, i) => (
                <div key={i} className="text-[11.5px] flex items-center gap-1.5"
                     style={{ color: t.includes("MIDTERM") ? "var(--coral)" : "var(--ink-200)" }}>
                  <div className="w-1 h-1 rounded-full"
                       style={{ background: t.includes("MIDTERM") ? "var(--coral)" : "var(--accent)" }} />
                  <span style={{ fontWeight: t.includes("MIDTERM") ? 600 : 400 }}>{t}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TodayInner({ onAsk }: { onAsk: (q: string) => void }) {
  const items = [
    { t: "Review 12 biology flashcards", k: "flashcards" as const, c: "#20b8b2", done: true },
    { t: "Essay: rework §3 transition", k: "essay" as const, c: "#b67616", done: false },
    { t: "Calc pset · Q4 (IBP twice)", k: "pset" as const, c: "#0e8ee8", done: false },
    { t: "Spanish subjunctive drill", k: "flashcards" as const, c: "#20b8b2", done: false },
  ];
  return (
    <div data-nodrag>
      <div className="flex items-center justify-between mb-2">
        <span className="font-display text-[15px]" style={{ color: "var(--ink-100)" }}>Today · 4 items</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: "var(--ok)" }}>1 done</span>
      </div>
      <div className="space-y-1.5">
        {items.map((x, i) => (
          <div key={i} className="flex items-center gap-2 py-1">
            <div className="w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0"
                 style={{ borderColor: x.c, background: x.done ? x.c : "transparent" }}>
              {x.done && <Icon name="check" size={8} stroke="#fff" />}
            </div>
            <Icon name={x.k} size={11} style={{ color: "var(--ink-400)" }} />
            <span className="text-[11.5px] flex-1"
                  style={{
                    color: x.done ? "var(--ink-400)" : "var(--ink-200)",
                    textDecoration: x.done ? "line-through" : "none",
                  }}>{x.t}</span>
          </div>
        ))}
      </div>
      <button
        onClick={() => onAsk("What's the most impactful thing to do right now?")}
        className="mt-2 w-full text-[10.5px] font-mono uppercase tracking-[0.12em] flex items-center gap-1 justify-center py-1 rounded"
        style={{ color: "var(--accent)", border: "1px dashed var(--line)" }}
      >
        <Icon name="sparkle" size={9} />what should I start?
      </button>
    </div>
  );
}

function ScratchpadInner() {
  const [txt, setTxt] = useState("Quick notes for anywhere.\nAI will fold into a workspace when you ask.");
  return (
    <textarea
      data-nodrag
      value={txt}
      onChange={(e) => setTxt(e.target.value)}
      className="w-full h-[160px] bg-transparent outline-none font-mono text-[12px] resize-none sv2-slim"
      style={{ color: "var(--ink-100)" }}
    />
  );
}

function LibraryInner() {
  const srcs = [
    { t: "Gatsby — Ch. 5 passage", tag: "eng" },
    { t: "Khan Academy: IBP", tag: "calc" },
    { t: "Krebs cycle diagram", tag: "bio" },
    { t: "Subjuntivo rules (RAE)", tag: "span" },
  ];
  return (
    <div data-nodrag className="space-y-1">
      {srcs.map((s, i) => (
        <div key={i} className="flex items-center gap-2 py-1"
             style={{ borderTop: i === 0 ? "none" : "1px solid rgba(221,216,207,0.5)" }}>
          <Icon name="reading" size={10} style={{ color: "var(--ink-400)" }} />
          <span className="text-[11.5px] flex-1 truncate" style={{ color: "var(--ink-200)" }}>{s.t}</span>
          <span className="font-mono text-[9px] uppercase" style={{ color: "var(--ink-400)" }}>{s.tag}</span>
        </div>
      ))}
    </div>
  );
}

function CalendarInner() {
  const days = ["S", "M", "T", "W", "T", "F", "S"];
  return (
    <div data-nodrag>
      <div className="font-display text-[15px] mb-2" style={{ color: "var(--ink-100)" }}>April 2026</div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {days.map((d, i) => (
          <div key={i} className="font-mono text-[9px] uppercase py-1" style={{ color: "var(--ink-400)" }}>{d}</div>
        ))}
        {Array.from({ length: 30 }, (_, i) => (
          <div
            key={i}
            className="text-[10.5px] py-1 rounded"
            style={{
              background: i + 1 === 23 ? "var(--coral)" : i + 1 === 24 ? "rgba(14,142,232,0.15)" : "transparent",
              color: i + 1 === 23 ? "#fff" : i + 1 === 24 ? "var(--accent)" : "var(--ink-200)",
              fontWeight: i + 1 === 23 || i + 1 === 24 ? 600 : 400,
            }}
          >
            {i + 1}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── FloatingWidget shell ─── */

type Props = {
  widget: FloatingWidgetData;
  onMove: (id: string, x: number, y: number) => void;
  onClose: (id: string) => void;
  onToggleCollapsed: (id: string) => void;
  onTimerToggle: (id: string) => void;
  onTimerReset: (id: string, secs: number) => void;
  aiTouched?: boolean;
  onAsk: (text: string) => void;
  onExpandEdit?: (id: string) => void;
};

export function FloatingWidget({
  widget, onMove, onClose, onToggleCollapsed,
  onTimerToggle, onTimerReset, aiTouched, onAsk, onExpandEdit,
}: Props) {
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const onDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: widget.x, oy: widget.y };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      onMove(widget.id, d.ox + (ev.clientX - d.sx), d.oy + (ev.clientY - d.sy));
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

  return (
    <div
      data-widget
      className={`absolute z-20 pointer-events-auto rounded-xl overflow-hidden sv2-widget-in ${
        aiTouched ? "sv2-ai-touched" : ""
      } ${widget.collapsed ? "sv2-widget-collapsed" : ""}`}
      style={{
        left: widget.x,
        top: widget.y,
        width: widget.w,
        height: widget.collapsed ? 36 : widget.h,
        background: "rgba(251,250,246,0.96)",
        border: "1px solid var(--line)",
        boxShadow: "0 20px 45px -28px rgba(8,22,40,0.18)",
        backdropFilter: "blur(10px)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        onMouseDown={onDown}
        className="cursor-grab active:cursor-grabbing flex items-center justify-between px-3 py-2"
        style={{
          borderBottom: widget.collapsed ? "none" : "1px solid rgba(221,216,207,0.6)",
          background: "rgba(237,233,227,0.4)",
        }}
      >
        <div className="flex items-center gap-2">
          <Icon name={meta.icon} size={11} style={{ color: "var(--ink-300)" }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-300)" }}>
            {meta.label}
          </span>
        </div>
        <div className="flex items-center gap-1" data-nodrag>
          {onExpandEdit && (
            <button
              onClick={() => onExpandEdit(widget.id)}
              className="w-5 h-5 rounded flex items-center justify-center"
              style={{ color: "var(--accent)" }}
              title="Expand to full editor"
            >
              <Icon name="expand" size={10} />
            </button>
          )}
          <button
            onClick={() => onToggleCollapsed(widget.id)}
            className="w-5 h-5 rounded flex items-center justify-center"
            style={{ color: "var(--ink-400)" }}
            title={widget.collapsed ? "Show" : "Collapse"}
          >
            <Icon name={widget.collapsed ? "expand" : "collapse"} size={10} />
          </button>
          <button
            onClick={() => onClose(widget.id)}
            className="w-5 h-5 rounded flex items-center justify-center"
            style={{ color: "var(--ink-400)" }}
            title="Close"
          >
            <Icon name="close" size={10} />
          </button>
        </div>
      </div>
      {!widget.collapsed && (
        <div className="p-3">
          {widget.kind === "timer" && (
            <TimerInner
              widget={widget}
              onToggle={() => onTimerToggle(widget.id)}
              onReset={(s) => onTimerReset(widget.id, s)}
            />
          )}
          {widget.kind === "planner" && <PlannerInner onAsk={onAsk} />}
          {widget.kind === "today" && <TodayInner onAsk={onAsk} />}
          {widget.kind === "scratch" && <ScratchpadInner />}
          {widget.kind === "library" && <LibraryInner />}
          {widget.kind === "calendar" && <CalendarInner />}
        </div>
      )}
    </div>
  );
}

/* ─── WidgetBloom — full-editor bloom surface for a widget ─── */
export function WidgetBloom({
  widget, onClose, onTimerToggle, onTimerReset, onAsk,
}: {
  widget: FloatingWidgetData;
  onClose: () => void;
  onTimerToggle: (id: string) => void;
  onTimerReset: (id: string, secs: number) => void;
  onAsk: (text: string) => void;
}) {
  const meta = WIDGET_META[widget.kind];
  return (
    <div
      data-bloom-editor="1"
      className="sv2-bloom-surface sv2-bloom-in primary w-full h-full relative flex flex-col"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "var(--accent)", opacity: 0.6 }} />
      <div className="px-7 pt-6 pb-3 flex items-start justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-400)" }}>
            Widget · {meta.label}
          </div>
          <h1 className="font-display text-[30px] leading-[1.05] mt-2" style={{ color: "var(--ink-100)" }}>
            {meta.label}
          </h1>
          <div className="mt-2 h-px w-16" style={{ background: "rgba(14,142,232,0.6)" }} />
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-full flex items-center justify-center"
          style={{ border: "1px solid var(--line)", background: "rgba(251,250,246,0.9)", color: "var(--ink-400)" }}
          title="Collapse (Esc)"
        >
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="px-7 pb-6 overflow-y-auto sv2-slim flex-1">
        {widget.kind === "timer" && (
          <TimerInner
            widget={widget}
            onToggle={() => onTimerToggle(widget.id)}
            onReset={(s) => onTimerReset(widget.id, s)}
          />
        )}
        {widget.kind === "planner" && <PlannerInner onAsk={onAsk} />}
        {widget.kind === "today" && <TodayInner onAsk={onAsk} />}
        {widget.kind === "scratch" && <ScratchpadInner />}
        {widget.kind === "library" && <LibraryInner />}
        {widget.kind === "calendar" && <CalendarInner />}
      </div>
    </div>
  );
}

export function useTimerTick(
  widgets: FloatingWidgetData[],
  setWidgets: React.Dispatch<React.SetStateAction<FloatingWidgetData[]>>,
) {
  useEffect(() => {
    const id = setInterval(() => {
      setWidgets((ws) =>
        ws.map((w) => {
          if (w.kind !== "timer" || !(w.state.running as boolean)) return w;
          const s = (w.state.secs as number) - 1;
          if (s <= 0) return { ...w, state: { ...w.state, secs: 25 * 60, running: false } };
          return { ...w, state: { ...w.state, secs: s } };
        }),
      );
    }, 1000);
    return () => clearInterval(id);
  }, [setWidgets]);
}
