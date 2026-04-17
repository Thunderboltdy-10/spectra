"use client";

/* ===================================================================
   WidgetHost — the draggable, resizable, deletable widget shell.

   Lives on the canvas in world coordinates. Chrome (borders, buttons)
   is screen-stable via useScreenSize. Content is delegated to per-kind
   renderers below.

   Widgets are pure-frontend: state lives in zustand + localStorage.
   =================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { X, GripHorizontal, ArrowDownRight } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useScreenSize, STABLE } from "@/lib/workspace/zoom";
import type { WidgetData } from "@/lib/workspace/contracts";
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

export function WidgetHost({ widget }: { widget: WidgetData }) {
  const removeWidget = useWorkspaceStore((s) => s.removeWidget);
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);

  const radius = useScreenSize(STABLE.RADIUS_MD);
  const border = useScreenSize(STABLE.BORDER);
  const pad = useScreenSize(STABLE.PAD_SM);
  const titleSize = useScreenSize(STABLE.ITEM_META);
  const iconSize = useScreenSize(STABLE.ICON_SM);
  const handleSize = useScreenSize(18);

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
          border: `${border}px solid var(--border-default)`,
          borderRadius: `${radius}px`,
          boxShadow: `0 ${useScreenSize(8)}px ${useScreenSize(22)}px -${useScreenSize(12)}px rgba(10,14,20,0.12)`,
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
            gap: useScreenSize(8),
            padding: `${pad}px ${useScreenSize(STABLE.PAD_MD)}px`,
            borderBottom: `${border}px solid var(--border-default)`,
            background:
              "linear-gradient(to bottom, color-mix(in oklab, var(--bg-elevated) 92%, var(--border-default)), var(--bg-elevated))",
            flexShrink: 0,
          }}
        >
          <GripHorizontal
            style={{ width: iconSize, height: iconSize, color: "var(--text-tertiary)", flexShrink: 0 }}
          />
          <span
            className="font-mono"
            style={{
              fontSize: titleSize,
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
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeWidget(widget.id);
            }}
            style={{
              width: useScreenSize(22),
              height: useScreenSize(22),
              borderRadius: useScreenSize(6),
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
            <X style={{ width: iconSize, height: iconSize }} />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: useScreenSize(STABLE.PAD_SM),
          }}
        >
          {renderWidget(widget)}
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={onResizeStart}
          style={{
            position: "absolute",
            right: useScreenSize(4),
            bottom: useScreenSize(4),
            width: handleSize,
            height: handleSize,
            cursor: "nwse-resize",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-tertiary)",
            opacity: 0.65,
          }}
          title="Resize"
        >
          <ArrowDownRight style={{ width: iconSize, height: iconSize }} />
        </div>
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

function renderWidget(w: WidgetData) {
  switch (w.kind) {
    case "sticky": return <WidgetSticky widget={w} />;
    case "timer": return <WidgetTimer widget={w} />;
    case "countdown": return <WidgetCountdown widget={w} />;
    case "clock": return <WidgetClock widget={w} />;
    case "link": return <WidgetLink widget={w} />;
    case "image": return <WidgetImage widget={w} />;
    case "scratchpad": return <WidgetScratchpad widget={w} />;
    case "planner-strip": return <WidgetPlannerStrip widget={w} />;
    default: return null;
  }
}
