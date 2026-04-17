"use client";

/* ===================================================================
   Widget renderers — lightweight, screen-stable widget bodies.

   Each reads its config from widget.state and writes back via
   updateWidget. All sizing uses screen-stable world px.
   =================================================================== */

import { useEffect, useMemo, useState } from "react";
import { Play, Pause, RotateCcw, ExternalLink, Timer, Clock as ClockIcon, Hourglass } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { WidgetData } from "@/lib/workspace/contracts";

const STICKY_COLORS: Record<string, { bg: string; ink: string; accent: string }> = {
  ochre: { bg: "#f7ecd4", ink: "#5d3f0a", accent: "#b67616" },
  moss: { bg: "#e6efd8", ink: "#2e4a1f", accent: "#4b7a3e" },
  lapis: { bg: "#dde6f0", ink: "#16335a", accent: "#2a568c" },
  terracotta: { bg: "#f4d9ca", ink: "#6b2a11", accent: "#b54f2a" },
  slate: { bg: "#e2e4e7", ink: "#2f3740", accent: "#55606a" },
};

/* ─── Sticky ──────────────────────────────────────────── */

export function WidgetSticky({ widget }: { widget: WidgetData }) {
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);
  const text = (widget.state.text as string | undefined) ?? "";
  const color = (widget.state.color as string | undefined) ?? "ochre";
  const palette = STICKY_COLORS[color] ?? STICKY_COLORS.ochre;

  const size = 15;
  const pad = 14;
  const swatchSize = 16;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: palette.bg,
        borderRadius: 10,
        padding: pad,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        color: palette.ink,
      }}
    >
      <div style={{ display: "flex", gap: 6 }}>
        {Object.keys(STICKY_COLORS).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => updateWidget(widget.id, { state: { ...widget.state, color: key } })}
            style={{
              width: swatchSize,
              height: swatchSize,
              borderRadius: "50%",
              background: STICKY_COLORS[key].bg,
              border: color === key
                ? `2px solid ${STICKY_COLORS[key].accent}`
                : `1px solid rgba(10,14,20,0.12)`,
              cursor: "pointer",
            }}
            title={key}
          />
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) =>
          updateWidget(widget.id, { state: { ...widget.state, text: e.target.value } })
        }
        placeholder="Write on this sticky…"
        style={{
          flex: 1,
          width: "100%",
          resize: "none",
          border: "none",
          outline: "none",
          background: "transparent",
          fontSize: size,
          lineHeight: 1.5,
          color: palette.ink,
          fontFamily: "var(--font-fraunces), serif",
        }}
      />
    </div>
  );
}

/* ─── Pomodoro Timer ──────────────────────────────────── */

export function WidgetTimer({ widget }: { widget: WidgetData }) {
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);
  const minutes = (widget.state.minutes as number | undefined) ?? 25;
  const running = (widget.state.running as boolean | undefined) ?? false;
  const startedAt = (widget.state.startedAt as number | undefined) ?? 0;
  const accumulated = (widget.state.accumulated as number | undefined) ?? 0;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);

  const targetMs = minutes * 60_000;
  const elapsedMs = accumulated + (running ? now - startedAt : 0);
  const remaining = Math.max(0, targetMs - elapsedMs);
  const mins = Math.floor(remaining / 60_000);
  const secs = Math.floor((remaining % 60_000) / 1000);

  const display = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  const displaySize = 42;
  const metaSize = 12;
  const iconSize = 16;
  const pad = 14;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: pad,
      }}
    >
      <Timer style={{ width: iconSize, height: iconSize, color: "var(--text-tertiary)" }} />
      <div
        className="font-mono"
        style={{
          fontSize: displaySize,
          fontWeight: 600,
          letterSpacing: "0.04em",
          color: "var(--text-primary)",
        }}
      >
        {display}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() =>
            updateWidget(widget.id, {
              state: {
                ...widget.state,
                running: !running,
                startedAt: running ? 0 : Date.now(),
                accumulated: running ? elapsedMs : accumulated,
              },
            })
          }
          style={buttonStyle(10, 12)}
        >
          {running ? <Pause style={{ width: iconSize, height: iconSize }} /> : <Play style={{ width: iconSize, height: iconSize }} />}
        </button>
        <button
          type="button"
          onClick={() =>
            updateWidget(widget.id, {
              state: { ...widget.state, running: false, startedAt: 0, accumulated: 0 },
            })
          }
          style={buttonStyle(10, 12)}
        >
          <RotateCcw style={{ width: iconSize, height: iconSize }} />
        </button>
      </div>
      <div
        className="font-mono"
        style={{ fontSize: metaSize, color: "var(--text-tertiary)", letterSpacing: "0.08em", textTransform: "uppercase" }}
      >
        {minutes} min · {running ? "running" : "paused"}
      </div>
    </div>
  );
}

