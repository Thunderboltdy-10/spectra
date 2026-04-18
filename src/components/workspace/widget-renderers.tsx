"use client";

/* ===================================================================
   Widget renderers — lightweight, screen-stable widget bodies.

   Each reads its config from widget.state and writes back via
   updateWidget. All sizing uses plain CSS pixels (STABLE constants).
   Semantic tier drives progressive reveal: widgets simplify when
   zoomed out but stay visible and coherent.

   NO anti-zoom helpers: no useScreenSize / useScreenSizes.
   ReactFlow scales natively — CSS pixel values are correct.
   =================================================================== */

import { useEffect, useState } from "react";
import Image from "next/image";
import { Play, Pause, RotateCcw, ExternalLink, Timer, Clock as ClockIcon, Hourglass } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { STABLE } from "@/lib/workspace/zoom";
import type { WidgetData } from "@/lib/workspace/contracts";
import type { SemanticTier } from "@/lib/workspace/zoom";

/* ─── Shared semantic reveal helpers ──────────────────── */

/** Props every widget renderer accepts */
interface WidgetProps {
  widget: WidgetData;
  tier: SemanticTier;
}

/** Which parts to show at each tier */
function revealFor(tier: SemanticTier) {
  return {
    /** Core icon + key datum (e.g. time, countdown) */
    showCore: tier !== "glance",
    /** Interactive controls (buttons, inputs) */
    showControls: tier === "detail",
    /** Secondary metadata (labels, subtexts) */
    showMeta: tier === "detail",
  };
}

const STICKY_COLORS: Record<string, { bg: string; ink: string; accent: string }> = {
  ochre: { bg: "#f7ecd4", ink: "#5d3f0a", accent: "#b67616" },
  moss: { bg: "#e6efd8", ink: "#2e4a1f", accent: "#4b7a3e" },
  lapis: { bg: "#dde6f0", ink: "#16335a", accent: "#2a568c" },
  terracotta: { bg: "#f4d9ca", ink: "#6b2a11", accent: "#b54f2a" },
  slate: { bg: "#e2e4e7", ink: "#2f3740", accent: "#55606a" },
};

/* ─── Sticky ──────────────────────────────────────────── */

export function WidgetSticky({ widget, tier }: WidgetProps) {
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);
  const text = (widget.state.text as string | undefined) ?? "";
  const color = (widget.state.color as string | undefined) ?? "ochre";
  const palette = STICKY_COLORS[color] ?? STICKY_COLORS.ochre;
  const reveal = revealFor(tier);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: palette.bg,
        borderRadius: STABLE.RADIUS_SM,
        padding: STABLE.PAD_MD,
        display: "flex",
        flexDirection: "column",
        gap: STABLE.PAD_SM,
        color: palette.ink,
      }}
    >
      {reveal.showControls && (
        <div style={{ display: "flex", gap: STABLE.PAD_SM - 2 }}>
          {Object.keys(STICKY_COLORS).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => updateWidget(widget.id, { state: { ...widget.state, color: key } })}
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: STICKY_COLORS[key].bg,
                border: color === key
                  ? `${2}px solid ${STICKY_COLORS[key].accent}`
                  : `${1}px solid rgba(10,14,20,0.12)`,
                cursor: "pointer",
              }}
              title={key}
            />
          ))}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) =>
          updateWidget(widget.id, { state: { ...widget.state, text: e.target.value } })
        }
        placeholder="Write on this sticky…"
        readOnly={!reveal.showControls}
        style={{
          flex: 1,
          width: "100%",
          resize: "none",
          border: "none",
          outline: "none",
          background: "transparent",
          fontSize: STABLE.ITEM_TITLE,
          lineHeight: 1.5,
          color: palette.ink,
          fontFamily: "var(--font-fraunces), serif",
        }}
      />
    </div>
  );
}

/* ─── Pomodoro Timer ──────────────────────────────────── */

export function WidgetTimer({ widget, tier }: WidgetProps) {
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);
  const minutes = (widget.state.minutes as number | undefined) ?? 25;
  const running = (widget.state.running as boolean | undefined) ?? false;
  const startedAt = (widget.state.startedAt as number | undefined) ?? 0;
  const accumulated = (widget.state.accumulated as number | undefined) ?? 0;
  const reveal = revealFor(tier);

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

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: STABLE.PAD_SM + 2,
        padding: STABLE.PAD_MD,
      }}
    >
      <Timer style={{ width: STABLE.ICON_MD, height: STABLE.ICON_MD, color: "var(--text-tertiary)" }} />
      <div
        className="font-mono"
        style={{
          fontSize: 42,
          fontWeight: 600,
          letterSpacing: "0.04em",
          color: "var(--text-primary)",
        }}
      >
        {display}
      </div>
      {reveal.showControls && (
        <div style={{ display: "flex", gap: STABLE.PAD_SM }}>
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
            style={buttonStyle}
          >
            {running ? <Pause style={{ width: STABLE.ICON_MD, height: STABLE.ICON_MD }} /> : <Play style={{ width: STABLE.ICON_MD, height: STABLE.ICON_MD }} />}
          </button>
          <button
            type="button"
            onClick={() =>
              updateWidget(widget.id, {
                state: { ...widget.state, running: false, startedAt: 0, accumulated: 0 },
              })
            }
            style={buttonStyle}
          >
            <RotateCcw style={{ width: STABLE.ICON_MD, height: STABLE.ICON_MD }} />
          </button>
        </div>
      )}
      {reveal.showMeta && (
        <div
          className="font-mono"
          style={{ fontSize: STABLE.ITEM_META, color: "var(--text-tertiary)", letterSpacing: "0.08em", textTransform: "uppercase" }}
        >
          {minutes} min · {running ? "running" : "paused"}
        </div>
      )}
    </div>
  );
}

