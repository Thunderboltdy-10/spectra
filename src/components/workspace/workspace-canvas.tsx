"use client";

/* ===================================================================
   WORKSPACE CANVAS — Atlas edition.

   Everything inside a ReactFlow node is sized via useScreenSize, so
   card chrome stays the same physical size on screen at every zoom.
   The zoom signal drives DENSITY and REVEAL, not raw size.

   Layers (bottom → top):
     1. CanvasBackground (paper + dots/grid/contour)
     2. Workspace territory (cartouche at center, contour rings around)
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
  TYPE_TO_TINT,
  TYPE_GROUP_LABELS,
} from "@/lib/workspace/contracts";
import {
  CANONICAL_WORKSPACE_TYPE_META,
  type CanonicalWorkspaceType,
} from "@/lib/artifact-types";
import { cn } from "@/lib/utils";
import {
  useScreenSize,
  useZoom,
  useZoomSignals,
  smoothStep,
  lerp,
  STABLE,
} from "@/lib/workspace/zoom";
import {
  territoryInk,
  contourPatternDataUri,
  coordinateBadge,
  type TerritoryInk,
} from "@/lib/workspace/atlas-theme";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { WidgetHost } from "@/components/workspace/widget-host";

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

function StatusDot({ status, screenSize }: { status: string; screenSize: number }) {
  const worldSize = useScreenSize(screenSize);
  return (
    <span
      style={{
        width: worldSize,
        height: worldSize,
        borderRadius: "50%",
        background: statusColor(status),
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

/* ===================================================================
   Workspace Territory — cartouche + contours.

   World position is fixed. All visible chrome is screen-stable.
   At far zoom: big emoji + cartouche name + concentric contour rings.
   At summary+: cartouche slides to top-left corner as an anchor badge.
   Contour rings fade out as zoom increases.
   =================================================================== */

