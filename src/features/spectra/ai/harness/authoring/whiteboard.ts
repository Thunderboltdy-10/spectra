import {
  normalizeWhiteboardContent,
  whiteboardNodeText,
  type WhiteboardContent,
  type WhiteboardEdge,
  type WhiteboardNode,
} from "../../../whiteboard/model";
import { notFoundMessage } from "./locate";
import { AuthoringError, type IdFactory, defaultIdFactory, isPlaceholder, record, truncate } from "./shared";

/*
 * Whiteboards are authored as nodes and edges. The model names each node with
 * a short key and connects keys; Spectra places them with an automatic layout
 * so a diagram never arrives as a pile of overlapping stickies.
 */

export const WHITEBOARD_LAYOUTS = ["flow-down", "flow-right", "cycle", "mind-map", "grid"] as const;
export type WhiteboardLayout = (typeof WHITEBOARD_LAYOUTS)[number];
export const WHITEBOARD_COLORS = ["mint", "gold", "violet", "cyan", "coral", "orange", "plain"] as const;
export type WhiteboardColor = (typeof WHITEBOARD_COLORS)[number];

export type NodeSpec = {
  /** A short unique key, used by edges and later edits. */
  key?: string;
  text: string;
  /** Cards also take a title above their text. */
  title?: string;
  type?: "shape" | "note" | "card" | "text";
  color?: WhiteboardColor;
};
export type EdgeSpec = { from: string; to: string; label?: string };

export type WhiteboardSpec = { nodes: NodeSpec[]; edges?: EdgeSpec[]; layout?: WhiteboardLayout };

export type WhiteboardEditOp =
  | { op: "add_nodes"; nodes: NodeSpec[]; edges?: EdgeSpec[] }
  | { op: "update_node"; node: string; text?: string; title?: string; color?: WhiteboardColor; type?: NodeSpec["type"] }
  | { op: "delete_nodes"; nodes: string[] }
  | { op: "connect"; from: string; to: string; label?: string }
  | { op: "disconnect"; from: string; to: string }
  | { op: "relayout"; layout?: WhiteboardLayout }
  | { op: "replace"; find: string; replace: string; all?: boolean };

const NODE_TYPES = new Set(["shape", "note", "card", "text"]);

function colorStyle(color: WhiteboardColor | undefined, type: string): Record<string, unknown> {
  if (type === "text") return { color: "var(--text-primary)", fontSize: 28, fontWeight: 650 };
  const accent = color && color !== "plain" ? `var(--accent-${color})` : type === "note" ? "var(--accent-gold)" : "var(--brand-primary)";
  if (color === "plain") return { fill: "var(--bg-elevated)", stroke: "var(--border-default)", color: "var(--text-primary)" };
  return {
    fill: `color-mix(in oklab, ${accent} ${type === "note" ? 28 : 16}%, var(--bg-elevated))`,
    stroke: accent,
    color: "var(--text-primary)",
    ...(type === "shape" ? { radius: 14 } : {}),
  };
}

