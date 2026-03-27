"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  Tldraw,
  createShapeId,
  type Editor,
  type TLShapeId,
} from "tldraw";
import "tldraw/tldraw.css";
import { WorkstreamShapeUtil } from "@/lib/workspace/shapes/workstream-shape";
import { HubShapeUtil } from "@/lib/workspace/shapes/hub-shape";
import {
  DEFAULT_WORKSTREAM_SIZE,
  HUB_SIZE,
  radialPosition,
} from "@/lib/workspace/zoom-helpers";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workstream } from "@/hooks/use-workspace-data";

const CUSTOM_SHAPE_UTILS = [WorkstreamShapeUtil, HubShapeUtil];

// Dot-grid background matching the app's design system
function CanvasBackground() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--bg-primary, #13111a)",
        backgroundImage:
          "radial-gradient(circle, var(--border-default, #2d2a3a) 0.8px, transparent 0.8px)",
        backgroundSize: "28px 28px",
      }}
    />
  );
}

type WorkspaceCanvasProps = {
  workstreams: Workstream[];
  userName: string;
  userAvatar: string;
  onWorkstreamUpdate?: (workstreamId: string, data: Partial<Workstream>) => void;
  focusWorkstreamId?: string;
};

export function WorkspaceCanvas({
  workstreams,
  userName,
  userAvatar,
  onWorkstreamUpdate,
  focusWorkstreamId,
}: WorkspaceCanvasProps) {
  const editorRef = useRef<Editor | null>(null);
  const syncedRef = useRef(false);
  const updateTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const { showArchived, showConnections, setCamera } = useWorkspaceStore();
  const mountedRef = useRef(false);

  // Derive active workstreams based on showArchived toggle
  const visibleWorkstreams = showArchived
    ? workstreams
    : workstreams.filter((ws) => ws.status !== "archived");

  const syncShapes = useCallback(
    (editor: Editor) => {
      const existing = editor.getCurrentPageShapes();
      const existingIds = new Set(existing.map((s) => s.id));

      // --- Hub node ---
      const hubId = createShapeId("hub-node");
      if (!existingIds.has(hubId)) {
        editor.createShape({
          id: hubId,
          type: "hub",
          x: -HUB_SIZE.w / 2,
          y: -HUB_SIZE.h / 2,
          props: {
            w: HUB_SIZE.w,
            h: HUB_SIZE.h,
            userName,
            userAvatar,
            upcomingDeadlines: 0,
            recentNotes: 0,
            totalWorkstreams: workstreams.filter((w) => w.status === "active").length,
          },
        } as any);
      } else {
        editor.updateShape({
          id: hubId,
          type: "hub",
          props: {
            userName,
            userAvatar,
            totalWorkstreams: workstreams.filter((w) => w.status === "active").length,
          },
        } as any);
      }

      // --- Workstream islands ---
      const wsShapeIds = new Set<TLShapeId>();

      visibleWorkstreams.forEach((ws, idx) => {
        const shapeId = createShapeId(`ws-${ws._id}`);
        wsShapeIds.add(shapeId);

        const pos =
          ws.canvasX !== undefined && ws.canvasY !== undefined
            ? { x: ws.canvasX, y: ws.canvasY }
            : radialPosition(idx, visibleWorkstreams.length, 380);

        if (!existingIds.has(shapeId)) {
          editor.createShape({
            id: shapeId,
            type: "workstream",
            x: pos.x - DEFAULT_WORKSTREAM_SIZE.w / 2,
            y: pos.y - DEFAULT_WORKSTREAM_SIZE.h / 2,
            props: {
              w: ws.canvasWidth ?? DEFAULT_WORKSTREAM_SIZE.w,
              h: ws.canvasHeight ?? DEFAULT_WORKSTREAM_SIZE.h,
              title: ws.title,
              emoji: ws.emoji || "📚",
              description: ws.description || "",
              workstreamType: ws.type,
              color: ws.color || "#0e8ee8",
              status: ws.status,
              artifactCount: ws.artifactCount ?? 0,
              threadCount: ws.threadCount ?? 0,
              lastActivityAt: ws.lastActivityAt ?? ws.updatedAt,
              workstreamId: ws._id,
              dueDate: "",
            },
          } as any);
        } else {
          // Only update props, do NOT override position (would fight user drags)
          editor.updateShape({
            id: shapeId,
            type: "workstream",
            props: {
              title: ws.title,
              emoji: ws.emoji || "📚",
              description: ws.description || "",
              workstreamType: ws.type,
              color: ws.color || "#0e8ee8",
              status: ws.status,
              artifactCount: ws.artifactCount ?? 0,
              threadCount: ws.threadCount ?? 0,
              lastActivityAt: ws.lastActivityAt ?? ws.updatedAt,
              workstreamId: ws._id,
            },
          } as any);
        }
      });

      // Remove stale workstream shapes
      for (const shape of existing) {
        if ((shape as any).type === "workstream" && !wsShapeIds.has(shape.id)) {
          editor.deleteShape(shape.id);
        }
        // Remove any stale native arrows (from old implementation)
        if (shape.type === "arrow") {
          editor.deleteShape(shape.id);
        }
      }
    },
    [workstreams, visibleWorkstreams, userName, userAvatar],
  );

  const centerOnHub = useCallback((editor: Editor, animated = true) => {
    // Center viewport on hub (at canvas origin 0,0)
    const viewportW = editor.getViewportScreenBounds().w;
    const viewportH = editor.getViewportScreenBounds().h;
    const zoom = editor.getZoomLevel();
    editor.setCamera(
      {
        x: viewportW / 2 / zoom - 0 /* hub center x */,
        y: viewportH / 2 / zoom - 0 /* hub center y */,
        z: zoom,
      },
      animated ? { animation: { duration: 500, easing: (t: number) => 1 - Math.pow(1 - t, 3) } } : { immediate: true },
    );
  }, []);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      syncShapes(editor);
      syncedRef.current = true;
      mountedRef.current = true;

      // Restore camera from localStorage, or default to center on hub at zoom 0.7
      if (!focusWorkstreamId) {
        const viewportBounds = editor.getViewportScreenBounds();
        const defaultCamera = {
          x: viewportBounds.w / 2 / 0.7,
          y: viewportBounds.h / 2 / 0.7,
          z: 0.7,
        };
        try {
          const saved = localStorage.getItem("workspace:camera");
          if (saved) {
            const parsed = JSON.parse(saved) as { x: number; y: number; z: number };
            if (typeof parsed.x === "number" && typeof parsed.y === "number" && typeof parsed.z === "number") {
              editor.setCamera(parsed, { immediate: true });
            } else {
              editor.setCamera(defaultCamera, { immediate: true });
            }
          } else {
            editor.setCamera(defaultCamera, { immediate: true });
          }
        } catch {
          editor.setCamera(defaultCamera, { immediate: true });
        }
      }

      // If a focus workstream was requested (from URL param), zoom to it
      if (focusWorkstreamId) {
        setTimeout(() => {
          const targetId = createShapeId(`ws-${focusWorkstreamId}`);
          const shape = editor.getShape(targetId);
          if (shape) {
            const bounds = editor.getShapePageBounds(shape.id);
            if (bounds) {
              editor.zoomToBounds(bounds, {
                animation: { duration: 500, easing: (t: number) => 1 - Math.pow(1 - t, 3) },
                inset: 60,
              });
            }
          }
        }, 100);
      }

      // Lock to select tool — prevent free drawing/text/draw mode
      editor.setCurrentTool("select");
      const unsubTool = editor.store.listen(
        () => {
          const toolId = editor.getCurrentToolId();
          if (toolId !== "select" && toolId !== "hand") {
            editor.setCurrentTool("select");
          }
          // Delete any non-workstream/hub shapes created by tool activation
          const shapes = editor.getCurrentPageShapes();
          const invalid = shapes.filter((s) => (s as any).type !== "workstream" && (s as any).type !== "hub");
          if (invalid.length > 0) {
            editor.deleteShapes(invalid.map((s) => s.id));
          }
        },
        { source: "user", scope: "all" },
      );

      // Track camera changes — persist to localStorage so reload restores last position
      const unsub = editor.store.listen(
        () => {
          const cam = editor.getCamera();
          setCamera({ x: cam.x, y: cam.y, z: cam.z });
          try {
            localStorage.setItem("workspace:camera", JSON.stringify({ x: cam.x, y: cam.y, z: cam.z }));
          } catch {
            // ignore storage errors
          }
        },
        { source: "user", scope: "all" },
      );

      // Track drag-end position updates for workstream persistence
      let dragTimeout: ReturnType<typeof setTimeout> | null = null;
      const unsubDrag = editor.store.listen(
        (update) => {
          for (const [, record] of Object.entries(update.changes.updated)) {
            const next = record[1] as any;
            const prev = record[0] as any;
            if (
              next.typeName === "shape" &&
              next.type === "workstream" &&
              (prev.x !== next.x || prev.y !== next.y || prev.props?.w !== next.props?.w || prev.props?.h !== next.props?.h)
            ) {
              const wsId = next.props?.workstreamId;
              if (!wsId) continue;

              if (updateTimeoutsRef.current[wsId]) {
                clearTimeout(updateTimeoutsRef.current[wsId]);
              }

              // Debounced persist — only after drag settles
              updateTimeoutsRef.current[wsId] = setTimeout(() => {
                const cx = next.x + (next.props?.w ?? DEFAULT_WORKSTREAM_SIZE.w) / 2;
                const cy = next.y + (next.props?.h ?? DEFAULT_WORKSTREAM_SIZE.h) / 2;
                onWorkstreamUpdate?.(wsId, {
                  canvasX: cx,
                  canvasY: cy,
                  canvasWidth: next.props?.w,
                  canvasHeight: next.props?.h,
                });
              }, 600);
            }
          }
        },
        { source: "user", scope: "all" },
      );

      return () => {
        unsubTool();
        unsub();
        unsubDrag();
        if (dragTimeout) clearTimeout(dragTimeout);
      };
    },
    [syncShapes, setCamera, onWorkstreamUpdate, focusWorkstreamId, centerOnHub],
  );

  // Re-sync when workstreams change (props only, not position)
  useEffect(() => {
    if (editorRef.current && syncedRef.current) {
      syncShapes(editorRef.current);
    }
  }, [syncShapes]);

  // Listen for "workspace:center-hub" from toolbar
  useEffect(() => {
    const handler = () => {
      if (editorRef.current) {
        centerOnHub(editorRef.current, true);
      }
    };
    window.addEventListener("workspace:center-hub", handler);
    return () => window.removeEventListener("workspace:center-hub", handler);
  }, [centerOnHub]);

  // Note: workspace:focus-workstream and workspace:focus-hub events are no longer
  // needed — shapes call useWorkspaceStore directly.

  return (
    <div
      className="workspace-canvas-root"
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
      }}
    >
      <Tldraw
        shapeUtils={CUSTOM_SHAPE_UTILS}
        hideUi
        onMount={handleMount}
        components={{
          Background: CanvasBackground,
        }}
        options={{
          maxPages: 1,
        }}
      />
    </div>
  );
}
