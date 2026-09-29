"use client";

import { describeFailure } from "@/components/ui/truthful-state";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BoxSelect,
  CircleDot,
  Eye,
  EyeOff,
  FileCode,
  FileText,
  FileUp,
  Frame,
  Group,
  Hand,
  Image as ImageIcon,
  ImagePlus,
  Layers3,
  LayoutTemplate,
  Link2,
  ListTree,
  Loader2,
  Lock,
  Magnet,
  MousePointer2,
  Package,
  PanelLeft,
  Plus,
  Presentation,
  Redo2,
  Repeat2,
  Scan,
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
  type LucideIcon,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useMutation } from "convex/react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
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
  type WhiteboardEdge,
  type WhiteboardNode,
  type WhiteboardNodeType,
} from "../whiteboard/model";
import {
  buildWhiteboardPackage,
  buildWhiteboardSvg,
  importWhiteboardFile,
} from "../whiteboard/io";
import { uniqueToken } from "@/lib/unique-token";
import { SelectField } from "@/components/ui/select";
import { getWorkDefinition } from "../work/registry";
import { isArtifactTypeKey } from "../artifacts/registry";
import { suggestedEmbedInteraction } from "../capabilities";
import { spectraBus } from "../events";
import type { ReferenceNode } from "../references";
import { aiRegionAttr, pathTouches } from "./ai-region-path";
import { targetAttrs } from "../collaboration/target-attributes";
import { useStudioContract } from "./artifact-studio-shell";
import {
  applyStudioHistory,
  commitStudioGesture,
  studioValuesEqual,
  type StudioHistoryEntry,
} from "./artifact-studio-value-utils";
import { StudioItemRail } from "./studio-item-rail";
import {
  ArtifactWorkbar,
  WorkbarItemSelector,
  type CommandBinding,
} from "./artifact-workbar";
import { projectBindingsFromIr } from "../capabilities";
import { enforcePdfInput } from "../../../../shared/parser-limits";
import { ArtifactEmbedById } from "./artifact-embed-host";
import {
  artifactBlobSha256,
  downloadDocumentBlob,
} from "./artifact-studio-file-utils";

type Tool = "select" | "hand" | "connector" | WhiteboardNodeType;
type Drag = {
  mode: "node" | "pan" | "resize" | "marquee";
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
  /** True once a node drag has actually moved, so a click is not a no-op edit. */
  moved?: boolean;
};
/** Live alignment guides in world coordinates, shown only while dragging. */
type Guides = { x?: number; y?: number };
type Marquee = { x: number; y: number; width: number; height: number };

/**
 * User-facing nouns for the object types. The type key is a schema key, and
 * printing it at a reader is exactly what D13 rules out ("embed", "planner_task").
 */
const NODE_NOUNS: Record<WhiteboardNodeType, string> = {
  text: "Text",
  note: "Sticky note",
  shape: "Shape",
  image: "Image",
  embed: "Linked work",
  frame: "Frame",
  group: "Group",
  table: "Table",
  card: "Card",
  drawing: "Drawing",
};

/** How close, in screen pixels, an edge or centre has to be to snap. */

const SNAP_PIXELS = 7;

/**
 * The tools, in the order they matter. The first four stay in the bar at every
 * width; the rest promote into the overflow menu when the pane is tight.
 */
const BOARD_PALETTE = [
  ["select", MousePointer2, "Select"],
  ["hand", Hand, "Pan"],
  ["note", StickyNote, "Sticky note"],
  ["connector", CircleDot, "Connector"],
  ["text", TextCursorInput, "Text"],
  ["shape", Square, "Shape"],
] as const satisfies readonly (readonly [Tool, LucideIcon, string])[];

/** Object tools that always live in the overflow menu. */
const BOARD_OBJECTS = [
  ["frame", Frame, "Frame"],
  ["card", BoxSelect, "Card"],
  ["table", Table2, "Table"],
  // D15: "artifact" is not a user-facing word. This inserts a live reference to
  // other work, which is what the label now says.
  ["embed", Link2, "Embed work"],
] as const satisfies readonly (readonly [Tool, LucideIcon, string])[];

/** The side panels, in the order the menu lists them. `true` means it edits. */
const BOARD_PANELS = [
  ["layers", Layers3, "Pages and layers", false],
  ["templates", LayoutTemplate, "Templates", true],
  ["search", Search, "Find on board", false],
  ["outline", ListTree, "Accessible outline", false],
] as const satisfies readonly (readonly [
  "layers" | "templates" | "search" | "outline",
  LucideIcon,
  string,
  boolean,
])[];

/** One icon per format, so the export group is readable at a glance (D16). */

const BOARD_EXPORTS = [
  ["png", ImageIcon, "Export PNG image"],
  ["svg", FileCode, "Export editable SVG"],
  ["pdf", FileText, "Export PDF"],
  ["package", Package, "Export portable board"],
] as const satisfies readonly (readonly [
  "png" | "svg" | "pdf" | "package",
  LucideIcon,
  string,
])[];