function nodeSize(type: string, label: string, title?: string) {
  const width = type === "card" ? 260 : type === "text" ? 320 : 220;
  const perLine = Math.max(12, Math.floor((width - 32) / (type === "text" ? 15 : 8.5)));
  const lines = label
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
  const lineHeight = type === "text" ? 36 : 20;
  const height = Math.max(type === "text" ? 64 : 96, 40 + lines * lineHeight + (title ? 28 : 0));
  return { width, height: Math.min(420, height) };
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function buildNode(
  spec: NodeSpec,
  board: WhiteboardContent,
  used: Set<string>,
  ids: IdFactory,
  label: string,
): WhiteboardNode {
  const nodeText = typeof spec?.text === "string" ? spec.text.trim() : "";
  const type = spec.type ?? "shape";
  if (!NODE_TYPES.has(type)) throw new AuthoringError(`${label}: node type must be shape, note, card or text.`);
  if (!nodeText && !spec.title?.trim()) throw new AuthoringError(`${label}: node "${spec.key ?? "?"}" has no text.`);
  if (spec.color !== undefined && !(WHITEBOARD_COLORS as readonly string[]).includes(spec.color))
    throw new AuthoringError(`${label}: color must be one of ${WHITEBOARD_COLORS.join(", ")}.`);
  let id = spec.key ? slug(spec.key) : "";
  if (!id || used.has(id)) {
    if (spec.key && used.has(slug(spec.key)))
      throw new AuthoringError(`${label}: the key "${spec.key}" is already used. Keys must be unique.`);
    do id = ids("node");
    while (used.has(id));
  }
  used.add(id);
  const page = board.pages[0]!.id;
  const layer = board.layers.find((entry) => entry.pageId === page)?.id ?? "layer-1";
  const size = nodeSize(type, nodeText, spec.title);
  const content =
    type === "card"
      ? { title: spec.title?.trim() || nodeText, text: spec.title?.trim() ? nodeText : "" }
      : type === "shape"
        ? { text: nodeText, shape: "rounded-rectangle" }
        : { text: nodeText };
  return {
    id,
    type,
    pageId: page,
    layerId: layer,
    x: 0,
    y: 0,
    ...size,
    rotation: 0,
    zIndex: board.nodes.length + 1,
    accessibilityOrder: board.nodes.length + 1,
    content,
    style: colorStyle(spec.color, type),
    semanticLabel: truncate(spec.title?.trim() || nodeText, 120),
  };
}

function resolveNode(board: WhiteboardContent, ref: string, label: string, field = "node") {
  if (typeof ref !== "string" || !ref.trim()) throw new AuthoringError(`${label}: ${field} is empty.`);
  const byId = board.nodes.find((node) => node.id === ref || node.id === slug(ref));
  if (byId) return byId;
  const wanted = ref.trim().toLowerCase();
  const matches = board.nodes.filter((node) => whiteboardNodeText(node).trim().toLowerCase() === wanted);
  if (matches.length === 1) return matches[0]!;
  const loose = board.nodes.filter((node) => whiteboardNodeText(node).toLowerCase().includes(wanted));
  if (!matches.length && loose.length === 1) return loose[0]!;
  throw new AuthoringError(
    matches.length + loose.length
      ? `${label}: ${field} "${ref}" matches several nodes; use the node key.`
      : `${label}: ${field} "${ref}" matches no node. Use a key from the readback.`,
  );
}

function addEdge(board: WhiteboardContent, spec: EdgeSpec, ids: IdFactory, label: string) {
  const from = resolveNode(board, spec?.from, label, "from");
  const to = resolveNode(board, spec?.to, label, "to");
  if (from.id === to.id) throw new AuthoringError(`${label}: a node cannot connect to itself.`);
  if (board.edges.some((edge) => edge.from === from.id && edge.to === to.id)) return;
  let id = ids("edge");
  while (board.edges.some((edge) => edge.id === id)) id = ids("edge");
  const edge: WhiteboardEdge = {
    id,
    pageId: from.pageId,
    layerId: from.layerId,
    from: from.id,
    to: to.id,
    ...(spec.label?.trim() ? { label: spec.label.trim() } : {}),
    zIndex: board.edges.length,
  };
  board.edges.push(edge);
}

// ---------------------------------------------------------------- layout

function chooseLayout(board: WhiteboardContent): WhiteboardLayout {
  const nodes = board.nodes;
  if (!board.edges.length) return "grid";
  const inDegree = new Map(nodes.map((node) => [node.id, 0]));
  const outDegree = new Map(nodes.map((node) => [node.id, 0]));
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of board.edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    outDegree.set(edge.from, (outDegree.get(edge.from) ?? 0) + 1);
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const connected = nodes.filter((node) => (degree.get(node.id) ?? 0) > 0);
  if (connected.length >= 3 && connected.every((node) => inDegree.get(node.id)! >= 1 && outDegree.get(node.id)! >= 1))
    return "cycle";
  const hub = Math.max(...degree.values());
  if (nodes.length >= 5 && hub >= Math.ceil((nodes.length - 1) * 0.6)) return "mind-map";
  return nodes.length > 6 ? "flow-down" : "flow-right";
}

function layers(board: WhiteboardContent) {
  const ids = board.nodes.map((node) => node.id);
  const incoming = new Map(ids.map((id) => [id, [] as string[]]));
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of board.edges) {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  }
  const level = new Map<string, number>();
  const roots = ids.filter((id) => !incoming.get(id)!.length);
  const queue = (roots.length ? roots : ids.slice(0, 1)).map((id) => {
    level.set(id, 0);
    return id;
  });
  // Longest-path layering bounded by the node count, so cycles terminate.
  for (let index = 0; index < queue.length && index < ids.length * ids.length; index += 1) {
    const id = queue[index]!;
    for (const next of outgoing.get(id) ?? []) {
      const candidate = level.get(id)! + 1;
      if (candidate < ids.length && candidate > (level.get(next) ?? -1)) {
        level.set(next, candidate);
        queue.push(next);
      }
    }
  }
  const maxLevel = Math.max(0, ...level.values());
  for (const id of ids) if (!level.has(id)) level.set(id, maxLevel + 1);
  const grouped: string[][] = [];
  for (const id of ids) (grouped[level.get(id)!] ??= []).push(id);
  return grouped.filter(Boolean);
}

