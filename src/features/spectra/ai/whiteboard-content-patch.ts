/**
 * Whiteboard contentPatch helpers: resolve id/title node selectors to numeric
 * indices, lift bare fill/stroke/color onto style.*, and coerce color values so
 * focused recolor patches survive Zod + apply.
 */

export type ContentPatchChange = { path: string; value: unknown };

type WhiteboardNode = Record<string, unknown>;

const STYLE_COLOR_KEYS = new Set(["fill", "stroke", "color", "background"]);

const NAMED_COLORS: Record<string, string> = {
  blue: "#2563eb",
  "clearer blue": "#2563eb",
  "clear blue": "#2563eb",
  "bright blue": "#3b82f6",
  "light blue": "#60a5fa",
  "sky blue": "#38bdf8",
  "navy blue": "#1e3a8a",
  navy: "#1e3a8a",
  indigo: "#4f46e5",
  teal: "#0d9488",
  cyan: "#06b6d4",
  green: "#16a34a",
  red: "#dc2626",
  orange: "#ea580c",
  yellow: "#ca8a04",
  purple: "#7c3aed",
  pink: "#db2777",
  black: "#111827",
  white: "#ffffff",
  gray: "#6b7280",
  grey: "#6b7280",
};

function asNodes(content: unknown): WhiteboardNode[] {
  if (!content || typeof content !== "object" || Array.isArray(content))
    return [];
  const nodes = (content as Record<string, unknown>).nodes;
  return Array.isArray(nodes)
    ? nodes.filter(
        (node): node is WhiteboardNode =>
          Boolean(node) && typeof node === "object" && !Array.isArray(node),
      )
    : [];
}

function nodeLabel(node: WhiteboardNode) {
  const content = node.content;
  if (typeof content === "string") return content;
  const row =
    content && typeof content === "object" && !Array.isArray(content)
      ? (content as Record<string, unknown>)
      : {};
  const parts = [
    row.text,
    row.title,
    row.label,
    row.header,
    row.body,
    node.semanticLabel,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  return parts.join(" ");
}

function decodePointerSegment(segment: string) {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** Normalize a CSS-ish color string into #rrggbb when possible. */
export function coerceWhiteboardColorValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    // Models sometimes nest `{ fill: "#…" }` / `{ color: "blue" }` at a leaf.
    for (const key of ["fill", "color", "stroke", "background", "value"] as const) {
      if (typeof row[key] === "string")
        return coerceWhiteboardColorValue(row[key]);
    }
    return value;
  }
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const body = hex[1]!.toLowerCase();
    if (body.length === 3)
      return `#${body
        .split("")
        .map((ch) => `${ch}${ch}`)
        .join("")}`;
    if (body.length === 8) return `#${body.slice(0, 6)}`;
    return `#${body}`;
  }
  const rgb = trimmed.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i,
  );
  if (rgb) {
    const channels = [rgb[1], rgb[2], rgb[3]].map((part) =>
      Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0"),
    );
    return `#${channels.join("")}`;
  }
  const named = NAMED_COLORS[trimmed.toLowerCase()];
  if (named) return named;
  // Soft phrases like "a clearer blue" / "more blue".
  const lower = trimmed.toLowerCase();
  for (const [name, hexValue] of Object.entries(NAMED_COLORS)) {
    if (lower.includes(name)) return hexValue;
  }
  return value;
}