/* ─── Countdown ───────────────────────────────────────── */

export function WidgetCountdown({ widget }: { widget: WidgetData }) {
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);
  const [now, setNow] = useState(() => Date.now());
  const targetAt = (widget.state.targetAt as number | undefined) ?? (now + 3600_000);
  const label = (widget.state.label as string | undefined) ?? "Countdown";
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const remaining = Math.max(0, targetAt - now);
  const d = Math.floor(remaining / 86400000);
  const h = Math.floor((remaining % 86400000) / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);

  const size = 32;
  const labelSize = 13;
  const iconSize = 14;

  return (
    <div
      style={{
        width: "100%", height: "100%", display: "flex",
        flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 6, padding: 14,
      }}
    >
      <Hourglass style={{ width: iconSize, height: iconSize, color: "var(--text-tertiary)" }} />
      <input
        type="text"
        value={label}
        onChange={(e) => updateWidget(widget.id, { state: { ...widget.state, label: e.target.value } })}
        style={{
          textAlign: "center",
          border: "none", outline: "none",
          background: "transparent",
          fontSize: labelSize,
          color: "var(--text-primary)",
          fontWeight: 600,
          width: "100%",
        }}
      />
      <div
        className="font-mono"
        style={{
          fontSize: size, fontWeight: 600, letterSpacing: "0.04em",
          color: "var(--text-primary)", lineHeight: 1,
        }}
      >
        {d > 0 ? `${d}d ` : ""}
        {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
      </div>
      <input
        type="datetime-local"
        value={new Date(targetAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
        onChange={(e) => {
          const parsed = new Date(e.target.value).getTime();
          if (Number.isFinite(parsed)) {
            updateWidget(widget.id, { state: { ...widget.state, targetAt: parsed } });
          }
        }}
        style={{
          fontSize: 11,
          color: "var(--text-tertiary)",
          border: "none", background: "transparent", outline: "none",
          textAlign: "center",
        }}
      />
    </div>
  );
}

/* ─── Clock ───────────────────────────────────────────── */

export function WidgetClock({ widget: _widget }: { widget: WidgetData }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const hh = now.getHours();
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const day = now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  const size = 40;
  const sub = 12;
  const iconSize = 14;

  return (
    <div
      style={{
        width: "100%", height: "100%",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: 4, padding: 14,
      }}
    >
      <ClockIcon style={{ width: iconSize, height: iconSize, color: "var(--text-tertiary)" }} />
      <div
        className="font-mono"
        style={{
          fontSize: size, fontWeight: 600, letterSpacing: "0.04em",
          color: "var(--text-primary)",
        }}
      >
        {String(hh).padStart(2, "0")}:{mm}
        <span style={{ color: "var(--text-tertiary)" }}>:{ss}</span>
      </div>
      <div
        className="font-mono"
        style={{
          fontSize: sub, color: "var(--text-tertiary)",
          letterSpacing: "0.1em", textTransform: "uppercase",
        }}
      >
        {day}
      </div>
    </div>
  );
}

/* ─── Link card ───────────────────────────────────────── */

export function WidgetLink({ widget }: { widget: WidgetData }) {
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);
  const url = (widget.state.url as string | undefined) ?? "";
  const label = (widget.state.label as string | undefined) ?? "Open link";
  const size = 14;
  const iconSize = 16;

  return (
    <div
      style={{
        width: "100%", height: "100%", padding: 14,
        display: "flex", flexDirection: "column", gap: 8,
      }}
    >
      <input
        value={label}
        onChange={(e) => updateWidget(widget.id, { state: { ...widget.state, label: e.target.value } })}
        placeholder="Label"
        style={{
          fontSize: size, fontWeight: 600, border: "none", outline: "none",
          color: "var(--text-primary)", background: "transparent",
        }}
      />
      <input
        value={url}
        onChange={(e) => updateWidget(widget.id, { state: { ...widget.state, url: e.target.value } })}
        placeholder="https://…"
        style={{
          fontSize: 12, border: "none", outline: "none",
          color: "var(--text-secondary)", background: "transparent",
        }}
      />
      <a
        href={url || "#"}
        target="_blank"
        rel="noopener"
        style={{
          marginTop: "auto",
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: `${6}px ${10}px`,
          background: "color-mix(in oklab, var(--accent-cyan) 10%, transparent)",
          color: "var(--accent-cyan)",
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
          textDecoration: "none",
          width: "fit-content",
        }}
      >
        <ExternalLink style={{ width: iconSize, height: iconSize }} />
        Open
      </a>
    </div>
  );
}

/* ─── Image ───────────────────────────────────────────── */

export function WidgetImage({ widget }: { widget: WidgetData }) {
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);
  const url = (widget.state.url as string | undefined) ?? "";

  const gap8 = 8;
  const padMd = 14;
  const font13 = 13;
  const pad6 = 6;
  const pad10 = 10;
  const radius8 = 8;
  const radius6 = 6;

  if (!url) {
    return (
      <div
        style={{
          width: "100%", height: "100%",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: gap8, padding: padMd,
        }}
      >
        <input
          placeholder="Paste image URL"
          onChange={(e) => updateWidget(widget.id, { state: { ...widget.state, url: e.target.value } })}
          style={{
            fontSize: font13, border: `1px solid var(--border-default)`,
            padding: `${pad6}px ${pad10}px`,
            borderRadius: radius8, width: "80%", outline: "none",
            background: "var(--bg-elevated)", color: "var(--text-primary)",
          }}
        />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: radius6 }}
    />
  );
}