/** Places every node on the board; geometry only, content untouched. */
export function layoutWhiteboard(board: WhiteboardContent, layout: WhiteboardLayout = chooseLayout(board)) {
  const byId = new Map(board.nodes.map((node) => [node.id, node]));
  const place = (id: string, cx: number, cy: number) => {
    const node = byId.get(id)!;
    node.x = Math.round(cx - node.width / 2);
    node.y = Math.round(cy - node.height / 2);
  };
  const ids = board.nodes.map((node) => node.id);
  if (layout === "grid") {
    const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(ids.length))));
    ids.forEach((id, index) => place(id, (index % columns) * 320 + 160, Math.floor(index / columns) * 220 + 110));
  } else if (layout === "cycle") {
    const radius = Math.max(220, (ids.length * 300) / (2 * Math.PI));
    ids.forEach((id, index) => {
      const angle = -Math.PI / 2 + (index / ids.length) * 2 * Math.PI;
      place(id, radius + 200 + Math.cos(angle) * radius, radius + 140 + Math.sin(angle) * radius * 0.8);
    });
  } else if (layout === "mind-map") {
    const degree = new Map(ids.map((id) => [id, 0]));
    for (const edge of board.edges) {
      degree.set(edge.from, degree.get(edge.from)! + 1);
      degree.set(edge.to, degree.get(edge.to)! + 1);
    }
    const hub = ids.reduce((best, id) => (degree.get(id)! > degree.get(best)! ? id : best), ids[0]!);
    const distance = new Map([[hub, 0]]);
    const queue = [hub];
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index]!;
      for (const edge of board.edges) {
        const next = edge.from === id ? edge.to : edge.to === id ? edge.from : null;
        if (next && !distance.has(next)) {
          distance.set(next, distance.get(id)! + 1);
          queue.push(next);
        }
      }
    }
    for (const id of ids) if (!distance.has(id)) distance.set(id, 1 + Math.max(...distance.values()));
    const rings = new Map<number, string[]>();
    for (const id of ids) rings.set(distance.get(id)!, [...(rings.get(distance.get(id)!) ?? []), id]);
    const centre = { x: 900, y: 600 };
    for (const [ring, members] of rings) {
      if (ring === 0) {
        place(members[0]!, centre.x, centre.y);
        continue;
      }
      const radius = 300 * ring + Math.max(0, members.length - 8) * 18;
      members.forEach((id, index) => {
        const angle = -Math.PI / 2 + ((index + (ring % 2 ? 0 : 0.5)) / members.length) * 2 * Math.PI;
        place(id, centre.x + Math.cos(angle) * radius * 1.25, centre.y + Math.sin(angle) * radius * 0.8);
      });
    }
  } else {
    const down = layout === "flow-down";
    const groups = layers(board);
    groups.forEach((group, depth) => {
      const breadth = group.length;
      group.forEach((id, index) => {
        const across = (index - (breadth - 1) / 2) * (down ? 300 : 190);
        const along = depth * (down ? 230 : 330);
        place(id, down ? 700 + across : 160 + along, down ? 110 + along : 500 + across);
      });
    });
  }
  // Normalise to a small positive margin and frame the viewport on the result.
  if (board.nodes.length) {
    const minX = Math.min(...board.nodes.map((node) => node.x));
    const minY = Math.min(...board.nodes.map((node) => node.y));
    for (const node of board.nodes) {
      node.x += 80 - minX;
      node.y += 80 - minY;
    }
    const width = Math.max(...board.nodes.map((node) => node.x + node.width)) + 80;
    const height = Math.max(...board.nodes.map((node) => node.y + node.height)) + 80;
    board.viewport = {
      ...board.viewport,
      x: 0,
      y: 0,
      zoom: Math.max(0.35, Math.min(1, 1_400 / width, 900 / height)),
    };
  }
  return board;
}

