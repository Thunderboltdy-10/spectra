import { whiteboardNodeText, type WhiteboardEdge, type WhiteboardNode } from "./model";

/** Above this many objects a thumbnail draws a fair sample, not every one. */
const MOST = 240;
const PAD = 40;

/**
 * A board page as the rail shows it: its objects drawn as blocks in their
 * places — notes in their paper colour, shapes as outlines, text as lines of
 * type, connectors as strokes — framed to the work on the page, so pages are
 * told apart at a glance the way slides are.
 */
export function PageThumbnail({
  nodes,
  edges,
  className = "spectra-item-rail-preview",
}: {
  nodes: readonly WhiteboardNode[];
  edges: readonly WhiteboardEdge[];
  /** Where it sits: the page rail by default, or a card's face. */
  className?: string;
}) {
  // A text box not yet written holds nothing to draw; its placeholder is not
  // on the page.
  const shown = nodes.filter((node) => !node.hidden && (node.type !== "text" || whiteboardNodeText(node).trim()));
  const sample = shown.length > MOST ? shown.filter((_, index) => index % Math.ceil(shown.length / MOST) === 0) : shown;
  if (!sample.length)
    return <div className={`${className} rail-thumb`} data-thumb="page" data-empty />;
  const left = Math.min(...sample.map((node) => node.x)) - PAD;
  const top = Math.min(...sample.map((node) => node.y)) - PAD;
  const right = Math.max(...sample.map((node) => node.x + node.width)) + PAD;
  const bottom = Math.max(...sample.map((node) => node.y + node.height)) + PAD;
  // Keep the page's proportion: a lone note sits in the middle of a page,
  // not stretched across the thumbnail.
  const width = Math.max(right - left, ((bottom - top) * 16) / 10);
  const height = Math.max(bottom - top, (width * 10) / 16);
  const x = left - (width - (right - left)) / 2;
  const y = top - (height - (bottom - top)) / 2;
  const byId = new Map(sample.map((node) => [node.id, node]));
  return (
    <svg
      className={`${className} rail-thumb`}
      data-thumb="page"
      viewBox={`${x} ${y} ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {edges.map((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return null;
        return (
          <line
            key={edge.id}
            className="rail-thumb-edge"
            x1={from.x + from.width / 2}
            y1={from.y + from.height / 2}
            x2={to.x + to.width / 2}
            y2={to.y + to.height / 2}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {[...sample].sort((a, b) => a.zIndex - b.zIndex).map((node) => (
        <ThumbnailNode key={node.id} node={node} />
      ))}
    </svg>
  );
}

function fillOf(node: WhiteboardNode) {
  const content = node.content && typeof node.content === "object" ? (node.content as Record<string, unknown>) : {};
  const fill = node.style?.fill ?? node.style?.background ?? content.fill ?? content.color;
  return typeof fill === "string" ? fill : undefined;
}

function ThumbnailNode({ node }: { node: WhiteboardNode }) {
  const box = { x: node.x, y: node.y, width: node.width, height: node.height };
  if (node.type === "text") return <TypeLines node={node} inset={0} />;
  const fill = fillOf(node);
  const shape = node.type === "shape" && (node.style?.shape === "ellipse" || (node.content as { shape?: string } | null)?.shape === "ellipse");
  const kind = node.type === "note" || node.type === "card" ? "note" : node.type === "frame" || node.type === "group" ? "frame" : node.type === "image" || node.type === "embed" ? "picture" : "shape";
  const style = fill && kind !== "frame" ? { fill } : undefined;
  return (
    <>
      {shape ? (
        <ellipse className="rail-thumb-node" data-kind={kind} cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} style={style} vectorEffect="non-scaling-stroke" />
      ) : (
        <rect className="rail-thumb-node" data-kind={kind} {...box} rx={Math.min(12, box.width / 8)} style={style} vectorEffect="non-scaling-stroke" />
      )}
      {kind !== "picture" && whiteboardNodeText(node).trim() ? <TypeLines node={node} inset={16} /> : null}
    </>
  );
}

/**
 * Words as lines of type at their own size, as many as they would run to
 * across the box (and the box holds), the last one short.
 */
function TypeLines({ node, inset }: { node: WhiteboardNode; inset: number }) {
  const size = typeof node.style?.fontSize === "number" ? node.style.fontSize : inset ? 16 : 18;
  const measure = Math.max(1, node.width - inset * 2);
  const reach = whiteboardNodeText(node).trim().length * size * 0.5;
  const room = Math.max(1, Math.floor((node.height - inset * 2) / (size * 1.25)));
  const lines = Math.max(1, Math.min(4, room, Math.ceil(reach / measure)));
  const bar = size * 0.6;
  return (
    <g className="rail-thumb-text">
      {Array.from({ length: lines }, (_, index) => (
        <rect
          key={index}
          x={node.x + inset}
          y={node.y + inset + size * 0.2 + index * size * 1.25}
          width={index === lines - 1 ? Math.min(measure, reach - index * measure) || measure : measure}
          height={bar}
          rx={bar / 2}
        />
      ))}
    </g>
  );
}