/* ─── Countdown ───────────────────────────────────────── */

export function WidgetCountdown({ widget, tier }: WidgetProps) {
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);
  const reveal = revealFor(tier);

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

  return (
    <div
      style={{
        width: "100%", height: "100%", display: "flex",
        flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: STABLE.PAD_SM - 2, padding: STABLE.PAD_MD,
      }}
    >
      <Hourglass style={{ width: STABLE.ICON_MD, height: STABLE.ICON_MD, color: "var(--text-tertiary)" }} />
      {reveal.showControls ? (
        <input
          type="text"
          value={label}
          onChange={(e) => updateWidget(widget.id, { state: { ...widget.state, label: e.target.value } })}
          style={{
            textAlign: "center",
            border: "none", outline: "none",
            background: "transparent",
            fontSize: STABLE.ITEM_TITLE,
            color: "var(--text-primary)",
            fontWeight: 600,
            width: "100%",
          }}
        />
      ) : (
        <div style={{
          fontSize: STABLE.ITEM_TITLE,
          color: "var(--text-primary)",
          fontWeight: 600,
          textAlign: "center",
        }}>
          {label}
        </div>
      )}
      <div
        className="font-mono"
        style={{
          fontSize: 32, fontWeight: 600, letterSpacing: "0.04em",
          color: "var(--text-primary)", lineHeight: 1,
        }}
      >
        {d > 0 ? `${d}d ` : ""}
        {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
      </div>
      {reveal.showControls && (
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
            fontSize: STABLE.ITEM_META,
            color: "var(--text-tertiary)",
            border: "none", background: "transparent", outline: "none",
            textAlign: "center",
          }}
        />
      )}
    </div>
  );
}

/* ─── Clock ───────────────────────────────────────────── */

export function WidgetClock({ widget: _widget, tier }: WidgetProps) {
  void _widget;
  const reveal = revealFor(tier);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const hh = now.getHours();
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const day = now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  return (
    <div
      style={{
        width: "100%", height: "100%",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: 4, padding: STABLE.PAD_MD,
      }}
    >
      <ClockIcon style={{ width: STABLE.ICON_MD, height: STABLE.ICON_MD, color: "var(--text-tertiary)" }} />
      <div
        className="font-mono"
        style={{
          fontSize: 40, fontWeight: 600, letterSpacing: "0.04em",
          color: "var(--text-primary)",
        }}
      >
        {String(hh).padStart(2, "0")}:{mm}
        <span style={{ color: "var(--text-tertiary)" }}>:{ss}</span>
      </div>
      {reveal.showMeta && (
        <div
          className="font-mono"
          style={{
            fontSize: STABLE.ITEM_META, color: "var(--text-tertiary)",
            letterSpacing: "0.1em", textTransform: "uppercase",
          }}
        >
          {day}
        </div>
      )}
    </div>
  );
}

/* ─── Link card ───────────────────────────────────────── */