// ---------------------------------------------------------------- edits

function setNodeText(node: WhiteboardNode, value: string, title?: string) {
  const content = record(node.content);
  if (node.type === "card") {
    node.content = { ...content, ...(title !== undefined ? { title } : {}), ...(value !== undefined ? { text: value } : {}) };
  } else node.content = { ...content, text: value };
  const size = nodeSize(node.type, whiteboardNodeText(node), node.type === "card" ? String(record(node.content).title ?? "") : undefined);
  node.height = Math.max(node.height, size.height);
}

/** Applies node and edge operations to a copy of the board. Throws naming the failing op. */
export function applyWhiteboardEdits(content: unknown, ops: WhiteboardEditOp[], ids: IdFactory = defaultIdFactory()) {
  const board = normalizeWhiteboardContent(structuredClone(content ?? {}));
  if (!Array.isArray(ops) || !ops.length) throw new AuthoringError("No operations were given.");
  const used = new Set(board.nodes.map((node) => node.id));
  const added = new Set<string>();
  let relayout: WhiteboardLayout | "auto" | null = board.nodes.length ? null : "auto";
  ops.forEach((op, index) => {
    const label = `Edit ${index + 1} (${String(op?.op)})`;
    switch (op?.op) {
      case "add_nodes": {
        if (!Array.isArray(op.nodes) || !op.nodes.length) throw new AuthoringError(`${label}: nodes is empty.`);
        op.nodes.forEach((spec, position) => {
          const node = buildNode(spec, board, used, ids, `${label} nodes[${position}]`);
          board.nodes.push(node);
          added.add(node.id);
        });
        (op.edges ?? []).forEach((edge, position) => addEdge(board, edge, ids, `${label} edges[${position}]`));
        relayout ??= "auto";
        break;
      }
      case "update_node": {
        const node = resolveNode(board, op.node, label);
        if (op.type !== undefined) {
          if (!NODE_TYPES.has(op.type)) throw new AuthoringError(`${label}: type must be shape, note, card or text.`);
          const value = whiteboardNodeText(node);
          node.type = op.type;
          node.content = op.type === "card" ? { title: value, text: "" } : op.type === "shape" ? { text: value, shape: "rounded-rectangle" } : { text: value };
          node.style = colorStyle(op.color, op.type);
        }
        if (op.text !== undefined || op.title !== undefined)
          setNodeText(node, op.text ?? String(record(node.content).text ?? ""), op.title);
        if (op.color !== undefined) {
          if (!(WHITEBOARD_COLORS as readonly string[]).includes(op.color))
            throw new AuthoringError(`${label}: color must be one of ${WHITEBOARD_COLORS.join(", ")}.`);
          node.style = { ...node.style, ...colorStyle(op.color, node.type) };
        }
        node.semanticLabel = truncate(whiteboardNodeText(node), 120);
        break;
      }
      case "delete_nodes": {
        if (!Array.isArray(op.nodes) || !op.nodes.length) throw new AuthoringError(`${label}: nodes is empty.`);
        const doomed = new Set(op.nodes.map((ref) => resolveNode(board, ref, label).id));
        board.nodes = board.nodes.filter((node) => !doomed.has(node.id));
        board.edges = board.edges.filter((edge) => !doomed.has(edge.from) && !doomed.has(edge.to));
        break;
      }
      case "connect":
        addEdge(board, op, ids, label);
        break;
      case "disconnect": {
        const from = resolveNode(board, op.from, label, "from");
        const to = resolveNode(board, op.to, label, "to");
        const before = board.edges.length;
        board.edges = board.edges.filter(
          (edge) => !((edge.from === from.id && edge.to === to.id) || (edge.from === to.id && edge.to === from.id)),
        );
        if (board.edges.length === before) throw new AuthoringError(`${label}: those nodes are not connected.`);
        break;
      }
      case "relayout":
        if (op.layout !== undefined && !(WHITEBOARD_LAYOUTS as readonly string[]).includes(op.layout))
          throw new AuthoringError(`${label}: layout must be one of ${WHITEBOARD_LAYOUTS.join(", ")}.`);
        relayout = op.layout ?? "auto";
        break;
      case "replace": {
        if (!op.find) throw new AuthoringError(`${label}: \`find\` is empty.`);
        const hits = board.nodes.filter((node) => whiteboardNodeText(node).includes(op.find));
        const count = hits.reduce((sum, node) => sum + whiteboardNodeText(node).split(op.find).length - 1, 0) +
          board.edges.reduce((sum, edge) => sum + (edge.label?.split(op.find).length ?? 1) - 1, 0);
        if (!count)
          throw new AuthoringError(
            notFoundMessage(label, "find", op.find, [...board.nodes.map(whiteboardNodeText), ...board.edges.map((edge) => edge.label ?? "")].join("\n"), "the board"),
          );
        if (count > 1 && !op.all) throw new AuthoringError(`${label}: \`find\` text appears ${count} times. Set "all": true or include more text.`);
        for (const node of board.nodes) {
          const content = record(node.content);
          const next = { ...content };
          for (const key of ["text", "title"] as const)
            if (typeof content[key] === "string") next[key] = (content[key] as string).split(op.find).join(op.replace);
          node.content = next;
        }
        for (const edge of board.edges) if (edge.label) edge.label = edge.label.split(op.find).join(op.replace);
        break;
      }
      default:
        throw new AuthoringError(
          `${label}: unknown operation. Use add_nodes, update_node, delete_nodes, connect, disconnect, relayout or replace.`,
        );
    }
  });
  if (relayout === "auto" && board.nodes.length) {
    // New nodes on an existing board join the automatic layout only when the
    // board was laid out by Spectra or is new; hand-placed boards keep their
    // positions and new nodes go to the right of everything.
    const existing = board.nodes.filter((node) => !added.has(node.id));
    if (!existing.length) layoutWhiteboard(board);
    else {
      const right = Math.max(...existing.map((node) => node.x + node.width)) + 120;
      const top = Math.min(...existing.map((node) => node.y));
      let y = top;
      for (const node of board.nodes.filter((entry) => added.has(entry.id))) {
        node.x = right;
        node.y = y;
        y += node.height + 40;
      }
    }
  } else if (relayout && relayout !== "auto") layoutWhiteboard(board, relayout);
  board.zOrder = board.nodes.map((node) => node.id);
  return normalizeWhiteboardContent(board);
}

