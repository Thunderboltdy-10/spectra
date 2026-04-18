"use client";

/* ===================================================================
   WORKSPACE CANVAS — Atlas edition v4.

   ReactFlow scales natively. All node content is sized in CSS pixels
   and ReactFlow's transform handles zoom. Semantic zoom is achieved
   through CONTINUOUS ZoomSignals that drive gradual structural
   adaptation — not just hide/show by tier.

   v4 changes:
   - Continuous reveal: itemReveal(), territoryReveal(), groupLabelReveal()
     produce 0-1 opacity/scale signals, not binary show/hide.
   - Components consume useZoomSignals() directly for fine-grained control.
   - useSemanticTier() only for coarse gating where needed.
   - Shape/spacing/internal adaptation: icon size, padding, body height,
     meta opacity, etc. all interpolate continuously.

   Layers (bottom → top):
     1. CanvasBackground (paper + dots/grid)
     2. Workspace territory (cartouche + subtle wash)
     3. Group latitude-rule headers
     4. Widget hosts (draggable non-item blocks)
     5. Item nodes (chips → cards → detail through zoom signals)
   =================================================================== */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type Edge,
  type NodeChange,
  type NodePositionChange,
  type Viewport,
} from "@xyflow/react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  VIEWPORT as VP,
  TERRITORY,
  computeZoomSignals,
  type WorkspaceData,
  type WorkspaceItemData,
  type ViewMode,
  type BackgroundMode,
  type WidgetData,
  type WidgetKind,
  TYPE_GROUP_LABELS,
} from "@/lib/workspace/contracts";
import {
  CANONICAL_WORKSPACE_TYPE_META,
  type CanonicalWorkspaceType,
} from "@/lib/artifact-types";
import {
  useZoom,
  useZoomSignals,
  STABLE,
  lerp,
  itemReveal,
  territoryReveal,
  groupLabelReveal,
} from "@/lib/workspace/zoom";
import {
  territoryInk,
  type TerritoryInk,
} from "@/lib/workspace/atlas-theme";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { WidgetHost } from "@/components/workspace/widget-host";
import {
  ActionMenuContent,
  type ActionMenuItemId,
} from "@/components/workspace/shared-action-menu";

/* ===================================================================
   Node data types
   =================================================================== */

type WorkspaceNodeData = {
  workspace: WorkspaceData;
  ink: TerritoryInk;
};

type ItemNodeData = {
  item: WorkspaceItemData;
  groupLabel?: string;
  ink: TerritoryInk;
};

type GroupLabelNodeData = {
  label: string;
  count: number;
  ink: TerritoryInk;
  viewMode: ViewMode;
};

type WidgetNodeData = {
  widget: WidgetData;
};

/* ===================================================================
   Status dot
   =================================================================== */

function statusColor(status: string): string {
  switch (status) {
    case "active":
      return "var(--success)";
    case "completed":
      return "var(--text-tertiary)";
    case "archived":
    case "idle":
    case "quiet":
    default:
      return "var(--border-default)";
  }
}

function StatusDot({ status, opacity }: { status: string; opacity: number }) {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: statusColor(status),
        display: "inline-block",
        flexShrink: 0,
        opacity,
      }}
    />
  );
}

/* ===================================================================
   Workspace Territory — clean identity display.

   Uses territoryReveal() for continuous adaptation:
   - Emoji scales down as we zoom in (identity anchors to corner)
   - Name opacity interpolates smoothly
   - Meta line fades in gradually
   - Background wash intensity changes with territoryFade signal
   =================================================================== */

