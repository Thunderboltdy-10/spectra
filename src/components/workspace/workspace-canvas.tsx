"use client";

/* ===================================================================
   WORKSPACE CANVAS — Atlas edition v2.

   ReactFlow scales natively. All node content is sized in CSS pixels
   and ReactFlow's transform handles zoom. Semantic zoom is achieved
   through CSS opacity/display transitions driven by ZoomSignals —
   progressive reveal, not counter-scaling.

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
import { cn } from "@/lib/utils";
import {
  useZoom,
  useZoomSignals,
  lerp,
} from "@/lib/workspace/zoom";
import {
  territoryInk,
  type TerritoryInk,
} from "@/lib/workspace/atlas-theme";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { WidgetHost } from "@/components/workspace/widget-host";
import {
  ActionMenuContent,
  ACTION_MENU_ITEMS,
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

function StatusDot({ status }: { status: string }) {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: statusColor(status),
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

/* ===================================================================
   Workspace Territory — clean identity display.

   At far zoom: big emoji + name centered.
   At summary+: compact badge anchored top-left.
   Territory wash fades with zoom.
   =================================================================== */

function WorkspaceTerritoryNode({ data }: { data: WorkspaceNodeData }) {
  const { workspace, ink } = data;
  const signals = useZoomSignals();

  // Crossfade far ↔ anchored
  const farAlpha = 1 - signals.identityAnchor;
  const nearAlpha = signals.identityAnchor;

  const lastActivity = useMemo(() => {
    if (!workspace.lastActivity) return null;
    const diffM = Math.floor((Date.now() - workspace.lastActivity) / 60000);
    if (diffM < 1) return "now";
    if (diffM < 60) return `${diffM}m`;
    const h = Math.floor(diffM / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }, [workspace.lastActivity]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        pointerEvents: "none",
      }}
    >
      {/* Territory fill — subtle wash of ink */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: ink.fill,
          opacity: lerp(1, 0.25, signals.territoryFade),
          borderRadius: 40,
        }}
      />

      {/* FAR (landscape) identity — centered cartouche */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 24,
          opacity: farAlpha,
          pointerEvents: farAlpha > 0.1 ? "auto" : "none",
          transition: "opacity 200ms ease",
        }}
      >
        <div
          className="font-display"
          style={{
            fontSize: 96,
            lineHeight: 1,
            filter: "drop-shadow(0 2px 6px rgba(10,14,20,0.08))",
          }}
        >
          {workspace.emoji}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
          }}
        >
          <div
            className="font-display"
            style={{
              fontSize: 56,
              fontWeight: 600,
              letterSpacing: "-0.015em",
              lineHeight: 1.1,
              color: ink.ink,
              textShadow: "0 2px 10px rgba(10,14,20,0.05)",
            }}
          >
            {workspace.name}
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: 12.5,
              letterSpacing: "0.08em",
              textTransform: "uppercase" as const,
              color: ink.accent,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span>{workspace.itemCount} items</span>
            {lastActivity ? (
              <>
                <span
                  style={{
                    width: 3,
                    height: 3,
                    borderRadius: "50%",
                    background: ink.accent,
                  }}
                />
                <span>{lastActivity}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* NEAR (summary+) — compact badge anchored top-left */}
      <div
        style={{
          position: "absolute",
          top: 28,
          left: 36,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          background: "var(--bg-elevated)",
          border: `1px solid ${ink.contour}`,
          borderRadius: 14,
          opacity: nearAlpha,
          pointerEvents: nearAlpha > 0.1 ? "auto" : "none",
          boxShadow: "0 4px 14px rgba(10,14,20,0.08)",
          transition: "opacity 200ms ease",
        }}
      >
        <span style={{ fontSize: 44, lineHeight: 1 }}>{workspace.emoji}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            className="font-display"
            style={{
              fontSize: 38,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: ink.ink,
              lineHeight: 1.05,
            }}
          >
            {workspace.name}
          </span>
          <span
            className="font-mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase" as const,
              color: ink.accent,
            }}
          >
            {workspace.itemCount} items{lastActivity ? ` · ${lastActivity}` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ===================================================================
   Group label — latitude-rule style.
   =================================================================== */

function GroupLabelNode({ data }: { data: GroupLabelNodeData }) {
  const signals = useZoomSignals();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 0",
        opacity: signals.groupReveal,
        pointerEvents: "none",
        transition: "opacity 200ms ease",
      }}
    >
      <span
        className="font-mono"
        style={{
          fontSize: 13,
          letterSpacing: "0.18em",
          textTransform: "uppercase" as const,
          color: data.ink.ink,
          fontWeight: 600,
        }}
      >
        {data.label}
      </span>
      <span
        style={{
          height: 1,
          width: 80,
          background: `linear-gradient(to right, ${data.ink.accent}, transparent)`,
        }}
      />
      <span
        className="font-mono"
        style={{
          fontSize: 11,
          color: data.ink.accent,
          letterSpacing: "0.04em",
        }}
      >
        {String(data.count).padStart(2, "0")}
      </span>
    </div>
  );
}