function findNodeIndexBySelector(
  nodes: WhiteboardNode[],
  selector: string,
  prompt?: string,
): number {
  const decoded = decodePointerSegment(selector).trim();
  if (!decoded) return -1;
  if (/^\d+$/.test(decoded)) {
    const index = Number(decoded);
    return index >= 0 && index < nodes.length ? index : -1;
  }

  const byId = nodes.findIndex(
    (node) => typeof node.id === "string" && node.id === decoded,
  );
  if (byId >= 0) return byId;

  const needle = decoded.toLowerCase().replace(/[_-]+/g, " ").trim();
  if (needle) {
    const exact = nodes.findIndex((node) => {
      const label = nodeLabel(node).toLowerCase();
      return label === needle || label.includes(needle);
    });
    if (exact >= 0) return exact;
  }

  // Prompt-driven title match ("competitive inhibition") when the selector is
  // a generic placeholder like "node" / "target" / a wrong index.
  if (prompt) {
    const titleHint =
      prompt.match(
        /\b(?:recolor|re-colour|colour|color|tint|paint|fill)\b[\s\S]{0,80}?\b(?:the\s+)?([a-z][a-z0-9\s-]{1,48}?)\s+node\b/i,
      )?.[1] ??
      prompt.match(
        /\b(?:node|shape|card|note)\s+(?:for|labelled|labeled|named|titled)?\s*["']?([a-z][a-z0-9\s-]{1,48})["']?/i,
      )?.[1];
    const hint = titleHint?.trim().toLowerCase();
    if (hint) {
      const byPrompt = nodes.findIndex((node) =>
        nodeLabel(node).toLowerCase().includes(hint),
      );
      if (byPrompt >= 0) return byPrompt;
    }
  }

  return -1;
}

/**
 * Resolve `/nodes/<n|id:…|byId/…|title>/…` (plus optional `/content` prefix)
 * into a canonical numeric path. Lifts bare fill/stroke/color onto style.*.
 */
export function resolveWhiteboardNodePatchPath(
  content: unknown,
  path: string,
  prompt?: string,
): string {
  const match = path.match(
    /^(\/(?:content\/)?)nodes\/(?:id:|byId\/)?([^/]+)(.*)$/i,
  );
  if (!match) return path;
  const [, prefix = "/", selector = "", rest = ""] = match;
  const nodes = asNodes(content);
  const index = findNodeIndexBySelector(nodes, selector, prompt);
  if (index < 0) return path;

  let suffix = rest;
  // `/nodes/N/fill` → `/nodes/N/style/fill` (and stroke/color/background).
  const bareStyle = suffix.match(/^\/(fill|stroke|color|background)(\/.*)?$/i);
  if (bareStyle) {
    suffix = `/style/${bareStyle[1]!.toLowerCase()}${bareStyle[2] ?? ""}`;
  }
  // `/nodes/N/background` already handled; also map style.background → fill.
  suffix = suffix.replace(/\/style\/background\b/i, "/style/fill");

  return `${prefix}nodes/${index}${suffix}`;
}

function isStyleColorLeafPath(path: string) {
  return /\/style\/(?:fill|stroke|color)$/i.test(path);
}

function isWholeStylePath(path: string) {
  return /\/nodes\/\d+\/style$/i.test(path.replace(/^\/content/, ""));
}

/** Normalize a single whiteboard change so Zod + apply share one shape. */
export function canonicalizeWhiteboardPatchChange(
  content: unknown,
  change: ContentPatchChange,
  prompt?: string,
): ContentPatchChange {
  const path = resolveWhiteboardNodePatchPath(content, change.path, prompt)
    .replace(/^\/content/, "");
  let value = change.value;

  if (isStyleColorLeafPath(path)) {
    value = coerceWhiteboardColorValue(value);
  } else if (isWholeStylePath(path)) {
    if (typeof value === "string") {
      value = { fill: coerceWhiteboardColorValue(value) };
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      const row = { ...(value as Record<string, unknown>) };
      for (const key of STYLE_COLOR_KEYS) {
        if (key in row) {
          const coerced = coerceWhiteboardColorValue(row[key]);
          if (key === "background") {
            row.fill = coerced;
            delete row.background;
          } else {
            row[key] = coerced;
          }
        }
      }
      value = row;
    }
  }

  return { path, value };
}

/**
 * When the user asks to recolor a named node, remap mis-aimed style writes onto
 * that node's style.fill (and optional stroke) so title-based selectors work.
 */
export function remapWhiteboardRecolorChanges(
  content: unknown,
  prompt: string,
  changes: ContentPatchChange[],
): ContentPatchChange[] {
  if (changes.length === 0) return changes;
  if (
    !/\b(?:recolor|re-colour|colour|color|tint|paint|fill)\b/i.test(prompt)
  )
    return changes.map((change) =>
      canonicalizeWhiteboardPatchChange(content, change, prompt),
    );

  const nodes = asNodes(content);
  const titleHint =
    prompt.match(
      /\b(?:recolor|re-colour|colour|color|tint|paint|fill)\b[\s\S]{0,100}?\b(?:the\s+)?([a-z][a-z0-9\s-]{1,48}?)\s+node\b/i,
    )?.[1] ??
    prompt.match(
      /\b(?:competitive|non[-\s]?competitive|uncompetitive|irreversible)[a-z\s-]*/i,
    )?.[0];
  const hint = titleHint?.trim().toLowerCase();
  const targetIndex =
    hint && hint.length >= 3
      ? nodes.findIndex((node) =>
          nodeLabel(node).toLowerCase().includes(hint),
        )
      : -1;

  const remapped = changes.map((change) =>
    canonicalizeWhiteboardPatchChange(content, change, prompt),
  );

  if (targetIndex < 0) return remapped;

  return remapped.map((change) => {
    if (!/\/nodes\//.test(change.path)) return change;
    const colorValue = coerceWhiteboardColorValue(change.value);
    if (typeof colorValue !== "string" || !colorValue.startsWith("#"))
      return change;
    // Any style color write for a recolor request lands on the named node.
    if (
      /\/style\/(?:fill|stroke|color)$/i.test(change.path) ||
      /\/nodes\/\d+\/(?:fill|stroke|color)$/i.test(change.path)
    ) {
      const field = /stroke/i.test(change.path)
        ? "stroke"
        : /(?:^|\/)color$/i.test(change.path)
          ? "color"
          : "fill";
      return {
        path: `/nodes/${targetIndex}/style/${field}`,
        value: colorValue,
      };
    }
    if (isWholeStylePath(change.path) && typeof change.value === "string") {
      return {
        path: `/nodes/${targetIndex}/style/fill`,
        value: colorValue,
      };
    }
    return change;
  });
}
