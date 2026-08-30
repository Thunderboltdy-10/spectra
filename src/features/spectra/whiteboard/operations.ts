import {
  createWhiteboardNode,
  type WhiteboardConnectorAnchor,
  type WhiteboardContent,
  type WhiteboardEdge,
  type WhiteboardNode,
  type WhiteboardShapeKind,
} from "./model";

export type WhiteboardAlignment =
  "left" | "center" | "right" | "top" | "middle" | "bottom";
export type WhiteboardDistribution = "horizontal" | "vertical";
export type WhiteboardTemplate = "concept" | "study" | "retro" | "brainwriting";

function copy(content: WhiteboardContent) {
  return structuredClone(content);
}

function editableNodes(
  content: WhiteboardContent,
  nodeIds: ReadonlySet<string>,
) {
  const lockedLayers = new Set(
    content.layers.filter((layer) => layer.locked).map((layer) => layer.id),
  );
  return content.nodes.filter(
    (node) =>
      nodeIds.has(node.id) && !node.locked && !lockedLayers.has(node.layerId),
  );
}

function lockedLayerIds(content: WhiteboardContent) {
  return new Set(
    content.layers.filter((layer) => layer.locked).map((layer) => layer.id),
  );
}

export function arrangeWhiteboardNodes(
  content: WhiteboardContent,
  nodeIds: Iterable<string>,
  operation: WhiteboardAlignment | WhiteboardDistribution,
) {
  const ids = new Set(nodeIds);
  const selected = editableNodes(content, ids);
  const minimum =
    operation === "horizontal" || operation === "vertical" ? 3 : 2;
  if (selected.length < minimum) return content;
  const next = copy(content);
  const byId = new Map(next.nodes.map((node) => [node.id, node]));

  if (operation === "horizontal" || operation === "vertical") {
    const horizontal = operation === "horizontal";
    const ordered = selected
      .slice()
      .sort((left, right) =>
        horizontal ? left.x - right.x : left.y - right.y,
      );
    const first = ordered[0]!;
    const last = ordered.at(-1)!;
    const totalSize = ordered.reduce(
      (total, node) => total + (horizontal ? node.width : node.height),
      0,
    );
    const start = horizontal ? first.x : first.y;
    const end = horizontal ? last.x + last.width : last.y + last.height;
    const gap = (end - start - totalSize) / (ordered.length - 1);
    let cursor = start;
    for (const source of ordered) {
      const node = byId.get(source.id)!;
      if (horizontal) node.x = cursor;
      else node.y = cursor;
      cursor += (horizontal ? source.width : source.height) + gap;
    }
    return next;
  }

  const left = Math.min(...selected.map((node) => node.x));
  const right = Math.max(...selected.map((node) => node.x + node.width));
  const top = Math.min(...selected.map((node) => node.y));
  const bottom = Math.max(...selected.map((node) => node.y + node.height));
  for (const source of selected) {
    const node = byId.get(source.id)!;
    if (operation === "left") node.x = left;
    if (operation === "center") node.x = (left + right - node.width) / 2;
    if (operation === "right") node.x = right - node.width;
    if (operation === "top") node.y = top;
    if (operation === "middle") node.y = (top + bottom - node.height) / 2;
    if (operation === "bottom") node.y = bottom - node.height;
  }
  return next;
}

export function setWhiteboardNodeLock(
  content: WhiteboardContent,
  nodeIds: Iterable<string>,
  locked: boolean,
) {
  const ids = new Set(nodeIds);
  const lockedLayers = lockedLayerIds(content);
  const eligible = content.nodes.filter(
    (node) => ids.has(node.id) && !lockedLayers.has(node.layerId),
  );
  if (!eligible.length) return content;
  const next = copy(content);
  for (const node of next.nodes)
    if (ids.has(node.id) && !lockedLayers.has(node.layerId))
      node.locked = locked;
  return next;
}

export function reorderWhiteboardNodes(
  content: WhiteboardContent,
  nodeIds: Iterable<string>,
  edge: "front" | "back",
) {
  const ids = new Set(nodeIds);
  const selected = editableNodes(content, ids);
  if (!selected.length) return content;
  const next = copy(content);
  const ordered = next.nodes
    .slice()
    .sort((left, right) => left.zIndex - right.zIndex);
  const selectedIds = new Set(selected.map((node) => node.id));
  const rest = ordered.filter((node) => !selectedIds.has(node.id));
  const moving = ordered.filter((node) => selectedIds.has(node.id));
  const nextOrder =
    edge === "front" ? [...rest, ...moving] : [...moving, ...rest];
  nextOrder.forEach((node, index) => {
    const target = next.nodes.find((candidate) => candidate.id === node.id)!;
    target.zIndex = index;
  });
  next.zOrder = nextOrder.map((node) => node.id);
  return next;
}