export function WidgetLink({ widget, tier }: WidgetProps) {
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);
  const reveal = revealFor(tier);

  const url = (widget.state.url as string | undefined) ?? "";
  const label = (widget.state.label as string | undefined) ?? "Open link";

  return (
    <div
      style={{
        width: "100%", height: "100%", padding: STABLE.PAD_MD,
        display: "flex", flexDirection: "column", gap: STABLE.PAD_SM,
      }}
    >
      {reveal.showControls ? (
        <input
          value={label}
          onChange={(e) => updateWidget(widget.id, { state: { ...widget.state, label: e.target.value } })}
          placeholder="Label"
          style={{
            fontSize: STABLE.ITEM_TITLE, fontWeight: 600, border: "none", outline: "none",
            color: "var(--text-primary)", background: "transparent",
          }}
        />
      ) : (
        <div style={{
          fontSize: STABLE.ITEM_TITLE, fontWeight: 600,
          color: "var(--text-primary)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {label}
        </div>
      )}
      {reveal.showControls && (
        <input
          value={url}
          onChange={(e) => updateWidget(widget.id, { state: { ...widget.state, url: e.target.value } })}
          placeholder="https://…"
          style={{
            fontSize: STABLE.ITEM_META, border: "none", outline: "none",
            color: "var(--text-secondary)", background: "transparent",
          }}
        />
      )}
      {reveal.showCore && (
        <a
          href={url || "#"}
          target="_blank"
          rel="noopener"
          style={{
            marginTop: "auto",
            display: "inline-flex", alignItems: "center", gap: STABLE.PAD_SM - 2,
            padding: `${6}px ${10}px`,
            background: "color-mix(in oklab, var(--accent-cyan) 10%, transparent)",
            color: "var(--accent-cyan)",
            borderRadius: STABLE.RADIUS_SM,
            fontSize: STABLE.ITEM_META,
            fontWeight: 600,
            textDecoration: "none",
            width: "fit-content",
          }}
        >
          <ExternalLink style={{ width: STABLE.ICON_MD, height: STABLE.ICON_MD }} />
          Open
        </a>
      )}
    </div>
  );
}

/* ─── Image ───────────────────────────────────────────── */

export function WidgetImage({ widget, tier }: WidgetProps) {
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);
  const reveal = revealFor(tier);

  const url = (widget.state.url as string | undefined) ?? "";

  if (!url) {
    return (
      <div
        style={{
          width: "100%", height: "100%",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: STABLE.PAD_SM, padding: STABLE.PAD_MD,
        }}
      >
        {reveal.showControls && (
          <input
            placeholder="Paste image URL"
            onChange={(e) => updateWidget(widget.id, { state: { ...widget.state, url: e.target.value } })}
            style={{
              fontSize: STABLE.ITEM_BODY, border: `${1}px solid var(--border-default)`,
              padding: `${6}px ${10}px`,
              borderRadius: STABLE.RADIUS_SM, width: "80%", outline: "none",
              background: "var(--bg-elevated)", color: "var(--text-primary)",
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Image
        src={url}
        alt=""
        fill
        unoptimized
        style={{ objectFit: "cover", borderRadius: STABLE.RADIUS_SM - 2 }}
      />
    </div>
  );
}

/* ─── Scratchpad ──────────────────────────────────────── */

export function WidgetScratchpad({ widget, tier }: WidgetProps) {
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);
  const reveal = revealFor(tier);

  const text = (widget.state.text as string | undefined) ?? "";
  return (
    <textarea
      value={text}
      onChange={(e) => updateWidget(widget.id, { state: { ...widget.state, text: e.target.value } })}
      placeholder="Scratchpad — think out loud…"
      readOnly={!reveal.showControls}
      style={{
        width: "100%", height: "100%",
        resize: "none", border: "none", outline: "none",
        background: "transparent",
        padding: STABLE.PAD_MD,
        fontSize: STABLE.ITEM_TITLE,
        lineHeight: 1.55,
        color: "var(--text-primary)",
        fontFamily: "var(--font-manrope), sans-serif",
      }}
    />
  );
}

/* ─── Planner strip ───────────────────────────────────── */

type StripTask = { id: string; text: string; done: boolean };

export function WidgetPlannerStrip({ widget, tier }: WidgetProps) {
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);
  const reveal = revealFor(tier);

  const tasks = ((widget.state.tasks as StripTask[] | undefined) ?? []);
  const [draft, setDraft] = useState("");

  const setTasks = (next: StripTask[]) =>
    updateWidget(widget.id, { state: { ...widget.state, tasks: next } });

  return (
    <div style={{ width: "100%", height: "100%", padding: STABLE.PAD_MD, display: "flex", flexDirection: "column", gap: STABLE.PAD_SM }}>
      {reveal.showControls && (
        <div style={{ display: "flex", gap: STABLE.PAD_SM }}>
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
              flex: 1, border: `${1}px solid var(--border-default)`,
              borderRadius: STABLE.RADIUS_SM,
              padding: `${4}px ${STABLE.PAD_SM}px`,
              background: "var(--bg-elevated)", outline: "none",
              fontSize: STABLE.ITEM_TITLE, color: "var(--text-primary)",
            }}
          />
        </div>
      )}
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        {tasks.length === 0 ? (
          <span className="font-mono" style={{ fontSize: STABLE.ITEM_META, color: "var(--text-tertiary)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            No tasks yet
          </span>
        ) : (
          tasks.map((t) => (
            <label
              key={t.id}
              style={{
                display: "flex", alignItems: "center", gap: STABLE.PAD_SM,
                padding: `${4}px ${6}px`,
                borderRadius: STABLE.RADIUS_SM,
                fontSize: STABLE.ITEM_TITLE,
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
                disabled={!reveal.showControls}
              />
              <span>{t.text}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

/* ─── Shared button style (plain CSS, no anti-zoom) ──── */

const buttonStyle: React.CSSProperties = {
  padding: `${10}px ${12}px`,
  borderRadius: STABLE.RADIUS_SM,
  background: "color-mix(in oklab, var(--accent-cyan) 10%, transparent)",
  color: "var(--accent-cyan)",
  border: "none",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: STABLE.ITEM_META,
  fontWeight: 600,
};
