"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BoxSelect,
  CheckCircle2,
  Circle,
  CircleDot,
  Download,
  Eye,
  EyeOff,
  Frame,
  FileUp,
  Grid3X3,
  Group,
  Hand,
  ImagePlus,
  Layers3,
  LayoutTemplate,
  Link2,
  Loader2,
  Lock,
  Maximize2,
  MousePointer2,
  Plus,
  Redo2,
  Search,
  SlidersHorizontal,
  Square,
  StickyNote,
  Table2,
  TextCursorInput,
  Trash2,
  Undo2,
  Ungroup,
  Unlock,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  abortArtifactImportUpload,
  beginArtifactImportOriginal,
  completeArtifactImport,
  getArtifactAssets,
  uploadArtifactImportOriginal,
  uploadArtifactAsset,
  type SpectraArtifact,
  type SpectraArtifactAsset,
} from "../data/api";
import {
  createWhiteboardNode,
  normalizeWhiteboardContent,
  whiteboardNodeText,
  withWhiteboardNodeText,
  type WhiteboardContent,
  type WhiteboardNode,
  type WhiteboardNodeType,
} from "../whiteboard/model";
import {
  buildWhiteboardPackage,
  buildWhiteboardSvg,
  importWhiteboardFile,
} from "../whiteboard/io";
import { uniqueToken } from "@/lib/unique-token";
import { aiRegionAttr, pathTouches } from "./ai-region-path";
import { targetAttrs } from "../collaboration/target-attributes";