export function groupWhiteboardNodes(
  content: WhiteboardContent,
  nodeIds: Iterable<string>,
  groupId: string,
) {
  const ids = new Set(nodeIds);
  const candidates = editableNodes(content, ids).filter(
    (node) => node.type !== "group",
  );
  if (candidates.length < 2) return content;
  const layerId = candidates[0]!.layerId;
  if (candidates.some((node) => node.layerId !== layerId)) return content;
  const x = Math.min(...candidates.map((node) => node.x)) - 12;
  const y = Math.min(...candidates.map((node) => node.y)) - 12;
  const right = Math.max(...candidates.map((node) => node.x + node.width));
  const bottom = Math.max(...candidates.map((node) => node.y + node.height));
  const next = copy(content);
  next.nodes.push({
    id: groupId,
    type: "group",
    pageId: candidates[0]!.pageId,
    layerId,
    x,
    y,
    width: right - x + 12,
    height: bottom - y + 12,
    rotation: 0,
    zIndex: Math.min(...candidates.map((node) => node.zIndex)) - 1,
    content: { label: "Object group" },
    semanticLabel: "Grouped whiteboard objects",
    accessibilityOrder: Math.min(
      ...candidates.map((node) => node.accessibilityOrder ?? 0),
    ),
  });
  const selectedIds = new Set(candidates.map((node) => node.id));
  for (const node of next.nodes)
    if (selectedIds.has(node.id)) node.parentId = groupId;
  next.zOrder = [groupId, ...next.zOrder.filter((id) => id !== groupId)];
  return next;
}

export function ungroupWhiteboardNodes(
  content: WhiteboardContent,
  groupIds: Iterable<string>,
) {
  const requested = new Set(groupIds);
  const ids = new Set(
    editableNodes(content, requested)
      .filter((node) => node.type === "group")
      .map((node) => node.id),
  );
  if (!ids.size) return content;
  const next = copy(content);
  next.nodes = next.nodes.filter((node) => !ids.has(node.id));
  for (const node of next.nodes)
    if (node.parentId && ids.has(node.parentId)) node.parentId = undefined;
  next.zOrder = next.zOrder.filter((id) => !ids.has(id));
  return next;
}

export function adjustWhiteboardVote(
  content: WhiteboardContent,
  nodeId: string,
  adjustment: number,
) {
  const next = copy(content);
  const node = next.nodes.find((candidate) => candidate.id === nodeId);
  if (
    !node ||
    node.locked ||
    lockedLayerIds(content).has(node.layerId) ||
    (node.type !== "note" && node.type !== "card")
  )
    return content;
  node.voteCount = Math.max(
    0,
    Math.min(100_000, Math.round((node.voteCount ?? 0) + adjustment)),
  );
  return next;
}

export function setWhiteboardShapeKind(
  content: WhiteboardContent,
  nodeId: string,
  shapeKind: WhiteboardShapeKind,
) {
  const next = copy(content);
  const node = next.nodes.find((candidate) => candidate.id === nodeId);
  if (
    !node ||
    node.type !== "shape" ||
    node.locked ||
    lockedLayerIds(content).has(node.layerId)
  )
    return content;
  node.shapeKind = shapeKind;
  node.content = {
    ...(node.content &&
    typeof node.content === "object" &&
    !Array.isArray(node.content)
      ? node.content
      : {}),
    shape: shapeKind,
  };
  return next;
}

function center(node: WhiteboardNode) {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function anchorPoint(
  node: WhiteboardNode,
  anchor: WhiteboardConnectorAnchor | undefined,
  toward: WhiteboardNode,
) {
  const middle = center(node);
  const target = center(toward);
  const resolved =
    !anchor || anchor === "auto"
      ? Math.abs(target.x - middle.x) >= Math.abs(target.y - middle.y)
        ? target.x >= middle.x
          ? "right"
          : "left"
        : target.y >= middle.y
          ? "bottom"
          : "top"
      : anchor;
  if (resolved === "left") return { x: node.x, y: middle.y };
  if (resolved === "right") return { x: node.x + node.width, y: middle.y };
  if (resolved === "top") return { x: middle.x, y: node.y };
  if (resolved === "bottom") return { x: middle.x, y: node.y + node.height };
  return middle;
}

export type WhiteboardConnectorGeometry = {
  path: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  label: { x: number; y: number };
};

export function whiteboardConnectorGeometry(
  edge: WhiteboardEdge,
  from: WhiteboardNode,
  to: WhiteboardNode,
): WhiteboardConnectorGeometry {
  const start = anchorPoint(from, edge.fromAnchor, to);
  const end = anchorPoint(to, edge.toAnchor, from);
  const label = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  if (edge.route === "curve") {
    const bend = Math.max(40, Math.min(180, Math.abs(end.x - start.x) / 2));
    const direction = end.x >= start.x ? 1 : -1;
    return {
      start,
      end,
      label,
      path: `M ${start.x} ${start.y} C ${start.x + bend * direction} ${start.y}, ${end.x - bend * direction} ${end.y}, ${end.x} ${end.y}`,
    };
  }
  if (edge.route === "elbow") {
    if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
      const middleX = (start.x + end.x) / 2;
      return {
        start,
        end,
        label: { x: middleX, y: (start.y + end.y) / 2 },
        path: `M ${start.x} ${start.y} L ${middleX} ${start.y} L ${middleX} ${end.y} L ${end.x} ${end.y}`,
      };
    }
    const middleY = (start.y + end.y) / 2;
    return {
      start,
      end,
      label: { x: (start.x + end.x) / 2, y: middleY },
      path: `M ${start.x} ${start.y} L ${start.x} ${middleY} L ${end.x} ${middleY} L ${end.x} ${end.y}`,
    };
  }
  return {
    start,
    end,
    label,
    path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
  };
}

