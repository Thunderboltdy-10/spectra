export type WhiteboardNodeType =
  | "text"
  | "note"
  | "shape"
  | "image"
  | "embed"
  | "frame"
  | "group"
  | "table"
  | "card"
  | "drawing";

export type WhiteboardNode = {
  id: string;
  type: WhiteboardNodeType;
  pageId: string;
  layerId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  content: unknown;
  style?: Record<string, unknown>;
  parentId?: string;
  frameId?: string;
  semanticLabel?: string;
  accessibilityOrder?: number;
  provenance?: { source?: string; sourceId?: string; createdAt?: number };
  locked?: boolean;
  hidden?: boolean;
  constraints?: {
    horizontal?: "free" | "left" | "center" | "right";
    vertical?: "free" | "top" | "center" | "bottom";
  };
};

export type WhiteboardEdge = {
  id: string;
  pageId: string;
  layerId: string;
  from: string;
  to: string;
  fromAnchor?: string;
  toAnchor?: string;
  label?: string;
  style?: Record<string, unknown>;
  locked?: boolean;
  zIndex?: number;
};

export type WhiteboardContent = {
  viewport: { x: number; y: number; zoom: number; pageId: string };
  pages: Array<{ id: string; name: string; background?: string }>;
  nodes: WhiteboardNode[];
  edges: WhiteboardEdge[];
  layers: Array<{
    id: string;
    pageId: string;
    name: string;
    visible: boolean;
    locked: boolean;
  }>;
  /**
   * Shared stacking order for collaborative boards. Always rebuilt during
   * normalize so React emits and Yjs projections stay byte-comparable; omitting
   * it made every sticky edit look like a remote conflict on /content/zOrder.
   */
  zOrder: string[];
  sources?: Array<{
    id: string;
    label: string;
    url?: string;
    artifactId?: string;
  }>;
  settings?: {
    gridSize?: number;
    snapToGrid?: boolean;
    showGrid?: boolean;
    canvasColor?: string;
  };
};