function WorkspaceTerritoryNode({ data }: { data: WorkspaceNodeData }) {
  const { workspace, ink } = data;
  const signals = useZoomSignals();
  const reveal = territoryReveal(signals);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
        alignItems: "flex-start",
        padding: reveal.padding,
      }}
    >
      {/* Territory wash — intensity driven by territoryFade signal */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: ink.fill,
          opacity: reveal.washOpacity,
          borderRadius: STABLE.RADIUS_LG,
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: STABLE.PAD_MD,
          position: "relative",
          zIndex: 1,
        }}
      >
        <span
          style={{
            fontSize: STABLE.WS_EMOJI,
            lineHeight: 1,
            transform: `scale(${reveal.emojiScale})`,
            transformOrigin: "center left",
            transition: "transform 0.3s ease-out",
          }}
        >
          {workspace.emoji}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: STABLE.PAD_SM / 2 }}>
          <span
            className="font-display"
            style={{
              fontSize: STABLE.WS_NAME,
              fontWeight: 600,
              letterSpacing: "-0.015em",
              color: ink.ink,
              lineHeight: 1,
              opacity: reveal.nameOpacity,
            }}
          >
            {workspace.name}
          </span>
          {reveal.shouldMountMeta && (
            <span
              className="font-mono"
              style={{
                fontSize: STABLE.WS_META,
                letterSpacing: "0.08em",
                textTransform: "uppercase" as const,
                color: ink.accent,
                opacity: reveal.metaOpacity,
              }}
            >
              {workspace.itemCount} items
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===================================================================
   Group label — latitude-rule style with continuous reveal.

   Label text fades with groupReveal signal.
   Rule line and count fade in with cardDetail signal.
   =================================================================== */

function GroupLabelNode({ data }: { data: GroupLabelNodeData }) {
  const signals = useZoomSignals();
  const reveal = groupLabelReveal(signals);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: STABLE.PAD_SM,
        padding: `${STABLE.PAD_SM / 2}px 0`,
        pointerEvents: "none",
      }}
    >
      <span
        className="font-mono"
        style={{
          fontSize: STABLE.GROUP_LABEL,
          letterSpacing: "0.18em",
          textTransform: "uppercase" as const,
          color: data.ink.ink,
          fontWeight: 600,
          opacity: reveal.labelOpacity,
        }}
      >
        {data.label}
      </span>
      {reveal.shouldMountRule && (
        <>
          <span
            style={{
              height: 1,
              width: 80,
              background: `linear-gradient(to right, ${data.ink.accent}, transparent)`,
              opacity: reveal.ruleOpacity,
            }}
          />
          <span
            className="font-mono"
            style={{
              fontSize: STABLE.GROUP_COUNT,
              color: data.ink.accent,
              letterSpacing: "0.04em",
              opacity: reveal.countOpacity,
            }}
          >
            {String(data.count).padStart(2, "0")}
          </span>
        </>
      )}
    </div>
  );
}

/* ===================================================================
   Item node — native ReactFlow scaling with CONTINUOUS semantic zoom.

   Content is in CSS pixels; ReactFlow transforms handle zoom.
   Sub-elements reveal via continuous 0-1 opacity signals from
   itemReveal(), not binary tier-based show/hide.

   Shape adaptation:
   - Icon container size interpolates with cardDetail
   - Header padding interpolates with cardDetail
   - Body height grows continuously with cardDetail
   - Meta/controls opacity fades in gradually
   =================================================================== */