export function shouldVirtualizeWhiteboard(
  nodeCount: number,
  virtualizeAfter = 300,
) {
  return nodeCount >= Math.max(50, Math.round(virtualizeAfter));
}

export function whiteboardFrameNodeIds(
  content: WhiteboardContent,
  frameId: string,
) {
  const result = new Set([frameId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of content.nodes) {
      if (
        !result.has(node.id) &&
        ((node.frameId && result.has(node.frameId)) ||
          (node.parentId && result.has(node.parentId)))
      ) {
        result.add(node.id);
        changed = true;
      }
    }
  }
  return result;
}

type TemplateSpec = readonly [
  WhiteboardNode["type"],
  string,
  number,
  number,
  string,
  number,
  number,
];

const TEMPLATE_SPECS: Record<WhiteboardTemplate, readonly TemplateSpec[]> = {
  concept: [
    ["shape", "Central idea", 400, 210, "#f0ecff", 240, 124],
    ["card", "Evidence", 0, 0, "#ecf7f1", 260, 132],
    ["note", "Key fact", 320, 12, "#fff1c7", 220, 104],
    ["card", "Implications", 680, 0, "#fff3dc", 280, 132],
    ["card", "Examples", 0, 230, "#fbecef", 260, 144],
    ["note", "Remember", 710, 230, "#eaf1ff", 250, 144],
    ["card", "Process", 70, 430, "#eef6ff", 250, 112],
    ["note", "Questions", 365, 430, "#fff1c7", 240, 112],
    ["card", "Connections", 650, 430, "#ecf7f1", 270, 112],
  ],
  study: [
    ["text", "Study map", 220, 0, "transparent", 320, 80],
    ["card", "What I know", 0, 150, "#ecf7f1", 250, 180],
    ["card", "What to review", 280, 150, "#fff3dc", 250, 180],
    ["card", "Questions", 560, 150, "#f0ecff", 250, 180],
  ],
  retro: [
    ["note", "Went well", 0, 100, "#e6f6eb", 250, 180],
    ["note", "Learned", 280, 100, "#fff1c7", 250, 180],
    ["note", "Try next", 560, 100, "#eee9ff", 250, 180],
  ],
  brainwriting: [
    ["section", "Brainwriting", 0, 0, "#f7f8f5", 900, 430],
    ["note", "Idea 1", 45, 90, "#fff1c7", 240, 140],
    ["note", "Idea 2", 330, 90, "#eaf1ff", 240, 140],
    ["note", "Idea 3", 615, 90, "#e6f6eb", 240, 140],
  ],
};

export function applyWhiteboardTemplate(
  content: WhiteboardContent,
  input: {
    template: WhiteboardTemplate;
    pageId: string;
    layerId: string;
    x: number;
    y: number;
    snap: (value: number) => number;
    id: (kind: "node" | "edge") => string;
  },
) {
  const next = copy(content);
  const created = TEMPLATE_SPECS[input.template].map(
    ([type, label, x, y, fill, width, height], index) => {
      const node = createWhiteboardNode(
        type,
        input.pageId,
        input.layerId,
        input.snap(input.x + x),
        input.snap(input.y + y),
        next.nodes.length + index + 1,
      );
      node.id = input.id("node");
      node.content =
        type === "section" ? { title: label } : { text: label, title: label };
      node.semanticLabel = label;
      node.width = width;
      node.height = height;
      node.style = { ...node.style, fill };
      next.nodes.push(node);
      next.zOrder.push(node.id);
      return node;
    },
  );
  if (input.template === "concept") {
    for (const node of created.slice(1))
      next.edges.push({
        id: input.id("edge"),
        pageId: input.pageId,
        layerId: input.layerId,
        from: created[0]!.id,
        to: node.id,
        route: "curve",
        endCap: "arrow",
      });
  }
  if (input.template === "brainwriting") {
    const section = created[0]!;
    for (const node of created.slice(1)) node.parentId = section.id;
  }
  return next;
}