/* ─── Scratchpad ──────────────────────────────────────── */

export function WidgetScratchpad({ widget }: { widget: WidgetData }) {
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);
  const text = (widget.state.text as string | undefined) ?? "";
  return (
    <textarea
      value={text}
      onChange={(e) => updateWidget(widget.id, { state: { ...widget.state, text: e.target.value } })}
      placeholder="Scratchpad — think out loud…"
      style={{
        width: "100%", height: "100%",
        resize: "none", border: "none", outline: "none",
        background: "transparent",
        padding: 14,
        fontSize: 14,
        lineHeight: 1.55,
        color: "var(--text-primary)",
        fontFamily: "var(--font-manrope), sans-serif",
      }}
    />
  );
}

/* ─── Planner strip ───────────────────────────────────── */

type StripTask = { id: string; text: string; done: boolean };

export function WidgetPlannerStrip({ widget }: { widget: WidgetData }) {
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);
  const tasks = ((widget.state.tasks as StripTask[] | undefined) ?? []);
  const [draft, setDraft] = useState("");

  const pad = 14;
  const size = 13;
  const small = 11;
  
  const rad6 = 6;
  const pad4 = 4;
  const pad8 = 8;
  const gap8 = 8;
  const gap4 = 4;
  const pad6 = 6;

  const setTasks = (next: StripTask[]) =>
    updateWidget(widget.id, { state: { ...widget.state, tasks: next } });

  return (
    <div style={{ width: "100%", height: "100%", padding: pad, display: "flex", flexDirection: "column", gap: gap8 }}>
      <div style={{ display: "flex", gap: gap8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              setTasks([...tasks, { id: `t-${Date.now()}`, text: draft.trim(), done: false }]);
              setDraft("");
            }
          }}
          placeholder="Add a task and press enter"
          style={{
            flex: 1, border: `1px solid var(--border-default)`,
            borderRadius: rad6,
            padding: `${pad4}px ${pad8}px`,
            background: "var(--bg-elevated)", outline: "none",
            fontSize: size, color: "var(--text-primary)",
          }}
        />
      </div>
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: gap4 }}>
        {tasks.length === 0 ? (
          <span className="font-mono" style={{ fontSize: small, color: "var(--text-tertiary)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            No tasks yet
          </span>
        ) : (
          tasks.map((t) => (
            <label
              key={t.id}
              style={{
                display: "flex", alignItems: "center", gap: gap8,
                padding: `${pad4}px ${pad6}px`,
                borderRadius: rad6,
                fontSize: size,
                color: t.done ? "var(--text-tertiary)" : "var(--text-primary)",
                textDecoration: t.done ? "line-through" : "none",
              }}
            >
              <input
                type="checkbox"
                checked={t.done}
                onChange={() =>
                  setTasks(tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))
                }
              />
              <span>{t.text}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

/* ─── Shared ──────────────────────────────────────────── */

function buttonStyle(py: number, px: number): React.CSSProperties {
  return {
    padding: `${py}px ${px}px`,
    borderRadius: 8,
    background: "color-mix(in oklab, var(--accent-cyan) 10%, transparent)",
    color: "var(--accent-cyan)",
    border: "none",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
  };
}


