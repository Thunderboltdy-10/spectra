"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { normalizeWhiteboardContent, whiteboardNodeText, type WhiteboardNode } from "./model";

const PAD = 48;

/* The near-whites boards were saved with before the board was drawn on card
   paper. They mean "no colour chosen", so they get the paper. */
const PAPER_DEFAULTS = new Set(["#fbfbf8", "#fbfaf7"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The board studio's resolution order: the node's style, then its content, then the type default. */
function paint(node: WhiteboardNode, key: string, contentKeys: readonly string[], fallback: string | number) {
  const content = record(node.content);
  const own = node.style?.[key];
  if (typeof own === typeof fallback) return own as string | number;
  const fromContent = contentKeys.map((name) => content[name]).find((value) => typeof value === typeof fallback);
  return (fromContent as string | number | undefined) ?? fallback;
}

function colour(value: string | number) {
  const chosen = String(value);
  return PAPER_DEFAULTS.has(chosen.toLowerCase()) ? "var(--card-paper)" : chosen;
}

function nodeStyle(node: WhiteboardNode): CSSProperties {
  const note = node.type === "note";
  const text = node.type === "text";
  const shape = String(paint(node, "shape", ["shape"], ""));
  return {
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    zIndex: node.zIndex,
    transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
    background: text
      ? "transparent"
      : colour(paint(node, "fill", ["fill"], note ? "color-mix(in oklab, var(--accent-gold) 28%, var(--card-paper))" : "var(--card-paper)")),
    borderColor: text
      ? "transparent"
      : colour(paint(node, "stroke", ["stroke"], note ? "transparent" : "var(--card-border)")),
    borderWidth: Number(paint(node, "strokeWidth", ["strokeWidth"], 1)),
    borderRadius:
      shape === "ellipse" || shape === "circle"
        ? "50%"
        : Number(paint(node, "borderRadius", ["borderRadius", "radius"], note ? 3 : 10)),
    color: String(paint(node, "color", ["textColor", "color"], "var(--text-primary)")),
    fontSize: Number(paint(node, "fontSize", ["fontSize"], text ? 30 : 16)),
    fontWeight: paint(node, "fontWeight", ["fontWeight"], text ? 650 : 500) as CSSProperties["fontWeight"],
  };
}

function Body({ node }: { node: WhiteboardNode }) {
  const content = record(node.content);
  if (node.type === "table") {
    const rows = Array.isArray(content.rows) ? (content.rows as unknown[]).filter(Array.isArray) as unknown[][] : [];
    return (
      <table className="board-view-table">
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td key={column}>{typeof cell === "string" || typeof cell === "number" ? cell : ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (node.type === "image" || node.type === "embed")
    return <span className="board-view-placeholder">{node.semanticLabel || (node.type === "image" ? "Picture" : "Embedded work")}</span>;
  if (node.type === "frame")
    return <span className="board-view-frame-title">{typeof content.title === "string" ? content.title : ""}</span>;
  if (node.type === "card" && typeof content.title === "string")
    return (
      <>
        <strong className="board-view-card-title">{content.title}</strong>
        {typeof content.text === "string" ? <span>{content.text}</span> : null}
      </>
    );
  return <span>{whiteboardNodeText(node)}</span>;
}

/**
 * A board as a reader sees it outside the studio: the first page with every
 * object at its own place, size and colour, scaled to the width it is given,
 * and nothing that edits. Public links and other read-only views draw this
 * rather than a list of labels, so a board keeps its layout wherever it goes.
 */
export function BoardView({ content: raw }: { content: unknown }) {
  const content = normalizeWhiteboardContent(raw);
  const pageId = content.pages.some((page) => page.id === content.viewport.pageId)
    ? content.viewport.pageId
    : content.pages[0]?.id;
  const nodes = content.nodes.filter((node) => node.pageId === pageId && !node.hidden);
  const edges = content.edges.filter((edge) => edge.pageId === pageId);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (!nodes.length) return <p className="text-ui text-[var(--text-secondary)]">This board is empty.</p>;
  const left = Math.min(...nodes.map((node) => node.x)) - PAD;
  const top = Math.min(...nodes.map((node) => node.y)) - PAD;
  const boardWidth = Math.max(...nodes.map((node) => node.x + node.width)) + PAD - left;
  const boardHeight = Math.max(...nodes.map((node) => node.y + node.height)) + PAD - top;
  // Never blow a small board up past its own size; shrink a wide one to fit.
  const scale = width ? Math.min(1, width / boardWidth) : 0;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const canvasColor = content.settings?.canvasColor;

  return (
    <div
      ref={frame}
      className="board-view"
      role="img"
      aria-label={`Whiteboard with ${nodes.length} ${nodes.length === 1 ? "object" : "objects"}`}
      style={{
        height: scale ? boardHeight * scale : 320,
        background: canvasColor && !PAPER_DEFAULTS.has(canvasColor.toLowerCase()) ? canvasColor : undefined,
      }}
    >
      {scale ? (
        <div
          className="board-view-plane"
          style={{
            width: boardWidth,
            height: boardHeight,
            transform: `scale(${scale}) translate(${-left}px, ${-top}px)`,
          }}
        >
          <svg className="board-view-edges" style={{ left, top, width: boardWidth, height: boardHeight }} viewBox={`${left} ${top} ${boardWidth} ${boardHeight}`} aria-hidden>
            {edges.map((edge) => {
              const from = byId.get(edge.from);
              const to = byId.get(edge.to);
              if (!from || !to) return null;
              const x1 = from.x + from.width / 2;
              const y1 = from.y + from.height / 2;
              const x2 = to.x + to.width / 2;
              const y2 = to.y + to.height / 2;
              return (
                <g key={edge.id}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} />
                  {edge.label ? (
                    <text x={(x1 + x2) / 2} y={(y1 + y2) / 2} textAnchor="middle">
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {[...nodes]
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((node) => (
              <div key={node.id} className="board-view-node" data-type={node.type} style={nodeStyle(node)}>
                <Body node={node} />
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}