function WorkspaceTerritoryNode({ data }: { data: WorkspaceNodeData }) {
  const { workspace, ink } = data;
  const signals = useZoomSignals();

  // Screen-stable dimensions
  const emojiFar = useScreenSize(STABLE.WS_EMOJI_FAR);
  const emojiNear = useScreenSize(STABLE.WS_EMOJI);
  const nameFar = useScreenSize(STABLE.WS_NAME_FAR);
  const nameNear = useScreenSize(STABLE.WS_NAME);
  const metaSize = useScreenSize(STABLE.WS_META);
  const pad = useScreenSize(STABLE.PAD_LG);
  const radius = useScreenSize(STABLE.RADIUS_LG);

  // Precompute sizes so hooks are not called conditionally
  const gap24 = useScreenSize(24);
  const gap6 = useScreenSize(6);
  const gap12 = useScreenSize(12);
  const dotSize = useScreenSize(3);
  const nearTop = useScreenSize(28);
  const nearLeft = useScreenSize(36);
  const nearPadY = useScreenSize(10);
  const nearPadX = useScreenSize(14);
  const nearShadowY = useScreenSize(4);
  const nearShadowBlur = useScreenSize(14);
  const nearGap = useScreenSize(2);
  const bgSize = useScreenSize(240);

  // Crossfade far ↔ anchored
  const farAlpha = 1 - signals.identityAnchor;
  const nearAlpha = signals.identityAnchor;
  // Contour rings fade out with detail
  const contourAlpha = Math.max(0, 1 - signals.territoryFade * 1.1);

  const coord = useMemo(() => coordinateBadge(workspace.id), [workspace.id]);

  const lastActivity = useMemo(() => {
    if (!workspace.lastActivity) return null;
    // eslint-disable-next-line react-hooks/rules-of-hooks, react-hooks/purity
    const diffM = Math.floor((Date.now() - workspace.lastActivity) / 60000);
    if (diffM < 1) return "active now";
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
          opacity: lerp(1, 0.35, signals.territoryFade),
          borderRadius: `${pad * 2}px`,
        }}
      />

      {/* Contour rings — concentric, screen-stable tile */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: contourPatternDataUri(ink.contour, 0.35),
          backgroundRepeat: "repeat",
          backgroundSize: `${bgSize}px ${bgSize}px`,
          opacity: contourAlpha * 0.55,
          pointerEvents: "none",
          borderRadius: `${pad * 2}px`,
          maskImage: `radial-gradient(ellipse at center, black 60%, transparent 100%)`,
          WebkitMaskImage: `radial-gradient(ellipse at center, black 60%, transparent 100%)`,
        }}
      />

      {/* FAR (landscape) identity — centered cartouche */}
      {farAlpha > 0.01 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: gap24,
            opacity: farAlpha,
            pointerEvents: "auto",
          }}
        >
          <div
            className="font-display"
            style={{
              fontSize: emojiFar,
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
              gap: gap6,
            }}
          >
            <div
              className="font-display"
              style={{
                fontSize: nameFar,
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
                fontSize: metaSize,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: ink.accent,
                display: "flex",
                alignItems: "center",
                gap: gap12,
              }}
            >
              <span>{coord}</span>
              <span
                style={{
                  width: dotSize,
                  height: dotSize,
                  borderRadius: "50%",
                  background: ink.accent,
                }}
              />
              <span>{workspace.itemCount} ITEMS</span>
              {lastActivity ? (
                <>
                  <span
                    style={{
                      width: dotSize,
                      height: dotSize,
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
      )}

      {/* NEAR (summary+) — small cartouche anchored top-left */}
      {nearAlpha > 0.01 && (
        <div
          style={{
            position: "absolute",
            top: nearTop,
            left: nearLeft,
            display: "flex",
            alignItems: "center",
            gap: gap12,
            padding: `${nearPadY}px ${nearPadX}px`,
            background: "var(--bg-elevated)",
            border: `1px solid ${ink.contour}`,
            borderRadius: `${radius}px`,
            opacity: nearAlpha,
            pointerEvents: "auto",
            boxShadow: `0 ${nearShadowY}px ${nearShadowBlur}px rgba(10,14,20,0.08)`,
          }}
        >
          <span style={{ fontSize: emojiNear, lineHeight: 1 }}>{workspace.emoji}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: nearGap }}>
            <span
              className="font-display"
              style={{
                fontSize: nameNear,
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
                fontSize: metaSize * 0.9,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: ink.accent,
              }}
            >
              {coord} · {workspace.itemCount}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================================================================
   Group label — latitude-rule style.
   =================================================================== */

function GroupLabelNode({ data }: { data: GroupLabelNodeData }) {
  const signals = useZoomSignals();
  const labelSize = useScreenSize(STABLE.GROUP_LABEL);
  const countSize = useScreenSize(STABLE.GROUP_COUNT);
  const pad = useScreenSize(STABLE.PAD_MD);
  const ruleWidth = useScreenSize(80);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: useScreenSize(10),
        padding: `${useScreenSize(6)}px 0`,
        opacity: signals.groupReveal,
        pointerEvents: "none",
      }}
    >
      <span
        className="font-mono"
        style={{
          fontSize: labelSize,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: data.ink.ink,
          fontWeight: 600,
        }}
      >
        {data.label}
      </span>
      <span
        style={{
          height: 1,
          width: ruleWidth,
          background: `linear-gradient(to right, ${data.ink.accent}, transparent)`,
        }}
      />
      <span
        className="font-mono"
        style={{
          fontSize: countSize,
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
   Item node — screen-stable card. Density changes with zoom.
   =================================================================== */

function ItemNode({ data }: { data: ItemNodeData }) {
  const { item, ink } = data;
  const signals = useZoomSignals();
  const meta = CANONICAL_WORKSPACE_TYPE_META[item.itemType as CanonicalWorkspaceType];
  const Icon = meta?.icon;

  const focusedItemId = useWorkspaceStore((s) => s.focusedItemId);
  const isFocused = focusedItemId === item.id;

  // Chip → card → detail through signals
  const chipAlpha = 1 - signals.cardDetail;
  const cardAlpha = signals.cardDetail * (1 - signals.contentDepth);
  const detailAlpha = signals.contentDepth;

  // Interpolate height in screen px then convert to world
  const screenH = lerp(
    STABLE.ITEM_CHIP_HEIGHT,
    lerp(STABLE.ITEM_CARD_HEIGHT, STABLE.ITEM_DETAIL_HEIGHT, signals.contentDepth),
    signals.cardDetail,
  );
  const height = useScreenSize(screenH);

  const screenW = lerp(STABLE.ITEM_CHIP_WIDTH, STABLE.ITEM_DETAIL_WIDTH, signals.cardDetail);
  const width = useScreenSize(screenW);

  const pad = useScreenSize(STABLE.PAD_MD);
  const padSm = useScreenSize(STABLE.PAD_SM);
  const radius = useScreenSize(STABLE.RADIUS_MD);
  const border = useScreenSize(STABLE.BORDER);
  const iconSize = useScreenSize(STABLE.ICON_MD);
  const titleSize = useScreenSize(
    lerp(STABLE.ITEM_TITLE, STABLE.ITEM_TITLE_CARD, signals.cardDetail),
  );
  const metaSize = useScreenSize(STABLE.ITEM_META);
  const bodySize = useScreenSize(STABLE.ITEM_BODY);
  const gap = useScreenSize(10);
  
  // Precompute sizes for conditional render blocks
  const shadow12 = useScreenSize(12);
  const shadow26 = useScreenSize(26);
  const shadow14 = useScreenSize(14);
  const shadow4 = useScreenSize(4);
  const shadow10 = useScreenSize(10);
  const stripWidth = useScreenSize(3);
  const headerPadLeft = useScreenSize(18);
  const headerMinHeight = useScreenSize(STABLE.ITEM_CHIP_HEIGHT - 4);
  const iconBoxSize = useScreenSize(STABLE.ICON_MD + 8);
  const iconRadius = useScreenSize(6);
  const detailLeft = useScreenSize(6);
  const detailTop = useScreenSize(STABLE.ITEM_CHIP_HEIGHT);
  const footerPadTop = useScreenSize(4);
  const dotSize = useScreenSize(2);

  const typeColor = meta?.color ?? "var(--text-secondary)";

  return (
    <div
      style={{
        width,
        height,
        position: "relative",
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "var(--bg-elevated)",
          border: `${border}px solid ${isFocused ? ink.accent : "var(--border-default)"}`,
          borderRadius: `${radius}px`,
          boxShadow: isFocused
            ? `0 ${shadow12}px ${shadow26}px -${shadow14}px ${ink.contour}`
            : `0 ${shadow4}px ${shadow12}px -${shadow10}px rgba(10,14,20,0.10)`,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          transition: "border-color 160ms ease, box-shadow 200ms ease",
        }}
      >
        {/* Coloured type strip — left edge */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: stripWidth,
            background: typeColor,
            opacity: 0.75,
          }}
        />

        {/* Header row — title, icon, status */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap,
            padding: `${padSm}px ${pad}px`,
            paddingLeft: headerPadLeft,
            borderBottom:
              signals.cardDetail > 0.2
                ? `${border}px solid color-mix(in oklab, ${typeColor} 10%, var(--border-default))`
                : "none",
            minHeight: headerMinHeight,
            flexShrink: 0,
          }}
        >
          {Icon ? (
            <div
              style={{
                width: iconBoxSize,
                height: iconBoxSize,
                borderRadius: iconRadius,
                background: `color-mix(in oklab, ${typeColor} 12%, transparent)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon
                style={{ width: iconSize, height: iconSize, color: typeColor }}
              />
            </div>
          ) : null}
          <div
            className="font-body"
            style={{
              fontSize: titleSize,
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
          <StatusDot status={item.status} screenSize={6} />
        </div>

        {/* Card body — preview */}
        {item.preview && cardAlpha > 0.01 ? (
          <div
            style={{
              flex: 1,
              padding: `${padSm}px ${pad}px`,
              paddingLeft: headerPadLeft,
              opacity: cardAlpha,
              overflow: "hidden",
              minHeight: 0,
            }}
          >
            <div
              className="font-body"
              style={{
                fontSize: bodySize,
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
        ) : null}

        {/* Detail body — full preview / type-specific view */}
        {detailAlpha > 0.05 ? (
          <div
            style={{
              position: "absolute",
              left: detailLeft,
              right: 0,
              top: detailTop,
              bottom: 0,
              opacity: detailAlpha,
              pointerEvents: detailAlpha > 0.5 ? "auto" : "none",
              overflow: "hidden",
            }}
          >
            <DetailBody item={item} typeColor={typeColor} />
          </div>
        ) : null}

        {/* Footer meta — mono cartouche */}
        {signals.cardDetail > 0.15 && signals.contentDepth < 0.6 ? (
          <div
            style={{
              padding: `${footerPadTop}px ${pad}px ${padSm}px`,
              paddingLeft: headerPadLeft,
              display: "flex",
              alignItems: "center",
              gap,
              opacity: Math.min(signals.cardDetail * 2, 1 - signals.contentDepth),
              flexShrink: 0,
            }}
          >
            <span
              className="font-mono"
              style={{
                fontSize: metaSize,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
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
                    width: dotSize,
                    height: dotSize,
                    borderRadius: "50%",
                    background: "var(--text-tertiary)",
                  }}
                />
                <span
                  className="font-mono"
                  style={{
                    fontSize: metaSize,
                    color: "var(--text-tertiary)",
                    letterSpacing: "0.04em",
                  }}
                >
                  {item.meta}
                </span>
              </>
            ) : null}
          </div>
        ) : null}

        {/* Glance chip suppression border overlay when fully in chip */}
        {chipAlpha > 0.5 && signals.cardDetail < 0.1 ? null : null}
      </div>
    </div>
  );
}

/* ===================================================================
   Type-specific detail body — code / note / etc.
   =================================================================== */

function DetailBody({ item, typeColor }: { item: WorkspaceItemData; typeColor: string }) {
  const pad = useScreenSize(STABLE.PAD_MD);
  const bodySize = useScreenSize(STABLE.ITEM_BODY);

  if (!item.preview) {
    return (
      <div
        style={{
          padding: `${pad}px`,
          color: "var(--text-tertiary)",
          fontSize: bodySize,
          fontStyle: "italic",
        }}
      >
        Empty
      </div>
    );
  }

  if (item.itemType === "code") {
    return (
      <div
        style={{
          padding: `${pad}px`,
          background: "var(--bg-code)",
          height: "100%",
          overflow: "hidden",
          color: "var(--text-primary)",
        }}
      >
        <pre
          className="font-mono"
          style={{
            fontSize: bodySize,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
            lineHeight: 1.55,
          }}
        >
          {item.preview.slice(0, 600)}
        </pre>
      </div>
    );
  }

  if (item.itemType === "note" || item.itemType === "export") {
    return (
      <div
        style={{
          padding: `${pad}px`,
          height: "100%",
          overflow: "hidden",
          color: "var(--text-primary)",
          fontSize: bodySize,
          lineHeight: 1.65,
        }}
      >
        <MarkdownRenderer content={item.preview.slice(0, 800)} />
      </div>
    );
  }

  return (
    <div
      style={{
        padding: `${pad}px`,
        color: "var(--text-secondary)",
        fontSize: bodySize,
        lineHeight: 1.55,
      }}
    >
      {item.preview.slice(0, 400)}
    </div>
  );
}

/* ===================================================================
   Widget node (shell — actual widgets live in widget-host.tsx)
   =================================================================== */

function WidgetNode({ data }: { data: WidgetNodeData }) {
  return <WidgetHost widget={data.widget} />;
}

/* ===================================================================
   Layout engine.

   Territory size is computed from item count. Groups lay out into
   rows of items sized exactly to match the STABLE card width at
   SUMMARY zoom (so at summary, items pack evenly; at detail, they
   have breathing room since cards grow).
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
  // Prefer backend clusters if present
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

  // Heuristic keyword grouping
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
    // Column accumulators
    const colY: number[] = new Array(totalColumns).fill(LAYOUT.HEADER_Y);

    groups.forEach((group, gi) => {
      // Assign group to the shortest column for a balanced layout
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

      const iy = gy + 120;
      group.items.forEach((item, ii) => {
        const ix = gx + (ii % LAYOUT.ITEMS_PER_ROW) * 440;
        const baseY = iy + Math.floor(ii / LAYOUT.ITEMS_PER_ROW) * LAYOUT.WORLD_ROW_GAP;
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

      const rowsUsed = Math.ceil(group.items.length / LAYOUT.ITEMS_PER_ROW);
      colY[shortest] =
        iy + rowsUsed * LAYOUT.WORLD_ROW_GAP + LAYOUT.GROUP_GAP;
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
          panOnScroll={true}
          panOnScrollMode={"free" as unknown as undefined}
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
