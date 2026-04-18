"use client";

/* ===================================================================
   WidgetHost — the draggable, resizable, deletable widget shell.

   Lives on the canvas in world coordinates. Chrome (borders, buttons)
   scales natively via ReactFlow transform — all sizes are plain
   CSS pixels. Semantic reveal drives header/body simplification
   when zoomed out, so widgets stay visible but simplify gracefully.

   Widgets are pure-frontend: state lives in zustand + localStorage.
   =================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { X, GripHorizontal, ArrowDownRight } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSemanticTier, STABLE } from "@/lib/workspace/zoom";
import type { WidgetData } from "@/lib/workspace/contracts";
import type { SemanticTier } from "@/lib/workspace/zoom";
import {
  WidgetSticky,
  WidgetTimer,
  WidgetCountdown,
  WidgetClock,
  WidgetLink,
  WidgetImage,
  WidgetScratchpad,
  WidgetPlannerStrip,
} from "@/components/workspace/widget-renderers";

/* Stable CSS-pixel constants for shell chrome */
const SHELL = {
  radius: STABLE.RADIUS_MD,         // 14
  border: STABLE.BORDER,            // 1
  pad: STABLE.PAD_SM,               // 8
  titleSize: STABLE.ITEM_META,      // 11
  iconSize: STABLE.ICON_SM,         // 12
  handleSize: 18,
  closeBtn: 22,
  closeRadius: STABLE.RADIUS_SM,    // 8
  shadowY: 8,
  shadowBlur: 22,
  shadowSpread: 12,
} as const;

export function WidgetHost({ widget }: { widget: WidgetData }) {
  const removeWidget = useWorkspaceStore((s) => s.removeWidget);
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);
  const semanticTier = useSemanticTier();

  const [resizing, setResizing] = useState(false);
  const startRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const currentRef = useRef<{ w: number; h: number } | null>(null);

  // Resize handler operates in SCREEN pixels, then we convert to world via zoom
  const zoom = useWorkspaceStore((s) => s.zoom);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startRef.current = { x: e.clientX, y: e.clientY, w: widget.w, h: widget.h };
      setResizing(true);
    },
    [widget.w, widget.h],
  );

  useEffect(() => {
    if (!resizing) return;
    function onMove(e: MouseEvent) {
      if (!startRef.current) return;
      const dxScreen = e.clientX - startRef.current.x;
      const dyScreen = e.clientY - startRef.current.y;
      const dxWorld = dxScreen / (zoom || 1);
      const dyWorld = dyScreen / (zoom || 1);
      const newW = Math.max(400, startRef.current.w + dxWorld);
      const newH = Math.max(300, startRef.current.h + dyWorld);
      currentRef.current = { w: newW, h: newH };
      updateWidget(widget.id, { w: newW, h: newH });
    }
    function onUp() {
      setResizing(false);
      startRef.current = null;
      currentRef.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing, zoom, updateWidget, widget.id]);

  const title = widgetTitle(widget);

  // Semantic reveal: header simplifies at glance/touch tiers
  const showTitle = semanticTier !== "glance";
  const showCloseBtn = semanticTier === "detail";

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "var(--bg-elevated)",
          border: `${SHELL.border}px solid var(--border-default)`,
          borderRadius: SHELL.radius,
          boxShadow: `0 ${SHELL.shadowY}px ${SHELL.shadowBlur}px -${SHELL.shadowSpread}px rgba(10,14,20,0.12)`,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header bar — drag grip + title + close */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: `${SHELL.pad}px ${SHELL.pad * 1.75}px`,
            borderBottom: `${SHELL.border}px solid var(--border-default)`,
            background:
              "linear-gradient(to bottom, color-mix(in oklab, var(--bg-elevated) 92%, var(--border-default)), var(--bg-elevated))",
            flexShrink: 0,
          }}
        >
          <GripHorizontal
            style={{ width: SHELL.iconSize, height: SHELL.iconSize, color: "var(--text-tertiary)", flexShrink: 0 }}
          />
          {showTitle && (
            <span
              className="font-mono"
              style={{
                fontSize: SHELL.titleSize,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--text-secondary)",
                fontWeight: 600,
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </span>
          )}
          {showCloseBtn && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeWidget(widget.id);
              }}
              style={{
                width: SHELL.closeBtn,
                height: SHELL.closeBtn,
                borderRadius: SHELL.closeRadius,
                background: "transparent",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "var(--text-tertiary)",
                flexShrink: 0,
              }}
              title="Remove widget"
            >
              <X style={{ width: SHELL.iconSize, height: SHELL.iconSize }} />
            </button>
          )}
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: SHELL.pad,
          }}
        >
          {renderWidget(widget, semanticTier)}
        </div>

        {/* Resize handle — only visible at detail tier */}
        {semanticTier === "detail" && (
          <div
            onMouseDown={onResizeStart}
            style={{
              position: "absolute",
              right: SHELL.pad / 2,
              bottom: SHELL.pad / 2,
              width: SHELL.handleSize,
              height: SHELL.handleSize,
              cursor: "nwse-resize",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-tertiary)",
              opacity: 0.65,
            }}
            title="Resize"
          >
            <ArrowDownRight style={{ width: SHELL.iconSize, height: SHELL.iconSize }} />
          </div>
        )}
      </div>
    </div>
  );
}

function widgetTitle(w: WidgetData): string {
  switch (w.kind) {
    case "sticky": return "Sticky Note";
    case "timer": return "Pomodoro Timer";
    case "countdown": return "Countdown";
    case "clock": return "Clock";
    case "link": return "Link Card";
    case "image": return "Image";
    case "scratchpad": return "Scratchpad";
    case "planner-strip": return "Planner Strip";
    default: return "Widget";
  }
}

function renderWidget(w: WidgetData, tier: SemanticTier) {
  switch (w.kind) {
    case "sticky": return <WidgetSticky widget={w} tier={tier} />;
    case "timer": return <WidgetTimer widget={w} tier={tier} />;
    case "countdown": return <WidgetCountdown widget={w} tier={tier} />;
    case "clock": return <WidgetClock widget={w} tier={tier} />;
    case "link": return <WidgetLink widget={w} tier={tier} />;
    case "image": return <WidgetImage widget={w} tier={tier} />;
    case "scratchpad": return <WidgetScratchpad widget={w} tier={tier} />;
    case "planner-strip": return <WidgetPlannerStrip widget={w} tier={tier} />;
    default: return null;
  }
}