const nodeTypes = new Set<WhiteboardNodeType>([
  "text",
  "note",
  "shape",
  "image",
  "embed",
  "frame",
  "group",
  "table",
  "card",
  "drawing",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
function number(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function bounded(value: unknown, fallback: number, min: number, max: number) {
  return Math.max(min, Math.min(max, number(value, fallback)));
}
function unique(candidate: string, fallback: string, used: Set<string>) {
  const base = (candidate.trim() || fallback).slice(0, 180);
  let result = base;
  let suffix = 2;
  while (used.has(result)) result = `${base.slice(0, 174)}-${suffix++}`;
  used.add(result);
  return result;
}

export function whiteboardNodeText(node: WhiteboardNode) {
  if (typeof node.content === "string") return node.content;
  const content = record(node.content);
  return text(
    content.text,
    text(
      content.title,
      text(
        content.label,
        [content.header, content.body]
          .filter((value): value is string => typeof value === "string")
          .join("\n\n"),
      ),
    ),
  );
}

export function withWhiteboardNodeText(node: WhiteboardNode, value: string) {
  return {
    ...node,
    content:
      typeof node.content === "string"
        ? value
        : { ...record(node.content), text: value },
  };
}

export function createWhiteboardNode(
  type: WhiteboardNodeType,
  pageId: string,
  layerId: string,
  x: number,
  y: number,
  ordinal = 1,
): WhiteboardNode {
  const id = `node-${Date.now().toString(36)}-${ordinal.toString(36)}`;
  const base = {
    id,
    type,
    pageId,
    layerId,
    x,
    y,
    width: type === "frame" ? 720 : type === "text" ? 280 : type === "embed" ? 400 : 240,
    height: type === "frame" ? 460 : type === "text" ? 90 : type === "embed" ? 300 : 150,
    rotation: 0,
    zIndex: ordinal,
    accessibilityOrder: ordinal,
  };
  if (type === "note")
    return {
      ...base,
      content: { text: "Add a thought" },
      style: { fill: "color-mix(in oklab, var(--accent-gold) 28%, var(--bg-elevated))", stroke: "var(--accent-gold)", color: "var(--text-primary)" },
      semanticLabel: "Sticky note",
    };
  if (type === "text")
    return {
      ...base,
      content: { text: "Add text" },
      style: { color: "var(--text-primary)", fontSize: 30, fontWeight: 650 },
      semanticLabel: "Text",
    };
  if (type === "shape")
    return {
      ...base,
      content: { text: "Concept", shape: "rounded-rectangle" },
      style: {
        fill: "var(--bg-user-bubble)",
        stroke: "var(--brand-primary)",
        color: "var(--brand-primary)",
        radius: 14,
      },
      semanticLabel: "Concept",
    };
  if (type === "frame")
    return {
      ...base,
      content: { title: "New frame" },
      style: { fill: "var(--bg-elevated)", stroke: "var(--border-strong)" },
      semanticLabel: "Frame",
    };
  if (type === "card")
    return {
      ...base,
      content: { title: "Card", text: "Add supporting detail" },
      style: { fill: "var(--bg-elevated)", stroke: "var(--border-default)" },
      semanticLabel: "Card",
    };
  if (type === "table")
    return {
      ...base,
      content: {
        rows: [
          ["Topic", "Detail"],
          ["Example", "Value"],
        ],
      },
      style: { fill: "var(--bg-elevated)", stroke: "var(--border-default)" },
      semanticLabel: "Table",
    };
  return { ...base, content: {}, semanticLabel: type };
}

export function normalizeWhiteboardContent(value: unknown): WhiteboardContent {
  const input = record(value);
  const usedPages = new Set<string>();
  const pages = (
    Array.isArray(input.pages)
      ? input.pages
      : [{ id: "page-1", name: "Canvas" }]
  ).flatMap((candidate, index) => {
    const row = record(candidate);
    const id = unique(text(row.id), `page-${index + 1}`, usedPages);
    return [
      {
        id,
        name: text(row.name, `Page ${index + 1}`).slice(0, 120),
        ...(typeof row.background === "string"
          ? { background: row.background.slice(0, 100) }
          : {}),
      },
    ];
  });
  if (!pages.length) pages.push({ id: "page-1", name: "Canvas" });
  const pageIds = new Set(pages.map((page) => page.id));
  const defaultPageId = pages[0]!.id;
  const usedLayers = new Set<string>();
  const layers = (Array.isArray(input.layers) ? input.layers : []).flatMap(
    (candidate, index) => {
      const row = record(candidate);
      const pageId = pageIds.has(text(row.pageId))
        ? text(row.pageId)
        : defaultPageId;
      return [
        {
          id: unique(text(row.id), `layer-${index + 1}`, usedLayers),
          pageId,
          name: text(row.name, `Layer ${index + 1}`).slice(0, 100),
          visible: row.visible !== false,
          locked: row.locked === true,
        },
      ];
    },
  );
  if (!layers.length)
    layers.push({
      id: "layer-1",
      pageId: defaultPageId,
      name: "Canvas",
      visible: true,
      locked: false,
    });
  for (const page of pages)
    if (!layers.some((layer) => layer.pageId === page.id))
      layers.push({
        id: `layer-${page.id}`,
        pageId: page.id,
        name: "Canvas",
        visible: true,
        locked: false,
      });
  const layerIds = new Set(layers.map((layer) => layer.id));
  const usedNodes = new Set<string>();
  const nodes = (Array.isArray(input.nodes) ? input.nodes : []).flatMap(
    (candidate, index) => {
      const row = record(candidate);
      const pageId = pageIds.has(text(row.pageId))
        ? text(row.pageId)
        : defaultPageId;
      const layerId = layerIds.has(text(row.layerId))
        ? text(row.layerId)
        : layers.find((layer) => layer.pageId === pageId)!.id;
      const type = nodeTypes.has(row.type as WhiteboardNodeType)
        ? (row.type as WhiteboardNodeType)
        : "note";
      return [
        {
          id: unique(text(row.id), `node-${index + 1}`, usedNodes),
          type,
          pageId,
          layerId,
          x: bounded(row.x, index * 32, -1_000_000, 1_000_000),
          y: bounded(row.y, index * 28, -1_000_000, 1_000_000),
          width: bounded(row.width, 240, 20, 100_000),
          height: bounded(row.height, 150, 20, 100_000),
          rotation: bounded(row.rotation, 0, -360, 360),
          zIndex: Math.round(bounded(row.zIndex, index, -100_000, 100_000)),
          content: row.content ?? {},
          ...(row.style && typeof row.style === "object"
            ? { style: record(row.style) }
            : {}),
          ...(typeof row.parentId === "string" && row.parentId.trim()
            ? { parentId: row.parentId.trim().slice(0, 180) }
            : {}),
          ...(typeof row.frameId === "string" && row.frameId.trim()
            ? { frameId: row.frameId.trim().slice(0, 180) }
            : {}),
          ...(typeof row.semanticLabel === "string"
            ? { semanticLabel: row.semanticLabel.slice(0, 500) }
            : {}),
          accessibilityOrder: Math.max(
            0,
            Math.round(number(row.accessibilityOrder, index)),
          ),
          ...(row.provenance && typeof row.provenance === "object"
            ? {
                provenance: record(
                  row.provenance,
                ) as WhiteboardNode["provenance"],
              }
            : {}),
          ...(typeof row.locked === "boolean" ? { locked: row.locked } : {}),
          ...(typeof row.hidden === "boolean" ? { hidden: row.hidden } : {}),
          ...(row.constraints && typeof row.constraints === "object"
            ? {
                constraints: record(
                  row.constraints,
                ) as WhiteboardNode["constraints"],
              }
            : {}),
        } satisfies WhiteboardNode,
      ];
    },
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  nodes.forEach((node) => {
    if (node.parentId && !nodeIds.has(node.parentId)) delete node.parentId;
    if (node.frameId && !nodeIds.has(node.frameId)) delete node.frameId;
  });
  const usedEdges = new Set<string>();
  const edges = (Array.isArray(input.edges) ? input.edges : []).flatMap(
    (candidate, index) => {
      const row = record(candidate);
      const from = text(row.from);
      const to = text(row.to);
      if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) return [];
      const fromNode = nodes.find((node) => node.id === from)!;
      const pageId = fromNode.pageId;
      if (nodes.find((node) => node.id === to)?.pageId !== pageId) return [];
      return [
        {
          id: unique(text(row.id), `edge-${index + 1}`, usedEdges),
          pageId,
          layerId: layerIds.has(text(row.layerId))
            ? text(row.layerId)
            : fromNode.layerId,
          from,
          to,
          ...(typeof row.fromAnchor === "string"
            ? { fromAnchor: row.fromAnchor.slice(0, 100) }
            : {}),
          ...(typeof row.toAnchor === "string"
            ? { toAnchor: row.toAnchor.slice(0, 100) }
            : {}),
          ...(typeof row.label === "string"
            ? { label: row.label.slice(0, 500) }
            : {}),
          ...(row.style && typeof row.style === "object"
            ? { style: record(row.style) }
            : {}),
          ...(typeof row.locked === "boolean" ? { locked: row.locked } : {}),
          zIndex: Math.round(number(row.zIndex, index)),
        } satisfies WhiteboardEdge,
      ];
    },
  );
  const viewport = record(input.viewport);
  const settings = record(input.settings);
  const viewportPage = pageIds.has(text(viewport.pageId))
    ? text(viewport.pageId)
    : defaultPageId;
  const requestedZOrder = Array.isArray(input.zOrder)
    ? input.zOrder.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
  const zOrder = [
    ...requestedZOrder.filter((id) => nodeIds.has(id)),
    ...nodes
      .slice()
      .sort((left, right) => left.zIndex - right.zIndex)
      .map((node) => node.id)
      .filter((id) => !requestedZOrder.includes(id)),
  ];
  return {
    viewport: {
      x: bounded(viewport.x, 0, -1_000_000, 1_000_000),
      y: bounded(viewport.y, 0, -1_000_000, 1_000_000),
      zoom: bounded(viewport.zoom, 1, 0.05, 8),
      pageId: viewportPage,
    },
    pages,
    nodes,
    edges,
    layers,
    zOrder,
    ...(Array.isArray(input.sources)
      ? {
          sources: input.sources.flatMap((candidate, index) => {
            const row = record(candidate);
            return typeof row.label === "string"
              ? [
                  {
                    id: text(row.id, `source-${index + 1}`),
                    label: row.label.slice(0, 500),
                    ...(typeof row.url === "string"
                      ? { url: row.url.slice(0, 2_000) }
                      : {}),
                    ...(typeof row.artifactId === "string"
                      ? { artifactId: row.artifactId }
                      : {}),
                  },
                ]
              : [];
          }),
        }
      : {}),
    settings: {
      gridSize: bounded(settings.gridSize, 24, 4, 200),
      snapToGrid: settings.snapToGrid !== false,
      showGrid: settings.showGrid !== false,
      canvasColor: text(settings.canvasColor, "#fbfbf8").slice(0, 100),
    },
  };
}