function ItemNode({ data }: { data: ItemNodeData }) {
  const { item, ink } = data;
  const meta = CANONICAL_WORKSPACE_TYPE_META[item.itemType as CanonicalWorkspaceType];
  const Icon = meta?.icon;

  const focusedItemId = useWorkspaceStore((s) => s.focusedItemId);
  const isFocused = focusedItemId === item.id;
  const typeColor = meta?.color ?? "var(--text-secondary)";
  const signals = useZoomSignals();
  const reveal = itemReveal(signals);

  // Shadow varies with focus + content depth
  const shadowStyle = isFocused
    ? `0 ${lerp(8, 12, reveal.shadowIntensity)}px ${lerp(20, 26, reveal.shadowIntensity)}px -14px ${ink.contour}`
    : `0 ${lerp(2, 4, reveal.shadowIntensity)}px ${lerp(8, 12, reveal.shadowIntensity)}px -10px rgba(10,14,20,0.10)`;

  return (
    <div
      style={{
        width: STABLE.ITEM_CARD_WIDTH,
        position: "relative",
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          position: "relative",
          background: "var(--bg-elevated)",
          border: `${STABLE.BORDER}px solid ${isFocused ? ink.accent : "var(--border-default)"}`,
          borderRadius: STABLE.RADIUS_MD,
          boxShadow: shadowStyle,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Type accent bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: 3,
            background: typeColor,
            opacity: 0.75,
          }}
        />

        {/* Header row — icon + title + status */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: STABLE.PAD_SM + 2,
            padding: `${reveal.headerPadding}px ${STABLE.PAD_MD}px`,
            paddingLeft: 18,
            borderBottom: reveal.shouldMountBody
              ? `${STABLE.BORDER}px solid color-mix(in oklab, ${typeColor} 10%, var(--border-default))`
              : "none",
            minHeight: STABLE.ITEM_CHIP_HEIGHT,
            flexShrink: 0,
          }}
        >
          {reveal.shouldMountIcon && Icon ? (
            <div
              style={{
                width: reveal.iconSize,
                height: reveal.iconSize,
                borderRadius: STABLE.RADIUS_SM,
                background: `color-mix(in oklab, ${typeColor} 12%, transparent)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                opacity: reveal.iconOpacity,
                transition: "width 0.2s ease-out, height 0.2s ease-out, opacity 0.2s ease-out",
              }}
            >
              <Icon style={{ width: STABLE.ICON_MD, height: STABLE.ICON_MD, color: typeColor }} />
            </div>
          ) : null}
          <div
            className="font-body"
            style={{
              fontSize: STABLE.ITEM_TITLE,
              fontWeight: 600,
              color: "var(--text-primary)",
              letterSpacing: "-0.005em",
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.3,
              opacity: reveal.titleOpacity,
            }}
          >
            {item.title}
          </div>
          <StatusDot status={item.status} opacity={reveal.statusOpacity} />
        </div>

        {/* Body preview — height interpolates continuously */}
        {reveal.shouldMountBody && (
          <div
            style={{
              padding: `${STABLE.PAD_SM}px ${STABLE.PAD_MD}px`,
              paddingLeft: 18,
              maxHeight: reveal.bodyHeight,
              overflow: "hidden",
              opacity: reveal.bodyOpacity,
              transition: "max-height 0.25s ease-out, opacity 0.2s ease-out",
            }}
          >
            {item.preview ? (
              <DetailBody item={item} />
            ) : (
              <div style={{ color: "var(--text-tertiary)", fontSize: STABLE.ITEM_BODY, fontStyle: "italic" }}>
                Empty
              </div>
            )}
          </div>
        )}

        {/* Meta line — type badge + optional date */}
        {reveal.shouldMountMeta && (
          <div
            style={{
              padding: `4px ${STABLE.PAD_MD}px ${STABLE.PAD_SM}px`,
              paddingLeft: 18,
              display: "flex",
              alignItems: "center",
              gap: STABLE.PAD_SM + 2,
              flexShrink: 0,
              opacity: reveal.metaOpacity,
              transition: "opacity 0.2s ease-out",
            }}
          >
            <span
              className="font-mono"
              style={{
                fontSize: STABLE.ITEM_META,
                letterSpacing: "0.1em",
                textTransform: "uppercase" as const,
                color: typeColor,
                fontWeight: 600,
              }}
            >
              {meta?.label ?? item.itemType}
            </span>
            {item.meta ? (
              <>
                <span style={{ width: 2, height: 2, borderRadius: "50%", background: "var(--text-tertiary)" }} />
                <span className="font-mono" style={{ fontSize: STABLE.ITEM_META, color: "var(--text-tertiary)", letterSpacing: "0.04em" }}>
                  {item.meta}
                </span>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailBody({ item }: { item: WorkspaceItemData }) {
  if (item.itemType === "code") {
    return (
      <div style={{ padding: STABLE.PAD_MD, background: "var(--bg-code)", borderRadius: STABLE.RADIUS_SM, color: "var(--text-primary)" }}>
        <pre className="font-mono" style={{ fontSize: STABLE.ITEM_BODY, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, lineHeight: 1.55 }}>
          {item.preview!.slice(0, 600)}
        </pre>
      </div>
    );
  }

  if (item.itemType === "note" || item.itemType === "export") {
    return (
      <div style={{ color: "var(--text-primary)", fontSize: STABLE.ITEM_BODY, lineHeight: 1.65 }}>
        <MarkdownRenderer content={item.preview!.slice(0, 800)} />
      </div>
    );
  }

  return (
    <div style={{ color: "var(--text-secondary)", fontSize: STABLE.ITEM_BODY, lineHeight: 1.55 }}>
      {item.preview!.slice(0, 400)}
    </div>
  );
}

/* ===================================================================
   Widget node
   =================================================================== */

function WidgetNode({ data }: { data: WidgetNodeData }) {
  return <WidgetHost widget={data.widget} />;
}

/* ===================================================================
   Layout engine.

   Uses stable world coordinates — no zoom-dependent sizing.
   computeTerritorySize and buildNodes do NOT take zoom.
   Masonry-style column packing algorithm for item placement.
   =================================================================== */

function computeTerritorySize(itemCount: number): { w: number; h: number } {
  const LAYOUT = {
    WORLD_COL_WIDTH: 1400,
    WORLD_ROW_GAP: 520,
    HEADER_Y: 560,
    ITEMS_PER_ROW: 3,
    HORIZONTAL_GUTTER: 180,
    GROUP_GAP: 260,
  };
  const rows = Math.max(2, Math.ceil(itemCount / LAYOUT.ITEMS_PER_ROW));
  const w = Math.max(3600, Math.min(6400, 3200 + Math.ceil(itemCount / 4) * 520));
  const h = Math.max(2800, Math.min(5200, LAYOUT.HEADER_Y + 400 + rows * LAYOUT.WORLD_ROW_GAP));
  return { w, h };
}

function groupByType(
  items: WorkspaceItemData[],
): { label: string; items: WorkspaceItemData[] }[] {
  const byType: Record<string, WorkspaceItemData[]> = {};
  for (const it of items) {
    byType[it.itemType] = byType[it.itemType] ?? [];
    byType[it.itemType].push(it);
  }
  const out: { label: string; items: WorkspaceItemData[] }[] = [];
  for (const group of Object.values(TYPE_GROUP_LABELS)) {
    const list = group.types.flatMap((t) => byType[t] ?? []);
    if (list.length) out.push({ label: group.label, items: list });
  }
  return out;
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "for", "in", "on", "at",
  "by", "with", "from", "is", "it", "as", "be", "are",
]);

function groupByTopic(
  items: WorkspaceItemData[],
): { label: string; items: WorkspaceItemData[] }[] {
  const byCluster: Record<string, WorkspaceItemData[]> = {};
  const rest: WorkspaceItemData[] = [];
  for (const it of items) {
    if (it.topicCluster) {
      byCluster[it.topicCluster] = byCluster[it.topicCluster] ?? [];
      byCluster[it.topicCluster].push(it);
    } else {
      rest.push(it);
    }
  }
  if (Object.keys(byCluster).length) {
    const groups = Object.entries(byCluster).map(([label, list]) => ({ label, items: list }));
    if (rest.length) groups.push({ label: "Misc", items: rest });
    return groups;
  }

  const wordToItems = new Map<string, WorkspaceItemData[]>();
  for (const it of items) {
    const text = `${it.title} ${it.preview ?? ""}`.toLowerCase().replace(/[^a-z0-9\s]/g, "");
    const uniq = new Set(
      text.split(/\s+/).filter((w) => w.length > 3 && !STOPWORDS.has(w)),
    );
    for (const w of uniq) {
      const arr = wordToItems.get(w) ?? [];
      arr.push(it);
      wordToItems.set(w, arr);
    }
  }
  const sortedKw = Array.from(wordToItems.entries())
    .filter(([, arr]) => arr.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  const assigned = new Set<string>();
  const groups: { label: string; items: WorkspaceItemData[] }[] = [];
  for (const [kw, arr] of sortedKw) {
    const claim = arr.filter((it) => !assigned.has(it.id));
    if (claim.length < 2) continue;
    claim.forEach((it) => assigned.add(it.id));
    groups.push({
      label: kw.charAt(0).toUpperCase() + kw.slice(1),
      items: claim,
    });
  }
  const leftover = items.filter((it) => !assigned.has(it.id));
  if (leftover.length) groups.push({ label: "Unfiled", items: leftover });
  return groups.length ? groups : [{ label: "All", items }];
}

function groupByTimeline(
  items: WorkspaceItemData[],
): { label: string; items: WorkspaceItemData[] }[] {
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  const buckets: Record<string, WorkspaceItemData[]> = {
    "Today": [],
    "Yesterday": [],
    "This week": [],
    "Earlier": [],
  };
  const sorted = [...items].sort(
    (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
  );
  for (const it of sorted) {
    const ts = it.updatedAt ?? 0;
    if (ts >= t0) buckets.Today.push(it);
    else if (ts >= t0 - 86400000) buckets.Yesterday.push(it);
    else if (ts >= now - 7 * 86400000) buckets["This week"].push(it);
    else buckets.Earlier.push(it);
  }
  return Object.entries(buckets)
    .filter(([, arr]) => arr.length)
    .map(([label, items]) => ({ label, items }));
}

function groupsFor(
  items: WorkspaceItemData[],
  mode: ViewMode,
): { label: string; items: WorkspaceItemData[] }[] {
  if (mode === "byTopic") return groupByTopic(items);
  if (mode === "timeline") return groupByTimeline(items);
  return groupByType(items);
}

function buildNodes(
  workspaces: WorkspaceData[],
  viewMode: ViewMode,
  itemOverrides: Record<string, { x: number; y: number }>,
  widgets: WidgetData[],
): Node[] {
  const LAYOUT = {
    WORLD_COL_WIDTH: 1400,
    WORLD_ROW_GAP: 520,
    HEADER_Y: 560,
    ITEMS_PER_ROW: 3,
    HORIZONTAL_GUTTER: 180,
    GROUP_GAP: 260,
    TERRITORY_COLS: TERRITORY.COLS,
    TERRITORY_SPACING_X: TERRITORY.SPACING_X,
    TERRITORY_SPACING_Y: TERRITORY.SPACING_Y,
  };
  const nodes: Node[] = [];

  workspaces.forEach((ws, wsIdx) => {
    const col = wsIdx % LAYOUT.TERRITORY_COLS;
    const row = Math.floor(wsIdx / LAYOUT.TERRITORY_COLS);
    const originX = col * LAYOUT.TERRITORY_SPACING_X;
    const originY = row * LAYOUT.TERRITORY_SPACING_Y;
    const ink = territoryInk(ws.id, ws.name);
    const size = computeTerritorySize(ws.items.length);

    nodes.push({
      id: `ws-${ws.id}`,
      type: "workspaceTerritory",
      position: { x: originX, y: originY },
      data: { workspace: ws, ink } satisfies WorkspaceNodeData,
      draggable: false,
      selectable: true,
      style: { width: size.w, height: size.h, zIndex: 0 },
    });

    const groups = groupsFor(ws.items, viewMode);
    const colWidth = LAYOUT.WORLD_COL_WIDTH;
    const totalColumns = Math.max(1, Math.floor((size.w - LAYOUT.HORIZONTAL_GUTTER * 2) / colWidth));
    // Column accumulators — track the Y position for each column
    const colY: number[] = new Array(totalColumns).fill(LAYOUT.HEADER_Y);

    groups.forEach((group, gi) => {
      // Assign group to the shortest column for balanced layout
      let shortest = 0;
      for (let c = 1; c < totalColumns; c++) {
        if (colY[c] < colY[shortest]) shortest = c;
      }
      const gx = LAYOUT.HORIZONTAL_GUTTER + shortest * colWidth;
      const gy = colY[shortest];

      nodes.push({
        id: `group-${ws.id}-${gi}`,
        type: "groupLabel",
        parentId: `ws-${ws.id}`,
        position: { x: gx, y: gy },
        data: { label: group.label, count: group.items.length, ink, viewMode },
        draggable: false,
        selectable: false,
        extent: "parent",
        style: { zIndex: 1 },
      });

      // Place items using a masonry layout within the group
      const itemStartY = gy + 120;
      const itemColWidth = 440; // world-space width per item slot
      const itemMarginY = 40; // Vertical gap between items

      // Accumulators for each column in this group
      const groupColY: number[] = new Array(LAYOUT.ITEMS_PER_ROW).fill(itemStartY);

      group.items.forEach((item) => {
        // Find the shortest column in the group
        let shortestCol = 0;
        for (let c = 1; c < LAYOUT.ITEMS_PER_ROW; c++) {
          if (groupColY[c] < groupColY[shortestCol]) shortestCol = c;
        }

        const ix = gx + shortestCol * itemColWidth;
        const baseY = groupColY[shortestCol];
        
        const override = itemOverrides[item.id];
        const finalX = override ? override.x : ix;
        const finalY = override ? override.y : baseY;
        
        nodes.push({
          id: `item-${item.id}`,
          type: "itemNode",
          parentId: `ws-${ws.id}`,
          position: { x: finalX, y: finalY },
          data: { item, groupLabel: group.label, ink } satisfies ItemNodeData,
          draggable: true,
          selectable: true,
          extent: "parent",
          style: { zIndex: 2 },
        });

        // Estimate item height for masonry:
        // Base minHeight is 60. If preview exists, add up to 200
        // plus padding and meta dot area.
        const estimatedHeight = item.preview ? 320 : 100;
        groupColY[shortestCol] = baseY + estimatedHeight + itemMarginY;
      });

      // Update the main column accumulator for the entire group
      const maxGroupY = Math.max(...groupColY);
      colY[shortest] = maxGroupY + LAYOUT.GROUP_GAP;
    });
  });

  // Widgets — live in world coords, not parented to any territory
  // Use w.w / w.h directly — stable world coordinates, no zoom scaling
  for (const w of widgets) {
    nodes.push({
      id: `widget-${w.id}`,
      type: "widgetHost",
      position: { x: w.x, y: w.y },
      data: { widget: w } satisfies WidgetNodeData,
      draggable: true,
      selectable: true,
      style: { width: w.w, height: w.h, zIndex: 3 },
    });
  }

  return nodes;
}

/* ===================================================================
   Background — paper + mode-dependent pattern
   =================================================================== */

function CanvasBackground({ mode, zoom }: { mode: BackgroundMode; zoom: number }) {
  const signals = computeZoomSignals(zoom);

  const opacity = lerp(0.25, 0.55, signals.structureReveal);
  if (mode === "blank") return null;

  let backgroundImage = "";
  let backgroundSize = "28px 28px";

  if (mode === "dots") {
    backgroundImage =
      "radial-gradient(circle, color-mix(in oklab, var(--text-tertiary) 32%, transparent) 1px, transparent 1.4px)";
    backgroundSize = "26px 26px";
  } else if (mode === "grid") {
    backgroundImage = `
      linear-gradient(color-mix(in oklab, var(--border-default) 40%, transparent) 0.5px, transparent 0.5px),
      linear-gradient(90deg, color-mix(in oklab, var(--border-default) 40%, transparent) 0.5px, transparent 0.5px)
    `;
    backgroundSize = "44px 44px";
  } else if (mode === "contour") {
    backgroundImage = "none";
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        backgroundImage,
        backgroundSize,
        opacity,
      }}
    />
  );
}

/* ===================================================================
   Right-click Context Menu
   =================================================================== */

function CanvasContextMenu({
  x,
  y,
  onAction,
  onClose,
}: {
  x: number;
  y: number;
  onAction: (id: ActionMenuItemId) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside or Escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as unknown as globalThis.Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: x,
        top: y,
        zIndex: 9999,
        minWidth: 200,
      }}
    >
      <div
        className="rounded-2xl border border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/98 backdrop-blur-xl shadow-[0_28px_60px_-28px_rgba(8,22,40,0.35)]"
      >
        <ActionMenuContent onAction={(id) => { onAction(id); onClose(); }} />
      </div>
    </div>
  );
}

/* ===================================================================
   Canvas Inner
   =================================================================== */

const NODE_TYPES = {
  workspaceTerritory: WorkspaceTerritoryNode,
  groupLabel: GroupLabelNode,
  itemNode: ItemNode,
  widgetHost: WidgetNode,
};

type WorkspaceCanvasProps = {
  onNodeClick?: (workspaceId: string) => void;
  onItemClick?: (itemId: string) => void;
};

function WorkspaceCanvasInner({ onNodeClick, onItemClick }: WorkspaceCanvasProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const viewMode = useWorkspaceStore((s) => s.viewMode);
  const backgroundMode = useWorkspaceStore((s) => s.backgroundMode);
  const zoom = useZoom();
  const setViewport = useWorkspaceStore((s) => s.setViewport);
  const setZoom = useWorkspaceStore((s) => s.setZoom);
  const setFocusedItem = useWorkspaceStore((s) => s.setFocusedItem);
  const flyToTarget = useWorkspaceStore((s) => s.flyToTarget);
  const clearFlyToTarget = useWorkspaceStore((s) => s.clearFlyToTarget);
  const widgets = useWorkspaceStore((s) => s.widgets);
  const setItemPosition = useWorkspaceStore((s) => s.setItemPosition);
  const updateWidget = useWorkspaceStore((s) => s.updateWidget);
  const itemPositions = useWorkspaceStore((s) => s.itemPositions);
  const widgetPlacementHint = useWorkspaceStore((s) => s.widgetPlacementHint);
  const setWidgetPlacementHint = useWorkspaceStore((s) => s.setWidgetPlacementHint);
  const addWidget = useWorkspaceStore((s) => s.addWidget);

  const { setCenter, zoomIn, zoomOut, zoomTo, screenToFlowPosition } = useReactFlow();

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; flowX: number; flowY: number } | null>(null);

  // Fly-to animation
  const lastFlyRef = useRef<number>(0);
  useEffect(() => {
    if (!flyToTarget || flyToTarget.requestId === lastFlyRef.current) return;
    lastFlyRef.current = flyToTarget.requestId;
    setCenter(flyToTarget.centerX, flyToTarget.centerY, {
      zoom: flyToTarget.zoom,
      duration: 720,
    });
    const t = setTimeout(clearFlyToTarget, 760);
    return () => clearTimeout(t);
  }, [flyToTarget, setCenter, clearFlyToTarget]);

  // Keyboard zoom shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === "+" || (e.key === "=" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        zoomIn({ duration: 200 });
      } else if (e.key === "-" || (e.key === "-" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        zoomOut({ duration: 200 });
      } else if (e.key === "0") {
        e.preventDefault();
        zoomTo(VP.DEFAULT_ZOOM, { duration: 240 });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomIn, zoomOut, zoomTo]);

  // Viewport change — RAF throttled
  const rafRef = useRef<number>(0);
  const lastVp = useRef<Viewport>({ x: 0, y: 0, zoom: VP.DEFAULT_ZOOM });
  const handleViewportChange = useCallback(
    (vp: Viewport) => {
      lastVp.current = vp;
      setZoom(vp.zoom);
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          const cur = lastVp.current;
          setViewport(cur.x, cur.y, cur.zoom);
        });
      }
    },
    [setViewport, setZoom],
  );

  // Build positions override map
  const positionsMap = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const [id, pos] of Object.entries(itemPositions)) {
      out[id] = { x: pos.x, y: pos.y };
    }
    return out;
  }, [itemPositions]);

  // buildNodes no longer takes zoom — layout is in stable world coordinates
  const nodes = useMemo(
    () => buildNodes(workspaces, viewMode, positionsMap, widgets),
    [workspaces, viewMode, positionsMap, widgets],
  );

  const edges: Edge[] = useMemo(() => [], []);

  // Track drag commits
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const ch of changes) {
        if (ch.type !== "position") continue;
        const pc = ch as NodePositionChange;
        if (pc.dragging) continue;
        if (!pc.position) continue;
        if (pc.id.startsWith("item-")) {
          const itemId = pc.id.slice("item-".length);
          setItemPosition(itemId, pc.position.x, pc.position.y);
        } else if (pc.id.startsWith("widget-")) {
          const widgetId = pc.id.slice("widget-".length);
          updateWidget(widgetId, { x: pc.position.x, y: pc.position.y });
        }
      }
    },
    [setItemPosition, updateWidget],
  );

  const handleNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      if (node.type === "workspaceTerritory" && onNodeClick) {
        onNodeClick(node.id.replace("ws-", ""));
      } else if (node.type === "itemNode" && onItemClick) {
        const itemId = node.id.replace("item-", "");
        setFocusedItem(itemId);
        onItemClick(itemId);
      }
    },
    [onNodeClick, onItemClick, setFocusedItem],
  );

  const handlePaneClick = useCallback(
    (e: React.MouseEvent) => {
      // Close context menu if open
      setContextMenu(null);
      setFocusedItem(null);
      // Place pending widget
      if (widgetPlacementHint) {
        const world = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const w: WidgetData = {
          id: `wg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          kind: widgetPlacementHint.kind,
          x: world.x,
          y: world.y,
          w: defaultWidgetSize(widgetPlacementHint.kind).w,
          h: defaultWidgetSize(widgetPlacementHint.kind).h,
          workspaceId: null,
          createdAt: Date.now(),
          state: defaultWidgetState(widgetPlacementHint.kind),
        };
        addWidget(w);
        setWidgetPlacementHint(null);
      }
    },
    [setFocusedItem, widgetPlacementHint, screenToFlowPosition, addWidget, setWidgetPlacementHint],
  );

  // Right-click context menu
  const handlePaneContextMenu = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      e.preventDefault();
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        flowX: flowPos.x,
        flowY: flowPos.y,
      });
    },
    [screenToFlowPosition],
  );

  const handleContextAction = useCallback(
    (id: ActionMenuItemId) => {
      switch (id) {
        case "widget": {
          useWorkspaceStore.getState().setWidgetPlacementHint({ kind: "sticky", at: "pointer" });
          break;
        }
        case "note":
        case "code":
        case "visual":
        case "task":
        case "thread":
        case "ai":
        case "workspace":
          // These would route to the command bar creation flow
          // For now, dispatch a custom event that page.tsx can listen to
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("workspace:context-action", {
                detail: { action: id, flowX: contextMenu?.flowX, flowY: contextMenu?.flowY },
              }),
            );
          }
          break;
      }
    },
    [contextMenu],
  );

  // Resolve background — "contour" mode skips mask pattern since it's on the territory
  const bgForFlow: BackgroundMode = backgroundMode === "contour" ? "blank" : backgroundMode;

  return (
    <div
      className="h-full w-full relative"
      style={{
        background: "var(--bg-primary)",
        cursor: widgetPlacementHint ? "crosshair" : "default",
      }}
    >
      <CanvasBackground mode={bgForFlow} zoom={zoom} />

      <div className="h-full w-full relative z-[1]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={handleNodesChange}
          onViewportChange={handleViewportChange}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          onPaneContextMenu={handlePaneContextMenu}
          panOnScroll={false}
          
          panOnDrag={true}
          zoomOnScroll={true}
          zoomOnPinch={true}
          zoomOnDoubleClick={false}
          minZoom={VP.MIN_ZOOM}
          maxZoom={VP.MAX_ZOOM}
          defaultViewport={{ x: 80, y: 40, zoom: VP.DEFAULT_ZOOM }}
          proOptions={{ hideAttribution: true }}
          fitView={true}
          fitViewOptions={{ padding: 0.3, maxZoom: VP.DEFAULT_ZOOM + 0.05 }}
          deleteKeyCode={null}
          selectionKeyCode={null}
          style={{ background: "transparent" }}
        />
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

function defaultWidgetSize(kind: WidgetKind): { w: number; h: number } {
  switch (kind) {
    case "sticky":
      return { w: 1200, h: 900 };
    case "timer":
    case "countdown":
    case "clock":
      return { w: 1100, h: 650 };
    case "link":
      return { w: 1300, h: 500 };
    case "image":
      return { w: 1600, h: 1100 };
    case "scratchpad":
      return { w: 1800, h: 1400 };
    case "planner-strip":
      return { w: 2200, h: 650 };
    default:
      return { w: 1200, h: 800 };
  }
}

function defaultWidgetState(kind: WidgetKind): Record<string, unknown> {
  switch (kind) {
    case "sticky":
      return { text: "", color: "ochre" };
    case "timer":
      return { minutes: 25, running: false };
    case "countdown":
      return { targetAt: Date.now() + 3600000, label: "Countdown" };
    case "clock":
      return { tz: "local" };
    case "link":
      return { url: "", label: "Open link" };
    case "image":
      return { url: "" };
    case "scratchpad":
      return { text: "" };
    case "planner-strip":
      return { tasks: [] };
    default:
      return {};
  }
}

export function WorkspaceCanvas(props: WorkspaceCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkspaceCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
