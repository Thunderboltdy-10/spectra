/**
 * auto-layout.ts
 *
 * Constrained force-directed layout engine for the workspace canvas.
 * Positions workstream nodes around a central hub using:
 *   - Radial force: active near hub, quiet mid, completed far
 *   - Angular clustering: same type clusters together
 *   - Repulsion: prevents overlap
 *   - Within-cluster ordering: most recent activity = closest to hub
 */

import type { Workstream } from "@/hooks/use-workspace-data";

export type LayoutNode = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: string;
  status: string;
  lastActivityAt?: number;
  pinned: boolean; // user-dragged = pinned
};

export type LayoutResult = {
  positions: Map<string, { x: number; y: number }>;
};

// Radial distances from hub center by lifecycle state (2.5x scale for breathing room)
const RADIAL_DISTANCE = {
  active: 1875,
  quiet: 2588,
  completed: 3375,
  archived: 4050,
} as const;

// Angular sectors by type (radians from 0)
const TYPE_SECTORS: Record<string, number> = {
  subject: -Math.PI / 3,      // top-right area
  project: Math.PI * 2 / 3,   // bottom-left area
  general: Math.PI / 6,       // right area
};

function getTargetRadius(workstream: Pick<Workstream, "status" | "lastActivityAt">): number {
  if (workstream.status === "completed") return RADIAL_DISTANCE.completed;
  if (workstream.status === "archived") return RADIAL_DISTANCE.archived;
  if (workstream.lastActivityAt) {
    const daysSinceActivity = (Date.now() - workstream.lastActivityAt) / (1000 * 60 * 60 * 24);
    if (daysSinceActivity >= 14) {
      return RADIAL_DISTANCE.quiet;
    }
  }
  return RADIAL_DISTANCE.active;
}

function getTargetAngle(type: string, index: number, countInType: number): number {
  const sectorCenter = TYPE_SECTORS[type] ?? 0;
  const spread = Math.min(Math.PI * 0.6, countInType * 0.3);
  if (countInType <= 1) return sectorCenter;
  const step = spread / Math.max(countInType - 1, 1);
  return sectorCenter - spread / 2 + index * step;
}

/**
 * Compute canonical layout for workstream nodes.
 * Given the same inputs, produces the same layout.
 * Does NOT consider user overrides — those are applied separately.
 */
export function computeCanonicalLayout(workstreams: Workstream[]): LayoutResult {
  if (workstreams.length === 0) {
    return { positions: new Map() };
  }

  // Group by type
  const byType = new Map<string, Workstream[]>();
  for (const ws of workstreams) {
    const group = byType.get(ws.type) ?? [];
    group.push(ws);
    byType.set(ws.type, group);
  }

  // Sort each group by last activity (most recent first → closest to hub)
  for (const group of byType.values()) {
    group.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  }

  // Initialize nodes with target positions
  const nodes: LayoutNode[] = [];
  for (const [type, group] of byType) {
    for (let i = 0; i < group.length; i++) {
      const ws = group[i]!;
      const angle = getTargetAngle(type, i, group.length);
      const radius = getTargetRadius(ws) + (i % 3) * 72;
      nodes.push({
        id: ws._id,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        type: ws.type,
        status: ws.status,
        lastActivityAt: ws.lastActivityAt,
        pinned: false,
      });
    }
  }

  // Run a simple force simulation (20 iterations)
  for (let iter = 0; iter < 20; iter++) {
    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const minDist = 1050; // minimum distance between nodes (2.5x scale)
        if (dist < minDist) {
          const force = (minDist - dist) / dist * 0.3;
          const fx = dx * force;
          const fy = dy * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }
    }

    // Apply velocities and decay
    for (const node of nodes) {
      if (node.pinned) continue;
      node.x += node.vx;
      node.y += node.vy;
      node.vx *= 0.6;
      node.vy *= 0.6;
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    positions.set(node.id, { x: Math.round(node.x), y: Math.round(node.y) });
  }

  return { positions };
}

/**
 * Apply user position overrides on top of canonical layout.
 * Workstreams with canvasX/canvasY set by user dragging get those positions.
 */
export function applyOverrides(
  canonical: LayoutResult,
  workstreams: Workstream[],
  localOverrides?: Map<string, { x: number; y: number }>,
): Map<string, { x: number; y: number }> {
  const result = new Map(canonical.positions);

  // Apply database-stored positions (canvasX/canvasY from user drags)
  for (const ws of workstreams) {
    if (ws.canvasX !== undefined && ws.canvasY !== undefined) {
      result.set(ws._id, { x: ws.canvasX, y: ws.canvasY });
    }
  }

  // Apply local overrides (from current session, not yet synced)
  if (localOverrides) {
    for (const [id, pos] of localOverrides) {
      result.set(id, pos);
    }
  }

  return result;
}

/**
 * Determine lifecycle visual properties for a workstream.
 */
export function getLifecycleVisuals(ws: Workstream): {
  opacity: number;
  scale: number;
  dashed: boolean;
} {
  if (ws.status === "archived") {
    return { opacity: 0.2, scale: 0.8, dashed: true };
  }
  if (ws.status === "completed") {
    return { opacity: 0.35, scale: 0.85, dashed: true };
  }
  // Check for quiet (no activity in 14+ days)
  if (ws.lastActivityAt) {
    const daysSinceActivity = (Date.now() - ws.lastActivityAt) / (1000 * 60 * 60 * 24);
    if (daysSinceActivity >= 14) {
      return { opacity: 0.7, scale: 0.95, dashed: false };
    }
  }
  // Active
  return { opacity: 1, scale: 1, dashed: false };
}