export function whiteboardFromSpec(spec: WhiteboardSpec, ids: IdFactory = defaultIdFactory()) {
  if (!Array.isArray(spec?.nodes) || !spec.nodes.length) throw new AuthoringError("nodes: give at least one node.");
  if (spec.layout !== undefined && !(WHITEBOARD_LAYOUTS as readonly string[]).includes(spec.layout))
    throw new AuthoringError(`layout must be one of ${WHITEBOARD_LAYOUTS.join(", ")}.`);
  const ops: WhiteboardEditOp[] = [{ op: "add_nodes", nodes: spec.nodes, edges: spec.edges }];
  if (spec.layout) ops.push({ op: "relayout", layout: spec.layout });
  return applyWhiteboardEdits(null, ops, ids);
}

// ---------------------------------------------------------------- reading

function overlaps(left: WhiteboardNode, right: WhiteboardNode) {
  return left.x < right.x + right.width && right.x < left.x + left.width && left.y < right.y + right.height && right.y < left.y + left.height;
}

export function whiteboardProblems(content: unknown) {
  const board = normalizeWhiteboardContent(content);
  const problems: string[] = [];
  const visible = board.nodes.filter((node) => !node.hidden && node.type !== "frame" && node.type !== "group" && node.type !== "drawing");
  for (const node of visible)
    if (["shape", "note", "card", "text"].includes(node.type) && isPlaceholder(whiteboardNodeText(node)))
      problems.push(`node ${node.id} is empty or placeholder text`);
  let overlapCount = 0;
  for (let i = 0; i < visible.length; i += 1)
    for (let j = i + 1; j < visible.length; j += 1)
      if (!visible[i]!.parentId && !visible[j]!.parentId && overlaps(visible[i]!, visible[j]!)) overlapCount += 1;
  if (overlapCount) problems.push(`${overlapCount} pair${overlapCount === 1 ? "" : "s"} of nodes overlap; relayout fixes this`);
  const connected = new Set(board.edges.flatMap((edge) => [edge.from, edge.to]));
  const loose = board.edges.length ? visible.filter((node) => node.type !== "text" && !connected.has(node.id)) : [];
  if (loose.length && loose.length < visible.length)
    problems.push(`unconnected: ${loose.map((node) => node.id).join(", ")}`);
  return problems;
}

