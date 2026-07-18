import { parseDelimited } from "../sheets/model";
import {
  createWhiteboardNode,
  normalizeWhiteboardContent,
  whiteboardNodeText,
  type WhiteboardContent,
  type WhiteboardNode,
} from "./model";

export type WhiteboardImportResult = {
  content: WhiteboardContent;
  format: "json" | "csv" | "svg";
  importedNodes: number;
  warnings: string[];
};

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function finite(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildWhiteboardPackage(content: WhiteboardContent) {
  return JSON.stringify(
    {
      format: "spectra-whiteboard",
      version: 1,
      exportedAt: new Date().toISOString(),
      content,
    },
    null,
    2,
  );
}

export function buildWhiteboardSvg(
  content: WhiteboardContent,
  pageId = content.viewport.pageId,
  nodeIds?: ReadonlySet<string>,
) {
  const pageNodes = content.nodes.filter(
    (node) =>
      node.pageId === pageId &&
      !node.hidden &&
      (!nodeIds || nodeIds.has(node.id)),
  );
  const pageNodeIds = new Set(pageNodes.map((node) => node.id));
  const pageEdges = content.edges.filter(
    (edge) =>
      edge.pageId === pageId &&
      pageNodeIds.has(edge.from) &&
      pageNodeIds.has(edge.to),
  );
  const minimumX = Math.min(0, ...pageNodes.map((node) => node.x - 40));
  const minimumY = Math.min(0, ...pageNodes.map((node) => node.y - 40));
  const maximumX = Math.max(
    1200,
    ...pageNodes.map((node) => node.x + node.width + 40),
  );
  const maximumY = Math.max(
    800,
    ...pageNodes.map((node) => node.y + node.height + 40),
  );
  const byId = new Map(pageNodes.map((node) => [node.id, node]));
  const lines = pageEdges.flatMap((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return [];
    return [
      `<line x1="${from.x + from.width / 2}" y1="${from.y + from.height / 2}" x2="${to.x + to.width / 2}" y2="${to.y + to.height / 2}" stroke="#68736d" stroke-width="2" marker-end="url(#arrow)"/>`,
    ];
  });
  const objects = [...pageNodes]
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((node) => {
      const fill = String(
        node.style?.fill ?? (node.type === "note" ? "#fff3c9" : "#ffffff"),
      );
      const stroke = String(node.style?.stroke ?? "#d5d7d2");
      const text = escapeXml(
        node.semanticLabel || whiteboardNodeText(node) || node.type,
      );
      const fontSize = Number(node.style?.fontSize) || 14;
      const textLines = text
        .split(/\r?\n/)
        .flatMap((line) =>
          line.length > 46
            ? (line.match(/.{1,46}(?:\s|$)/g)?.map((part) => part.trim()) ?? [
                line,
              ])
            : [line],
        )
        .slice(
          0,
          Math.max(1, Math.floor((node.height - 20) / (fontSize * 1.3))),
        );
      const tspans = textLines
        .map(
          (line, index) =>
            `<tspan x="${node.x + 12}" y="${node.y + 18 + index * fontSize * 1.3}">${line}</tspan>`,
        )
        .join("");
      return `<g data-spectra-node="${escapeXml(node.id)}" data-spectra-type="${node.type}" transform="rotate(${node.rotation} ${node.x + node.width / 2} ${node.y + node.height / 2})"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.type === "note" ? 8 : 12}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}"/><text font-family="sans-serif" font-size="${fontSize}" font-weight="600" fill="#29352f">${tspans}</text></g>`;
    });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minimumX} ${minimumY} ${maximumX - minimumX} ${maximumY - minimumY}" role="img" aria-label="Spectra whiteboard export"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#68736d"/></marker></defs><rect x="${minimumX}" y="${minimumY}" width="${maximumX - minimumX}" height="${maximumY - minimumY}" fill="#fbfbf8"/>${lines.join("")}${objects.join("")}</svg>`;
}

function importCsv(
  source: string,
  current: WhiteboardContent,
  pageId: string,
  layerId: string,
) {
  const rows = parseDelimited(source);
  if (!rows.length) throw new Error("No CSV values were found.");
  const next = structuredClone(current);
  const imported: WhiteboardNode[] = [];
  rows.slice(0, 500).forEach((row, rowIndex) =>
    row.slice(0, 50).forEach((value, columnIndex) => {
      if (!value.trim()) return;
      const node = createWhiteboardNode(
        "note",
        pageId,
        layerId,
        80 + columnIndex * 270,
        80 + rowIndex * 180,
        next.nodes.length + imported.length + 1,
      );
      node.id = `csv-${crypto.randomUUID()}`;
      node.content = { text: value.slice(0, 20_000) };
      node.provenance = { source: "CSV import", createdAt: Date.now() };
      imported.push(node);
    }),
  );
  next.nodes.push(...imported);
  return {
    content: next,
    format: "csv" as const,
    importedNodes: imported.length,
    warnings: [
      "CSV contains no connectors, geometry, comments, or styles; values were placed as an editable sticky grid.",
    ],
  };
}

function importSvg(
  source: string,
  current: WhiteboardContent,
  pageId: string,
  layerId: string,
) {
  if (/<(?:script|foreignObject|iframe|object|embed)\b/i.test(source))
    throw new Error(
      "SVG quarantined because it contains active or embedded document content.",
    );
  if (
    /\son[a-z]+\s*=|(?:href|src)\s*=\s*["'](?:https?:|data:text\/html|javascript:)/i.test(
      source,
    )
  )
    throw new Error(
      "SVG quarantined because it contains executable handlers or external resources.",
    );
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror"))
    throw new Error("SVG is malformed.");
  const next = structuredClone(current);
  const imported: WhiteboardNode[] = [];
  const nativeGroups = [
    ...document.querySelectorAll<SVGGElement>("g[data-spectra-node]"),
  ];
  const elements: Element[] = nativeGroups.length
    ? nativeGroups
    : [...document.querySelectorAll("rect, circle, ellipse, text")];
  elements.slice(0, 2_000).forEach((element, index) => {
    const geometry =
      element.tagName.toLowerCase() === "g"
        ? (element.querySelector("rect, circle, ellipse") ?? element)
        : element;
    const exportedType = element.getAttribute("data-spectra-type");
    const type =
      exportedType === "note" ||
      exportedType === "card" ||
      exportedType === "text" ||
      exportedType === "shape"
        ? exportedType
        : geometry.tagName.toLowerCase() === "text"
          ? "text"
          : "shape";
    const x = finite(
      geometry.getAttribute("x"),
      finite(geometry.getAttribute("cx"), 0),
    );
    const y = finite(
      geometry.getAttribute("y"),
      finite(geometry.getAttribute("cy"), 0),
    );
    const width = Math.max(
      40,
      finite(
        geometry.getAttribute("width"),
        finite(geometry.getAttribute("r"), 60) * 2,
      ),
    );
    const height = Math.max(
      32,
      finite(
        geometry.getAttribute("height"),
        finite(geometry.getAttribute("r"), 40) * 2,
      ),
    );
    const node = createWhiteboardNode(
      type,
      pageId,
      layerId,
      x,
      y,
      next.nodes.length + index + 1,
    );
    node.id = `svg-${crypto.randomUUID()}`;
    node.width = width;
    node.height = height;
    node.content = {
      text: (element.textContent ?? "").trim().slice(0, 20_000),
    };
    node.style = {
      fill:
        geometry.getAttribute("fill") ||
        (type === "text" ? "transparent" : "#ffffff"),
      stroke: geometry.getAttribute("stroke") || "#d5d7d2",
    };
    node.provenance = { source: "Sanitized SVG import", createdAt: Date.now() };
    imported.push(node);
  });
  if (!imported.length)
    throw new Error("No supported SVG shapes or text objects were found.");
  next.nodes.push(...imported);
  return {
    content: next,
    format: "svg" as const,
    importedNodes: imported.length,
    warnings: [
      "Supported SVG shapes and text became native objects; paths, gradients, masks, fonts, and connector semantics were not inferred.",
    ],
  };
}

export async function importWhiteboardFile(
  file: File,
  current: WhiteboardContent,
  pageId: string,
  layerId: string,
): Promise<WhiteboardImportResult> {
  if (file.size < 1 || file.size > 40 * 1024 * 1024)
    throw new Error("Board import must be between 1 byte and 40 MB.");
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  const source = await file.text();
  if (extension === "json") {
    const parsed: unknown = JSON.parse(source);
    const record =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    if (record.format !== "spectra-whiteboard" || record.version !== 1)
      throw new Error("This is not a supported Spectra whiteboard package.");
    const normalized = normalizeWhiteboardContent(record.content);
    return {
      content: normalized,
      format: "json",
      importedNodes: normalized.nodes.length,
      warnings: [],
    };
  }
  if (extension === "csv") return importCsv(source, current, pageId, layerId);
  if (extension === "svg") return importSvg(source, current, pageId, layerId);
  throw new Error(
    "Choose a Spectra board package, CSV sticky grid, or safe SVG.",
  );
}