type Tool = "select" | "hand" | "connector" | WhiteboardNodeType;
type Drag = {
  mode: "node" | "pan" | "resize";
  pointerId: number;
  nodeId?: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth?: number;
  startHeight?: number;
  nodeStarts?: Record<string, { x: number; y: number }>;
  snapshot: WhiteboardContent;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function styleValue(
  node: WhiteboardNode,
  key: string,
  fallback: string | number,
) {
  const value = node.style?.[key];
  return typeof value === "string" || typeof value === "number"
    ? value
    : fallback;
}

async function sha256Blob(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function BoardNode({
  node,
  artifact,
  asset,
  selected,
  aiActive,
  readOnly,
  compact,
  onSelect,
  onPointerDown,
  onResizePointerDown,
  onTextChange,
  onContentChange,
  path,
}: {
  node: WhiteboardNode;
  artifact?: SpectraArtifact;
  asset?: SpectraArtifactAsset;
  selected: boolean;
  aiActive: boolean;
  readOnly: boolean;
  compact: boolean;
  onSelect: (additive: boolean) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onTextChange: (value: string) => void;
  onContentChange: (change: Record<string, unknown>) => void;
  /** Canonical pointer for this node, e.g. `/nodes/3`. */
  path?: string;
}) {
  const [editingText, setEditingText] = useState(false);
  const nodeElementRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) setEditingText(false);
  }, [selected]);
  if (node.hidden) return null;
  const content =
    node.content &&
    typeof node.content === "object" &&
    !Array.isArray(node.content)
      ? (node.content as Record<string, unknown>)
      : {};
  const beginTextEditing = (
    event: ReactMouseEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (readOnly || node.locked || compact) return;
    event.preventDefault();
    event.stopPropagation();
    setEditingText(true);
    const control = event.currentTarget;
    window.requestAnimationFrame(() => {
      control.focus();
      control.setSelectionRange(control.value.length, control.value.length);
    });
  };
  const textPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    // Select-mode follows the familiar canvas contract: drag anywhere on an
    // object to move it; double-click its text to enter editing. Once editing,
    // pointer gestures belong to the native input for caret/selection.
    if (editingText) event.stopPropagation();
  };
  const enterTextEditing = () => {
    if (readOnly || node.locked || compact) return;
    setEditingText(true);
    window.requestAnimationFrame(() => {
      const control =
        nodeElementRef.current?.querySelector<
          HTMLInputElement | HTMLTextAreaElement
        >("input, textarea");
      if (!control) return;
      control.focus();
      control.setSelectionRange(control.value.length, control.value.length);
    });
  };
  return (
    <div
      ref={nodeElementRef}
      className="whiteboard-node"
      data-ai-region={aiRegionAttr(aiActive)}
      {...(path ? targetAttrs(path) : {})}
      data-type={node.type}
      data-selected={selected || undefined}
      data-locked={node.locked || undefined}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        zIndex: node.zIndex,
        transform: `rotate(${node.rotation}deg)`,
        background: String(
          styleValue(
            node,
            "fill",
            typeof content.fill === "string"
              ? content.fill
              : node.type === "note"
                ? "#fff3c9"
                : "#ffffff",
          ),
        ),
        borderColor: String(
          styleValue(
            node,
            "stroke",
            typeof content.stroke === "string"
              ? content.stroke
              : "#d5d7d2",
          ),
        ),
        borderWidth: Number(
          styleValue(
            node,
            "strokeWidth",
            typeof content.strokeWidth === "number"
              ? content.strokeWidth
              : 1,
          ),
        ),
        borderRadius: Number(
          styleValue(
            node,
            "borderRadius",
            typeof content.borderRadius === "number"
              ? content.borderRadius
              : 11,
          ),
        ),
        color: String(
          styleValue(
            node,
            "color",
            typeof content.textColor === "string"
              ? content.textColor
              : typeof content.color === "string"
                ? content.color
                : "#29352f",
          ),
        ),
      }}
      onClick={(event) => {
        event.stopPropagation();
        const textControl = (event.target as Element).closest<
          HTMLInputElement | HTMLTextAreaElement
        >("input, textarea");
        if (
          selected &&
          event.detail >= 2 &&
          textControl &&
          event.currentTarget.contains(textControl) &&
          !readOnly &&
          !node.locked &&
          !compact
        ) {
          setEditingText(true);
          window.requestAnimationFrame(() => {
            textControl.focus();
            textControl.setSelectionRange(
              textControl.value.length,
              textControl.value.length,
            );
          });
        }
        onSelect(event.shiftKey);
      }}
      onPointerDown={onPointerDown}
    >
      {node.type === "frame" ? (
        <span className="whiteboard-frame-title">
          {String(content.title ?? "Frame")}
        </span>
      ) : node.type === "embed" ? (
        <div
          className="whiteboard-embed-node"
          data-unavailable={!artifact || undefined}
        >
          <Link2 className="h-4 w-4" />
          <strong>{artifact?.title ?? "Access unavailable"}</strong>
          <small>
            {artifact?.blueprintKey.replaceAll("_", " ") ??
              "Source permission changed"}
          </small>
        </div>
      ) : node.type === "table" ? (
        <table>
          <tbody>
            {(Array.isArray(content.rows) ? content.rows : []).map(
              (row, rowIndex) => (
                <tr key={rowIndex}>
                  {(Array.isArray(row) ? row : []).map((cell, cellIndex) => (
                    <td key={cellIndex}>{String(cell)}</td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>
      ) : node.type === "image" ? (
        asset?.downloadUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.downloadUrl}
            alt={node.semanticLabel ?? ""}
            draggable={false}
          />
        ) : (
          <div className="whiteboard-empty-media">
            <ImagePlus className="h-5 w-5" />
            Image unavailable
          </div>
        )
      ) : node.type === "group" ? (
        <span className="whiteboard-group-label">Group</span>
      ) : node.type === "card" &&
        (typeof content.header === "string" ||
          typeof content.body === "string") ? (
        <div className="whiteboard-card-node">
          <input
            {...(path ? targetAttrs(`${path}/content/header`) : {})}
            value={String(content.header ?? "")}
            readOnly={readOnly || node.locked || compact || !editingText}
            aria-label={`${node.semanticLabel || "Card"} title`}
            onPointerDown={textPointerDown}
            onDoubleClick={beginTextEditing}
            onFocus={() => onSelect(false)}
            onChange={(event) =>
              onContentChange({ header: event.target.value })
            }
            style={{
              background:
                typeof content.headerBg === "string"
                  ? content.headerBg
                  : "#3f5f72",
              color:
                typeof content.headerColor === "string"
                  ? content.headerColor
                  : "#ffffff",
            }}
          />
          <textarea
            {...(path ? targetAttrs(`${path}/content/body`) : {})}
            value={String(content.body ?? "")}
            readOnly={readOnly || node.locked || compact || !editingText}
            aria-label={`${node.semanticLabel || "Card"} body`}
            onPointerDown={textPointerDown}
            onDoubleClick={beginTextEditing}
            onFocus={() => onSelect(false)}
            onChange={(event) =>
              onContentChange({ body: event.target.value })
            }
            style={{
              color:
                typeof content.bodyColor === "string"
                  ? content.bodyColor
                  : "inherit",
              fontSize:
                typeof content.fontSize === "number"
                  ? content.fontSize
                  : 13,
            }}
          />
        </div>
      ) : (
        <textarea
          {...(path ? targetAttrs(`${path}/content/text`) : {})}
          value={whiteboardNodeText(node)}
          readOnly={readOnly || node.locked || compact || !editingText}
          aria-label={node.semanticLabel || `${node.type} text`}
          onPointerDown={textPointerDown}
          onDoubleClick={beginTextEditing}
          onFocus={() => onSelect(false)}
          onChange={(event) => onTextChange(event.target.value)}
          style={{
            fontSize: Number(
              styleValue(
                node,
                "fontSize",
                typeof content.fontSize === "number"
                  ? content.fontSize
                  : node.type === "text"
                    ? 30
                    : 14,
              ),
            ),
            fontWeight: Number(
              styleValue(
                node,
                "fontWeight",
                typeof content.fontWeight === "number"
                  ? content.fontWeight
                  : content.fontWeight === "bold"
                    ? 700
                    : node.type === "text"
                      ? 650
                      : 500,
              ),
            ),
            fontStyle:
              content.fontStyle === "italic" ? "italic" : undefined,
            textAlign:
              content.textAlign === "left" ||
              content.textAlign === "right" ||
              content.textAlign === "center"
                ? content.textAlign
                : node.type === "shape"
                  ? "center"
                  : undefined,
          }}
        />
      )}
      {selected &&
      !readOnly &&
      !compact &&
      !editingText &&
      node.type !== "frame" &&
      node.type !== "group" &&
      node.type !== "image" &&
      node.type !== "embed" &&
      node.type !== "table" ? (
        <button
          type="button"
          className="whiteboard-node-edit"
          aria-label="Edit object text"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(false);
            enterTextEditing();
          }}
        >
          <TextCursorInput className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {selected &&
      !readOnly &&
      !compact &&
      node.type !== "frame" &&
      node.type !== "group" ? (
        <button
          type="button"
          className="whiteboard-node-resize"
          aria-label="Resize object"
          {...(path ? targetAttrs(path, "handle:se") : {})}
          onPointerDown={onResizePointerDown}
        />
      ) : null}
    </div>
  );
}

export function WhiteboardStudio({
  artifactId,
  artifacts,
  content,
  onChange,
  aiChangedPaths = [],
  readOnly,
  synchronizationReady: _synchronizationReady = true,
  syncMessage = "Auto-saved",
  onActiveRegionChange,
}: {
  artifactId: string;
  artifacts: SpectraArtifact[];
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  readOnly: boolean;
  synchronizationReady?: boolean;
  syncMessage?: string;
  onActiveRegionChange?: (regionId: string) => void;
}) {
  const board = useMemo(() => normalizeWhiteboardContent(content), [content]);
  // Viewport is personal presence, never shared artifact content. Panning or
  // zooming in one differently-sized pane must not move every collaborator.
  const [viewport, setViewport] = useState(board.viewport);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const selectedNodeId = selectedNodeIds.at(-1);
  const setSelectedNodeId = useCallback((nodeId?: string) => {
    setSelectedNodeIds(nodeId ? [nodeId] : []);
  }, []);
  const [connectorFrom, setConnectorFrom] = useState<string>();
  const [panel, setPanel] = useState<
    "none" | "layers" | "outline" | "templates" | "search"
  >("none");
  const [search, setSearch] = useState("");
  const [undo, setUndo] = useState<WhiteboardContent[]>([]);
  const [redo, setRedo] = useState<WhiteboardContent[]>([]);
  const [presenting, setPresenting] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [assets, setAssets] = useState<SpectraArtifactAsset[]>([]);
  const [assetError, setAssetError] = useState<string>();
  const [uploadingImage, setUploadingImage] = useState(false);
  const [ioNotice, setIoNotice] = useState<string>();
  const [ioBusy, setIoBusy] = useState<string>();
  const [canvasSize, setCanvasSize] = useState({ width: 1280, height: 800 });
  const dragRef = useRef<Drag | undefined>(undefined);
  const canvasRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const boardInputRef = useRef<HTMLInputElement>(null);
  const selectionHandledRef = useRef(false);
  const page =
    board.pages.find((candidate) => candidate.id === viewport.pageId) ??
    board.pages[0]!;
  const layers = board.layers.filter((layer) => layer.pageId === page.id);
  const visibleLayerIds = new Set(
    layers.filter((layer) => layer.visible).map((layer) => layer.id),
  );
  const nodes = board.nodes.filter(
    (node) => node.pageId === page.id && visibleLayerIds.has(node.layerId),
  );
  const edges = board.edges.filter(
    (edge) => edge.pageId === page.id && visibleLayerIds.has(edge.layerId),
  );
  const renderedNodes = useMemo(() => {
    const margin = 520 / Math.max(viewport.zoom, 0.05);
    const left = viewport.x - margin;
    const top = viewport.y - margin;
    const right =
      viewport.x + canvasSize.width / viewport.zoom + margin;
    const bottom =
      viewport.y + canvasSize.height / viewport.zoom + margin;
    return nodes.filter(
      (node) =>
        node.x + node.width >= left &&
        node.y + node.height >= top &&
        node.x <= right &&
        node.y <= bottom,
    );
  }, [
    viewport.x,
    viewport.y,
    viewport.zoom,
    canvasSize.height,
    canvasSize.width,
    nodes,
  ]);
  const renderedNodeIds = useMemo(
    () => new Set(renderedNodes.map((node) => node.id)),
    [renderedNodes],
  );
  const renderedEdges = useMemo(
    () =>
      edges.filter(
        (edge) =>
          renderedNodeIds.has(edge.from) || renderedNodeIds.has(edge.to),
      ),
    [edges, renderedNodeIds],
  );
  const nodeIndexById = useMemo(
    () => new Map(board.nodes.map((node, index) => [node.id, index])),
    [board.nodes],
  );
  const edgeIndexById = useMemo(
    () => new Map(board.edges.map((edge, index) => [edge.id, index])),
    [board.edges],
  );
  const selectedNode = board.nodes.find((node) => node.id === selectedNodeId);
  const selectedNodes = board.nodes.filter((node) =>
    selectedNodeIds.includes(node.id),
  );
  const artifactMap = new Map(
    artifacts.map((artifact) => [artifact._id, artifact]),
  );
  const assetMap = new Map(assets.map((asset) => [asset.assetId, asset]));

  useEffect(() => {
    if (!selectedNodeId) setInspectorOpen(false);
  }, [selectedNodeId]);

  useEffect(() => {
    setViewport(board.viewport);
  }, [artifactId, board.viewport]);

  useEffect(() => {
    let active = true;
    void getArtifactAssets(artifactId)
      .then((result) => {
        if (active) setAssets(result.assets);
      })
      .catch((error: unknown) => {
        if (active)
          setAssetError(
            error instanceof Error
              ? error.message
              : "Board media is unavailable.",
          );
      });
    return () => {
      active = false;
    };
  }, [artifactId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const update = () =>
      setCanvasSize({
        width: Math.max(1, canvas.clientWidth),
        height: Math.max(1, canvas.clientHeight),
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const emit = useCallback(
    (next: WhiteboardContent, record = true) => {
      if (readOnly) return;
      if (record) {
        setUndo((stack) => [...stack.slice(-79), clone(board)]);
        setRedo([]);
      }
      onChange(next);
    },
    [board, onChange, readOnly],
  );
  const mutate = useCallback(
    (recipe: (draft: WhiteboardContent) => void, record = true) => {
      const next = clone(board);
      recipe(next);
      emit(next, record);
    },
    [board, emit],
  );
  const worldPoint = (clientX: number, clientY: number) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    return {
      x:
        (clientX - (bounds?.left ?? 0)) / viewport.zoom +
        viewport.x,
      y:
        (clientY - (bounds?.top ?? 0)) / viewport.zoom + viewport.y,
    };
  };
  const snap = (value: number) =>
    board.settings?.snapToGrid === false
      ? value
      : Math.round(value / (board.settings?.gridSize ?? 24)) *
        (board.settings?.gridSize ?? 24);

  function addNode(type: WhiteboardNodeType, x?: number, y?: number) {
    const layer = layers.find(
      (candidate) => !candidate.locked && candidate.visible,
    );
    if (!layer || readOnly) return;
    const center = worldPoint(
      (canvasRef.current?.getBoundingClientRect().left ?? 0) +
        (canvasRef.current?.clientWidth ?? 800) / 2,
      (canvasRef.current?.getBoundingClientRect().top ?? 0) +
        (canvasRef.current?.clientHeight ?? 600) / 2,
    );
    const node = createWhiteboardNode(
      type,
      page.id,
      layer.id,
      snap(x ?? center.x - 120),
      snap(y ?? center.y - 75),
      board.nodes.length + 1,
    );
    mutate((draft) => draft.nodes.push(node));
    setSelectedNodeId(node.id);
    onActiveRegionChange?.(node.id);
    setTool("select");
  }
  function canvasClick(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".whiteboard-node")) return;
    if (tool === "select" || tool === "hand" || tool === "connector") {
      setSelectedNodeId(undefined);
      setConnectorFrom(undefined);
      return;
    }
    const point = worldPoint(event.clientX, event.clientY);
    addNode(tool, point.x - 120, point.y - 75);
  }
  function selectNode(node: WhiteboardNode, additive = false) {
    if (tool === "connector") {
      if (!connectorFrom) {
        setConnectorFrom(node.id);
        return;
      }
      if (connectorFrom !== node.id) {
        const layer = layers.find(
          (candidate) => !candidate.locked && candidate.visible,
        );
        if (layer)
          mutate((draft) =>
            draft.edges.push({
              id: `edge-${Date.now().toString(36)}`,
              pageId: page.id,
              layerId: layer.id,
              from: connectorFrom,
              to: node.id,
              zIndex: -1,
            }),
          );
      }
      setConnectorFrom(undefined);
      setTool("select");
      return;
    }
    setSelectedNodeIds((current) =>
      additive
        ? current.includes(node.id)
          ? current.filter((id) => id !== node.id)
          : [...current, node.id]
        : [node.id],
    );
    onActiveRegionChange?.(node.id);
  }
  function beginNodeDrag(
    node: WhiteboardNode,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (
      readOnly ||
      node.locked ||
      tool !== "select" ||
      layers.find((layer) => layer.id === node.layerId)?.locked
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    selectionHandledRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.shiftKey) {
      setSelectedNodeIds((current) =>
        current.includes(node.id)
          ? current.filter((id) => id !== node.id)
          : [...current, node.id],
      );
      return;
    }
    const movingIds = selectedNodeIds.includes(node.id)
      ? selectedNodeIds
      : [node.id];
    const movingNodeIds = new Set(movingIds);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const candidate of board.nodes)
        if (
          candidate.parentId &&
          movingNodeIds.has(candidate.parentId) &&
          !movingNodeIds.has(candidate.id)
        ) {
          movingNodeIds.add(candidate.id);
          expanded = true;
        }
    }
    setSelectedNodeIds(movingIds);
    dragRef.current = {
      mode: "node",
      pointerId: event.pointerId,
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: node.x,
      startY: node.y,
      nodeStarts: Object.fromEntries(
        board.nodes
          .filter((candidate) => movingNodeIds.has(candidate.id))
          .map((candidate) => [
            candidate.id,
            { x: candidate.x, y: candidate.y },
          ]),
      ),
      snapshot: clone(board),
    };
  }
  function beginResize(
    node: WhiteboardNode,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (
      readOnly ||
      node.locked ||
      layers.find((layer) => layer.id === node.layerId)?.locked
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode: "resize",
      pointerId: event.pointerId,
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: node.x,
      startY: node.y,
      startWidth: node.width,
      startHeight: node.height,
      snapshot: clone(board),
    };
  }
  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      (event.target as HTMLElement).closest(".whiteboard-node") ||
      (tool !== "hand" && event.button !== 1)
    )
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode: "pan",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: viewport.x,
      startY: viewport.y,
      snapshot: clone(board),
    };
  }
  function movePointer(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.mode === "pan")
      setViewport((current) => ({
        ...current,
        x:
          drag.startX -
          (event.clientX - drag.startClientX) / current.zoom,
        y:
          drag.startY -
          (event.clientY - drag.startClientY) / current.zoom,
      }));
    else if (drag.mode === "resize")
      mutate((draft) => {
        const node = draft.nodes.find(
          (candidate) => candidate.id === drag.nodeId,
        );
        if (node) {
          node.width = Math.max(
            48,
            snap(
              (drag.startWidth ?? node.width) +
                (event.clientX - drag.startClientX) / viewport.zoom,
            ),
          );
          node.height = Math.max(
            40,
            snap(
              (drag.startHeight ?? node.height) +
                (event.clientY - drag.startClientY) / viewport.zoom,
            ),
          );
        }
      }, false);
    else
      mutate((draft) => {
        const deltaX =
          (event.clientX - drag.startClientX) / viewport.zoom;
        const deltaY =
          (event.clientY - drag.startClientY) / viewport.zoom;
        for (const [nodeId, start] of Object.entries(drag.nodeStarts ?? {})) {
          const node = draft.nodes.find((candidate) => candidate.id === nodeId);
          if (!node || node.locked) continue;
          node.x = snap(start.x + deltaX);
          node.y = snap(start.y + deltaY);
        }
      }, false);
  }
  function finishPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    setUndo((stack) => [...stack.slice(-79), drag.snapshot]);
    setRedo([]);
  }
  function wheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && Math.abs(event.deltaY) < Math.abs(event.deltaX))
      return;
    event.preventDefault();
    const before = worldPoint(event.clientX, event.clientY);
    const zoom = Math.max(
      0.1,
      Math.min(4, viewport.zoom * Math.exp(-event.deltaY * 0.0015)),
    );
    const bounds = event.currentTarget.getBoundingClientRect();
    setViewport((current) => ({
      ...current,
      zoom,
      x: before.x - (event.clientX - bounds.left) / zoom,
      y: before.y - (event.clientY - bounds.top) / zoom,
    }));
  }
  function undoAction() {
    const previous = undo.at(-1);
    if (!previous || readOnly) return;
    setUndo((stack) => stack.slice(0, -1));
    setRedo((stack) => [...stack.slice(-79), clone(board)]);
    onChange(previous);
  }
  function redoAction() {
    const next = redo.at(-1);
    if (!next || readOnly) return;
    setRedo((stack) => stack.slice(0, -1));
    setUndo((stack) => [...stack.slice(-79), clone(board)]);
    onChange(next);
  }
  function updateSelected(recipe: (node: WhiteboardNode) => void) {
    if (!selectedNodeId) return;
    mutate((draft) => {
      const node = draft.nodes.find(
        (candidate) => candidate.id === selectedNodeId,
      );
      if (node) recipe(node);
    });
  }
  function deleteSelected() {
    if (!selectedNodeIds.length) return;
    const removing = new Set(selectedNodeIds);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const node of board.nodes)
        if (
          node.parentId &&
          removing.has(node.parentId) &&
          !removing.has(node.id)
        ) {
          removing.add(node.id);
          expanded = true;
        }
    }
    mutate((draft) => {
      draft.nodes = draft.nodes.filter((node) => !removing.has(node.id));
      draft.edges = draft.edges.filter(
        (edge) => !removing.has(edge.from) && !removing.has(edge.to),
      );
    });
    setSelectedNodeIds([]);
  }

  function alignSelected(mode: "left" | "center" | "right") {
    const editable = selectedNodes.filter(
      (node) =>
        !node.locked &&
        !layers.find((layer) => layer.id === node.layerId)?.locked,
    );
    if (editable.length < 2) return;
    const left = Math.min(...editable.map((node) => node.x));
    const right = Math.max(...editable.map((node) => node.x + node.width));
    const center = (left + right) / 2;
    const ids = new Set(editable.map((node) => node.id));
    mutate((draft) => {
      for (const node of draft.nodes) {
        if (!ids.has(node.id)) continue;
        node.x =
          mode === "left"
            ? left
            : mode === "right"
              ? right - node.width
              : center - node.width / 2;
      }
    });
  }

  function distributeSelected() {
    const editable = selectedNodes
      .filter(
        (node) =>
          !node.locked &&
          !layers.find((layer) => layer.id === node.layerId)?.locked,
      )
      .sort((left, right) => left.x - right.x);
    if (editable.length < 3) return;
    const first = editable[0]!;
    const last = editable.at(-1)!;
    const totalWidth = editable.reduce((total, node) => total + node.width, 0);
    const gap =
      (last.x + last.width - first.x - totalWidth) / (editable.length - 1);
    const positions = new Map<string, number>();
    let cursor = first.x;
    editable.forEach((node) => {
      positions.set(node.id, cursor);
      cursor += node.width + gap;
    });
    mutate((draft) => {
      for (const node of draft.nodes) {
        const x = positions.get(node.id);
        if (x !== undefined) node.x = x;
      }
    });
  }

  function groupSelected() {
    const candidates = selectedNodes.filter(
      (node) => node.type !== "group" && !node.locked,
    );
    if (candidates.length < 2) return;
    const layerId = candidates[0]!.layerId;
    if (candidates.some((node) => node.layerId !== layerId)) {
      setAssetError("Move objects to one layer before grouping them.");
      return;
    }
    const x = Math.min(...candidates.map((node) => node.x)) - 12;
    const y = Math.min(...candidates.map((node) => node.y)) - 12;
    const right = Math.max(...candidates.map((node) => node.x + node.width));
    const bottom = Math.max(...candidates.map((node) => node.y + node.height));
    const groupId = `group-${crypto.randomUUID()}`;
    const selected = new Set(candidates.map((node) => node.id));
    mutate((draft) => {
      draft.nodes.push({
        id: groupId,
        type: "group",
        pageId: page.id,
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
      for (const node of draft.nodes)
        if (selected.has(node.id)) node.parentId = groupId;
    });
    setSelectedNodeIds([groupId]);
    onActiveRegionChange?.(groupId);
  }

  function ungroupSelected() {
    const groups = selectedNodes.filter((node) => node.type === "group");
    if (!groups.length) return;
    const groupIds = new Set(groups.map((node) => node.id));
    const childIds = board.nodes
      .filter((node) => node.parentId && groupIds.has(node.parentId))
      .map((node) => node.id);
    mutate((draft) => {
      draft.nodes = draft.nodes.filter((node) => !groupIds.has(node.id));
      for (const node of draft.nodes)
        if (node.parentId && groupIds.has(node.parentId))
          node.parentId = undefined;
    });
    setSelectedNodeIds(childIds);
  }
  const setZoom = (zoom: number) =>
    setViewport((current) => ({
      ...current,
      zoom: Math.max(0.1, Math.min(4, zoom)),
    }));

  async function insertImage(file: File) {
    if (readOnly) return;
    if (!file.type.startsWith("image/")) {
      setAssetError("Choose an image file.");
      return;
    }
    if (file.type === "image/svg+xml" || /\.svgz?$/i.test(file.name)) {
      setAssetError(
        "Use Import board for SVG files so active content and external resources can be quarantined before conversion.",
      );
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setAssetError("This image exceeds the 100 MB technical safety ceiling.");
      return;
    }
    setAssetError(undefined);
    setUploadingImage(true);
    try {
      const uploaded = await uploadArtifactAsset({
        artifactId,
        path: `whiteboard/${uniqueToken()}-${file.name}`,
        name: file.name,
        mediaType: file.type || "application/octet-stream",
        sha256: await sha256Blob(file),
        blob: file,
      });
      const layer = layers.find(
        (candidate) => !candidate.locked && candidate.visible,
      );
      if (!layer)
        throw new Error("Unlock a visible layer before adding media.");
      const bounds = canvasRef.current?.getBoundingClientRect();
      const center = worldPoint(
        (bounds?.left ?? 0) + (bounds?.width ?? 800) / 2,
        (bounds?.top ?? 0) + (bounds?.height ?? 600) / 2,
      );
      const node = createWhiteboardNode(
        "image",
        page.id,
        layer.id,
        snap(center.x - 160),
        snap(center.y - 110),
        board.nodes.length + 1,
      );
      node.width = 320;
      node.height = 220;
      node.content = { assetId: uploaded.assetId, name: file.name };
      node.semanticLabel = file.name.replace(/\.[^.]+$/, "");
      mutate((draft) => draft.nodes.push(node));
      setSelectedNodeId(node.id);
      const refreshed = await getArtifactAssets(artifactId);
      setAssets(refreshed.assets);
    } catch (error) {
      setAssetError(
        error instanceof Error
          ? error.message
          : "The image could not be added.",
      );
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  function downloadBlob(name: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function downloadBoard(name: string, type: string, body: string) {
    downloadBlob(name, new Blob([body], { type }));
  }

  function exportScope() {
    if (selectedNode?.type !== "frame") return undefined;
    return new Set([
      selectedNode.id,
      ...board.nodes
        .filter(
          (node) =>
            node.frameId === selectedNode.id ||
            node.parentId === selectedNode.id,
        )
        .map((node) => node.id),
    ]);
  }

  function exportName(extension: string) {
    const scopeName =
      selectedNode?.type === "frame"
        ? selectedNode.semanticLabel || "frame"
        : page.name || "whiteboard";
    return `${scopeName.replace(/[^a-z0-9_-]+/gi, "-") || "whiteboard"}.${extension}`;
  }

  function currentExportSvg() {
    return buildWhiteboardSvg(board, page.id, exportScope());
  }

  async function rasterizeSvg(svg: string) {
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const viewBox = parsed.documentElement
      .getAttribute("viewBox")
      ?.trim()
      .split(/\s+/)
      .map(Number);
    if (
      !viewBox ||
      viewBox.length !== 4 ||
      viewBox.some((value) => !Number.isFinite(value))
    )
      throw new Error("The export canvas has invalid dimensions.");
    const [, , sourceWidth, sourceHeight] = viewBox;
    const scale = Math.min(2, 8192 / Math.max(sourceWidth, sourceHeight), 1.5);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("This browser cannot render the board export.");
    const sourceUrl = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
    );
    try {
      const image = new Image();
      image.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () =>
          reject(new Error("The board could not be rasterized."));
        image.src = sourceUrl;
      });
      context.drawImage(image, 0, 0, width, height);
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
    return { canvas, width, height };
  }

  async function exportBoard(format: "package" | "svg" | "png" | "pdf") {
    setIoNotice(undefined);
    setIoBusy(
      `Preparing ${format === "package" ? "portable package" : format.toUpperCase()}`,
    );
    try {
      if (format === "package") {
        downloadBoard(
          "spectra-whiteboard.spectra-board.json",
          "application/json;charset=utf-8",
          buildWhiteboardPackage(board),
        );
      } else if (format === "svg") {
        downloadBoard(
          exportName("svg"),
          "image/svg+xml;charset=utf-8",
          currentExportSvg(),
        );
      } else {
        const { canvas, width, height } =
          await rasterizeSvg(currentExportSvg());
        if (format === "png") {
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (value) =>
                value
                  ? resolve(value)
                  : reject(new Error("PNG encoding failed.")),
              "image/png",
            ),
          );
          downloadBlob(exportName("png"), blob);
        } else {
          const { jsPDF } = await import("jspdf");
          const orientation = width >= height ? "landscape" : "portrait";
          const pdf = new jsPDF({
            orientation,
            unit: "px",
            format: [width, height],
            hotfixes: ["px_scaling"],
          });
          pdf.addImage(
            canvas.toDataURL("image/png"),
            "PNG",
            0,
            0,
            width,
            height,
          );
          pdf.save(exportName("pdf"));
        }
      }
      setIoNotice(
        selectedNode?.type === "frame"
          ? `Exported the selected frame as ${format.toUpperCase()}.`
          : `Exported ${page.name} as ${format.toUpperCase()}.`,
      );
    } catch (error) {
      setIoNotice(
        error instanceof Error
          ? error.message
          : "The board could not be exported.",
      );
    } finally {
      setIoBusy(undefined);
    }
  }

  async function importPdfPages(
    file: File,
    content: WhiteboardContent,
    pageId: string,
    layerId: string,
    importJobId: string,
  ) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdfDocument = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      useWorkerFetch: false,
      disableFontFace: true,
    }).promise;
    if (pdfDocument.numPages > 100) {
      await pdfDocument.destroy();
      throw new Error("PDF whiteboard imports are limited to 100 pages.");
    }
    const next = clone(content);
    const importedNodes: WhiteboardNode[] = [];
    try {
      for (
        let pageNumber = 1;
        pageNumber <= pdfDocument.numPages;
        pageNumber += 1
      ) {
        setIoBusy(
          `Rendering PDF page ${pageNumber} of ${pdfDocument.numPages}`,
        );
        const pdfPage = await pdfDocument.getPage(pageNumber);
        const naturalViewport = pdfPage.getViewport({ scale: 1 });
        const renderScale = Math.min(
          2,
          1600 / Math.max(1, naturalViewport.width),
        );
        const renderViewport = pdfPage.getViewport({ scale: renderScale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("This browser cannot render PDF pages.");
        await pdfPage.render({
          canvas,
          canvasContext: context,
          viewport: renderViewport,
        }).promise;
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value
                ? resolve(value)
                : reject(new Error("A PDF page could not be encoded.")),
            "image/png",
          ),
        );
        const name = `${file.name.replace(/\.pdf$/i, "")}-page-${pageNumber}.png`;
        const uploaded = await uploadArtifactAsset({
          artifactId,
          path: `imports/${importJobId}/pdf-pages/${name}`,
          name,
          mediaType: "image/png",
          sha256: await sha256Blob(blob),
          blob,
        });
        const displayWidth = 480;
        const displayHeight = Math.max(
          180,
          Math.round(
            displayWidth * (renderViewport.height / renderViewport.width),
          ),
        );
        const column = (pageNumber - 1) % 3;
        const row = Math.floor((pageNumber - 1) / 3);
        const node = createWhiteboardNode(
          "image",
          pageId,
          layerId,
          80 + column * 540,
          80 + row * (displayHeight + 70),
          next.nodes.length + importedNodes.length + 1,
        );
        node.id = `pdf-${crypto.randomUUID()}`;
        node.width = displayWidth;
        node.height = displayHeight;
        node.content = { assetId: uploaded.assetId, name };
        node.semanticLabel = `${file.name}, page ${pageNumber}`;
        node.provenance = {
          source: "PDF page import",
          sourceId: importJobId,
          createdAt: Date.now(),
        };
        importedNodes.push(node);
      }
    } finally {
      await pdfDocument.destroy();
    }
    next.nodes.push(...importedNodes);
    const refreshed = await getArtifactAssets(artifactId);
    setAssets(refreshed.assets);
    return {
      content: next,
      format: "pdf" as const,
      importedNodes: importedNodes.length,
      warnings: [
        "PDF pages were preserved visually as native board images; text, vectors, annotations, links, and layers are not independently editable.",
      ],
    };
  }

  async function importBoard(file: File) {
    if (readOnly) return;
    const layer = layers.find(
      (candidate) => candidate.visible && !candidate.locked,
    );
    if (!layer) {
      setIoNotice("Unlock a visible layer before importing board content.");
      return;
    }
    setIoNotice(undefined);
    setIoBusy("Retaining the original board");
    let jobId: string | undefined;
    try {
      if (file.size < 1 || file.size > 40 * 1024 * 1024)
        throw new Error("Board import must be between 1 byte and 40 MB.");
      const format = file.name.split(".").at(-1)?.toLowerCase() || "unknown";
      const beginning = await beginArtifactImportOriginal({
        artifactId,
        typeKey: "whiteboard",
        format,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: file.size,
        sha256: await sha256Blob(file),
      });
      jobId = beginning.jobId;
      try {
        await uploadArtifactImportOriginal(jobId, file);
      } catch (error) {
        await abortArtifactImportUpload(
          jobId,
          error instanceof Error ? error.message : "Original upload failed.",
        ).catch(() => undefined);
        throw error;
      }
      setIoBusy("Converting editable board objects");
      const imported =
        format === "pdf"
          ? await importPdfPages(file, board, page.id, layer.id, jobId)
          : await importWhiteboardFile(file, board, page.id, layer.id);
      const fidelityReport = imported.warnings.length
        ? imported.warnings.map((message) => ({
            scope: imported.format === "csv" ? "Sticky grid" : "Board objects",
            level: "adapted" as const,
            message,
          }))
        : [
            {
              scope: "Native board structure",
              level: "exact" as const,
              message:
                "Pages, layers, objects, connectors, and settings were retained as native Spectra data.",
            },
          ];
      const unsupportedFeatures =
        imported.format === "svg"
          ? [
              "SVG paths",
              "gradients",
              "masks",
              "external fonts",
              "connector semantics",
            ]
          : imported.format === "pdf"
            ? [
                "editable PDF text",
                "PDF vectors",
                "annotations",
                "links",
                "layers",
              ]
            : imported.format === "csv"
              ? ["connectors", "geometry", "comments", "styles"]
              : [];
      await completeArtifactImport({
        jobId,
        typeKey: "whiteboard",
        status: "imported",
        fidelityReport,
        unsupportedFeatures,
        importedContent: imported.content,
      });
      emit(imported.content);
      setSelectedNodeIds([]);
      setIoNotice(
        `Imported ${imported.importedNodes.toLocaleString()} native object${imported.importedNodes === 1 ? "" : "s"} from ${file.name}.${imported.warnings.length ? ` Fidelity report: ${imported.warnings.join(" ")}` : " Full native board structure was retained."}`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The board file could not be read.";
      if (jobId)
        await completeArtifactImport({
          jobId,
          typeKey: "whiteboard",
          status: "quarantined",
          fidelityReport: [
            {
              scope: "Safety and conversion",
              level: "unsupported",
              message,
            },
          ],
          unsupportedFeatures: ["Unsafe or unsupported source content"],
          quarantineReason: message,
        }).catch(() => undefined);
      setIoNotice(
        `Import quarantined: ${message} The original was retained and the current board was left unchanged.`,
      );
    } finally {
      setIoBusy(undefined);
      if (boardInputRef.current) boardInputRef.current.value = "";
    }
  }

  function addPage() {
    const token = Date.now().toString(36);
    const pageId = `page-${token}`;
    mutate((draft) => {
      draft.pages.push({ id: pageId, name: `Page ${draft.pages.length + 1}` });
      draft.layers.push({
        id: `layer-${token}`,
        pageId,
        name: "Canvas",
        visible: true,
        locked: false,
      });
    });
    setViewport({ pageId, x: 0, y: 0, zoom: 1 });
  }

  function addLayer() {
    const token = Date.now().toString(36);
    mutate((draft) =>
      draft.layers.push({
        id: `layer-${token}`,
        pageId: page.id,
        name: `Layer ${layers.length + 1}`,
        visible: true,
        locked: false,
      }),
    );
  }

  function applyTemplate(kind: "concept" | "study" | "retro") {
    const layer = layers.find(
      (candidate) => candidate.visible && !candidate.locked,
    );
    if (!layer || readOnly) return;
    const baseX = viewport.x + (kind === "concept" ? 72 : 180);
    const baseY = viewport.y + (kind === "concept" ? 34 : 120);
    mutate((draft) => {
      const specs =
        kind === "concept"
          ? ([
              ["shape", "Central idea", 400, 210, "#f0ecff", 240, 124],
              ["card", "Evidence", 0, 0, "#ecf7f1", 260, 132],
              ["note", "Key fact", 320, 12, "#fff1c7", 220, 104],
              ["card", "Implications", 680, 0, "#fff3dc", 280, 132],
              ["card", "Examples", 0, 230, "#fbecef", 260, 144],
              ["note", "Remember", 710, 230, "#eaf1ff", 250, 144],
              ["card", "Process", 70, 430, "#eef6ff", 250, 112],
              ["note", "Questions", 365, 430, "#fff1c7", 240, 112],
              ["card", "Connections", 650, 430, "#ecf7f1", 270, 112],
            ] as const)
          : kind === "study"
            ? ([
                ["text", "Study map", 220, 0, "transparent", 320, 80],
                ["card", "What I know", 0, 150, "#ecf7f1", 250, 180],
                ["card", "What to review", 280, 150, "#fff3dc", 250, 180],
                ["card", "Questions", 560, 150, "#f0ecff", 250, 180],
              ] as const)
            : ([
                ["note", "Went well", 0, 100, "#e6f6eb", 250, 180],
                ["note", "Learned", 280, 100, "#fff1c7", 250, 180],
                ["note", "Try next", 560, 100, "#eee9ff", 250, 180],
              ] as const);
      const created = specs.map(
        ([type, label, x, y, fill, width, height], index) => {
        const node = createWhiteboardNode(
          type,
          page.id,
          layer.id,
          snap(baseX + x),
          snap(baseY + y),
          draft.nodes.length + index + 1,
        );
        node.content = { text: label, title: label };
        node.semanticLabel = label;
        node.width = width;
        node.height = height;
        node.style = { ...node.style, fill };
        draft.nodes.push(node);
        return node;
        },
      );
      if (kind === "concept") {
        created.slice(1).forEach((node, index) =>
          draft.edges.push({
            id: `edge-${Date.now().toString(36)}-${index}`,
            pageId: page.id,
            layerId: layer.id,
            from: created[0]!.id,
            to: node.id,
          }),
        );
      }
    });
    setPanel("none");
  }

  function renderCanvas(compact = false) {
    return (
      <div
        ref={compact ? undefined : canvasRef}
        tabIndex={compact ? undefined : 0}
        className="whiteboard-canvas"
        data-tool={compact ? "present" : tool}
        data-compact={compact || undefined}
        style={
          {
            "--board-zoom": viewport.zoom,
            "--board-grid": `${board.settings?.gridSize ?? 24}px`,
            "--board-x": `${-viewport.x * viewport.zoom}px`,
            "--board-y": `${-viewport.y * viewport.zoom}px`,
            backgroundColor:
              page.background ?? board.settings?.canvasColor ?? "#fbfbf8",
          } as CSSProperties
        }
        onClick={compact ? undefined : canvasClick}
        onPointerDown={compact ? undefined : beginPan}
        onPointerMove={compact ? undefined : movePointer}
        onPointerUp={compact ? undefined : finishPointer}
        onPointerCancel={compact ? undefined : finishPointer}
        onWheel={compact ? undefined : wheel}
        onKeyDown={
          compact
            ? undefined
            : (event) => {
                if (
                  (event.target as HTMLElement).matches(
                    "input, textarea, select, [contenteditable='true']",
                  )
                )
                  return;
                if (event.key === "Escape") {
                  setSelectedNodeIds([]);
                  setConnectorFrom(undefined);
                } else if (
                  (event.key === "Delete" || event.key === "Backspace") &&
                  selectedNodeIds.length
                ) {
                  event.preventDefault();
                  deleteSelected();
                } else if (
                  (event.ctrlKey || event.metaKey) &&
                  event.key.toLowerCase() === "g"
                ) {
                  event.preventDefault();
                  if (event.shiftKey) ungroupSelected();
                  else groupSelected();
                }
              }
        }
      >
        <div
          className="whiteboard-world"
          style={{
            transform: `translate(${-viewport.x * viewport.zoom}px, ${-viewport.y * viewport.zoom}px) scale(${viewport.zoom})`,
          }}
        >
          <svg className="whiteboard-edges" aria-label="Connectors">
            {renderedEdges.map((edge) => {
              const from = nodes.find((node) => node.id === edge.from);
              const to = nodes.find((node) => node.id === edge.to);
              if (!from || !to) return null;
              const index = edgeIndexById.get(edge.id) ?? -1;
              const changed =
                index >= 0 &&
                (pathTouches(aiChangedPaths, `/edges/${index}`) ||
                  pathTouches(aiChangedPaths, `/edges/${edge.id}`));
              return (
                <g key={edge.id} data-ai-region={aiRegionAttr(changed)}>
                  <line
                    x1={from.x + from.width / 2}
                    y1={from.y + from.height / 2}
                    x2={to.x + to.width / 2}
                    y2={to.y + to.height / 2}
                  />
                  <circle
                    cx={to.x + to.width / 2}
                    cy={to.y + to.height / 2}
                    r="3"
                  />
                  {edge.label ? (
                    <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2}>
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {[...renderedNodes]
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((node) => {
              const index = nodeIndexById.get(node.id) ?? -1;
              const source =
                node.content &&
                typeof node.content === "object" &&
                !Array.isArray(node.content)
                  ? (node.content as Record<string, unknown>)
                  : {};
              const nodeAiActive =
                index >= 0 &&
                (pathTouches(aiChangedPaths, `/nodes/${index}`) ||
                  pathTouches(aiChangedPaths, `/nodes/${node.id}`));
              return (
                  <BoardNode
                    key={node.id}
                    node={node}
                    artifact={
                      typeof source.artifactId === "string"
                        ? artifactMap.get(source.artifactId)
                        : undefined
                    }
                    asset={
                      typeof source.assetId === "string"
                        ? assetMap.get(source.assetId)
                        : undefined
                    }
                    selected={
                      !compact &&
                      (selectedNodeIds.includes(node.id) ||
                        connectorFrom === node.id)
                    }
                    readOnly={readOnly || compact}
                    compact={compact}
                    onSelect={(additive) => {
                      if (selectionHandledRef.current) {
                        selectionHandledRef.current = false;
                        return;
                      }
                      if (!compact) selectNode(node, additive);
                    }}
                    onPointerDown={(event) => {
                      if (!compact) beginNodeDrag(node, event);
                    }}
                    onResizePointerDown={(event) => beginResize(node, event)}
                    onTextChange={(value) =>
                      mutate((draft) => {
                        const candidate = draft.nodes.find(
                          (item) => item.id === node.id,
                        );
                        if (candidate)
                          Object.assign(
                            candidate,
                            withWhiteboardNodeText(candidate, value),
                          );
                      })
                    }
                    aiActive={nodeAiActive}
                    path={index >= 0 ? `/nodes/${index}` : undefined}
                    onContentChange={(change) =>
                      mutate((draft) => {
                        const candidate = draft.nodes.find(
                          (item) => item.id === node.id,
                        );
                        if (!candidate) return;
                        const current =
                          candidate.content &&
                          typeof candidate.content === "object" &&
                          !Array.isArray(candidate.content)
                            ? (candidate.content as Record<string, unknown>)
                            : {};
                        candidate.content = { ...current, ...change };
                      })
                    }
                  />
              );
            })}
        </div>
        {!compact ? (
          <div className="whiteboard-minimap" aria-label="Board minimap">
            {nodes
              .filter(
                (_node, index) =>
                  nodes.length <= 500 ||
                  index % Math.ceil(nodes.length / 500) === 0,
              )
              .map((node) => (
                <i
                  key={node.id}
                  style={{
                    left: `${50 + node.x / 100}%`,
                    top: `${50 + node.y / 100}%`,
                    width: Math.max(2, node.width / 120),
                    height: Math.max(2, node.height / 120),
                  }}
                />
              ))}
            <span />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section className="whiteboard-studio">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void insertImage(file);
        }}
      />
      <input
        ref={boardInputRef}
        type="file"
        accept=".spectra-board.json,.json,.csv,.svg,.pdf,application/json,text/csv,image/svg+xml,application/pdf"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void importBoard(file);
        }}
      />
      <header className="whiteboard-toolbar" aria-label="Whiteboard tools">
        <div>
          {(
            [
              ["select", MousePointer2, "Select"],
              ["hand", Hand, "Pan"],
              ["text", TextCursorInput, "Text"],
              ["note", StickyNote, "Sticky"],
              ["shape", Square, "Shape"],
              ["connector", CircleDot, "Connector"],
              ["frame", Frame, "Frame"],
              ["card", BoxSelect, "Card"],
              ["table", Table2, "Table"],
              ["embed", Link2, "Embed artifact"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              data-active={tool === id || undefined}
              disabled={readOnly && id !== "select" && id !== "hand"}
              aria-label={label}
              title={label}
              onClick={() => setTool(id)}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
          <button
            type="button"
            aria-label="Add image"
            title="Add image"
            disabled={readOnly || uploadingImage}
            onClick={() => imageInputRef.current?.click()}
          >
            {uploadingImage ? (
              <Upload className="h-4 w-4 animate-pulse" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            aria-label="Import board"
            title="Import Spectra board, CSV, safe SVG, or PDF pages"
            disabled={readOnly}
            onClick={() => boardInputRef.current?.click()}
          >
            <FileUp className="h-4 w-4" />
          </button>
          <label
            className="whiteboard-export-control"
            title={
              selectedNode?.type === "frame"
                ? "Export the selected frame"
                : "Export the current page or portable board"
            }
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Export board</span>
            <select
              aria-label="Export board"
              value=""
              disabled={Boolean(ioBusy)}
              onChange={(event) => {
                const format = event.currentTarget.value as
                  "package" | "svg" | "png" | "pdf";
                event.currentTarget.value = "";
                if (format) void exportBoard(format);
              }}
            >
              <option value="" disabled>
                Export…
              </option>
              <option value="png">PNG image</option>
              <option value="svg">Editable SVG</option>
              <option value="pdf">PDF</option>
              <option value="package">Portable Spectra board</option>
            </select>
          </label>
        </div>
        <span />
        <div>
          <button
            type="button"
            title="Layers and pages"
            data-active={panel === "layers" || undefined}
            onClick={() => setPanel(panel === "layers" ? "none" : "layers")}
          >
            <Layers3 className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Templates"
            disabled={readOnly}
            data-active={panel === "templates" || undefined}
            onClick={() =>
              setPanel(panel === "templates" ? "none" : "templates")
            }
          >
            <LayoutTemplate className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Search"
            data-active={panel === "search" || undefined}
            onClick={() => setPanel(panel === "search" ? "none" : "search")}
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Accessible outline"
            data-active={panel === "outline" || undefined}
            onClick={() => setPanel(panel === "outline" ? "none" : "outline")}
          >
            <Grid3X3 className="h-4 w-4" />
          </button>
        </div>
        <span />
        <div>
          <span
            className="hidden items-center gap-1.5 px-1 text-[10px] text-[var(--text-secondary)] xl:inline-flex"
            role="status"
            aria-live="polite"
          >
            {syncMessage === "Auto-saved" ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />
            ) : syncMessage === "Synchronizing" || syncMessage === "Reconnecting" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)]" />
            ) : (
              <Circle className="h-3 w-3 fill-[#d88922] text-[#d88922]" />
            )}
            {syncMessage}
          </span>
          <button
            type="button"
            aria-label="Undo board change"
            onClick={undoAction}
            disabled={readOnly || !undo.length}
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Redo board change"
            onClick={redoAction}
            disabled={readOnly || !redo.length}
          >
            <Redo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setZoom(viewport.zoom - 0.1)}
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <strong>{Math.round(viewport.zoom * 100)}%</strong>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setZoom(viewport.zoom + 0.1)}
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setPresenting(true)}
            title="Present board"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      {assetError ? (
        <div className="whiteboard-asset-error" role="status">
          {assetError}
          <button type="button" onClick={() => setAssetError(undefined)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      {ioBusy ? (
        <div
          className="whiteboard-asset-error whiteboard-io-progress"
          role="status"
        >
          <Upload className="h-3.5 w-3.5 animate-pulse" />
          {ioBusy}
        </div>
      ) : null}
      {ioNotice ? (
        <div className="whiteboard-asset-error" role="status">
          {ioNotice}
          <button type="button" onClick={() => setIoNotice(undefined)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div className="whiteboard-shell">
        {panel !== "none" ? (
          <aside className="whiteboard-panel">
            <header>
              <strong>
                {panel === "layers"
                  ? "Pages & layers"
                  : panel === "outline"
                    ? "Object outline"
                    : panel === "search"
                      ? "Search board"
                      : "Templates"}
              </strong>
              <button type="button" onClick={() => setPanel("none")}>
                <X className="h-4 w-4" />
              </button>
            </header>
            {panel === "search" ? (
              <>
                <input
                  autoFocus
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Find text or labels"
                />
                {nodes
                  .filter((node) =>
                    `${whiteboardNodeText(node)} ${node.semanticLabel ?? ""}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => {
                        setSelectedNodeId(node.id);
                        setViewport((current) => ({
                          ...current,
                          x: node.x - 300,
                          y: node.y - 200,
                        }));
                      }}
                    >
                      <strong>
                        {whiteboardNodeText(node) ||
                          node.semanticLabel ||
                          node.type}
                      </strong>
                      <small>
                        {Math.round(node.x)}, {Math.round(node.y)}
                      </small>
                    </button>
                  ))}
              </>
            ) : panel === "layers" ? (
              <>
                <div className="whiteboard-page-list">
                  {board.pages.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      data-active={candidate.id === page.id || undefined}
                      onClick={() =>
                        setViewport({
                          pageId: candidate.id,
                          x: 0,
                          y: 0,
                          zoom: 1,
                        })
                      }
                    >
                      <strong>{candidate.name}</strong>
                      <small>
                        {
                          board.nodes.filter(
                            (node) => node.pageId === candidate.id,
                          ).length
                        }{" "}
                        objects
                      </small>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="whiteboard-panel-add"
                  disabled={readOnly}
                  onClick={addPage}
                >
                  <Plus className="h-3.5 w-3.5" /> Add page
                </button>
                <div className="whiteboard-layer-list">
                  {layers.map((layer) => (
                    <div key={layer.id}>
                      <span>
                        <strong>{layer.name}</strong>
                        <small>{layer.locked ? "Locked" : "Editable"}</small>
                      </span>
                      <button
                        type="button"
                        title={layer.visible ? "Hide layer" : "Show layer"}
                        disabled={readOnly}
                        onClick={() =>
                          mutate((draft) => {
                            const found = draft.layers.find(
                              (candidate) => candidate.id === layer.id,
                            );
                            if (found) found.visible = !found.visible;
                          })
                        }
                      >
                        {layer.visible ? (
                          <Eye className="h-3.5 w-3.5" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        title={layer.locked ? "Unlock layer" : "Lock layer"}
                        disabled={readOnly}
                        onClick={() =>
                          mutate((draft) => {
                            const found = draft.layers.find(
                              (candidate) => candidate.id === layer.id,
                            );
                            if (found) found.locked = !found.locked;
                          })
                        }
                      >
                        {layer.locked ? (
                          <Lock className="h-3.5 w-3.5" />
                        ) : (
                          <Unlock className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="whiteboard-panel-add"
                  disabled={readOnly}
                  onClick={addLayer}
                >
                  <Plus className="h-3.5 w-3.5" /> Add layer
                </button>
              </>
            ) : panel === "templates" ? (
              <div className="whiteboard-template-list">
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => applyTemplate("concept")}
                >
                  <i data-template="concept" />
                  <span>
                    <strong>Concept map</strong>
                    <small>Central idea with connected evidence</small>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => applyTemplate("study")}
                >
                  <i data-template="study" />
                  <span>
                    <strong>Study map</strong>
                    <small>Knowledge, review, and open questions</small>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => applyTemplate("retro")}
                >
                  <i data-template="retro" />
                  <span>
                    <strong>Reflection</strong>
                    <small>What worked, learning, and next step</small>
                  </span>
                </button>
              </div>
            ) : (
              [...nodes]
                .sort(
                  (a, b) =>
                    (a.accessibilityOrder ?? 0) - (b.accessibilityOrder ?? 0),
                )
                .map((node, index) => (
                  <button
                    key={node.id}
                    type="button"
                    data-active={node.id === selectedNodeId || undefined}
                    onClick={() => setSelectedNodeId(node.id)}
                  >
                    <span>{index + 1}</span>
                    <strong>
                      {node.semanticLabel ||
                        whiteboardNodeText(node) ||
                        node.type}
                    </strong>
                    <small>
                      {node.type}
                      {node.locked ? " · locked" : ""}
                    </small>
                  </button>
                ))
            )}
          </aside>
        ) : null}

        <main>
          {renderCanvas()}
          {!readOnly &&
          (selectedNodeIds.length > 1 || selectedNode?.type === "group") ? (
            <div
              className="whiteboard-multi-toolbar"
              aria-label="Selected object arrangement"
            >
              {selectedNodeIds.length > 1 ? (
                <>
                  <strong>{selectedNodeIds.length} selected</strong>
                  <button
                    type="button"
                    title="Align left"
                    onClick={() => alignSelected("left")}
                  >
                    <AlignLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Align centers"
                    onClick={() => alignSelected("center")}
                  >
                    <AlignCenter className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Align right"
                    onClick={() => alignSelected("right")}
                  >
                    <AlignRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Distribute horizontally"
                    disabled={selectedNodeIds.length < 3}
                    onClick={distributeSelected}
                  >
                    <BoxSelect className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Group objects"
                    onClick={groupSelected}
                  >
                    <Group className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <strong>Object group</strong>
                  <button
                    type="button"
                    title="Ungroup objects"
                    onClick={ungroupSelected}
                  >
                    <Ungroup className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
              <button
                type="button"
                title="Delete selection"
                onClick={deleteSelected}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
          {selectedNode && selectedNodeIds.length === 1 ? (
            <button
              type="button"
              className="whiteboard-inspector-trigger"
              aria-label={
                inspectorOpen ? "Hide object details" : "Show object details"
              }
              aria-expanded={inspectorOpen}
              onClick={() => setInspectorOpen((open) => !open)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>{inspectorOpen ? "Hide details" : "Object details"}</span>
            </button>
          ) : null}
          {selectedNode &&
          selectedNodeIds.length === 1 &&
          inspectorOpen ? (
            <div className="whiteboard-inspector">
              <div>
                <strong>
                  {selectedNode.semanticLabel || selectedNode.type}
                </strong>
                <button
                  type="button"
                  title={selectedNode.locked ? "Unlock object" : "Lock object"}
                  onClick={() =>
                    updateSelected((node) => {
                      node.locked = !node.locked;
                    })
                  }
                >
                  {selectedNode.locked ? (
                    <Unlock className="h-3.5 w-3.5" />
                  ) : (
                    <Lock className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  title="Delete object"
                  onClick={deleteSelected}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <label>
                Semantic label
                <input
                  value={selectedNode.semanticLabel ?? ""}
                  disabled={readOnly}
                  onChange={(event) =>
                    updateSelected((node) => {
                      node.semanticLabel = event.target.value;
                    })
                  }
                />
              </label>
              <div>
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <label key={key}>
                    {key}
                    <input
                      type="number"
                      value={Math.round(selectedNode[key])}
                      disabled={readOnly || selectedNode.locked}
                      onChange={(event) =>
                        updateSelected((node) => {
                          node[key] = Number(event.target.value);
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <label>
                Layer
                <select
                  value={selectedNode.layerId}
                  disabled={readOnly || selectedNode.locked}
                  onChange={(event) =>
                    updateSelected((node) => {
                      node.layerId = event.target.value;
                    })
                  }
                >
                  {layers.map((layer) => (
                    <option key={layer.id} value={layer.id}>
                      {layer.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="whiteboard-color-fields">
                <label>
                  Fill
                  <input
                    type="color"
                    value={String(styleValue(selectedNode, "fill", "#ffffff"))}
                    disabled={readOnly || selectedNode.locked}
                    onChange={(event) =>
                      updateSelected((node) => {
                        node.style = {
                          ...node.style,
                          fill: event.target.value,
                        };
                      })
                    }
                  />
                </label>
                <label>
                  Border
                  <input
                    type="color"
                    value={String(
                      styleValue(selectedNode, "stroke", "#d5d7d2"),
                    )}
                    disabled={readOnly || selectedNode.locked}
                    onChange={(event) =>
                      updateSelected((node) => {
                        node.style = {
                          ...node.style,
                          stroke: event.target.value,
                        };
                      })
                    }
                  />
                </label>
              </div>
              {selectedNode.type === "embed" ? (
                <label>
                  Linked artifact
                  <select
                    value={String(
                      (selectedNode.content as Record<string, unknown>)
                        ?.artifactId ?? "",
                    )}
                    disabled={readOnly}
                    onChange={(event) =>
                      updateSelected((node) => {
                        node.content = { artifactId: event.target.value };
                      })
                    }
                  >
                    <option value="">No source</option>
                    {artifacts
                      .filter(
                        (artifact) =>
                          artifact._id !== artifactId &&
                          artifact.status === "active",
                      )
                      .map((artifact) => (
                        <option key={artifact._id} value={artifact._id}>
                          {artifact.title}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}
        </main>
      </div>

      {presenting ? (
        <div className="whiteboard-presenter" role="dialog" aria-modal="true">
          <div className="whiteboard-presenter-bar">
            <strong>{page.name}</strong>
            <button type="button" onClick={() => setPresenting(false)}>
              <X className="h-5 w-5" /> Exit presentation
            </button>
          </div>
          {renderCanvas(true)}
        </div>
      ) : null}
    </section>
  );
}