export function whiteboardOutline(content: unknown, max = 4_000) {
  const board = normalizeWhiteboardContent(content);
  const nodes = board.nodes.map((node) => {
    const value = whiteboardNodeText(node).replace(/\n+/g, " / ");
    return `- ${node.id} (${node.type}): ${truncate(value, 160)}`;
  });
  const edges = board.edges.map((edge) => `- ${edge.from} → ${edge.to}${edge.label ? ` "${edge.label}"` : ""}`);
  return truncate([`Nodes:`, ...nodes, ...(edges.length ? ["Edges:", ...edges] : [])].join("\n"), max);
}

export function whiteboardReadback(content: unknown, previous?: unknown) {
  const board = normalizeWhiteboardContent(content);
  const lines = [`${board.nodes.length} nodes, ${board.edges.length} connections.`];
  const problems = whiteboardProblems(board);
  if (problems.length) lines.push(`Problems: ${problems.join("; ")}.`);
  if (previous) {
    const before = normalizeWhiteboardContent(previous);
    const prior = new Map(before.nodes.map((node) => [node.id, whiteboardNodeText(node)]));
    const changed = board.nodes.filter((node) => prior.get(node.id) !== whiteboardNodeText(node));
    const removed = before.nodes.filter((node) => !board.nodes.some((entry) => entry.id === node.id));
    if (changed.length)
      lines.push(`Changed or new: ${changed.map((node) => `${node.id}: ${truncate(whiteboardNodeText(node), 80)}`).join("; ")}`);
    if (removed.length) lines.push(`Removed: ${removed.map((node) => node.id).join(", ")}`);
    if (board.edges.length !== before.edges.length) lines.push(`Connections: ${before.edges.length} → ${board.edges.length}.`);
  } else lines.push(whiteboardOutline(board, 2_400));
  return lines.join("\n");
}