/** Clipboards rewrite line endings and may add a trailing newline. */
function normalizeBoardClipboardText(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function centerX(node: WhiteboardNode) {
  return node.x + node.width / 2;
}
function centerY(node: WhiteboardNode) {
  return node.y + node.height / 2;
}

/**
 * The bounding box of a set of objects, in world coordinates. Used by fit,
 * by the minimap and by export scoping, so all three agree on where the work is.
 */
function boundsOf(nodes: readonly WhiteboardNode[]) {
  if (!nodes.length) return undefined;
  return {
    left: Math.min(...nodes.map((node) => node.x)),
    top: Math.min(...nodes.map((node) => node.y)),
    right: Math.max(...nodes.map((node) => node.x + node.width)),
    bottom: Math.max(...nodes.map((node) => node.y + node.height)),
  };
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

/**
 * One resolution order for every painted property: the node's `style` wins,
 * then a matching key on its own content, then the type default. Imported
 * boards carry appearance on `content`, native ones on `style`, and both have
 * to render the same way.
 */
function visual(
  node: WhiteboardNode,
  content: Record<string, unknown>,
  key: string,
  contentKeys: readonly string[],
  fallback: string | number,
) {
  const fromContent = contentKeys
    .map((name) => content[name])
    .find((value) => typeof value === typeof fallback) as
    string | number | undefined;
  return styleValue(node, key, fromContent ?? fallback);
}

/**
 * The registry's one user-facing type name. A board that embeds other work must
 * never print a raw blueprint key at the reader (`planner_task`, "flashcard
 * deck"): D13, and D15 for the word "artifact".
 */
function workTypeName(artifact?: SpectraArtifact) {
  if (!artifact) return undefined;
  return getWorkDefinition(
    artifact.blueprintKey as Parameters<typeof getWorkDefinition>[0],
  )?.userFacingName;
}

function BoardNode({
  node,
  artifact,
  asset,
  assetsLoading,
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
  /** Board media is still being fetched, so "unavailable" would be a lie. */
  assetsLoading: boolean;
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
      const control = nodeElementRef.current?.querySelector<
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
          visual(
            node,
            content,
            "fill",
            ["fill"],
            node.type === "note" ? "color-mix(in oklab, var(--accent-gold) 28%, var(--bg-elevated))" : "var(--bg-elevated)",
          ),
        ),
        borderColor: String(
          visual(node, content, "stroke", ["stroke"], "#d5d7d2"),
        ),
        borderWidth: Number(
          visual(node, content, "strokeWidth", ["strokeWidth"], 1),
        ),
        borderRadius: Number(
          visual(node, content, "borderRadius", ["borderRadius"], 11),
        ),
        color: String(
          visual(node, content, "color", ["textColor", "color"], "#29352f"),
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
      ) : node.type === "embed" && typeof content.embedId === "string" ? (
        <div className="h-full w-full overflow-auto rounded-card">
          <ArtifactEmbedById embedId={content.embedId} />
        </div>
      ) : node.type === "embed" ? (
        <div
          className="whiteboard-embed-node"
          data-unavailable={!artifact || undefined}
        >
          <Link2 className="h-4 w-4" />
          <strong>{artifact?.title ?? "Access unavailable"}</strong>
          <small>{workTypeName(artifact) ?? "Source permission changed"}</small>
        </div>
      ) : node.type === "table" ? (
        <table>
          <tbody>
            {(Array.isArray(content.rows) ? content.rows : []).map(
              (row, rowIndex) => (
                <tr key={rowIndex}>
                  {(Array.isArray(row) ? row : []).map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      <input
                        value={String(cell ?? "")}
                        readOnly={
                          readOnly || node.locked || compact || !editingText
                        }
                        aria-label={`Row ${rowIndex + 1}, column ${cellIndex + 1}`}
                        onPointerDown={textPointerDown}
                        onDoubleClick={beginTextEditing}
                        onFocus={() => onSelect(false)}
                        onChange={(event) => {
                          const rows = (
                            Array.isArray(content.rows) ? content.rows : []
                          ).map((currentRow, currentRowIndex) =>
                            currentRowIndex !== rowIndex ||
                            !Array.isArray(currentRow)
                              ? currentRow
                              : currentRow.map(
                                  (currentCell, currentCellIndex) =>
                                    currentCellIndex === cellIndex
                                      ? event.target.value
                                      : currentCell,
                                ),
                          );
                          onContentChange({ rows });
                        }}
                      />
                    </td>
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
            {assetsLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading image
              </>
            ) : (
              <>
                <ImagePlus className="h-5 w-5" />
                Image unavailable
              </>
            )}
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
                  : "var(--bg-elevated)",
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
            onChange={(event) => onContentChange({ body: event.target.value })}
            style={{
              color:
                typeof content.bodyColor === "string"
                  ? content.bodyColor
                  : "inherit",
              fontSize:
                typeof content.fontSize === "number" ? content.fontSize : 13,
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
              visual(
                node,
                content,
                "fontSize",
                ["fontSize"],
                node.type === "text" ? 30 : 14,
              ),
            ),
            fontWeight: Number(
              visual(
                node,
                content,
                "fontWeight",
                ["fontWeight"],
                content.fontWeight === "bold"
                  ? 700
                  : node.type === "text"
                    ? 650
                    : 500,
              ),
            ),
            fontStyle: content.fontStyle === "italic" ? "italic" : undefined,
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
  readOnly: readOnlyProp,
  synchronizationReady: _synchronizationReady = true,
  // Sync truth belongs to the shell's identity row. The board used to print it
  // a second time inside its own bar; one artifact says one thing once.
  syncMessage: _syncMessage = "Auto-saved",
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
  // Registry truth, resolved once by the shell: what this viewer may do, how
  // wide the pane actually is, and which inspectors exist. A studio that
  // re-derives any of these is how nine editors ended up disagreeing.
  const contract = useStudioContract();
  const definition = getWorkDefinition("whiteboard");
  // CANON D1/D4: read-only means the viewer genuinely lacks `edit`. It is never
  // a consequence of pane width, so a split panel edits like fullscreen.
  const readOnly = readOnlyProp || contract.readOnly;
  const canEdit = contract.can("edit") && !readOnlyProp;
  // The registry grants `present` from the type's own capabilities, so presenting
  // is not something reaching the bar implies. The state is gated too, not just
  // the control: an ungranted role must not be able to be in Present at all.
  const canPresent = contract.can("present");
  const createReference = useMutation(api.artifactEmbeds.create);
  const updateReference = useMutation(api.artifactEmbeds.update);
  const removeReference = useMutation(api.artifactEmbeds.remove);
  const removeReferences = useMutation(api.artifactEmbeds.removeMany);
  const restoreReference = useMutation(api.artifactEmbeds.restore);
  const tight = contract.density === "tight";
  const board = useMemo(() => normalizeWhiteboardContent(content), [content]);
  // The board an edit applies to. Async work (an upload, an import) edits it
  // after an await, when the render that started it holds a stale board;
  // applying there would silently revert everything since, peers included.
  const boardRef = useRef(board);
  boardRef.current = board;
  // Viewport is personal presence, never shared artifact content. Panning or
  // zooming in one differently-sized pane must not move every collaborator.
  const [viewport, setViewport] = useState(board.viewport);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const selectedNodeId = selectedNodeIds.at(-1);
  const setSelectedNodeId = useCallback((nodeId?: string) => {
    setSelectedNodeIds(nodeId ? [nodeId] : []);
  }, []);
  // A connector is an object too: it can be selected, labelled and deleted.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [connectorFrom, setConnectorFrom] = useState<string>();
  const [panel, setPanel] = useState<
    "none" | "layers" | "outline" | "templates" | "search"
  >("none");
  const [pageRailCollapsed, setPageRailCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [undo, setUndo] = useState<StudioHistoryEntry<WhiteboardContent>[]>(
    [],
  );
  const [redo, setRedo] = useState<StudioHistoryEntry<WhiteboardContent>[]>(
    [],
  );
  /**
   * Typing in an object's text (focus to blur) commits every keystroke but is
   * one undo step. `after` gathers only this person's edits, so undoing it
   * never reverts what a collaborator changed meanwhile.
   */
  const typingSessionRef = useRef<
    StudioHistoryEntry<WhiteboardContent> | undefined
  >(undefined);
  const [presenting, setPresenting] = useState(false);
  const presenterRef = useRef<HTMLDivElement>(null);
  useModalFocus(presenterRef, {
    open: presenting && canPresent,
    onClose: () => setPresenting(false),
  });
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [assets, setAssets] = useState<SpectraArtifactAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [assetError, setAssetError] = useState<string>();
  const [uploadingImage, setUploadingImage] = useState(false);
  const [linkingEmbed, setLinkingEmbed] = useState(false);
  const [ioNotice, setIoNotice] = useState<string>();
  const [ioBusy, setIoBusy] = useState<string>();
  const [canvasSize, setCanvasSize] = useState({ width: 1280, height: 800 });
  const [guides, setGuides] = useState<Guides>({});
  const [marquee, setMarquee] = useState<Marquee>();
  const dragRef = useRef<Drag | undefined>(undefined);
  const canvasRef = useRef<HTMLDivElement>(null);
  const boardClipboardRef = useRef<{
    text: string;
    nodes: WhiteboardNode[];
    edges: WhiteboardEdge[];
    pastes: number;
  } | null>(null);
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
    const right = viewport.x + canvasSize.width / viewport.zoom + margin;
    const bottom = viewport.y + canvasSize.height / viewport.zoom + margin;
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
  const selectedEdge = board.edges.find((edge) => edge.id === selectedEdgeId);
  const nodeById = useMemo(
    () => new Map(board.nodes.map((node) => [node.id, node])),
    [board.nodes],
  );
  const artifactMap = new Map(
    artifacts.map((artifact) => [artifact._id, artifact]),
  );
  const assetMap = new Map(assets.map((asset) => [asset.assetId, asset]));

  useEffect(() => {
    if (!selectedNodeId && !selectedEdgeId) setInspectorOpen(false);
  }, [selectedEdgeId, selectedNodeId]);

  useEffect(() => {
    setViewport(board.viewport);
  }, [artifactId, board.viewport]);

  useEffect(() => {
    let active = true;
    setAssetsLoading(true);
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
      })
      .finally(() => {
        if (active) setAssetsLoading(false);
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
      const session = typingSessionRef.current;
      if (record && session) {
        session.after = commitStudioGesture(boardRef.current, next, session.after);
      } else if (record) {
        const before = clone(boardRef.current);
        setUndo((stack) => [...stack.slice(-79), { before, after: next }]);
        setRedo([]);
      }
      // Re-normalize so zOrder/settings match the collaborative projection
      // before onChange dirties the studio (sticky create/edit path).
      const normalized = normalizeWhiteboardContent(next);
      boardRef.current = normalized;
      onChange(normalized);
    },
    [onChange, readOnly],
  );
  const mutate = useCallback(
    (recipe: (draft: WhiteboardContent) => void, record = true) => {
      const next = clone(boardRef.current);
      recipe(next);
      emit(next, record);
    },
    [emit],
  );

  useEffect(
    () =>
      spectraBus.handle(
        "reference.insert",
        async ({ hostWorkId, target, reference: suppliedReference }) => {
          if (hostWorkId !== artifactId) return;
          if (readOnly)
            throw new Error(
              "This board is read-only, so the reference was not added.",
            );
          if (!suppliedReference && !target)
            throw new Error(
              "Choose source work before adding a live reference.",
            );
          const layer = layers.find(
            (candidate) => !candidate.locked && candidate.visible,
          );
          if (!layer)
            throw new Error(
              "Unlock a visible board layer before adding a live reference.",
            );
          const center = {
            x:
              viewport.x +
              (canvasRef.current?.clientWidth ?? 800) / viewport.zoom / 2,
            y:
              viewport.y +
              (canvasRef.current?.clientHeight ?? 600) / viewport.zoom / 2,
          };
          const gridSize = board.settings?.gridSize ?? 24;
          const place = (value: number) =>
            board.settings?.snapToGrid === false
              ? value
              : Math.round(value / gridSize) * gridSize;
          const node = createWhiteboardNode(
            "embed",
            page.id,
            layer.id,
            place(center.x - 200),
            place(center.y - 150),
            board.nodes.length + 1,
          );
          let reference = suppliedReference;
          if (!reference) {
            const interaction = suggestedEmbedInteraction(target!.workType);
            const result = await createReference({
              containerType: "artifact",
              containerId: artifactId,
              containerRegionId: node.id,
              sourceArtifactId: target!.workId as Id<"spectraArtifacts">,
              mode: "compact",
              interaction,
              versionPolicy: "live",
              contextPolicy: "summary",
              displayPreferences: {
                sourceWorkType: target!.workType,
                anchorKind: target!.kind,
                sourceAnchor: target,
              },
            });
            reference = {
              embedId: result.embedId,
              containerType: "artifact",
              containerId: artifactId,
              containerRegionId: node.id,
              sourceArtifactId: target!.workId,
              mode: "compact",
              interaction,
              versionPolicy: "live",
              contextPolicy: "summary",
              displayPreferences: {
                sourceWorkType: target!.workType,
                anchorKind: target!.kind,
                sourceAnchor: target,
              },
              state: "ready",
            };
          } else if (reference.containerRegionId !== node.id) {
            await updateReference({
              embedId: reference.embedId as Id<"artifactEmbeds">,
              containerRegionId: node.id,
            });
            reference = { ...reference, containerRegionId: node.id };
          }
          node.content = reference;
          mutate((draft) => draft.nodes.push(node));
          setSelectedNodeId(node.id);
          onActiveRegionChange?.(node.id);
          setTool("select");
          return { status: "completed", message: "Reference inserted." };
        },
      ),
    [
      artifactId,
      board.nodes.length,
      board.settings?.gridSize,
      board.settings?.snapToGrid,
      createReference,
      layers,
      mutate,
      onActiveRegionChange,
      page.id,
      readOnly,
      setSelectedNodeId,
      updateReference,
      viewport.x,
      viewport.y,
      viewport.zoom,
    ],
  );

  useEffect(
    () =>
      spectraBus.handle("reference.remove", async ({ hostWorkId, embedId }) => {
        if (hostWorkId !== artifactId) return;
        if (readOnly)
          throw new Error("This board is read-only, so the reference was not removed.");
        const removedIds = new Set(
          board.nodes
            .filter(
              (node) =>
                node.type === "embed" &&
                objectRecord(node.content).embedId === embedId,
            )
            .map((node) => node.id),
        );
        if (!removedIds.size)
          throw new Error("The reference is no longer present on this board.");
        mutate((draft) => {
          draft.nodes = draft.nodes.filter((node) => !removedIds.has(node.id));
          draft.edges = draft.edges.filter(
            (edge) => !removedIds.has(edge.from) && !removedIds.has(edge.to),
          );
        });
        setSelectedNodeIds((current) =>
          current.filter((id) =>
            board.nodes.some(
              (node) =>
                node.id === id &&
                objectRecord(node.content).embedId !== embedId,
            ),
          ),
        );
        return { status: "completed", message: "Reference removed." };
      }),
    [artifactId, board.nodes, mutate, readOnly],
  );

  async function linkSelectedEmbed(sourceArtifactId: string) {
    if (!selectedNode || selectedNode.type !== "embed" || readOnly) return;
    const current =
      selectedNode.content &&
      typeof selectedNode.content === "object" &&
      !Array.isArray(selectedNode.content)
        ? (selectedNode.content as Partial<ReferenceNode> & {
            artifactId?: string;
          })
        : {};
    setLinkingEmbed(true);
    try {
      if (sourceArtifactId === "none") {
        if (current.embedId)
          await removeReference({
            embedId: current.embedId as Id<"artifactEmbeds">,
          });
        mutate((draft) => {
          const node = draft.nodes.find(
            (entry) => entry.id === selectedNode.id,
          );
          if (node) node.content = {};
        });
        return;
      }
      const source = artifactMap.get(sourceArtifactId);
      if (!source || !isArtifactTypeKey(source.blueprintKey))
        throw new Error("The selected work is unavailable.");
      const interaction = suggestedEmbedInteraction(source.blueprintKey);
      const result = await createReference({
        containerType: "artifact",
        containerId: artifactId,
        containerRegionId: selectedNode.id,
        sourceArtifactId: sourceArtifactId as Id<"spectraArtifacts">,
        mode: "compact",
        interaction,
        versionPolicy: "live",
        contextPolicy: "summary",
      });
      const reference: ReferenceNode = {
        embedId: result.embedId,
        containerType: "artifact",
        containerId: artifactId,
        containerRegionId: selectedNode.id,
        sourceArtifactId,
        mode: "compact",
        interaction,
        versionPolicy: "live",
        contextPolicy: "summary",
        state: "ready",
      };
      if (current.embedId) {
        try {
          await removeReference({
            embedId: current.embedId as Id<"artifactEmbeds">,
          });
        } catch (error) {
          await removeReference({
            embedId: result.embedId as Id<"artifactEmbeds">,
          }).catch(() => undefined);
          throw error;
        }
      }
      mutate((draft) => {
        const node = draft.nodes.find((entry) => entry.id === selectedNode.id);
        if (node) node.content = reference;
      });
    } catch (error) {
      setIoNotice(
        describeFailure(error, { fallback: "The live reference could not be changed." }).message,
      );
    } finally {
      setLinkingEmbed(false);
    }
  }
  const worldPoint = (clientX: number, clientY: number) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    return {
      x: (clientX - (bounds?.left ?? 0)) / viewport.zoom + viewport.x,
      y: (clientY - (bounds?.top ?? 0)) / viewport.zoom + viewport.y,
    };
  };
  const gridSize = board.settings?.gridSize ?? 24;
  const snapToGrid = board.settings?.snapToGrid !== false;
  const snap = (value: number) =>
    snapToGrid ? Math.round(value / gridSize) * gridSize : value;

  /**
   * Object-aware snapping. A grid cannot line a note up with the note beside it,
   * which is the alignment a board actually needs, so a drag is also pulled onto
   * the edges and centres of the objects it is not moving, and reports the guide
   * to draw. Tolerance is screen pixels converted to world units, so the pull
   * feels identical at every zoom instead of getting stickier as you zoom out.
   */
  function alignDrag(
    starts: Record<string, { x: number; y: number }>,
    deltaX: number,
    deltaY: number,
  ) {
    const moving = Object.entries(starts).flatMap(([id, start]) => {
      const node = nodeById.get(id);
      return node ? [{ ...node, x: start.x, y: start.y }] : [];
    });
    const box = boundsOf(moving);
    if (!box) return { deltaX, deltaY, guides: {} as Guides };
    const tolerance = SNAP_PIXELS / viewport.zoom;
    const edgesX = [box.left + deltaX, box.right + deltaX];
    edgesX.push((edgesX[0]! + edgesX[1]!) / 2);
    const edgesY = [box.top + deltaY, box.bottom + deltaY];
    edgesY.push((edgesY[0]! + edgesY[1]!) / 2);
    const guides: Guides = {};
    let adjustX = 0;
    let adjustY = 0;
    let bestX = tolerance;
    let bestY = tolerance;
    for (const other of nodes) {
      if (starts[other.id]) continue;
      for (const target of [other.x, centerX(other), other.x + other.width])
        for (const edge of edgesX) {
          const distance = Math.abs(target - edge);
          if (distance < bestX) {
            bestX = distance;
            adjustX = target - edge;
            guides.x = target;
          }
        }
      for (const target of [other.y, centerY(other), other.y + other.height])
        for (const edge of edgesY) {
          const distance = Math.abs(target - edge);
          if (distance < bestY) {
            bestY = distance;
            adjustY = target - edge;
            guides.y = target;
          }
        }
    }
    return {
      deltaX: deltaX + adjustX,
      deltaY: deltaY + adjustY,
      guides,
      lockedX: guides.x !== undefined,
      lockedY: guides.y !== undefined,
    };
  }

  /**
   * The overview map, in the same coordinates the board is actually in. It used
   * to place every dot at `50% + x/100` and draw a hardcoded `inset: 20% 22%`
   * rectangle, so it agreed with the canvas only by accident: the box never moved
   * when you panned. Now both come from real geometry, and clicking it moves the
   * view, which is the only reason to draw a map at all.
   */
  const minimap = useMemo(() => {
    const box = boundsOf(nodes);
    if (!box) return undefined;
    const width = Math.max(1, canvasSize.width / viewport.zoom);
    const height = Math.max(1, canvasSize.height / viewport.zoom);
    // Union with the viewport so the frame is always inside the map, even after
    // panning off into empty space.
    const left = Math.min(box.left, viewport.x) - 60;
    const top = Math.min(box.top, viewport.y) - 60;
    const right = Math.max(box.right, viewport.x + width) + 60;
    const bottom = Math.max(box.bottom, viewport.y + height) + 60;
    const scale = Math.min(114 / (right - left), 74 / (bottom - top));
    const project = (x: number, y: number) => ({
      x: (x - left) * scale,
      y: (y - top) * scale,
    });
    const selected = new Set(selectedNodeIds);
    return {
      view: {
        ...project(viewport.x, viewport.y),
        width: width * scale,
        height: height * scale,
      },
      toWorld: (x: number, y: number) => ({
        x: left + x / scale,
        y: top + y / scale,
      }),
      dots: nodes
        .filter(
          (_node, index) =>
            nodes.length <= 400 || index % Math.ceil(nodes.length / 400) === 0,
        )
        .map((node) => ({
          id: node.id,
          ...project(node.x, node.y),
          width: Math.max(2, node.width * scale),
          height: Math.max(2, node.height * scale),
          selected: selected.has(node.id),
        })),
    };
  }, [
    canvasSize.height,
    canvasSize.width,
    nodes,
    selectedNodeIds,
    viewport.x,
    viewport.y,
    viewport.zoom,
  ]);

  /** Moves the viewport so a rectangle of the board is centred and in frame. */
  const frameBox = useCallback(
    (
      box: { left: number; top: number; right: number; bottom: number },
      options?: { zoom?: boolean },
    ) => {
      const width = Math.max(1, canvasSize.width);
      const height = Math.max(1, canvasSize.height);
      setViewport((current) => {
        const zoom = options?.zoom
          ? Math.max(
              0.1,
              Math.min(
                1.5,
                Math.min(
                  width / Math.max(1, box.right - box.left + 160),
                  height / Math.max(1, box.bottom - box.top + 160),
                ),
              ),
            )
          : current.zoom;
        return {
          ...current,
          zoom,
          x: (box.left + box.right) / 2 - width / zoom / 2,
          y: (box.top + box.bottom) / 2 - height / zoom / 2,
        };
      });
    },
    [canvasSize.height, canvasSize.width],
  );

  /** `0` and the bar's Fit control: every object on the page, in frame, once. */
  const fitToContent = useCallback(() => {
    const box = boundsOf(nodes);
    if (box) frameBox(box, { zoom: true });
  }, [frameBox, nodes]);

  /** Reveals one object: selects it and brings it into view without a zoom jump. */
  const revealNode = useCallback(
    (node: WhiteboardNode) => {
      if (node.pageId !== viewport.pageId)
        setViewport((current) => ({ ...current, pageId: node.pageId }));
      setSelectedNodeIds([node.id]);
      setSelectedEdgeId(undefined);
      onActiveRegionChange?.(node.id);
      // Only move the view if the object is not already in it. Recentring on
      // something the user can already see is the jump that makes outline
      // navigation feel broken.
      const width = canvasSize.width / viewport.zoom;
      const height = canvasSize.height / viewport.zoom;
      if (
        node.x >= viewport.x &&
        node.y >= viewport.y &&
        node.x + node.width <= viewport.x + width &&
        node.y + node.height <= viewport.y + height
      )
        return;
      frameBox({
        left: node.x,
        top: node.y,
        right: node.x + node.width,
        bottom: node.y + node.height,
      });
    },
    [
      canvasSize.height,
      canvasSize.width,
      frameBox,
      onActiveRegionChange,
      viewport.pageId,
      viewport.x,
      viewport.y,
      viewport.zoom,
    ],
  );

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
    // A drag that moved already said what the user meant. Without this, letting
    // go of a rubber-band or a pan cleared the selection it had just made.
    if (selectionHandledRef.current) {
      selectionHandledRef.current = false;
      return;
    }
    if (tool === "select" || tool === "hand" || tool === "connector") {
      setSelectedNodeId(undefined);
      setSelectedEdgeId(undefined);
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
        if (layer) {
          // `Date.now()` collided whenever two connectors were drawn inside the
          // same millisecond, which duplicated a React key and an RFC-6901 path.
          const edgeId = `edge-${uniqueToken()}`;
          mutate((draft) =>
            draft.edges.push({
              id: edgeId,
              pageId: page.id,
              layerId: layer.id,
              from: connectorFrom,
              to: node.id,
              zIndex: -1,
            }),
          );
          // A connector is drawn to say something, so it is selected with its
          // label field ready rather than left as an anonymous line.
          setSelectedNodeIds([]);
          setSelectedEdgeId(edgeId);
          setInspectorOpen(true);
        }
      }
      setConnectorFrom(undefined);
      setTool("select");
      return;
    }
    setSelectedEdgeId(undefined);
    setSelectedNodeIds((current) =>
      additive
        ? current.includes(node.id)
          ? current.filter((id) => id !== node.id)
          : [...current, node.id]
        : [node.id],
    );
    onActiveRegionChange?.(node.id);
  }
  /**
   * A group moves, duplicates and deletes with everything nested inside it,
   * however it was picked. One expansion, so dragging and deleting can never
   * disagree about what a group contains.
   */
  const withDescendants = useCallback(
    (ids: Iterable<string>) => {
      const result = new Set(ids);
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const node of board.nodes)
          if (
            node.parentId &&
            result.has(node.parentId) &&
            !result.has(node.id)
          ) {
            result.add(node.id);
            expanded = true;
          }
      }
      return result;
    },
    [board.nodes],
  );

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
    setSelectedEdgeId(undefined);
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
    const movingNodeIds = withDescendants(movingIds);
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
  /**
   * One pointer entry point for the empty canvas: hand tool or middle button
   * pans, the select tool rubber-bands. Both were missing, so the only way to
   * select several objects was to shift-click each one.
   */
  function beginCanvasPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".whiteboard-node")) return;
    // Self-heal: a drag released outside the window never produces a click, so
    // the suppression flag from the last gesture is cleared on the next press
    // rather than swallowing it.
    selectionHandledRef.current = false;
    const panning = tool === "hand" || event.button === 1;
    if (!panning && (tool !== "select" || event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (panning) {
      dragRef.current = {
        mode: "pan",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: viewport.x,
        startY: viewport.y,
        snapshot: clone(board),
      };
      return;
    }
    const point = worldPoint(event.clientX, event.clientY);
    dragRef.current = {
      mode: "marquee",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: point.x,
      startY: point.y,
      snapshot: clone(board),
    };
  }
  function movePointer(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.mode === "pan")
      setViewport((current) => ({
        ...current,
        x: drag.startX - (event.clientX - drag.startClientX) / current.zoom,
        y: drag.startY - (event.clientY - drag.startClientY) / current.zoom,
      }));
    else if (drag.mode === "marquee") {
      const point = worldPoint(event.clientX, event.clientY);
      const box = {
        x: Math.min(drag.startX, point.x),
        y: Math.min(drag.startY, point.y),
        width: Math.abs(point.x - drag.startX),
        height: Math.abs(point.y - drag.startY),
      };
      if (box.width < 3 && box.height < 3) return;
      drag.moved = true;
      setMarquee(box);
      // Selection follows the band live, so you can see what you are catching.
      setSelectedNodeIds(
        nodes
          .filter(
            (node) =>
              node.x + node.width >= box.x &&
              node.y + node.height >= box.y &&
              node.x <= box.x + box.width &&
              node.y <= box.y + box.height,
          )
          .map((node) => node.id),
      );
      setSelectedEdgeId(undefined);
    } else if (drag.mode === "resize")
      mutate((draft) => {
        const node = draft.nodes.find(
          (candidate) => candidate.id === drag.nodeId,
        );
        if (node) {
          drag.moved = true;
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
    else {
      const starts = drag.nodeStarts ?? {};
      const aligned = alignDrag(
        starts,
        (event.clientX - drag.startClientX) / viewport.zoom,
        (event.clientY - drag.startClientY) / viewport.zoom,
      );
      setGuides(aligned.guides);
      mutate((draft) => {
        for (const [nodeId, start] of Object.entries(starts)) {
          const node = draft.nodes.find((candidate) => candidate.id === nodeId);
          if (!node || node.locked) continue;
          drag.moved = true;
          // An object snap already placed the edge exactly; re-rounding it to the
          // grid would drag it back off the guide the user is looking at.
          node.x = aligned.lockedX
            ? start.x + aligned.deltaX
            : snap(start.x + aligned.deltaX);
          node.y = aligned.lockedY
            ? start.y + aligned.deltaY
            : snap(start.y + aligned.deltaY);
        }
      }, false);
    }
  }
  function isTypingTarget(target: EventTarget) {
    return (
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement && target.type === "text")
    );
  }
  function beginTyping(event: ReactFocusEvent<HTMLDivElement>) {
    if (!isTypingTarget(event.target) || typingSessionRef.current) return;
    const origin = clone(boardRef.current);
    typingSessionRef.current = { before: origin, after: origin };
  }
  function finishTyping(event: ReactFocusEvent<HTMLDivElement>) {
    const session = typingSessionRef.current;
    if (!isTypingTarget(event.target) || !session) return;
    typingSessionRef.current = undefined;
    if (studioValuesEqual(session.before, session.after)) return;
    setUndo((stack) => [...stack.slice(-79), session]);
    setRedo([]);
  }
  function finishPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    setGuides({});
    setMarquee(undefined);
    if (drag.moved) selectionHandledRef.current = true;
    // Panning and rubber-banding change what you are looking at, not the board,
    // so they must never consume an undo step. Neither must a click that moved
    // nothing: the bar's Undo used to walk back through identical states.
    if (drag.mode !== "node" && drag.mode !== "resize") return;
    if (!drag.moved) return;
    // The undo entry holds only this gesture's geometry. Taking the whole
    // board at drop time would fold in a collaborator's edit that landed
    // during the drag, and undoing the drag would revert it too.
    const gestureIds = new Set(
      drag.mode === "resize" ? [drag.nodeId] : Object.keys(drag.nodeStarts ?? {}),
    );
    const after = clone(drag.snapshot);
    for (const node of after.nodes) {
      const live = gestureIds.has(node.id)
        ? boardRef.current.nodes.find((candidate) => candidate.id === node.id)
        : undefined;
      if (live) Object.assign(node, { x: live.x, y: live.y, width: live.width, height: live.height });
    }
    setUndo((stack) => [...stack.slice(-79), { before: drag.snapshot, after }]);
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
  async function reconcileEmbedRows(next: WhiteboardContent) {
    const ids = (value: WhiteboardContent) =>
      new Set(
        value.nodes.flatMap((node) =>
          node.type === "embed" &&
          typeof objectRecord(node.content).embedId === "string"
            ? [String(objectRecord(node.content).embedId)]
            : [],
        ),
      );
    const before = ids(board);
    const after = ids(next);
    const added = [...after].filter((embedId) => !before.has(embedId));
    const removed = [...before].filter((embedId) => !after.has(embedId));
    const restored: Id<"artifactEmbeds">[] = [];
    try {
      for (const embedId of added) {
        const result = await restoreReference({
          embedId: embedId as Id<"artifactEmbeds">,
        });
        if (result.restored) restored.push(embedId as Id<"artifactEmbeds">);
      }
      if (removed.length)
        await removeReferences({
          embedIds: removed.map((embedId) => embedId as Id<"artifactEmbeds">),
        });
    } catch (error) {
      if (restored.length)
        await removeReferences({ embedIds: restored }).catch(() => undefined);
      throw error;
    }
  }
  // History replays one local edit onto the current board, so undoing your
  // sticky never reverts what a collaborator drew since.
  async function undoAction() {
    const entry = undo.at(-1);
    if (!entry || readOnly) return;
    const previous = applyStudioHistory(entry, "undo", board);
    try {
      await reconcileEmbedRows(previous);
    } catch (error) {
      setIoNotice(
        describeFailure(error, { fallback: "The board references could not be restored." }).message,
      );
      return;
    }
    setUndo((stack) => stack.slice(0, -1));
    setRedo((stack) => [...stack.slice(-79), entry]);
    // Replay again on the board as it is now: it can have moved on while the
    // embed rows were reconciled.
    const settled = normalizeWhiteboardContent(
      applyStudioHistory(entry, "undo", boardRef.current),
    );
    boardRef.current = settled;
    onChange(settled);
  }
  async function redoAction() {
    const entry = redo.at(-1);
    if (!entry || readOnly) return;
    const next = applyStudioHistory(entry, "redo", board);
    try {
      await reconcileEmbedRows(next);
    } catch (error) {
      setIoNotice(
        describeFailure(error, { fallback: "The board references could not be restored." }).message,
      );
      return;
    }
    setRedo((stack) => stack.slice(0, -1));
    setUndo((stack) => [...stack.slice(-79), entry]);
    // Replay again on the board as it is now: it can have moved on while the
    // embed rows were reconciled.
    const settled = normalizeWhiteboardContent(
      applyStudioHistory(entry, "redo", boardRef.current),
    );
    boardRef.current = settled;
    onChange(settled);
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
  async function deleteSelected() {
    if (selectedEdgeId && !selectedNodeIds.length) {
      deleteEdge(selectedEdgeId);
      return;
    }
    if (!selectedNodeIds.length) return;
    const removing = withDescendants(selectedNodeIds);
    const removedEmbedIds = board.nodes.flatMap((node) =>
      removing.has(node.id) &&
      node.type === "embed" &&
      typeof objectRecord(node.content).embedId === "string"
        ? [String(objectRecord(node.content).embedId)]
        : [],
    );
    if (removedEmbedIds.length) {
      try {
        await removeReferences({
          embedIds: removedEmbedIds.map(
            (embedId) => embedId as Id<"artifactEmbeds">,
          ),
        });
      } catch (error) {
        setIoNotice(
          describeFailure(error, { fallback: "The linked work could not be removed." }).message,
        );
        return;
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
  /**
   * A connector is an object, not decoration: it can be relabelled, reversed and
   * deleted. Before this, an edge could only be created, and a mislabelled one
   * could only be fixed by deleting the notes it joined.
   */
  function updateEdge(edgeId: string, recipe: (edge: WhiteboardEdge) => void) {
    mutate((draft) => {
      const edge = draft.edges.find((candidate) => candidate.id === edgeId);
      if (edge) recipe(edge);
    });
  }
  function deleteEdge(edgeId: string) {
    mutate((draft) => {
      draft.edges = draft.edges.filter((edge) => edge.id !== edgeId);
    });
    setSelectedEdgeId(undefined);
  }

  /**
   * Duplicate: the copies land offset and selected, and connectors that ran
   * between the copied objects are copied too, so duplicating a labelled cluster
   * gives you a labelled cluster rather than loose notes.
   */
  function duplicateSelected() {
    const originals = board.nodes.filter((node) =>
      selectedNodeIds.includes(node.id),
    );
    insertCopies(originals, board.edges, gridSize * 2);
  }

  function insertCopies(
    originals: WhiteboardNode[],
    edges: readonly WhiteboardEdge[],
    offset: number,
  ) {
    if (!originals.length || readOnly) return;
    const idMap = new Map(
      originals.map((node) => [node.id, `${node.type}-${uniqueToken()}`]),
    );
    const top = board.nodes.length + 1;
    mutate((draft) => {
      originals.forEach((node, index) => {
        draft.nodes.push({
          ...clone(node),
          id: idMap.get(node.id)!,
          pageId: page.id,
          x: node.x + offset,
          y: node.y + offset,
          zIndex: top + index,
          parentId: node.parentId ? idMap.get(node.parentId) : undefined,
          frameId: node.frameId
            ? (idMap.get(node.frameId) ?? node.frameId)
            : undefined,
        });
      });
      for (const edge of edges.filter(
        (candidate) => idMap.has(candidate.from) && idMap.has(candidate.to),
      ))
        draft.edges.push({
          ...clone(edge),
          id: `edge-${uniqueToken()}`,
          pageId: page.id,
          from: idMap.get(edge.from)!,
          to: idMap.get(edge.to)!,
        });
    });
    setSelectedNodeIds([...idMap.values()]);
    setSelectedEdgeId(undefined);
  }

  const setZoom = (zoom: number) =>
    setViewport((current) => ({
      ...current,
      zoom: Math.max(0.1, Math.min(4, zoom)),
    }));

  /**
   * The page's objects in reading order: declared accessibility order first,
   * then top-to-bottom, left-to-right. The outline, keyboard traversal and the
   * screen-reader summary all use this one order, so what you hear, what you
   * read and what Tab reaches cannot disagree.
   */
  const outlineNodes = useMemo(
    () =>
      [...nodes].sort(
        (a, b) =>
          (a.accessibilityOrder ?? 0) - (b.accessibilityOrder ?? 0) ||
          a.y - b.y ||
          a.x - b.x,
      ),
    [nodes],
  );

  /** Reveals a connector: selects it and frames both objects it joins. */
  const revealEdge = useCallback(
    (edge: WhiteboardEdge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      setSelectedNodeIds([]);
      setSelectedEdgeId(edge.id);
      setInspectorOpen(true);
      const box = boundsOf([from, to].filter(Boolean) as WhiteboardNode[]);
      if (box) frameBox(box);
    },
    [frameBox, nodeById],
  );

  /** Arrow-key move. One pixel for precision, one grid step with Shift. */

  function nudgeSelected(deltaX: number, deltaY: number) {
    const movable = selectedNodes.filter(
      (node) =>
        !node.locked &&
        !layers.find((layer) => layer.id === node.layerId)?.locked,
    );
    if (!movable.length || readOnly) return false;
    const moving = withDescendants(movable.map((node) => node.id));
    mutate((draft) => {
      for (const node of draft.nodes)
        if (moving.has(node.id)) {
          node.x += deltaX;
          node.y += deltaY;
        }
    });
    return true;
  }

  /**
   * The board's keyboard layer. `work/registry` promises a pointer-free path
   * through this type, so every operation it declares is here: move, pan, zoom,
   * fit, select all, duplicate, group, delete, undo and redo.
   */
  function canvasKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      (event.target as HTMLElement).matches(
        "input, textarea, [contenteditable='true']",
      )
    )
      return;
    const step = event.shiftKey ? gridSize : 1;
    const accel = event.ctrlKey || event.metaKey;
    const key = event.key;
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const arrow = arrows[key];
    if (key === "Tab" && !accel) {
      // `spatial outline and keyboard node traversal` is the declared
      // accessibility model for this type, so Tab walks the objects in reading
      // order and reveals each one. It deliberately does not wrap: at either end
      // the selection is released and focus leaves the canvas normally, so this
      // is traversal rather than a keyboard trap.
      const at = outlineNodes.findIndex((node) => node.id === selectedNodeId);
      const next = event.shiftKey
        ? at < 0
          ? outlineNodes.length - 1
          : at - 1
        : at + 1;
      const target = outlineNodes[next];
      if (!target) {
        setSelectedNodeIds([]);
        return;
      }
      event.preventDefault();
      revealNode(target);
      return;
    }
    if (arrow && !accel) {
      event.preventDefault();
      // With nothing selected the same keys pan, so the canvas is reachable
      // without a pointer instead of trapping keyboard users at the origin.
      if (!nudgeSelected(arrow[0] * step, arrow[1] * step))
        setViewport((current) => ({
          ...current,
          x: current.x + (arrow[0] * 120) / current.zoom,
          y: current.y + (arrow[1] * 120) / current.zoom,
        }));
      return;
    }
    if (key === "Escape") {
      setSelectedNodeIds([]);
      setSelectedEdgeId(undefined);
      setConnectorFrom(undefined);
      return;
    }
    if (
      (key === "Delete" || key === "Backspace") &&
      (selectedNodeIds.length || selectedEdgeId)
    ) {
      event.preventDefault();
      void deleteSelected();
      return;
    }
    // Zoom keys stay off the modifier: Ctrl+Plus, Ctrl+Minus and Ctrl+0 are the
    // browser's own zoom, and a canvas has no business taking them.
    if ((key === "+" || key === "=") && !accel) {
      event.preventDefault();
      setZoom(viewport.zoom * 1.2);
      return;
    }
    if ((key === "-" || key === "_") && !accel) {
      event.preventDefault();
      setZoom(viewport.zoom / 1.2);
      return;
    }
    if (key === "0" && !accel) {
      event.preventDefault();
      fitToContent();
      return;
    }
    if (!accel) return;
    const letter = key.toLowerCase();
    if (letter === "g") {
      event.preventDefault();
      if (event.shiftKey) ungroupSelected();
      else groupSelected();
    } else if (letter === "d") {
      event.preventDefault();
      duplicateSelected();
    } else if (letter === "a") {
      event.preventDefault();
      setSelectedNodeIds(nodes.map((node) => node.id));
    } else if (letter === "z") {
      event.preventDefault();
      if (event.shiftKey) void redoAction();
      else void undoAction();
    } else if (letter === "y") {
      event.preventDefault();
      void redoAction();
    }
  }

  /**
   * Copy, cut and paste on the canvas. Copied objects travel as their text
   * (so a note pastes into a document or chat) and are also kept here with
   * their connectors, which answer a paste while the system clipboard still
   * holds that text. A pasted image is uploaded like an inserted one; pasted
   * text from anywhere else becomes a text object or, when long, a sticky.
   */
  function canvasClipboard(
    event: ReactClipboardEvent<HTMLDivElement>,
    action: "copy" | "cut" | "paste",
  ) {
    if (
      (event.target as HTMLElement).matches(
        "input, textarea, [contenteditable='true']",
      )
    )
      return;
    if (action === "paste") {
      if (readOnly) return;
      const image = Array.from(event.clipboardData.files).find((file) =>
        file.type.startsWith("image/"),
      );
      if (image) {
        event.preventDefault();
        void insertImage(image);
        return;
      }
      const text = event.clipboardData.getData("text/plain");
      const copied = boardClipboardRef.current;
      if (
        copied &&
        normalizeBoardClipboardText(text) === normalizeBoardClipboardText(copied.text)
      ) {
        event.preventDefault();
        copied.pastes += 1;
        insertCopies(copied.nodes, copied.edges, gridSize * 2 * copied.pastes);
        return;
      }
      if (!text.trim()) return;
      event.preventDefault();
      pasteTextNode(text.trim());
      return;
    }
    const originals = board.nodes.filter((node) =>
      selectedNodeIds.includes(node.id),
    );
    if (!originals.length) return;
    event.preventDefault();
    const ids = new Set(originals.map((node) => node.id));
    const text = originals
      .map((node) => {
        const content = (node.content ?? {}) as Record<string, unknown>;
        const label = [content.text, content.title, node.semanticLabel].find(
          (value): value is string => typeof value === "string" && Boolean(value.trim()),
        );
        return label ?? node.type;
      })
      .join("\n");
    boardClipboardRef.current = {
      text,
      nodes: clone(originals),
      edges: clone(
        board.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
      ),
      pastes: 0,
    };
    event.clipboardData.setData("text/plain", text);
    if (action === "cut" && !readOnly) void deleteSelected();
  }

  function pasteTextNode(text: string) {
    const layer = layers.find(
      (candidate) => !candidate.locked && candidate.visible,
    );
    if (!layer || readOnly) return;
    const long = text.length > 60 || text.includes("\n");
    const bounds = canvasRef.current?.getBoundingClientRect();
    const center = worldPoint(
      (bounds?.left ?? 0) + (bounds?.width ?? 800) / 2,
      (bounds?.top ?? 0) + (bounds?.height ?? 600) / 2,
    );
    const node = createWhiteboardNode(
      long ? "note" : "text",
      page.id,
      layer.id,
      snap(center.x - 120),
      snap(center.y - 75),
      board.nodes.length + 1,
    );
    node.content = { ...((node.content ?? {}) as Record<string, unknown>), text };
    mutate((draft) => draft.nodes.push(node));
    setSelectedNodeId(node.id);
    onActiveRegionChange?.(node.id);
  }

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
        sha256: await artifactBlobSha256(file),
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

  function downloadBoard(name: string, type: string, body: string) {
    downloadDocumentBlob(name, new Blob([body], { type }));
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
          downloadDocumentBlob(exportName("png"), blob);
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
    const bytes = new Uint8Array(await file.arrayBuffer());
    enforcePdfInput(bytes);
    const pdfOptions = {
      data: bytes,
      useWorkerFetch: false,
      disableFontFace: true,
      enableScripting: false,
    };
    const pdfDocument = await pdfjs.getDocument(pdfOptions).promise;
    if (pdfDocument.numPages > 100) {
      await pdfDocument.cleanup();
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
          sha256: await artifactBlobSha256(blob),
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
      await pdfDocument.cleanup();
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
        sha256: await artifactBlobSha256(file),
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
      // The import was converted from the board as it was when it began; the
      // original's upload and the conversion take time. Replay it onto the
      // board as it is now, so an edit made meanwhile is not reverted.
      emit(commitStudioGesture(board, imported.content, boardRef.current));
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
        created.slice(1).forEach((node) =>
          draft.edges.push({
            id: `edge-${uniqueToken()}`,
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
        onPointerDown={compact ? undefined : beginCanvasPointer}
        onPointerMove={compact ? undefined : movePointer}
        onPointerUp={compact ? undefined : finishPointer}
        onPointerCancel={compact ? undefined : finishPointer}
        onFocus={compact ? undefined : beginTyping}
        onBlur={compact ? undefined : finishTyping}
        onWheel={compact ? undefined : wheel}
        onKeyDown={compact ? undefined : canvasKeyDown}
        onCopy={compact ? undefined : (event) => canvasClipboard(event, "copy")}
        onCut={compact ? undefined : (event) => canvasClipboard(event, "cut")}
        onPaste={compact ? undefined : (event) => canvasClipboard(event, "paste")}
      >
        <div
          className="whiteboard-world"
          style={{
            transform: `translate(${-viewport.x * viewport.zoom}px, ${-viewport.y * viewport.zoom}px) scale(${viewport.zoom})`,
          }}
        >
          <svg className="whiteboard-edges" aria-label="Connectors">
            {renderedEdges.map((edge) => {
              const from = nodeById.get(edge.from);
              const to = nodeById.get(edge.to);
              if (
                !from ||
                !to ||
                !visibleLayerIds.has(from.layerId) ||
                !visibleLayerIds.has(to.layerId)
              )
                return null;
              const index = edgeIndexById.get(edge.id) ?? -1;
              const changed =
                index >= 0 &&
                (pathTouches(aiChangedPaths, `/edges/${index}`) ||
                  pathTouches(aiChangedPaths, `/edges/${edge.id}`));
              // Both ends are read from the live nodes, so a connector follows
              // whatever it is attached to, and the label sits on the midpoint of
              // the line that is actually drawn rather than floating beside it.
              const x1 = centerX(from);
              const y1 = centerY(from);
              const x2 = centerX(to);
              const y2 = centerY(to);
              const selected = !compact && selectedEdgeId === edge.id;
              return (
                <g
                  key={edge.id}
                  data-ai-region={aiRegionAttr(changed)}
                  data-selected={selected || undefined}
                  {...(index >= 0 ? targetAttrs(`/edges/${index}`) : {})}
                >
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    style={
                      selected
                        ? { stroke: "var(--brand-primary)", strokeWidth: 2.5 }
                        : undefined
                    }
                  />
                  <circle
                    cx={x2}
                    cy={y2}
                    r="3"
                    style={
                      selected ? { fill: "var(--brand-primary)" } : undefined
                    }
                  />
                  {edge.label ? (
                    <text x={(x1 + x2) / 2} y={(y1 + y2) / 2}>
                      {edge.label}
                    </text>
                  ) : null}
                  {compact ? null : (
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      // A 1.35px line is not a pointer target. This invisible
                      // twin is what makes a connector selectable at all.
                      style={{
                        stroke: "transparent",
                        strokeWidth: 16,
                        vectorEffect: "non-scaling-stroke",
                        pointerEvents: "stroke",
                        cursor: "pointer",
                      }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        selectionHandledRef.current = true;
                        setSelectedNodeIds([]);
                        setSelectedEdgeId(edge.id);
                        setInspectorOpen(true);
                      }}
                    >
                      <title>
                        {edge.label
                          ? `Connector: ${edge.label}`
                          : `Connector from ${whiteboardNodeText(from) || "object"} to ${whiteboardNodeText(to) || "object"}`}
                      </title>
                    </line>
                  )}
                </g>
              );
            })}
            {guides.x !== undefined || guides.y !== undefined ? (
              <g
                style={{
                  stroke: "var(--brand-primary)",
                  strokeWidth: 1,
                  strokeDasharray: "5 4",
                  opacity: 0.9,
                }}
              >
                {guides.x !== undefined ? (
                  <line
                    x1={guides.x}
                    x2={guides.x}
                    y1={viewport.y}
                    y2={viewport.y + canvasSize.height / viewport.zoom}
                    style={{ stroke: "var(--brand-primary)" }}
                  />
                ) : null}
                {guides.y !== undefined ? (
                  <line
                    y1={guides.y}
                    y2={guides.y}
                    x1={viewport.x}
                    x2={viewport.x + canvasSize.width / viewport.zoom}
                    style={{ stroke: "var(--brand-primary)" }}
                  />
                ) : null}
              </g>
            ) : null}
            {marquee ? (
              <rect
                x={marquee.x}
                y={marquee.y}
                width={marquee.width}
                height={marquee.height}
                vectorEffect="non-scaling-stroke"
                style={{
                  fill: "color-mix(in srgb, var(--brand-primary) 10%, transparent)",
                  stroke: "var(--brand-primary)",
                  strokeWidth: 1,
                  strokeDasharray: "4 3",
                }}
              />
            ) : null}
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
                  assetsLoading={assetsLoading}
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
        {!compact && minimap ? (
          <button
            type="button"
            className="whiteboard-minimap"
            aria-label="Board overview"
            title="Click to move the view. Enter fits the whole board."
            style={{
              // The composer floats over the canvas, so a fixed 15px inset put
              // the overview underneath it. The shell publishes its height.
              bottom: "calc(15px + var(--spectra-composer-safe-area, 0px))",
              cursor: "pointer",
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              selectionHandledRef.current = true;
              // Keyboard activation has no coordinates, so Enter fits instead of
              // silently jumping the view to the top-left corner.
              if (event.detail === 0) {
                fitToContent();
                return;
              }
              const bounds = event.currentTarget.getBoundingClientRect();
              const point = minimap.toWorld(
                event.clientX - bounds.left,
                event.clientY - bounds.top,
              );
              frameBox({
                left: point.x,
                top: point.y,
                right: point.x,
                bottom: point.y,
              });
            }}
          >
            {minimap.dots.map((dot) => (
              <i
                key={dot.id}
                style={{
                  left: dot.x,
                  top: dot.y,
                  width: dot.width,
                  height: dot.height,
                  transform: "none",
                  background: dot.selected ? "var(--brand-primary)" : undefined,
                }}
              />
            ))}
            <span
              style={{
                inset: "auto",
                left: minimap.view.x,
                top: minimap.view.y,
                width: minimap.view.width,
                height: minimap.view.height,
              }}
            />
          </button>
        ) : null}
      </div>
    );
  }

  // The tool palette. The bar keeps the four tools a board is actually built
  // with; at `tight` the other two promote into the one overflow menu rather
  // than being clipped by a rail that scrolls sideways.
  const barPalette = tight ? BOARD_PALETTE.slice(0, 4) : BOARD_PALETTE;
  const menuPalette = BOARD_PALETTE.slice(barPalette.length);
  const openPanel = (next: typeof panel) =>
    setPanel(panel === next ? "none" : next);
  /**
   * Every board control the bar can show, declared once. `essential` is capped at
   * five by the contract, `advanced` is the single `More tools` menu, and every
   * item appears in exactly one of them, which is what kept two overflow menus
   * from being open at the same time in the audit shot.
   */
  const boardActions: CommandBinding[] = [
    {
      id: "undo",
      label: "Undo",
      icon: Undo2,
      priority: "essential",
      requires: "edit",
      disabled: !canEdit || !undo.length,
      hint: "Ctrl+Z",
      onSelect: undoAction,
    },
    {
      id: "redo",
      label: "Redo",
      icon: Redo2,
      priority: "essential",
      requires: "edit",
      disabled: !canEdit || !redo.length,
      hint: "Ctrl+Shift+Z",
      onSelect: redoAction,
    },
    {
      id: "zoom-out",
      label: "Zoom out",
      icon: ZoomOut,
      priority: "essential",
      hint: "Minus",
      onSelect: () => setZoom(viewport.zoom / 1.2),
    },
    {
      id: "zoom-in",
      label: "Zoom in",
      icon: ZoomIn,
      priority: "essential",
      hint: "Plus",
      onSelect: () => setZoom(viewport.zoom * 1.2),
    },
    {
      id: "fit",
      label: "Fit to content",
      icon: Scan,
      priority: "essential",
      disabled: !nodes.length,
      hint: "0",
      onSelect: fitToContent,
    },
    ...(contract.surface === "full"
      ? [
          {
            id: "pages",
            label: pageRailCollapsed ? "Show pages" : "Hide pages",
            icon: PanelLeft,
            priority: "essential" as const,
            active: !pageRailCollapsed,
            onSelect: () => setPageRailCollapsed((collapsed) => !collapsed),
          },
        ]
      : []),
    ...[...menuPalette, ...BOARD_OBJECTS].map(([id, icon, label]) => ({
      id: `tool-${id}`,
      label,
      icon,
      priority: "advanced" as const,
      requires: "edit" as const,
      active: tool === id,
      disabled: !canEdit,
      onSelect: () => setTool(id),
    })),
    {
      id: "add-image",
      label: uploadingImage ? "Adding image" : "Add image",
      icon: uploadingImage ? Upload : ImagePlus,
      priority: "advanced",
      requires: "edit",
      disabled: !canEdit || uploadingImage,
      onSelect: () => imageInputRef.current?.click(),
    },
    {
      id: "import",
      label: "Import board",
      icon: FileUp,
      priority: "advanced",
      requires: "edit",
      disabled: !canEdit,
      onSelect: () => boardInputRef.current?.click(),
    },
    {
      id: "snap",
      label: "Snap to grid",
      icon: Magnet,
      // A set-and-forget board setting, not a per-second control, and keeping it
      // out of the bar leaves the trailing cluster inside the narrowest pane the
      // registry allows (460) without the tool rail clipping.
      priority: "advanced",
      requires: "edit",
      active: snapToGrid,
      disabled: !canEdit,
      hint: "Aligns moves and resizes to the board grid",
      onSelect: () =>
        mutate((draft) => {
          draft.settings = { ...draft.settings, snapToGrid: !snapToGrid };
        }),
    },
    ...BOARD_PANELS.map(([id, icon, label, needsEdit]) => ({
      id: `panel-${id}`,
      label,
      icon,
      priority: "advanced" as const,
      active: panel === id,
      ...(needsEdit
        ? { requires: "edit" as const, disabled: !canEdit }
        : undefined),
      onSelect: () => openPanel(id),
    })),
    {
      id: "present",
      label: "Present board",
      icon: Presentation,
      priority: "advanced",
      // A viewing activity with an obvious exit, not a peer mode (D2). The bar
      // removes it outright for anyone without the capability.
      requires: "present",
      keepLabel: true,
      onSelect: () => setPresenting(canPresent),
    },
    ...BOARD_EXPORTS.map(([format, icon, label]) => ({
      id: `export-${format}`,
      label,
      icon,
      priority: "advanced" as const,
      disabled: Boolean(ioBusy),
      onSelect: () => void exportBoard(format),
    })),
  ];

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
      <ArtifactWorkbar
        label="Board tools"
        selectionContext={selectedNode ? "Shape" : undefined}
        // CANON D2/D3: a board has no genuine peer views. Edit and View were a
        // permission printed as a tab pair, which is exactly what D1 forbids.
        modes={[]}
        selector={
          <WorkbarItemSelector
            ariaLabel="Page"
            itemNoun="page"
            value={page.id}
            onChange={(pageId) =>
              setViewport((current) => ({ ...current, pageId, x: 0, y: 0 }))
            }
            items={board.pages.map((candidate) => ({
              value: candidate.id,
              label: candidate.name,
            }))}
          />
        }
        context={undefined}
        className="shrink-0"
        actions={projectBindingsFromIr("whiteboard", [
          ...boardActions,
          ...barPalette.map(([id, Icon, label]) => ({
            id: `tool-${id}`,
            label,
            icon: Icon,
            priority: "essential" as const,
            active: tool === id,
            disabled: !canEdit && id !== "select" && id !== "hand",
            onSelect: () => setTool(id),
          })),
        ])}
        trailing={
          <span className="spectra-workbar-count" title="Zoom level">
            {Math.round(viewport.zoom * 100)}%
          </span>
        }
      />

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

      <div className="whiteboard-shell spectra-composer-clearance">
        {contract.surface === "full" ? (
          <StudioItemRail
            label="Pages"
            count={board.pages.length}
            collapsed={pageRailCollapsed}
            onToggleCollapsed={() =>
              setPageRailCollapsed((collapsed) => !collapsed)
            }
            items={board.pages.map((candidate) => ({
              id: candidate.id,
              title: candidate.name,
              subtitle: `${board.nodes.filter((node) => node.pageId === candidate.id).length} objects`,
              active: candidate.id === page.id,
            }))}
            onSelect={(pageId) => setViewport({ pageId, x: 0, y: 0, zoom: 1 })}
            onAdd={readOnly ? undefined : addPage}
            addLabel="Add page"
            canEdit={!readOnly}
          />
        ) : null}
        {panel !== "none" &&
        !(contract.surface === "full" && panel === "layers") ? (
          <aside
            className={
              contract.surface === "full"
                ? "whiteboard-panel spectra-studio-inspector-overlay"
                : "whiteboard-panel"
            }
          >
            <header>
              <strong>
                {panel === "layers"
                  ? "Pages and layers"
                  : panel === "outline"
                    ? "Accessible outline"
                    : panel === "search"
                      ? "Find on board"
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
                      data-active={node.id === selectedNodeId || undefined}
                      onClick={() => revealNode(node)}
                    >
                      <strong>
                        {whiteboardNodeText(node) ||
                          node.semanticLabel ||
                          NODE_NOUNS[node.type]}
                      </strong>
                      <small>{NODE_NOUNS[node.type]}</small>
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
              <>
                {outlineNodes.map((node, index) => {
                  const connections = board.edges.filter(
                    (edge) => edge.from === node.id || edge.to === node.id,
                  ).length;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      data-active={node.id === selectedNodeId || undefined}
                      onClick={() => revealNode(node)}
                    >
                      <strong>
                        {index + 1}.{" "}
                        {node.semanticLabel ||
                          whiteboardNodeText(node) ||
                          NODE_NOUNS[node.type]}
                      </strong>
                      {/* Honest metadata only: what it is, how many connectors
                          reach it, and whether it can be moved. */}
                      <small>
                        {NODE_NOUNS[node.type]}
                        {connections
                          ? ` · ${connections} connector${connections === 1 ? "" : "s"}`
                          : ""}
                        {node.locked ? " · locked" : ""}
                      </small>
                    </button>
                  );
                })}
                {edges.map((edge) => {
                  const from = nodeById.get(edge.from);
                  const to = nodeById.get(edge.to);
                  if (!from || !to) return null;
                  return (
                    <button
                      key={edge.id}
                      type="button"
                      data-active={edge.id === selectedEdgeId || undefined}
                      onClick={() => revealEdge(edge)}
                    >
                      <strong>{edge.label || "Connector"}</strong>
                      <small>
                        {whiteboardNodeText(from) ||
                          from.semanticLabel ||
                          NODE_NOUNS[from.type]}{" "}
                        to{" "}
                        {whiteboardNodeText(to) ||
                          to.semanticLabel ||
                          NODE_NOUNS[to.type]}
                      </small>
                    </button>
                  );
                })}
                {!outlineNodes.length ? (
                  <p className="px-3 py-2 text-caption text-[var(--text-secondary)]">
                    This page has nothing on it yet.
                  </p>
                ) : null}
              </>
            )}
          </aside>
        ) : null}

        <main>
          {renderCanvas()}
          {!board.nodes.some((node) => node.pageId === page.id) ? (
            /* The registry owns this copy, so an empty board says the same
               thing here, in a tile and in a reference (D14). */
            <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
              <div className="pointer-events-auto flex max-w-[330px] flex-col items-center gap-2 rounded-card border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-5 py-4 text-center">
                <strong className="text-ui font-semibold text-[var(--text-primary)]">
                  {definition.emptyState.headline}
                </strong>
                <p className="text-caption text-[var(--text-secondary)]">
                  {definition.emptyState.body}
                </p>
                {canEdit ? (
                  <button
                    type="button"
                    className="spectra-workbar-primary mt-1 inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-control px-3 text-caption font-semibold"
                    onClick={() => addNode("note")}
                  >
                    <StickyNote className="size-3.5" />
                    {definition.emptyState.action}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
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
          {selectedEdge && inspectorOpen ? (
            /* A connector is editable in the same panel its objects are, so
               labelling the line joining two notes does not mean deleting it. */
            <div className="whiteboard-inspector">
              <div>
                <strong>Connector</strong>
                <button
                  type="button"
                  title="Reverse direction"
                  disabled={!canEdit}
                  onClick={() =>
                    updateEdge(selectedEdge.id, (edge) => {
                      const from = edge.from;
                      edge.from = edge.to;
                      edge.to = from;
                    })
                  }
                >
                  <Repeat2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Delete connector"
                  disabled={!canEdit}
                  onClick={() => deleteEdge(selectedEdge.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <label>
                Label
                <input
                  value={selectedEdge.label ?? ""}
                  disabled={!canEdit}
                  placeholder="How these connect"
                  onChange={(event) =>
                    updateEdge(selectedEdge.id, (edge) => {
                      edge.label = event.target.value || undefined;
                    })
                  }
                />
              </label>
              <label>
                Layer
                <SelectField
                  ariaLabel="Connector layer"
                  size="sm"
                  value={selectedEdge.layerId}
                  disabled={!canEdit}
                  options={layers.map((layer) => ({
                    value: layer.id,
                    label: layer.name,
                  }))}
                  onChange={(value) =>
                    updateEdge(selectedEdge.id, (edge) => {
                      edge.layerId = value;
                    })
                  }
                />
              </label>
            </div>
          ) : null}
          {selectedNode && selectedNodeIds.length === 1 && inspectorOpen ? (
            <div className="whiteboard-inspector">
              <div>
                <strong>
                  {selectedNode.semanticLabel || NODE_NOUNS[selectedNode.type]}
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
                <SelectField
                  ariaLabel="Object layer"
                  size="sm"
                  value={selectedNode.layerId}
                  disabled={readOnly || selectedNode.locked}
                  options={layers.map((layer) => ({
                    value: layer.id,
                    label: layer.name,
                  }))}
                  onChange={(value) =>
                    updateSelected((node) => {
                      node.layerId = value;
                    })
                  }
                />
              </label>
              <div className="whiteboard-color-fields">
                <label>
                  Fill
                  <input
                    type="color"
                    value={String(styleValue(selectedNode, "fill", "var(--bg-elevated)"))}
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
                  Linked work
                  <SelectField
                    ariaLabel="Linked work"
                    size="sm"
                    disabled={readOnly || linkingEmbed}
                    value={
                      String(
                        (selectedNode.content as Record<string, unknown>)
                          ?.sourceArtifactId ??
                          (selectedNode.content as Record<string, unknown>)
                            ?.artifactId ??
                          "",
                      ) || "none"
                    }
                    options={[
                      { value: "none", label: "No source" },
                      ...artifacts
                        .filter(
                          (artifact) =>
                            artifact._id !== artifactId &&
                            artifact.status === "active",
                        )
                        .map((artifact) => ({
                          value: artifact._id,
                          label: artifact.title,
                        })),
                    ]}
                    onChange={(value) => void linkSelectedEmbed(value)}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
        </main>
      </div>

      {presenting && canPresent
        ? // The studio root is now a container query context, which makes it the
          // containing block for `position: fixed` descendants: an in-tree
          // presenter would be trapped inside the pane instead of covering the
          // window. Present is a full-window activity, so it renders to the body.
          createPortal(
            <div
              ref={presenterRef}
              tabIndex={-1}
              className="whiteboard-presenter"
              role="dialog"
              aria-modal="true"
              aria-label="Whiteboard presentation"
            >
              <div className="whiteboard-presenter-bar">
                <strong>{page.name}</strong>
                <button type="button" onClick={() => setPresenting(false)}>
                  <X className="h-5 w-5" /> Exit presentation
                </button>
              </div>
              {renderCanvas(true)}
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
