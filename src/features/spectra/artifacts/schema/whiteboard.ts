import { z } from "zod";
import {
  WHITEBOARD_CONNECTOR_ANCHORS,
  WHITEBOARD_CONNECTOR_CAPS,
  WHITEBOARD_CONNECTOR_ROUTES,
  WHITEBOARD_SHAPE_KINDS,
  normalizeWhiteboardContent,
  type WhiteboardContent,
} from "../../whiteboard/model";

const id = z.string().trim().min(1).max(180);

export const WHITEBOARD_SCHEMA_VERSION = 2;

export const whiteboardContentSchema = z
  .object({
    zOrder: z.array(id).max(100_000).optional(),
    viewport: z
      .object({
        x: z.number().min(-1_000_000).max(1_000_000),
        y: z.number().min(-1_000_000).max(1_000_000),
        zoom: z.number().min(0.05).max(8),
        pageId: id,
      })
      .strict(),
    pages: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(120),
            background: z.string().max(100).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    nodes: z
      .array(
        z
          .object({
            id,
            type: z.enum([
              "text",
              "note",
              "shape",
              "image",
              "embed",
              "frame",
              "section",
              "group",
              "table",
              "card",
              "drawing",
            ]),
            pageId: id,
            x: z.number().min(-1_000_000).max(1_000_000),
            y: z.number().min(-1_000_000).max(1_000_000),
            width: z.number().min(20).max(100_000),
            height: z.number().min(20).max(100_000),
            rotation: z.number().min(-360).max(360),
            zIndex: z.number().int().min(-100_000).max(100_000),
            content: z.unknown(),
            style: z.record(z.string(), z.unknown()).optional(),
            shapeKind: z.enum(WHITEBOARD_SHAPE_KINDS).optional(),
            voteCount: z.number().int().min(0).max(100_000).optional(),
            layerId: id,
            parentId: id.optional(),
            frameId: id.optional(),
            semanticLabel: z.string().max(500).optional(),
            accessibilityOrder: z.number().int().nonnegative().optional(),
            provenance: z
              .object({
                source: z.string().max(120).optional(),
                sourceId: z.string().max(500).optional(),
                createdAt: z.number().optional(),
              })
              .strict()
              .optional(),
            locked: z.boolean().optional(),
            hidden: z.boolean().optional(),
            constraints: z
              .object({
                horizontal: z
                  .enum(["free", "left", "center", "right"])
                  .optional(),
                vertical: z
                  .enum(["free", "top", "center", "bottom"])
                  .optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(100_000),
    edges: z
      .array(
        z
          .object({
            id,
            pageId: id,
            layerId: id,
            from: id,
            to: id,
            fromAnchor: z.enum(WHITEBOARD_CONNECTOR_ANCHORS).optional(),
            toAnchor: z.enum(WHITEBOARD_CONNECTOR_ANCHORS).optional(),
            route: z.enum(WHITEBOARD_CONNECTOR_ROUTES).optional(),
            startCap: z.enum(WHITEBOARD_CONNECTOR_CAPS).optional(),
            endCap: z.enum(WHITEBOARD_CONNECTOR_CAPS).optional(),
            label: z.string().max(500).optional(),
            style: z.record(z.string(), z.unknown()).optional(),
            locked: z.boolean().optional(),
            zIndex: z.number().int().optional(),
          })
          .strict(),
      )
      .max(200_000),
    layers: z
      .array(
        z
          .object({
            id,
            pageId: id,
            name: z.string().min(1).max(100),
            visible: z.boolean(),
            locked: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(5_000),
    sources: z
      .array(
        z
          .object({
            id,
            label: z.string().min(1).max(500),
            url: z.string().max(2_000).optional(),
            artifactId: id.optional(),
          })
          .strict(),
      )
      .max(5_000)
      .optional(),
    settings: z
      .object({
        gridSize: z.number().min(4).max(200).optional(),
        snapToGrid: z.boolean().optional(),
        showGrid: z.boolean().optional(),
        canvasColor: z.string().max(100).optional(),
        virtualizeAfter: z.number().int().min(50).max(100_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((board, context) => {
    const pageIds = new Set<string>();
    const layersById = new Map<string, string>();
    const nodesById = new Map<string, string>();
    board.pages.forEach((page, index) => {
      if (pageIds.has(page.id))
        context.addIssue({
          code: "custom",
          message: "Page IDs must be unique.",
          path: ["pages", index, "id"],
        });
      pageIds.add(page.id);
    });
    board.layers.forEach((layer, index) => {
      if (layersById.has(layer.id))
        context.addIssue({
          code: "custom",
          message: "Layer IDs must be unique.",
          path: ["layers", index, "id"],
        });
      if (!pageIds.has(layer.pageId))
        context.addIssue({
          code: "custom",
          message: "Layer page is unavailable.",
          path: ["layers", index, "pageId"],
        });
      layersById.set(layer.id, layer.pageId);
    });
    if (!pageIds.has(board.viewport.pageId))
      context.addIssue({
        code: "custom",
        message: "Viewport page is unavailable.",
        path: ["viewport", "pageId"],
      });
    board.nodes.forEach((node, index) => {
      if (nodesById.has(node.id))
        context.addIssue({
          code: "custom",
          message: "Node IDs must be unique.",
          path: ["nodes", index, "id"],
        });
      if (
        !pageIds.has(node.pageId) ||
        !layersById.has(node.layerId) ||
        layersById.get(node.layerId) !== node.pageId
      )
        context.addIssue({
          code: "custom",
          message: "Node page and layer must agree.",
          path: ["nodes", index],
        });
      if (node.shapeKind && node.type !== "shape")
        context.addIssue({
          code: "custom",
          message: "Only shape objects may carry a shape kind.",
          path: ["nodes", index, "shapeKind"],
        });
      nodesById.set(node.id, node.pageId);
    });
    const edgeIds = new Set<string>();
    board.edges.forEach((edge, index) => {
      if (edgeIds.has(edge.id))
        context.addIssue({
          code: "custom",
          message: "Connector IDs must be unique.",
          path: ["edges", index, "id"],
        });
      if (
        !nodesById.has(edge.from) ||
        !nodesById.has(edge.to) ||
        edge.from === edge.to ||
        nodesById.get(edge.from) !== edge.pageId ||
        nodesById.get(edge.to) !== edge.pageId
      )
        context.addIssue({
          code: "custom",
          message: "Connector endpoints must be distinct nodes on its page.",
          path: ["edges", index],
        });
      edgeIds.add(edge.id);
    });
    board.nodes.forEach((node, index) => {
      if (node.parentId && !nodesById.has(node.parentId))
        context.addIssue({
          code: "custom",
          message: "Node parent must exist.",
          path: ["nodes", index, "parentId"],
        });
      if (node.frameId && !nodesById.has(node.frameId))
        context.addIssue({
          code: "custom",
          message: "Node frame must exist.",
          path: ["nodes", index, "frameId"],
        });
    });
    if (board.zOrder) {
      const unique = new Set(board.zOrder);
      if (
        unique.size !== board.zOrder.length ||
        unique.size !== nodesById.size ||
        board.zOrder.some((nodeId) => !nodesById.has(nodeId))
      )
        context.addIssue({
          code: "custom",
          message: "Z-order may contain each existing node exactly once.",
          path: ["zOrder"],
        });
    }
  });

/**
 * Version 1 stored shape kind inside opaque content, had no section/vote/route
 * defaults, and sometimes omitted z-order entirely. The v2 migration preserves
 * every stable id and geometry value while normalizing only those missing depth
 * fields. Re-running it is deliberately idempotent.
 */
export function migrateWhiteboardContent(
  value: unknown,
  _fromVersion = 1,
): WhiteboardContent {
  return normalizeWhiteboardContent(value);
}
