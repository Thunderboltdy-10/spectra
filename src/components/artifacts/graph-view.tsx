"use client";

import { useMemo, useState } from "react";
import { getArtifactMeta } from "@/lib/artifact-types";
import type { ArtifactItem } from "./artifact-card";

type Node = {
  id: string;
  artifact: ArtifactItem;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type Edge = {
  source: string;
  target: string;
  reason: string;
};

function buildGraph(artifacts: ArtifactItem[]) {
  const nodes: Node[] = artifacts.map((a, i) => {
    // Arrange in a circle initially
    const angle = (2 * Math.PI * i) / Math.max(artifacts.length, 1);
    const radius = Math.min(250, 50 + artifacts.length * 20);
    return {
      id: a._id,
      artifact: a,
      x: 400 + Math.cos(angle) * radius,
      y: 300 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });

  const edges: Edge[] = [];

  // Build edges based on shared tags, same agent, same chat
  for (let i = 0; i < artifacts.length; i++) {
    for (let j = i + 1; j < artifacts.length; j++) {
      const a = artifacts[i]!;
      const b = artifacts[j]!;

      // Shared tags
      if (a.tags && b.tags) {
        const shared = a.tags.filter((t) => b.tags!.includes(t));
        if (shared.length > 0) {
          edges.push({ source: a._id, target: b._id, reason: `tag: ${shared[0]}` });
        }
      }

      // Same linked agent
      if (a.linkedAgentId && a.linkedAgentId === b.linkedAgentId) {
        edges.push({ source: a._id, target: b._id, reason: "same agent" });
      }

      // Same linked chat
      if (a.linkedChatId && a.linkedChatId === b.linkedChatId) {
        edges.push({ source: a._id, target: b._id, reason: "same chat" });
      }

      // Same type proximity
      if (a.type === b.type) {
        edges.push({ source: a._id, target: b._id, reason: `same type` });
      }
    }
  }

  return { nodes, edges };
}

// Simple force-directed layout
function simulate(nodes: Node[], edges: Edge[], iterations = 80) {
  const centerX = 400;
  const centerY = 300;

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 0.3 * (1 - iter / iterations);

    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j]!.x - nodes[i]!.x;
        const dy = nodes[j]!.y - nodes[i]!.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (800 / (dist * dist)) * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        nodes[i]!.vx -= fx;
        nodes[i]!.vy -= fy;
        nodes[j]!.vx += fx;
        nodes[j]!.vy += fy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const src = nodes.find((n) => n.id === edge.source);
      const tgt = nodes.find((n) => n.id === edge.target);
      if (!src || !tgt) continue;
      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = ((dist - 120) * 0.01) * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      src.vx += fx;
      src.vy += fy;
      tgt.vx -= fx;
      tgt.vy -= fy;
    }

    // Center gravity
    for (const node of nodes) {
      node.vx += (centerX - node.x) * 0.005 * alpha;
      node.vy += (centerY - node.y) * 0.005 * alpha;
    }

    // Apply velocity
    for (const node of nodes) {
      node.vx *= 0.6;
      node.vy *= 0.6;
      node.x += node.vx;
      node.y += node.vy;
      // Keep in bounds
      node.x = Math.max(60, Math.min(740, node.x));
      node.y = Math.max(60, Math.min(540, node.y));
    }
  }

  return nodes;
}

export function GraphView({
  artifacts,
  onOpen,
}: {
  artifacts: ArtifactItem[];
  onOpen: (id: string) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const graph = buildGraph(artifacts);
    simulate(graph.nodes, graph.edges);
    return graph;
  }, [artifacts]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, Node>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const connectedToHovered = useMemo(() => {
    if (!hoveredId) return new Set<string>();
    const s = new Set<string>();
    for (const e of edges) {
      if (e.source === hoveredId) s.add(e.target);
      if (e.target === hoveredId) s.add(e.source);
    }
    return s;
  }, [hoveredId, edges]);

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm text-[var(--text-secondary)]">Add artifacts to see their relationship graph.</p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-secondary)_50%,var(--bg-primary))]">
      <svg
        viewBox="0 0 800 600"
        className="h-[500px] w-full"
        style={{ background: "transparent" }}
      >
        {/* Edges */}
        {edges.map((edge, i) => {
          const src = nodeMap.get(edge.source);
          const tgt = nodeMap.get(edge.target);
          if (!src || !tgt) return null;

          const isHighlighted =
            hoveredId && (edge.source === hoveredId || edge.target === hoveredId);
          const isDimmed = hoveredId && !isHighlighted;

          return (
            <line
              key={`edge-${i}`}
              x1={src.x}
              y1={src.y}
              x2={tgt.x}
              y2={tgt.y}
              stroke="var(--border-default)"
              strokeWidth={isHighlighted ? 2 : 1}
              opacity={isDimmed ? 0.15 : isHighlighted ? 0.6 : 0.3}
              strokeDasharray={edge.reason === "same type" ? "4 4" : undefined}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const meta = getArtifactMeta(node.artifact.type);
          const isHovered = hoveredId === node.id;
          const isConnected = connectedToHovered.has(node.id);
          const isDimmed = hoveredId && !isHovered && !isConnected;

          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={() => onOpen(node.id)}
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId(null)}
              className="cursor-pointer"
              opacity={isDimmed ? 0.3 : 1}
            >
              {/* Glow ring on hover */}
              {isHovered ? (
                <circle
                  r="32"
                  fill="none"
                  stroke={meta.color}
                  strokeWidth="2"
                  opacity="0.3"
                />
              ) : null}

              {/* Background circle */}
              <circle
                r="24"
                fill="var(--bg-elevated)"
                stroke={isHovered ? meta.color : "var(--border-default)"}
                strokeWidth={isHovered ? 2 : 1}
              />

              {/* Color dot */}
              <circle r="8" fill={meta.color} opacity="0.85" />

              {/* Label */}
              <text
                y="38"
                textAnchor="middle"
                className="text-[10px] font-medium"
                fill="var(--text-secondary)"
              >
                {node.artifact.title.length > 18
                  ? node.artifact.title.slice(0, 16) + "..."
                  : node.artifact.title}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex items-center gap-4 rounded-xl bg-[var(--bg-elevated)] px-3 py-2 text-[10px] text-[var(--text-tertiary)] shadow-[var(--shadow-card)]">
        <span className="flex items-center gap-1">
          <span className="h-px w-4 bg-[var(--border-default)]" />
          shared tag / agent / chat
        </span>
        <span className="flex items-center gap-1">
          <span className="h-px w-4 border-t border-dashed border-[var(--border-default)]" />
          same type
        </span>
      </div>
    </div>
  );
}