/* ===================================================================
   Item node — native ReactFlow scaling with CSS semantic zoom.

   Content is in CSS pixels; ReactFlow transforms handle zoom.
   Sub-elements reveal/hide via opacity driven by ZoomSignals.
   =================================================================== */

function ItemNode({ data }: { data: ItemNodeData }) {
  const { item, ink } = data;
  const signals = useZoomSignals();
  const meta = CANONICAL_WORKSPACE_TYPE_META[item.itemType as CanonicalWorkspaceType];
  const Icon = meta?.icon;

  const focusedItemId = useWorkspaceStore((s) => s.focusedItemId);
  const isFocused = focusedItemId === item.id;

  const typeColor = meta?.color ?? "var(--text-secondary)";

  return (
    <div
      style={{
        width: 240,
        position: "relative",
        pointerEvents: "auto",
        transition: "width 200ms ease",
      }}
    >
      <div
        style={{
          position: "relative",
          background: "var(--bg-elevated)",
          border: `1px solid ${isFocused ? ink.accent : "var(--border-default)"}`,
          borderRadius: 14,
          boxShadow: isFocused
            ? `0 12px 26px -14px ${ink.contour}`
            : "0 4px 12px -10px rgba(10,14,20,0.10)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          transition: "border-color 160ms ease, box-shadow 200ms ease, width 200ms ease",
        }}
      >
        {/* Coloured type strip — left edge */}
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

        {/* Header row — title, icon, status */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            paddingLeft: 18,
            borderBottom:
              signals.cardDetail > 0.2
                ? `1px solid color-mix(in oklab, ${typeColor} 10%, var(--border-default))`
                : "none",
            minHeight: 60,
            flexShrink: 0,
          }}
        >
          {Icon ? (
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: `color-mix(in oklab, ${typeColor} 12%, transparent)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon
                style={{ width: 16, height: 16, color: typeColor }}
              />
            </div>
          ) : null}
          <div
            className="font-body"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-primary)",
              letterSpacing: "-0.005em",
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.3,
            }}
          >
            {item.title}
          </div>
          <StatusDot status={item.status} />
        </div>

        {/* Card body — preview (revealed via opacity) */}
        {item.preview && (
          <div
            style={{
              flex: 1,
              padding: "8px 14px",
              paddingLeft: 18,
              opacity: signals.cardDetail * (1 - signals.contentDepth),
              maxHeight: signals.cardDetail > 0.1 ? 80 : 0,
              overflow: "hidden",
              transition: "opacity 200ms ease, max-height 200ms ease",
              pointerEvents: signals.cardDetail > 0.5 ? "auto" : "none",
            }}
          >
            <div
              className="font-body"
              style={{
                fontSize: 12.5,
                color: "var(--text-secondary)",
                lineHeight: 1.55,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {item.preview}
            </div>
          </div>
        )}

        {/* Detail body — full preview (revealed via opacity) */}
        <div
          style={{
            padding: "6px 14px",
            paddingLeft: 18,
            opacity: signals.contentDepth,
            maxHeight: signals.contentDepth > 0.1 ? 200 : 0,
            overflow: "hidden",
            pointerEvents: signals.contentDepth > 0.5 ? "auto" : "none",
            transition: "opacity 200ms ease, max-height 200ms ease",
          }}
        >
          {item.preview ? (
            <DetailBody item={item} typeColor={typeColor} />
          ) : (
            <div
              style={{
                color: "var(--text-tertiary)",
                fontSize: 12.5,
                fontStyle: "italic",
              }}
            >
              Empty
            </div>
          )}
        </div>

        {/* Footer meta — type label */}
        <div
          style={{
            padding: "4px 14px 8px",
            paddingLeft: 18,
            display: "flex",
            alignItems: "center",
            gap: 10,
            opacity: Math.min(signals.cardDetail * 2, 1 - signals.contentDepth),
            flexShrink: 0,
            transition: "opacity 200ms ease",
            pointerEvents: signals.cardDetail > 0.3 ? "auto" : "none",
          }}
        >
          <span
            className="font-mono"
            style={{
              fontSize: 11,
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
              <span
                style={{
                  width: 2,
                  height: 2,
                  borderRadius: "50%",
                  background: "var(--text-tertiary)",
                }}
              />
              <span
                className="font-mono"
                style={{
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                  letterSpacing: "0.04em",
                }}
              >
                {item.meta}
              </span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ===================================================================
   Type-specific detail body
   =================================================================== */

function DetailBody({ item, typeColor }: { item: WorkspaceItemData; typeColor: string }) {
  if (item.itemType === "code") {
    return (
      <div
        style={{
          padding: 14,
          background: "var(--bg-code)",
          borderRadius: 8,
          color: "var(--text-primary)",
        }}
      >
        <pre
          className="font-mono"
          style={{
            fontSize: 12.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
            lineHeight: 1.55,
          }}
        >
          {item.preview!.slice(0, 600)}
        </pre>
      </div>
    );
  }

  if (item.itemType === "note" || item.itemType === "export") {
    return (
      <div
        style={{
          color: "var(--text-primary)",
          fontSize: 12.5,
          lineHeight: 1.65,
        }}
      >
        <MarkdownRenderer content={item.preview!.slice(0, 800)} />
      </div>
    );
  }

  return (
    <div
      style={{
        color: "var(--text-secondary)",
        fontSize: 12.5,
        lineHeight: 1.55,
      }}
    >
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

   Improved: uses a proper masonry-style column packing algorithm
   to prevent overlaps and adapt dynamically to item count.
   =================================================================== */

const LAYOUT = {
  WORLD_COL_WIDTH: 1400,
  WORLD_ROW_GAP: 520,
  HEADER_Y: 560,
  ITEMS_PER_ROW: 3,
  HORIZONTAL_GUTTER: 180,
  GROUP_GAP: 260,
};

function computeTerritorySize(itemCount: number): { w: number; h: number } {
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
  const nodes: Node[] = [];

  workspaces.forEach((ws, wsIdx) => {
    const col = wsIdx % TERRITORY.COLS;
    const row = Math.floor(wsIdx / TERRITORY.COLS);
    const originX = col * TERRITORY.SPACING_X;
    const originY = row * TERRITORY.SPACING_Y;
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

      // Place items in a grid within the group column
      const itemStartY = gy + 120;
      const itemColWidth = 440; // world-space width per item slot
      const itemRowHeight = LAYOUT.WORLD_ROW_GAP;

      group.items.forEach((item, ii) => {
        const ix = gx + (ii % LAYOUT.ITEMS_PER_ROW) * itemColWidth;
        const baseY = itemStartY + Math.floor(ii / LAYOUT.ITEMS_PER_ROW) * itemRowHeight;
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
      });

      // Update column accumulator
      const rowsUsed = Math.ceil(group.items.length / LAYOUT.ITEMS_PER_ROW);
      colY[shortest] = itemStartY + rowsUsed * itemRowHeight + LAYOUT.GROUP_GAP;
    });
  });

  // Widgets — live in world coords, not parented to any territory
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
          panOnScroll={true}
          panOnScrollMode={"free" as unknown as undefined}
          panOnDrag={true}
          zoomOnScroll={false}
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
