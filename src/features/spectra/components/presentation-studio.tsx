"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bold,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  FileArchive,
  Group as GroupIcon,
  ImagePlus,
  Italic,
  Layers3,
  LayoutTemplate,
  Link2,
  List,
  Lock,
  MonitorOff,
  MonitorPlay,
  Palette,
  Play,
  Plus,
  Redo2,
  SlidersHorizontal,
  Square,
  StickyNote,
  Table2,
  Trash2,
  Type,
  Underline,
  Undo2,
  Ungroup,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { LocalAutocompleteTextarea } from "../compute/autocomplete";
import {
  createPresentationObject,
  createPresentationSlide,
  normalizePresentationContent,
  presentationObjectText,
  withPresentationObjectText,
  type PresentationContent,
  type PresentationObject,
  type PresentationObjectType,
  type PresentationSlide,
} from "../presentation/model";
import {
  applyBibliographySlides,
  BIBLIOGRAPHY_SLIDE_MARKER,
  collectDeckCitations,
} from "../presentation/bibliography";
import {
  abortArtifactImportUpload,
  beginArtifactImportOriginal,
  completeArtifactImport,
  getArtifactAssets,
  getArtifactImports,
  postSpectra,
  uploadArtifactAsset,
  uploadArtifactImportOriginal,
  type SpectraArtifact,
  type SpectraArtifactImport,
  type SpectraArtifactAsset,
} from "../data/api";
import {
  buildPresentationOdp,
  buildPresentationPdf,
  buildPresentationPngArchive,
  buildPresentationPptx,
  importPresentationFile,
} from "../presentation/io";
import { aiRegionAttr, pathTouches } from "./ai-region-path";
import { targetAttrs } from "../collaboration/target-attributes";
import {
  ArtifactWorkbar,
  WorkbarItemSelector,
  type CommandBinding,
} from "./artifact-workbar";
import { useStudioContract } from "./artifact-studio-shell";
import { StudioItemRail } from "./studio-item-rail";
import { SelectField } from "@/components/ui/select";
import {
  calculateWorkbook,
  coordinateToAddress,
  normalizeSheetsContent,
  parseRange,
} from "../sheets/model";

/**
 * Slides and Notes are the deck's two views; both come from `work/registry`
 * through the studio contract. Present is not one of them: it is an activity
 * with an obvious exit, reached from the bar's primary verb (CANON D2/D3).
 */
type PresentationSurface = "slides" | "notes";
/** Sections of the type's own inspector pane, not modes. */
type InspectorSection = "slide" | "insert" | "design" | "sources" | "files";
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type DragState = {
  mode: "move" | "resize";
  handle?: ResizeHandle;
  objectId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  snapshot: PresentationContent;
};

const TRANSITION_OPTIONS = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "push", label: "Push" },
  { value: "dissolve", label: "Dissolve" },
] as const;
const OBJECT_ANIMATION_OPTIONS = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "rise", label: "Rise" },
  { value: "scale", label: "Scale" },
  { value: "wipe", label: "Wipe" },
] as const;
const IMAGE_FIT_OPTIONS = [
  { value: "contain", label: "Fit inside" },
  { value: "cover", label: "Crop to fill" },
] as const;
const IMAGE_MASK_OPTIONS = [
  { value: "none", label: "None" },
  { value: "rounded", label: "Rounded" },
  { value: "circle", label: "Circle" },
] as const;
const ASPECT_RATIO_OPTIONS = [
  { value: "16:9", label: "16:9 widescreen" },
  { value: "4:3", label: "4:3 standard" },
] as const;
const LAYOUT_OPTIONS = [
  { value: "title-content", label: "Title and content" },
  { value: "title-only", label: "Title only" },
  { value: "two-column", label: "Two columns" },
  { value: "title-visual-text", label: "Title, visual and text" },
  { value: "visual-story", label: "Visual story" },
  { value: "three-ideas", label: "Three ideas" },
  { value: "statement", label: "Statement" },
  { value: "full-bleed", label: "Full bleed" },
  { value: "blank", label: "Blank" },
] as const;
const TEXT_PRESET_OPTIONS = [
  { value: "title", label: "Title" },
  { value: "subtitle", label: "Subtitle" },
  { value: "body", label: "Body" },
  { value: "caption", label: "Caption" },
] as const;
/**
 * Radix refuses an item whose value is the empty string, so "nothing chosen" has
 * to be a real token rather than "".
 */
const NO_SELECTION = "__none__";
const INSPECTOR_SECTIONS = [
  { value: "slide", label: "Slide and objects" },
  { value: "insert", label: "Insert" },
  { value: "design", label: "Design" },
  { value: "sources", label: "Sources" },
  { value: "files", label: "Files" },
] as const;
/**
 * Object formatting, declared once. Each tool states what it toggles and how it
 * reads its own state, so the pane cannot show a pressed control that is not.
 */
const OBJECT_FORMAT_TOOLS: ReadonlyArray<{
  id: string;
  icon: LucideIcon;
  label: (object: PresentationObject) => string;
  pressed?: (object: PresentationObject) => boolean;
  apply: (object: PresentationObject) => void;
}> = [
  {
    id: "bold",
    icon: Bold,
    label: () => "Bold",
    pressed: (object) => Number(styleValue(object, "fontWeight", 400)) >= 600,
    apply: (object) => {
      object.style = {
        ...object.style,
        fontWeight:
          Number(styleValue(object, "fontWeight", 400)) >= 600 ? 400 : 700,
      };
    },
  },
  {
    id: "italic",
    icon: Italic,
    label: () => "Italic",
    pressed: (object) => Boolean(styleValue(object, "italic", false)),
    apply: (object) => {
      object.style = {
        ...object.style,
        italic: !styleValue(object, "italic", false),
      };
    },
  },
  {
    id: "underline",
    icon: Underline,
    label: () => "Underline",
    pressed: (object) => Boolean(styleValue(object, "underline", false)),
    apply: (object) => {
      object.style = {
        ...object.style,
        underline: !styleValue(object, "underline", false),
      };
    },
  },
  ...(
    [
      ["left", AlignLeft, "Align left"],
      ["center", AlignCenter, "Align center"],
      ["right", AlignRight, "Align right"],
    ] as const
  ).map(([align, icon, label]) => ({
    id: `align-${align}`,
    icon,
    label: () => label,
    pressed: (object: PresentationObject) =>
      styleValue(object, "align", "left") === align,
    apply: (object: PresentationObject) => {
      object.style = { ...object.style, align };
    },
  })),
  {
    id: "bulleted-list",
    icon: List,
    label: () => "Bulleted list",
    apply: (object) => {
      const current = presentationObjectText(object);
      const lineBreak = "\n";
      Object.assign(
        object,
        withPresentationObjectText(
          object,
          current.startsWith("• ")
            ? current.replace(/^• /gm, "")
            : current
                .split(lineBreak)
                .map((line) => `• ${line}`)
                .join(lineBreak),
        ),
      );
    },
  },
  {
    id: "lock",
    icon: Lock,
    label: (object) => (object.locked ? "Unlock object" : "Lock object"),
    pressed: (object) => Boolean(object.locked),
    apply: (object) => {
      object.locked = !object.locked;
    },
  },
];
const INSPECTOR_BUTTON =
  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-micro font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40";
const INSPECTOR_ICON_BUTTON =
  "grid size-8 shrink-0 place-items-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40";
/** Remembers whether the presenter wants notes on this device, not in the deck. */
const PRESENTER_NOTES_KEY = "spectra:presentation:presenter-notes";

/**
 * Ids have to be unique across the whole deck: `enumerateArtifactRegions`
 * refuses a duplicate region id, so two objects created inside the same
 * millisecond would break every anchor in the artifact, not just their own.
 */
let localIdCounter = 0;
function localId(prefix: string) {
  localIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${localIdCounter.toString(36)}`;
}

function smartGuide(
  position: number,
  size: number,
  limit: number,
  targets: number[],
) {
  const anchors = [position, position + size / 2, position + size];
  let best: { distance: number; delta: number; guide: number } | undefined;
  for (const anchor of anchors) {
    for (const target of targets) {
      const delta = target - anchor;
      const distance = Math.abs(delta);
      if (distance <= 8 && (!best || distance < best.distance))
        best = { distance, delta, guide: target };
    }
  }
  return best
    ? {
        position: Math.max(0, Math.min(limit - size, position + best.delta)),
        guide: best.guide,
      }
    : { position, guide: undefined };
}

const THEMES = [
  {
    id: "spectra-botanical",
    name: "Botanical",
    tokens: {
      background: "#fbfaf5",
      heading: "#173f35",
      body: "#324b43",
      accent: "#2f9a72",
      soft: "#dfeee4",
    },
  },
  {
    id: "spectra-cobalt",
    name: "Cobalt",
    tokens: {
      background: "#f7f9fd",
      heading: "#173252",
      body: "#38536d",
      accent: "#3278bf",
      soft: "#dce9f7",
    },
  },
  {
    id: "spectra-plum",
    name: "Plum",
    tokens: {
      background: "#fbf8fc",
      heading: "#452b54",
      body: "#644d6d",
      accent: "#8a5ca1",
      soft: "#eee3f2",
    },
  },
  {
    id: "spectra-graphite",
    name: "Graphite",
    tokens: {
      background: "#f7f6f3",
      heading: "#272924",
      body: "#51534d",
      accent: "#73776d",
      soft: "#e6e6df",
    },
  },
] as const;

function cloneDeck<T>(value: T): T {
  return structuredClone(value);
}

async function sha256Blob(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function presentationFileStem(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "spectra-presentation"
  );
}

function linkedChartValues(
  object: PresentationObject,
  artifacts: SpectraArtifact[],
) {
  if (object.sourceBinding?.kind !== "sheets_range") return undefined;
  const source = artifacts.find(
    (artifact) =>
      artifact._id === object.sourceBinding?.artifactId &&
      artifact.blueprintKey === "sheets" &&
      artifact.status === "active",
  );
  if (!source?.content) return null;
  const objectContent =
    object.content &&
    typeof object.content === "object" &&
    !Array.isArray(object.content)
      ? (object.content as Record<string, unknown>)
      : {};
  if (
    object.sourceBinding.live === false &&
    Array.isArray(objectContent.pinnedValues)
  ) {
    const pinned = objectContent.pinnedValues.filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    );
    return pinned.length ? pinned : null;
  }
  const workbook = normalizeSheetsContent(source.content);
  const rangeLabel = object.sourceBinding.range ?? "";
  const [sheetName, address] = rangeLabel.includes("!")
    ? [
        rangeLabel.slice(0, rangeLabel.lastIndexOf("!")),
        rangeLabel.split("!").at(-1)!,
      ]
    : [undefined, rangeLabel];
  const sheet =
    workbook.sheets.find((candidate) => candidate.name === sheetName) ??
    workbook.sheets.find(
      (candidate) => candidate.id === workbook.activeSheetId,
    ) ??
    workbook.sheets[0];
  const range = parseRange(address);
  if (!sheet || !range) return null;
  const calculated = calculateWorkbook(workbook);
  const values: number[] = [];
  for (let row = range.start.row; row <= range.end.row; row += 1) {
    for (
      let column = range.start.column;
      column <= range.end.column;
      column += 1
    ) {
      const cellAddress = coordinateToAddress({ row, column });
      const value =
        calculated.get(`${sheet.id}:${cellAddress}`)?.value ??
        sheet.cells[cellAddress]?.value;
      if (typeof value === "number" && Number.isFinite(value))
        values.push(value);
    }
  }
  return values.length ? values.slice(0, 200) : null;
}

function objectStyle(
  object: PresentationObject,
  canvasHeight: number,
): CSSProperties {
  return {
    left: `${(object.x / 1_000) * 100}%`,
    top: `${(object.y / canvasHeight) * 100}%`,
    width: `${(object.width / 1_000) * 100}%`,
    height: `${(object.height / canvasHeight) * 100}%`,
    transform: `rotate(${object.rotation}deg)`,
    zIndex: Math.max(1, (object.readingOrder ?? 0) + 1),
  };
}

function styleValue(
  object: PresentationObject,
  key: string,
  fallback: string | number | boolean,
) {
  const value = object.style?.[key];
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : fallback;
}

function PresentationObjectView({
  object,
  asset,
  linkedValues,
  linkedArtifact,
  animate,
  selected,
  readOnly,
  compact,
  aiActive = false,
  onSelect,
  onPointerDown,
  onResizePointerDown,
  onTextChange,
  onTextFocus,
  onTextBlur,
  path,
}: {
  object: PresentationObject;
  asset?: SpectraArtifactAsset;
  linkedValues?: number[] | null;
  linkedArtifact?: SpectraArtifact;
  animate: boolean;
  selected: boolean;
  readOnly: boolean;
  compact: boolean;
  aiActive?: boolean;
  onSelect: (additive: boolean) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (
    handle: ResizeHandle,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onTextChange: (value: string) => void;
  onTextFocus: () => void;
  onTextBlur: () => void;
  /** Canonical pointer for this object, e.g. `/slides/2/objects/1`. */
  path?: string;
}) {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [textOverflow, setTextOverflow] = useState(false);
  const objectText = presentationObjectText(object);
  const textFontSize = Number(styleValue(object, "fontSize", 42));
  const textPreset =
    textFontSize >= 44
      ? "title"
      : textFontSize >= 27
        ? "subtitle"
        : textFontSize >= 18
          ? "body"
          : "caption";
  useEffect(() => {
    if (object.type !== "text" || compact || object.hidden) {
      setTextOverflow(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const element = textAreaRef.current;
      setTextOverflow(
        Boolean(
          element &&
          (element.scrollHeight > element.clientHeight + 1 ||
            element.scrollWidth > element.clientWidth + 1),
        ),
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    compact,
    object.height,
    object.hidden,
    object.style,
    object.type,
    object.width,
    objectText,
  ]);
  if (object.hidden) return null;
  if (object.type === "group" && compact) return null;
  const content =
    object.content &&
    typeof object.content === "object" &&
    !Array.isArray(object.content)
      ? (object.content as Record<string, unknown>)
      : {};
  return (
    <div
      className="presentation-object"
      {...(path ? targetAttrs(path) : {})}
      data-spectra-part={selected && !compact ? "grip" : undefined}
      data-selected={selected || undefined}
      data-locked={object.locked || undefined}
      data-overflow={textOverflow || undefined}
      data-animation={
        animate && object.animation?.kind !== "none"
          ? object.animation?.kind
          : undefined
      }
      style={
        {
          "--presentation-animation-duration": `${object.animation?.durationMs ?? 450}ms`,
          "--presentation-animation-delay": `${object.animation?.delayMs ?? 0}ms`,
        } as CSSProperties
      }
      onClick={(event) => {
        // Objects inside slide thumbnails are previews, not interactive
        // layers. Let the click reach the slide-rail button so selecting a
        // thumbnail works even when its artwork fills the whole preview.
        if (compact) return;
        event.stopPropagation();
        onSelect(event.shiftKey || event.metaKey || event.ctrlKey);
      }}
      onPointerDown={onPointerDown}
    >
      {object.type === "text" ? (
        <LocalAutocompleteTextarea
          ref={textAreaRef}
          surface="slide_text"
          data-text-preset={textPreset}
          data-ai-region={aiRegionAttr(aiActive)}
          {...(path ? targetAttrs(`${path}/text`) : {})}
          value={objectText}
          readOnly={readOnly || object.locked || compact}
          onFocus={onTextFocus}
          onBlur={onTextBlur}
          onValueChange={onTextChange}
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            color: String(styleValue(object, "color", "#173f35")),
            // Presentation geometry uses a 1000-unit logical canvas. One cqw
            // represents ten of those units, so a 50-unit font maps to 5cqw.
            // The previous /65 conversion collapsed nearly every text style
            // to the 10px clamp and made Title, Subtitle, and Body visually
            // indistinguishable.
            fontSize: compact
              ? `${textFontSize / 10}cqw`
              : `clamp(10px, ${textFontSize / 10}cqw, ${textFontSize}px)`,
            fontWeight: Number(styleValue(object, "fontWeight", 600)),
            fontStyle: styleValue(object, "italic", false)
              ? "italic"
              : "normal",
            textDecoration: styleValue(object, "underline", false)
              ? "underline"
              : "none",
            textAlign: String(styleValue(object, "align", "left")) as
              "left" | "center" | "right",
          }}
          className="size-full"
          textareaClassName="presentation-object-text"
          aria-label="Slide text"
        />
      ) : object.type === "shape" ? (
        <div
          className="presentation-shape"
          style={{
            background: String(styleValue(object, "fill", "#dfeee4")),
            borderColor: String(styleValue(object, "stroke", "#82b79b")),
            borderRadius: Number(styleValue(object, "radius", 24)),
          }}
        >
          {presentationObjectText(object)}
        </div>
      ) : object.type === "image" ? (
        asset?.downloadUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.downloadUrl}
            alt={object.altText ?? ""}
            draggable={false}
            className="h-full w-full"
            style={{
              objectFit: String(styleValue(object, "fit", "contain")) as
                "contain" | "cover",
              objectPosition: `${Number(styleValue(object, "focalX", 50))}% ${Number(styleValue(object, "focalY", 50))}%`,
              borderRadius:
                styleValue(object, "mask", "none") === "circle"
                  ? "999px"
                  : styleValue(object, "mask", "none") === "rounded"
                    ? "18px"
                    : "0",
            }}
          />
        ) : (
          <div className="presentation-media-missing">
            <ImagePlus className="h-5 w-5" />
            Media unavailable
          </div>
        )
      ) : object.type === "video" ? (
        asset?.downloadUrl ? (
          <video
            src={asset.downloadUrl}
            controls={!compact}
            muted={compact}
            preload="metadata"
            aria-label={object.altText || "Presentation video"}
            className="presentation-video"
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : (
          <div className="presentation-media-missing">
            <MonitorPlay className="h-5 w-5" />
            Video unavailable
          </div>
        )
      ) : object.type === "chart" ? (
        <div
          className="presentation-chart"
          role="img"
          aria-label={object.altText}
          data-source-unavailable={linkedValues === null || undefined}
        >
          {(
            linkedValues ??
            (Array.isArray(content.values) ? content.values : [62, 84, 48])
          ).map((value, index) => (
            <span
              key={index}
              style={{
                height: `${Math.max(6, Math.min(100, Number(value) || 0))}%`,
              }}
            />
          ))}
          {linkedValues === null ? (
            <em>Linked Sheets range is unavailable</em>
          ) : null}
        </div>
      ) : object.type === "table" ? (
        <table className="presentation-table">
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
      ) : object.type === "embed" ? (
        <div
          className="presentation-linked-artifact"
          data-unavailable={!linkedArtifact || undefined}
        >
          <span>Linked work</span>
          <strong>{linkedArtifact?.title ?? "Access unavailable"}</strong>
          <small>
            {linkedArtifact
              ? linkedArtifact.blueprintKey.replaceAll("_", " ")
              : "The source was removed or permission changed"}
          </small>
        </div>
      ) : object.type === "group" ? (
        <div className="presentation-group-frame">
          {compact ? null : "Grouped objects"}
        </div>
      ) : (
        <div className="presentation-media-missing">{object.type}</div>
      )}
      {textOverflow && !compact ? (
        <span className="presentation-overflow-indicator" role="status">
          Text overflows this object
        </span>
      ) : null}
      {selected && !compact ? (
        <>
          {(
            ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const
          ).map((handle) => (
            <button
              key={handle}
              type="button"
              className={`presentation-object-handle is-${handle}`}
              data-spectra-part={`handle:${handle}`}
              aria-label={`Resize from ${handle.toUpperCase()}`}
              onPointerDown={(event) => onResizePointerDown(handle, event)}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

function SlideCanvas({
  slide,
  deck,
  assets,
  artifacts,
  selectedObjectId,
  selectedObjectIds = [],
  guides,
  aiChangedPaths,
  readOnly,
  compact = false,
  animateObjects = false,
  showSlideNumber = false,
  onSelectObject,
  onPointerDown,
  onResizePointerDown,
  onPointerMove,
  onPointerUp,
  onTextChange,
  onTextFocus,
  onTextBlur,
}: {
  slide: PresentationSlide;
  deck: PresentationContent;
  assets: SpectraArtifactAsset[];
  artifacts: SpectraArtifact[];
  selectedObjectId?: string;
  aiChangedPaths: string[];
  readOnly: boolean;
  compact?: boolean;
  animateObjects?: boolean;
  showSlideNumber?: boolean;
  selectedObjectIds?: string[];
  guides?: { x?: number; y?: number };
  onSelectObject: (id?: string, additive?: boolean) => void;
  onPointerDown: (
    object: PresentationObject,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  onResizePointerDown: (
    object: PresentationObject,
    handle: ResizeHandle,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onTextChange: (objectId: string, value: string) => void;
  onTextFocus: (objectId: string) => void;
  onTextBlur: () => void;
}) {
  const canvasHeight = deck.settings?.aspectRatio === "4:3" ? 750 : 562.5;
  const tokens = deck.theme.tokens ?? {};
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  return (
    <div
      className="presentation-canvas"
      data-authoring={!compact || undefined}
      data-transition={
        animateObjects && slide.transition?.kind !== "none"
          ? slide.transition?.kind
          : undefined
      }
      style={
        {
          aspectRatio:
            deck.settings?.aspectRatio === "4:3" ? "4 / 3" : "16 / 9",
          background: compact
            ? slide.background || tokens.background || "#fbfaf5"
            : "var(--bg-primary)",
          color: tokens.body || "#324b43",
          animationDuration:
            animateObjects && slide.transition?.durationMs
              ? `${slide.transition.durationMs}ms`
              : undefined,
          "--presentation-heading-font": deck.theme.fonts?.heading
            ? `"${deck.theme.fonts.heading}"`
            : "var(--font-display)",
        } as CSSProperties
      }
      onClick={() => onSelectObject(undefined)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Slide numbers are slide *content*, so they are drawn in the theme's own
          ink at the deck's scale and only where a number means something: the
          slide being worked on and the slide being presented. The rail's
          thumbnails and the notes previews pass `showSlideNumber={false}` — a
          22px chip over a 132px preview covered every deck title in the audit. */}
      {showSlideNumber && deck.settings?.showSlideNumbers !== false ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            zIndex: 1,
            left: "3.2cqw",
            bottom: "2.6cqw",
            fontSize: "1.4cqw",
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: "currentColor",
            opacity: 0.55,
          }}
        >
          {deck.slides.findIndex((candidate) => candidate.id === slide.id) + 1}
        </span>
      ) : null}
      {slide.citations?.length ? (
        <span
          className="presentation-citation-footer"
          aria-label={`Sources on this slide: ${slide.citations
            .map((citation) => citation.label)
            .join(", ")}`}
        >
          {slide.citations
            .slice(0, 3)
            .map((citation) => citation.label)
            .join(" · ")}
          {slide.citations.length > 3
            ? ` · +${slide.citations.length - 3}`
            : ""}
        </span>
      ) : null}
      {guides?.x !== undefined ? (
        <span
          className="presentation-guide presentation-guide--vertical"
          style={{ left: `${(guides.x / 1_000) * 100}%` }}
          aria-hidden="true"
        />
      ) : null}
      {guides?.y !== undefined ? (
        <span
          className="presentation-guide presentation-guide--horizontal"
          style={{ top: `${(guides.y / canvasHeight) * 100}%` }}
          aria-hidden="true"
        />
      ) : null}
      {slide.objects.map((object, objectIndex) => {
        const source =
          object.content &&
          typeof object.content === "object" &&
          !Array.isArray(object.content)
            ? (object.content as Record<string, unknown>)
            : {};
        const slideIndex = deck.slides.indexOf(slide);
        const aiActive = pathTouches(
          aiChangedPaths,
          `/slides/${slideIndex}/objects/${objectIndex}`,
        );
        return (
          <div
            key={object.id}
            style={objectStyle(object, canvasHeight)}
            className="absolute"
            data-ai-region={aiRegionAttr(aiActive)}
          >
            <PresentationObjectView
              object={object}
              asset={
                typeof source.assetId === "string"
                  ? assetById.get(source.assetId)
                  : undefined
              }
              linkedValues={linkedChartValues(object, artifacts)}
              linkedArtifact={
                object.sourceBinding?.artifactId
                  ? artifacts.find(
                      (artifact) =>
                        artifact._id === object.sourceBinding?.artifactId,
                    )
                  : undefined
              }
              animate={animateObjects}
              selected={
                selectedObjectId === object.id ||
                selectedObjectIds.includes(object.id)
              }
              readOnly={readOnly}
              compact={compact}
              aiActive={aiActive}
              onSelect={(additive) => onSelectObject(object.id, additive)}
              onPointerDown={(event) => onPointerDown(object, event)}
              onResizePointerDown={(handle, event) =>
                onResizePointerDown(object, handle, event)
              }
              onTextChange={(value) => onTextChange(object.id, value)}
              onTextFocus={() => onTextFocus(object.id)}
              onTextBlur={onTextBlur}
              path={`/slides/${slideIndex}/objects/${objectIndex}`}
            />
          </div>
        );
      })}
    </div>
  );
}

function PresentationObjectInspector({
  object,
  readOnly,
  canvasHeight,
  artifacts,
  artifactId,
  onUpdate,
}: {
  object: PresentationObject;
  readOnly: boolean;
  canvasHeight: number;
  artifacts: SpectraArtifact[];
  artifactId: string;
  onUpdate: (recipe: (object: PresentationObject) => void) => void;
}) {
  const geometry = [
    ["X", object.x, 0, 1_000 - object.width, "x"],
    ["Y", object.y, 0, canvasHeight - object.height, "y"],
    ["Width", object.width, 40, 1_000 - object.x, "width"],
    ["Height", object.height, 32, canvasHeight - object.y, "height"],
    ["Rotation", object.rotation, -360, 360, "rotation"],
  ] as const;
  return (
    <div className="presentation-object-inspector">
      <div
        className="presentation-geometry-grid"
        // The geometry row fits its pane rather than assuming a 940px settings
        // page: three columns in a docked inspector, six when there is room.
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))" }}
      >
        {geometry.map(([label, value, minimum, maximum, key]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={minimum}
              max={maximum}
              value={Math.round(value)}
              disabled={readOnly || (object.locked && key !== "rotation")}
              onChange={(event) =>
                onUpdate((candidate) => {
                  candidate[key] = Math.max(
                    minimum,
                    Math.min(maximum, Number(event.target.value)),
                  );
                })
              }
            />
          </label>
        ))}
      </div>
      <SelectField
        label="Animation"
        size="sm"
        value={object.animation?.kind ?? "none"}
        disabled={readOnly}
        options={OBJECT_ANIMATION_OPTIONS}
        onChange={(kind) =>
          onUpdate((candidate) => {
            candidate.animation = {
              kind: kind as "none" | "fade" | "rise" | "scale" | "wipe",
              durationMs: candidate.animation?.durationMs ?? 450,
            };
          })
        }
      />
      {["image", "chart", "video"].includes(object.type) ? (
        <label>
          Alternative text
          <LocalAutocompleteTextarea
            surface="description"
            value={object.altText ?? ""}
            disabled={readOnly}
            placeholder="Describe the meaning, not only the appearance."
            onValueChange={(altText) =>
              onUpdate((candidate) => {
                candidate.altText = altText;
              })
            }
            textareaClassName="w-full"
          />
        </label>
      ) : null}
      {object.type === "chart" || object.type === "embed" ? (
        <div className="presentation-source-binding">
          <SelectField
            label="Source artifact"
            size="sm"
            value={object.sourceBinding?.artifactId ?? NO_SELECTION}
            disabled={readOnly}
            options={[
              { value: NO_SELECTION, label: "No linked source" },
              ...artifacts
                .filter(
                  (artifact) =>
                    artifact._id !== artifactId &&
                    artifact.status === "active" &&
                    (object.type !== "chart" ||
                      artifact.blueprintKey === "sheets"),
                )
                .map((artifact) => ({
                  value: artifact._id,
                  label: `${artifact.title} · ${artifact.blueprintKey.replaceAll("_", " ")}`,
                })),
            ]}
            onChange={(artifactValue) =>
              onUpdate((candidate) => {
                if (artifactValue === NO_SELECTION) {
                  delete candidate.sourceBinding;
                  return;
                }
                candidate.sourceBinding = {
                  artifactId: artifactValue,
                  kind:
                    candidate.type === "chart" ? "sheets_range" : "artifact",
                  ...(candidate.type === "chart"
                    ? { range: candidate.sourceBinding?.range ?? "A1:B8" }
                    : {}),
                  live: true,
                };
              })
            }
          />
          {object.sourceBinding?.kind === "sheets_range" ? (
            <label>
              Stable Sheets range
              <input
                value={object.sourceBinding.range ?? ""}
                disabled={readOnly}
                placeholder="Sheet 1!A1:B8"
                onChange={(event) =>
                  onUpdate((candidate) => {
                    if (candidate.sourceBinding)
                      candidate.sourceBinding.range = event.target.value;
                  })
                }
              />
            </label>
          ) : null}
          {object.sourceBinding ? (
            <label className="presentation-check">
              <input
                type="checkbox"
                checked={object.sourceBinding.live !== false}
                disabled={readOnly}
                onChange={(event) =>
                  onUpdate((candidate) => {
                    if (candidate.sourceBinding) {
                      candidate.sourceBinding.live = event.target.checked;
                      if (!event.target.checked) {
                        const source = artifacts.find(
                          (artifact) =>
                            artifact._id ===
                            candidate.sourceBinding?.artifactId,
                        );
                        candidate.sourceBinding.versionId =
                          source?.currentVersionId;
                        if (candidate.type === "chart") {
                          const current =
                            candidate.content &&
                            typeof candidate.content === "object" &&
                            !Array.isArray(candidate.content)
                              ? (candidate.content as Record<string, unknown>)
                              : {};
                          candidate.content = {
                            ...current,
                            pinnedValues:
                              linkedChartValues(candidate, artifacts) ?? [],
                            pinnedAt: Date.now(),
                          };
                        }
                      } else {
                        delete candidate.sourceBinding.versionId;
                      }
                    }
                  })
                }
              />
              Keep the permitted source live
            </label>
          ) : null}
        </div>
      ) : null}
      {object.type === "image" ? (
        <div className="presentation-source-binding">
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label="Image fit"
              size="sm"
              value={String(styleValue(object, "fit", "contain"))}
              disabled={readOnly}
              options={IMAGE_FIT_OPTIONS}
              onChange={(fit) =>
                onUpdate((candidate) => {
                  candidate.style = { ...candidate.style, fit };
                })
              }
            />
            <SelectField
              label="Mask"
              size="sm"
              value={String(styleValue(object, "mask", "none"))}
              disabled={readOnly}
              options={IMAGE_MASK_OPTIONS}
              onChange={(mask) =>
                onUpdate((candidate) => {
                  candidate.style = { ...candidate.style, mask };
                })
              }
            />
          </div>
          {styleValue(object, "fit", "contain") === "cover" ? (
            <div className="grid grid-cols-2 gap-2">
              <label>
                Horizontal focus
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Number(styleValue(object, "focalX", 50))}
                  disabled={readOnly}
                  onChange={(event) =>
                    onUpdate((candidate) => {
                      candidate.style = {
                        ...candidate.style,
                        focalX: Number(event.target.value),
                      };
                    })
                  }
                />
              </label>
              <label>
                Vertical focus
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Number(styleValue(object, "focalY", 50))}
                  disabled={readOnly}
                  onChange={(event) =>
                    onUpdate((candidate) => {
                      candidate.style = {
                        ...candidate.style,
                        focalY: Number(event.target.value),
                      };
                    })
                  }
                />
              </label>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="presentation-object-flags">
        <label className="presentation-check">
          <input
            type="checkbox"
            checked={Boolean(object.locked)}
            disabled={readOnly}
            onChange={(event) =>
              onUpdate((candidate) => {
                candidate.locked = event.target.checked;
              })
            }
          />
          Lock position and size
        </label>
        <label className="presentation-check">
          <input
            type="checkbox"
            checked={Boolean(object.hidden)}
            disabled={readOnly}
            onChange={(event) =>
              onUpdate((candidate) => {
                candidate.hidden = event.target.checked;
              })
            }
          />
          Hide while presenting
        </label>
      </div>
    </div>
  );
}

export function PresentationStudio({
  artifactId,
  artifacts,
  content,
  onChange,
  aiChangedPaths = [],
  readOnly: readOnlyProp,
  synchronizationReady,
  onActiveRegionChange,
}: {
  artifactId: string;
  artifacts: SpectraArtifact[];
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  readOnly: boolean;
  synchronizationReady: boolean;
  syncMessage?: string;
  onActiveRegionChange?: (regionId: string) => void;
}) {
  const deck = useMemo(() => normalizePresentationContent(content), [content]);
  const contract = useStudioContract();
  // Two locks, and either one is enough: the prop is the studio's own (history
  // view, a deck that has not synchronized), the contract is the role's. Every
  // control below reads this single value, so nothing in the surface can offer
  // an edit the viewer does not hold the capability for.
  const readOnly = readOnlyProp || !contract.can("edit");
  const [surfacePreference, setSurfacePreference] =
    useState<PresentationSurface>("slides");
  // The registry decides which views exist and who may enter them, so a view
  // this role does not hold can never become the active one.
  const surface: PresentationSurface = contract.modes.some(
    (mode) => mode.id === surfacePreference,
  )
    ? surfacePreference
    : ((contract.modes[0]?.id ?? "slides") as PresentationSurface);
  const [slideRailPreference, setSlideRailPreference] = useState<
    "auto" | "open" | "closed"
  >("auto");
  const [inspectorPreference, setInspectorPreference] = useState<
    "auto" | "open" | "closed"
  >("auto");
  const [inspectorSection, setInspectorSection] =
    useState<InspectorSection>("slide");
  const [notesOpen, setNotesOpen] = useState(false);
  const [activeSlideId, setActiveSlideId] = useState(deck.slides[0]!.id);
  const [selectedObjectId, setSelectedObjectId] = useState<string>();
  const [layerSelection, setLayerSelection] = useState<string[]>([]);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [draggingSlideId, setDraggingSlideId] = useState<string>();
  const [_dropTargetSlideId, setDropTargetSlideId] = useState<string>();
  const [undoStack, setUndoStack] = useState<PresentationContent[]>([]);
  const [redoStack, setRedoStack] = useState<PresentationContent[]>([]);
  const [presentedDeck, setPresentedDeck] = useState<PresentationContent>();
  const [presentIndex, setPresentIndex] = useState(0);
  const [presentStartedAt, setPresentStartedAt] = useState(0);
  const [presentElapsed, setPresentElapsed] = useState(0);
  const [slideElapsed, setSlideElapsed] = useState(0);
  const [presenterNotesVisible, setPresenterNotesVisible] = useState(true);
  const [presentBlackout, setPresentBlackout] = useState(false);
  const [presentLayout, setPresentLayout] = useState<"audience" | "speaker">(
    "audience",
  );
  const [presentChrome, setPresentChrome] = useState(true);
  const presentChromeHideRef = useRef(0);
  const [rehearsalMode, setRehearsalMode] = useState(false);
  const [rehearsalReport, setRehearsalReport] = useState<{
    slideDurations: number[];
    totalMs: number;
  }>();
  // One responsive contract, measured once by the shell: the rail keeps its
  // previews while the pane is at its preferred size and collapses to the
  // shared slide selector below it. The studio no longer runs its own observer
  // against a private 880px threshold.
  const roomForRail =
    contract.surface === "full" && contract.density === "comfortable";
  const inspectorOverlays = true;
  const slideRailOpen =
    contract.surface === "full" &&
    (slideRailPreference === "auto"
      ? roomForRail
      : slideRailPreference === "open");
  const inspectorOpen =
    inspectorPreference === "auto"
      ? !inspectorOverlays && roomForRail
      : inspectorPreference === "open";

  const presentIndexRef = useRef(0);
  const presentSlideStartedAtRef = useRef(0);
  const rehearsalDurationsRef = useRef<number[]>([]);
  const rehearsalModeRef = useRef(false);
  const [assets, setAssets] = useState<SpectraArtifactAsset[]>([]);
  const [assetError, setAssetError] = useState<string>();
  const [assetBusy, setAssetBusy] = useState(false);
  const [ioBusy, setIoBusy] = useState<string>();
  const [ioError, setIoError] = useState<string>();
  const [ioMessage, setIoMessage] = useState<string>();
  const [importHistory, setImportHistory] = useState<SpectraArtifactImport[]>(
    [],
  );
  const [pendingImportVersion, setPendingImportVersion] = useState<string>();
  const [sectionDraft, setSectionDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragState | undefined>(undefined);
  const textOriginRef = useRef<PresentationContent | undefined>(undefined);
  const activeSlide =
    deck.slides.find((slide) => slide.id === activeSlideId) ?? deck.slides[0]!;
  const activeSlideIndex = deck.slides.indexOf(activeSlide);
  const deckCitations = useMemo(() => collectDeckCitations(deck), [deck]);
  const deckCitationCount = deckCitations.length;
  const deckHasBibliography = deck.slides.some(
    (slide) => slide.accessibility?.label === BIBLIOGRAPHY_SLIDE_MARKER,
  );
  const selectedObject = activeSlide.objects.find(
    (object) => object.id === selectedObjectId,
  );
  const selectedTextPreset =
    selectedObject?.type === "text"
      ? Number(styleValue(selectedObject, "fontSize", 42)) >= 44
        ? "title"
        : Number(styleValue(selectedObject, "fontSize", 42)) >= 27
          ? "subtitle"
          : Number(styleValue(selectedObject, "fontSize", 42)) >= 18
            ? "body"
            : "caption"
      : undefined;

  useEffect(() => {
    if (!deck.slides.some((slide) => slide.id === activeSlideId)) {
      setActiveSlideId(deck.slides[0]!.id);
      setSelectedObjectId(undefined);
      setLayerSelection([]);
    }
  }, [activeSlideId, deck.slides]);

  // Follow AI: a reveal request names a slide path; switch to that slide so
  // the studio's own scroll-reveal can find the exact target afterwards.
  useEffect(() => {
    function onReveal(event: Event) {
      const detail = (
        event as CustomEvent<{ artifactId?: string; path?: string }>
      ).detail;
      if (detail?.artifactId !== artifactId || !detail.path) return;
      const match = /^\/slides\/(\d+)/.exec(detail.path);
      if (!match) return;
      const slide = deck.slides[Number(match[1])];
      if (slide && slide.id !== activeSlideId) setActiveSlideId(slide.id);
    }
    window.addEventListener("spectra:reveal-target", onReveal);
    return () => window.removeEventListener("spectra:reveal-target", onReveal);
  }, [artifactId, activeSlideId, deck.slides]);
  useEffect(() => {
    let active = true;
    void getArtifactAssets(artifactId)
      .then((result) => {
        if (active) setAssets(result.assets);
      })
      .catch(() => {
        if (active) setAssetError("Presentation media could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [artifactId]);
  const refreshImportHistory = useCallback(() => {
    void getArtifactImports(artifactId)
      .then((result) => setImportHistory(result.imports))
      .catch(() => undefined);
  }, [artifactId]);
  useEffect(() => {
    refreshImportHistory();
  }, [refreshImportHistory]);
  useEffect(() => {
    if (!pendingImportVersion || !synchronizationReady) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void postSpectra<{ versionId: string }>({
        action: "createArtifactImportVersion",
        artifactId,
        importJobId: pendingImportVersion,
      })
        .then(() => {
          if (active) {
            setPendingImportVersion(undefined);
            refreshImportHistory();
          }
        })
        .catch((error) => {
          if (active)
            setIoError(
              error instanceof Error
                ? error.message
                : "The imported version could not be committed.",
            );
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    artifactId,
    pendingImportVersion,
    refreshImportHistory,
    synchronizationReady,
  ]);
  useEffect(() => {
    // A device preference, not deck content: whether this machine is the one
    // driving the projector. Notes stay off until the presenter asks for them,
    // so a mirrored display cannot reveal them by default.
    try {
      setPresenterNotesVisible(
        window.localStorage.getItem(PRESENTER_NOTES_KEY) !== "hidden",
      );
    } catch {
      // Private browsing denies storage; the safe default already applies.
    }
  }, []);
  useEffect(() => {
    if (!presentedDeck) return;
    const update = () => {
      const now = Date.now();
      setPresentElapsed(now - presentStartedAt);
      setSlideElapsed(
        presentSlideStartedAtRef.current
          ? now - presentSlideStartedAtRef.current
          : 0,
      );
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [presentStartedAt, presentedDeck, presentIndex]);
  useEffect(() => {
    if (!presentedDeck) return;
    const keydown = (event: KeyboardEvent) => {
      // Blackout is a hold, not a mode: the next keypress returns the deck.
      if (presentBlackout) {
        event.preventDefault();
        setPresentBlackout(false);
        return;
      }
      if (
        ["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(
          event.key,
        )
      ) {
        event.preventDefault();
        movePresentIndex(1);
      } else if (
        ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(event.key)
      ) {
        event.preventDefault();
        movePresentIndex(-1);
      } else if (event.key === "Home") {
        event.preventDefault();
        goToPresentSlide(0);
      } else if (event.key === "End") {
        event.preventDefault();
        goToPresentSlide(presentedDeck.slides.length - 1);
      } else if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        togglePresenterNotes();
      } else if (event.key === "b" || event.key === "B") {
        event.preventDefault();
        setPresentBlackout(true);
      } else if (event.key === "Escape") stopPresenting();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- present handlers declared below
  }, [presentedDeck, presentBlackout]);
  useEffect(() => {
    const seconds = presentedDeck?.settings?.autoAdvanceSeconds;
    if (!presentedDeck || !seconds || seconds <= 0) return;
    if (presentIndex >= presentedDeck.slides.length - 1) return;
    const timer = window.setTimeout(() => movePresentIndex(1), seconds * 1_000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- movePresentIndex declared below
  }, [presentIndex, presentedDeck]);
  useEffect(() => {
    if (!presentedDeck) return;
    const fullscreenChange = () => {
      if (!document.fullscreenElement) stopPresenting();
    };
    document.addEventListener("fullscreenchange", fullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", fullscreenChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stopPresenting declared below
  }, [presentedDeck]);
  useEffect(() => {
    if (!presentedDeck) return;
    revealPresentChrome();
    return () => window.clearTimeout(presentChromeHideRef.current);
     
  }, [presentedDeck]);

  const emit = useCallback(
    (next: PresentationContent, record = true) => {
      if (readOnly) return;
      if (record) {
        setUndoStack((stack) => [...stack.slice(-79), cloneDeck(deck)]);
        setRedoStack([]);
      }
      onChange(next);
    },
    [deck, onChange, readOnly],
  );
  const mutate = useCallback(
    (recipe: (draft: PresentationContent) => void, record = true) => {
      const next = cloneDeck(deck);
      recipe(next);
      emit(next, record);
    },
    [deck, emit],
  );
  useEffect(() => {
    if (readOnly || surface !== "slides" || !selectedObjectId) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select") ||
        target?.isContentEditable
      )
        return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        mutate((draft) => {
          const slide = draft.slides[activeSlideIndex];
          if (slide) {
            const deletingGroup =
              slide.objects.find((object) => object.id === selectedObjectId)
                ?.type === "group";
            slide.objects = slide.objects.filter(
              (object) => object.id !== selectedObjectId,
            );
            if (deletingGroup)
              slide.objects.forEach((object) => {
                if (object.parentId === selectedObjectId)
                  delete object.parentId;
              });
          }
        });
        setSelectedObjectId(undefined);
        setLayerSelection([]);
        onActiveRegionChange?.(activeSlide.id);
        return;
      }
      const movement = event.shiftKey ? 10 : 1;
      const delta =
        event.key === "ArrowLeft"
          ? { x: -movement, y: 0 }
          : event.key === "ArrowRight"
            ? { x: movement, y: 0 }
            : event.key === "ArrowUp"
              ? { x: 0, y: -movement }
              : event.key === "ArrowDown"
                ? { x: 0, y: movement }
                : undefined;
      if (!delta) return;
      event.preventDefault();
      mutate((draft) => {
        const object = draft.slides[activeSlideIndex]?.objects.find(
          (candidate) => candidate.id === selectedObjectId,
        );
        if (!object || object.locked) return;
        const canvasHeight =
          draft.settings?.aspectRatio === "4:3" ? 750 : 562.5;
        object.x = Math.max(
          0,
          Math.min(1_000 - object.width, object.x + delta.x),
        );
        object.y = Math.max(
          0,
          Math.min(canvasHeight - object.height, object.y + delta.y),
        );
      });
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [
    activeSlide.id,
    activeSlideIndex,
    mutate,
    onActiveRegionChange,
    readOnly,
    selectedObjectId,
    surface,
  ]);

  // Undo was reachable only by pointer. It is one of the five operations the
  // registry says a deck must offer from the keyboard alone, so the deck-level
  // history now answers the platform shortcut. Text fields are excluded so a
  // browser's own text undo still works while typing inside a slide object.
  useEffect(() => {
    if (readOnly || surface !== "slides") return;
    const keydown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select") ||
        target?.isContentEditable
      )
        return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- undo and redo are declared below and read the latest stacks
  }, [readOnly, surface, undoStack.length, redoStack.length]);

  function undo() {
    const previous = undoStack.at(-1);
    if (!previous || readOnly) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack.slice(-79), cloneDeck(deck)]);
    onChange(previous);
  }
  function redo() {
    const next = redoStack.at(-1);
    if (!next || readOnly) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack.slice(-79), cloneDeck(deck)]);
    onChange(next);
  }
  function addSlide() {
    const slide = createPresentationSlide(deck.slides.length + 1);
    mutate((draft) => {
      draft.slides.splice(activeSlideIndex + 1, 0, slide);
    });
    setActiveSlideId(slide.id);
    setSelectedObjectId(undefined);
    setLayerSelection([]);
  }
  function duplicateSlide() {
    const copy = cloneDeck(activeSlide);
    copy.id = localId("slide");
    copy.title = `${copy.title} copy`;
    copy.objects = copy.objects.map((object) => ({
      ...object,
      id: localId("object"),
    }));
    mutate((draft) => draft.slides.splice(activeSlideIndex + 1, 0, copy));
    setActiveSlideId(copy.id);
    setSelectedObjectId(undefined);
    setLayerSelection([]);
  }
  function deleteSlide() {
    if (deck.slides.length === 1) return;
    const nextIndex = Math.max(0, activeSlideIndex - 1);
    const nextId = deck.slides[nextIndex]!.id;
    mutate((draft) => {
      draft.slides.splice(activeSlideIndex, 1);
    });
    setActiveSlideId(nextId);
    setSelectedObjectId(undefined);
    setLayerSelection([]);
  }
  function moveSlideBy(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= deck.slides.length) return;
    mutate((draft) => {
      const [slide] = draft.slides.splice(index, 1);
      if (slide) draft.slides.splice(destination, 0, slide);
    });
  }
  function moveSlide(direction: -1 | 1) {
    moveSlideBy(activeSlideIndex, direction);
  }
  function moveSlideBefore(targetSlideId: string) {
    if (!draggingSlideId || draggingSlideId === targetSlideId || readOnly)
      return;
    mutate((draft) => {
      const sourceIndex = draft.slides.findIndex(
        (slide) => slide.id === draggingSlideId,
      );
      const targetIndex = draft.slides.findIndex(
        (slide) => slide.id === targetSlideId,
      );
      if (sourceIndex < 0 || targetIndex < 0) return;
      const [slide] = draft.slides.splice(sourceIndex, 1);
      if (!slide) return;
      draft.slides.splice(
        sourceIndex < targetIndex ? targetIndex - 1 : targetIndex,
        0,
        slide,
      );
    });
    setDraggingSlideId(undefined);
  }
  function addObject(type: PresentationObjectType) {
    const object = createPresentationObject(
      type,
      activeSlide.objects.length + 1,
    );
    mutate((draft) => {
      draft.slides[activeSlideIndex]!.objects.push(object);
    });
    setSelectedObjectId(object.id);
    setLayerSelection([object.id]);
    onActiveRegionChange?.(object.id);
  }
  function applyTextPreset(preset: "title" | "subtitle" | "body" | "caption") {
    const tokens = {
      title: { fontSize: 54, fontWeight: 700, color: "#143d34" },
      subtitle: { fontSize: 27, fontWeight: 520, color: "#168767" },
      body: { fontSize: 21, fontWeight: 430, color: "#2f3e39" },
      caption: { fontSize: 15, fontWeight: 520, color: "#60706a" },
    } as const;
    updateSelected((object) => {
      object.style = { ...object.style, ...tokens[preset] };
      object.height = Math.max(
        preset === "title"
          ? 130
          : preset === "subtitle"
            ? 120
            : preset === "body"
              ? 80
              : 50,
        object.height,
      );
    });
  }
  function selectObject(objectId?: string, additive = false) {
    setSelectedObjectId(objectId);
    setLayerSelection((selection) => {
      if (!objectId) return [];
      if (!additive) return [objectId];
      return selection.includes(objectId)
        ? selection.filter((id) => id !== objectId)
        : [...selection, objectId];
    });
    onActiveRegionChange?.(objectId ?? activeSlide.id);
  }
  function arrangeSelection(
    mode:
      | "left"
      | "center"
      | "right"
      | "top"
      | "middle"
      | "bottom"
      | "distribute-x"
      | "distribute-y",
  ) {
    const selected = activeSlide.objects.filter(
      (object) => layerSelection.includes(object.id) && !object.locked,
    );
    if (selected.length < 2) return;
    const left = Math.min(...selected.map((object) => object.x));
    const right = Math.max(
      ...selected.map((object) => object.x + object.width),
    );
    const top = Math.min(...selected.map((object) => object.y));
    const bottom = Math.max(
      ...selected.map((object) => object.y + object.height),
    );
    mutate((draft) => {
      const objects = draft.slides[activeSlideIndex]!.objects.filter((object) =>
        selected.some((candidate) => candidate.id === object.id),
      );
      if (mode === "distribute-x" && objects.length >= 3) {
        const ordered = [...objects].sort((a, b) => a.x - b.x);
        const totalWidth = ordered.reduce(
          (total, object) => total + object.width,
          0,
        );
        const gap = (right - left - totalWidth) / (ordered.length - 1);
        let cursor = left;
        ordered.forEach((object) => {
          object.x = cursor;
          cursor += object.width + gap;
        });
        return;
      }
      if (mode === "distribute-y" && objects.length >= 3) {
        const ordered = [...objects].sort((a, b) => a.y - b.y);
        const totalHeight = ordered.reduce(
          (total, object) => total + object.height,
          0,
        );
        const gap = (bottom - top - totalHeight) / (ordered.length - 1);
        let cursor = top;
        ordered.forEach((object) => {
          object.y = cursor;
          cursor += object.height + gap;
        });
        return;
      }
      objects.forEach((object) => {
        if (mode === "left") object.x = left;
        if (mode === "center") object.x = (left + right - object.width) / 2;
        if (mode === "right") object.x = right - object.width;
        if (mode === "top") object.y = top;
        if (mode === "middle") object.y = (top + bottom - object.height) / 2;
        if (mode === "bottom") object.y = bottom - object.height;
      });
    });
  }
  function groupSelectedObjects() {
    const members = activeSlide.objects.filter(
      (object) => layerSelection.includes(object.id) && object.type !== "group",
    );
    if (members.length < 2) return;
    const groupId = `group-${Date.now().toString(36)}`;
    const x = Math.min(...members.map((object) => object.x));
    const y = Math.min(...members.map((object) => object.y));
    const right = Math.max(...members.map((object) => object.x + object.width));
    const bottom = Math.max(
      ...members.map((object) => object.y + object.height),
    );
    const group: PresentationObject = {
      id: groupId,
      type: "group",
      x,
      y,
      width: right - x,
      height: bottom - y,
      rotation: 0,
      content: { childIds: members.map((object) => object.id) },
      readingOrder: Math.max(
        0,
        Math.min(...members.map((object) => object.readingOrder ?? 0)) - 1,
      ),
    };
    mutate((draft) => {
      const slide = draft.slides[activeSlideIndex]!;
      slide.objects.forEach((object) => {
        if (layerSelection.includes(object.id)) object.parentId = groupId;
      });
      slide.objects.push(group);
    });
    setSelectedObjectId(groupId);
    setLayerSelection([groupId]);
    onActiveRegionChange?.(groupId);
  }
  function ungroupSelectedObject() {
    if (selectedObject?.type !== "group") return;
    const groupId = selectedObject.id;
    mutate((draft) => {
      const slide = draft.slides[activeSlideIndex]!;
      slide.objects = slide.objects.filter((object) => object.id !== groupId);
      slide.objects.forEach((object) => {
        if (object.parentId === groupId) delete object.parentId;
      });
    });
    setSelectedObjectId(undefined);
    setLayerSelection([]);
    onActiveRegionChange?.(activeSlide.id);
  }
  function deleteSelectedObject() {
    if (!selectedObjectId) return;
    const deletingGroup = selectedObject?.type === "group";
    mutate((draft) => {
      const slide = draft.slides[activeSlideIndex]!;
      slide.objects = slide.objects.filter(
        (object) => object.id !== selectedObjectId,
      );
      if (deletingGroup)
        slide.objects.forEach((object) => {
          if (object.parentId === selectedObjectId) delete object.parentId;
        });
    });
    setSelectedObjectId(undefined);
    setLayerSelection([]);
    onActiveRegionChange?.(activeSlide.id);
  }
  function applySlideLayout(layoutId: string) {
    mutate((draft) => {
      const slide = draft.slides[activeSlideIndex]!;
      slide.layoutId = layoutId;
      if (layoutId === "blank" || !slide.objects.length) return;
      const canvasHeight = draft.settings?.aspectRatio === "4:3" ? 750 : 562.5;
      const nextObject = (type: PresentationObjectType) => {
        const object = createPresentationObject(type, slide.objects.length + 1);
        slide.objects.push(object);
        return object;
      };
      let visible = slide.objects.filter((object) => !object.hidden);
      let title = visible.find((object) => object.type === "text");
      if (!title) {
        title = nextObject("text");
        visible = [...visible, title];
      }
      const remaining = () =>
        visible.filter((object) => object.id !== title?.id);
      if (layoutId === "title-only" && title) {
        Object.assign(title, {
          x: 90,
          y: canvasHeight * 0.33,
          width: 820,
          height: canvasHeight * 0.22,
        });
        return;
      }
      if (layoutId === "statement" && title) {
        Object.assign(title, {
          x: 110,
          y: canvasHeight * 0.25,
          width: 780,
          height: canvasHeight * 0.5,
          style: {
            ...title.style,
            fontSize: 58,
            fontWeight: 720,
            align: "center",
          },
        });
        return;
      }
      if (layoutId === "full-bleed") {
        const hero =
          visible.find((object) =>
            ["image", "video", "shape"].includes(object.type),
          ) ?? visible[0];
        if (hero)
          Object.assign(hero, {
            x: 0,
            y: 0,
            width: 1_000,
            height: canvasHeight,
          });
        if (title && title.id !== hero?.id)
          Object.assign(title, {
            x: 70,
            y: canvasHeight * 0.68,
            width: 860,
            height: canvasHeight * 0.18,
          });
        return;
      }
      if (layoutId === "title-visual-text" || layoutId === "visual-story") {
        let visual = remaining().find((object) =>
          ["image", "video", "chart", "shape", "embed"].includes(object.type),
        );
        if (!visual) {
          visual = nextObject("shape");
          visual.content = {
            shape: "rounded-rectangle",
            text: "Add a visual",
          };
          visible = [...visible, visual];
        }
        const bodies = remaining().filter(
          (object) => object.type === "text" && object.id !== visual?.id,
        );
        if (!bodies.length) {
          let body = nextObject("text");
          body = withPresentationObjectText(body, "Add the supporting idea");
          slide.objects[slide.objects.length - 1] = body;
          visible = [...visible, body];
          bodies.push(body);
        }
        if (layoutId === "title-visual-text") {
          Object.assign(title, { x: 70, y: 45, width: 860, height: 90 });
          Object.assign(visual, {
            x: 70,
            y: 165,
            width: 500,
            height: canvasHeight - 215,
          });
          const bodyGap = 16;
          const bodyHeight =
            (canvasHeight - 215 - bodyGap * (bodies.length - 1)) /
            bodies.length;
          bodies.forEach((body, index) =>
            Object.assign(body, {
              x: 610,
              y: 165 + index * (bodyHeight + bodyGap),
              width: 320,
              height: bodyHeight,
            }),
          );
        } else {
          Object.assign(visual, {
            x: 0,
            y: 0,
            width: 570,
            height: canvasHeight,
          });
          Object.assign(title, {
            x: 620,
            y: 100,
            width: 320,
            height: 145,
          });
          const bodyGap = 14;
          const bodyHeight =
            (canvasHeight - 320 - bodyGap * (bodies.length - 1)) /
            bodies.length;
          bodies.forEach((body, index) =>
            Object.assign(body, {
              x: 620,
              y: 270 + index * (bodyHeight + bodyGap),
              width: 310,
              height: bodyHeight,
            }),
          );
        }
        return;
      }
      if (layoutId === "three-ideas") {
        Object.assign(title, { x: 70, y: 45, width: 860, height: 90 });
        const cards = remaining().filter((object) => object.type !== "group");
        while (cards.length < 3) {
          const card = nextObject("shape");
          card.content = {
            shape: "rounded-rectangle",
            text: `Key idea ${cards.length + 1}`,
          };
          cards.push(card);
        }
        cards.slice(0, 3).forEach((card, index) =>
          Object.assign(card, {
            x: 70 + index * 300,
            y: 175,
            width: 260,
            height: canvasHeight - 235,
          }),
        );
        return;
      }
      if (title) Object.assign(title, { x: 70, y: 52, width: 860, height: 92 });
      remaining().forEach((object, index) => {
        if (layoutId === "two-column") {
          const column = index % 2;
          const row = Math.floor(index / 2);
          Object.assign(object, {
            x: column ? 525 : 70,
            y: Math.min(canvasHeight - 40, 175 + row * 170),
            width: 405,
            height: Math.max(40, Math.min(145, canvasHeight - 190 - row * 170)),
          });
        } else {
          Object.assign(object, {
            x: 90,
            y: Math.min(canvasHeight - 40, 175 + index * 155),
            width: 820,
            height: Math.max(
              40,
              Math.min(130, canvasHeight - 190 - index * 155),
            ),
          });
        }
      });
    });
  }
  function applyTheme(theme: (typeof THEMES)[number]) {
    mutate((draft) => {
      const previous = draft.theme.tokens ?? {};
      draft.theme = {
        id: theme.id,
        name: theme.name,
        tokens: { ...theme.tokens },
        fonts: { heading: "Manrope", body: "Manrope" },
      };
      draft.slides.forEach((slide) =>
        slide.objects.forEach((object) => {
          if (!object.style) return;
          const color = object.style.color;
          const fill = object.style.fill;
          const stroke = object.style.stroke;
          if (
            object.type === "text" &&
            (!color || color === previous.heading || color === previous.body)
          )
            object.style.color = theme.tokens.heading;
          if (object.type === "shape") {
            if (!fill || fill === previous.soft)
              object.style.fill = theme.tokens.soft;
            if (!stroke || stroke === previous.accent)
              object.style.stroke = theme.tokens.accent;
          }
        }),
      );
    });
  }
  function updateSelected(recipe: (object: PresentationObject) => void) {
    if (!selectedObjectId) return;
    mutate((draft) => {
      const object = draft.slides[activeSlideIndex]!.objects.find(
        (candidate) => candidate.id === selectedObjectId,
      );
      if (object) recipe(object);
    });
  }
  function moveSelectedLayer(direction: -1 | 1) {
    if (!selectedObjectId) return;
    mutate((draft) => {
      const slide = draft.slides[activeSlideIndex]!;
      const ordered = [...slide.objects].sort(
        (left, right) => (left.readingOrder ?? 0) - (right.readingOrder ?? 0),
      );
      const index = ordered.findIndex(
        (object) => object.id === selectedObjectId,
      );
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= ordered.length) return;
      const currentOrder = ordered[index]!.readingOrder ?? index;
      const destinationOrder =
        ordered[destination]!.readingOrder ?? destination;
      ordered[index]!.readingOrder = destinationOrder;
      ordered[destination]!.readingOrder = currentOrder;
      slide.accessibility = {
        ...slide.accessibility,
        readingOrder: [...ordered]
          .sort(
            (left, right) =>
              (left.readingOrder ?? 0) - (right.readingOrder ?? 0),
          )
          .map((object) => object.id),
      };
    });
  }
  function saveSelectedAsComponent() {
    if (!selectedObject) return;
    const componentId = `component-${Date.now().toString(36)}`;
    const componentObject = cloneDeck(selectedObject);
    componentObject.id = `${componentId}:template`;
    componentObject.componentId = componentId;
    mutate((draft) => {
      draft.components = [
        ...(draft.components ?? []),
        {
          id: componentId,
          name:
            presentationObjectText(selectedObject).slice(0, 80) ||
            `${selectedObject.type} component`,
          object: componentObject,
        },
      ];
      const live = draft.slides[activeSlideIndex]!.objects.find(
        (object) => object.id === selectedObject.id,
      );
      if (live) live.componentId = componentId;
    });
  }
  function insertComponent(componentId: string) {
    const component = deck.components?.find(
      (candidate) => candidate.id === componentId,
    );
    if (!component) return;
    const object = cloneDeck(component.object);
    object.id = `object-${Date.now().toString(36)}-component`;
    object.componentId = component.id;
    object.x = Math.max(0, Math.min(1_000 - object.width, object.x + 20));
    const canvasHeight = deck.settings?.aspectRatio === "4:3" ? 750 : 562.5;
    object.y = Math.max(
      0,
      Math.min(canvasHeight - object.height, object.y + 20),
    );
    mutate((draft) => draft.slides[activeSlideIndex]!.objects.push(object));
    setSelectedObjectId(object.id);
    setSurfacePreference("slides");
    onActiveRegionChange?.(object.id);
  }
  function addSection() {
    const name = sectionDraft.trim();
    if (!name) return;
    const id = `section-${Date.now().toString(36)}`;
    mutate((draft) => {
      draft.sections = [
        ...(draft.sections ?? []),
        { id, name: name.slice(0, 120) },
      ];
      draft.slides[activeSlideIndex]!.sectionId = id;
    });
    setSectionDraft("");
  }
  function beginDrag(
    object: PresentationObject,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (readOnly || object.locked) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedObjectId(object.id);
    setLayerSelection((selection) =>
      selection.includes(object.id) ? selection : [object.id],
    );
    onActiveRegionChange?.(object.id);
    dragRef.current = {
      mode: "move",
      objectId: object.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: object.x,
      startY: object.y,
      startWidth: object.width,
      startHeight: object.height,
      snapshot: cloneDeck(deck),
    };
  }
  function beginResize(
    object: PresentationObject,
    handle: ResizeHandle,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (readOnly || object.locked) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedObjectId(object.id);
    setLayerSelection((selection) =>
      selection.includes(object.id) ? selection : [object.id],
    );
    onActiveRegionChange?.(object.id);
    dragRef.current = {
      mode: "resize",
      handle,
      objectId: object.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: object.x,
      startY: object.y,
      startWidth: object.width,
      startHeight: object.height,
      snapshot: cloneDeck(deck),
    };
  }
  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const canvasHeight = deck.settings?.aspectRatio === "4:3" ? 750 : 562.5;
    const deltaX = ((event.clientX - drag.startClientX) / bounds.width) * 1_000;
    const deltaY =
      ((event.clientY - drag.startClientY) / bounds.height) * canvasHeight;
    let x = drag.startX;
    let y = drag.startY;
    let width = drag.startWidth;
    let height = drag.startHeight;
    if (drag.mode === "move") {
      x = Math.max(0, Math.min(1_000 - width, drag.startX + deltaX));
      y = Math.max(0, Math.min(canvasHeight - height, drag.startY + deltaY));
    } else {
      const minimumWidth = 40;
      const minimumHeight = 32;
      const handle = drag.handle ?? "se";
      const resizeX = handle.includes("e") || handle.includes("w");
      const resizeY = handle.includes("n") || handle.includes("s");
      if (resizeX && handle.includes("w")) {
        x = Math.max(
          0,
          Math.min(
            drag.startX + drag.startWidth - minimumWidth,
            drag.startX + deltaX,
          ),
        );
        width = drag.startWidth + (drag.startX - x);
      } else if (resizeX) {
        width = Math.max(
          minimumWidth,
          Math.min(1_000 - drag.startX, drag.startWidth + deltaX),
        );
      }
      if (resizeY && handle.includes("n")) {
        y = Math.max(
          0,
          Math.min(
            drag.startY + drag.startHeight - minimumHeight,
            drag.startY + deltaY,
          ),
        );
        height = drag.startHeight + (drag.startY - y);
      } else if (resizeY) {
        height = Math.max(
          minimumHeight,
          Math.min(canvasHeight - drag.startY, drag.startHeight + deltaY),
        );
      }
    }
    x = Math.round(x / 5) * 5;
    y = Math.round(y / 5) * 5;
    width = Math.max(40, Math.round(width / 5) * 5);
    height = Math.max(32, Math.round(height / 5) * 5);
    if (drag.mode === "move") {
      const peers = activeSlide.objects.filter(
        (object) => object.id !== drag.objectId && !object.hidden,
      );
      const horizontalTargets = [
        0,
        500,
        1_000,
        ...peers.flatMap((object) => [
          object.x,
          object.x + object.width / 2,
          object.x + object.width,
        ]),
      ];
      const verticalTargets = [
        0,
        canvasHeight / 2,
        canvasHeight,
        ...peers.flatMap((object) => [
          object.y,
          object.y + object.height / 2,
          object.y + object.height,
        ]),
      ];
      const snappedX = smartGuide(x, width, 1_000, horizontalTargets);
      const snappedY = smartGuide(y, height, canvasHeight, verticalTargets);
      x = snappedX.position;
      y = snappedY.position;
      setGuides({ x: snappedX.guide, y: snappedY.guide });
    } else {
      setGuides({});
    }
    mutate((draft) => {
      const object = draft.slides[activeSlideIndex]!.objects.find(
        (candidate) => candidate.id === drag.objectId,
      );
      if (object) {
        object.x = x;
        object.y = y;
        object.width = Math.min(width, 1_000 - x);
        object.height = Math.min(height, canvasHeight - y);
        if (object.type === "group") {
          const originalSlide = drag.snapshot.slides[activeSlideIndex];
          const scaleX = object.width / Math.max(1, drag.startWidth);
          const scaleY = object.height / Math.max(1, drag.startHeight);
          draft.slides[activeSlideIndex]!.objects.forEach((child) => {
            if (child.parentId !== object.id) return;
            const original = originalSlide?.objects.find(
              (candidate) => candidate.id === child.id,
            );
            if (!original) return;
            child.x = x + (original.x - drag.startX) * scaleX;
            child.y = y + (original.y - drag.startY) * scaleY;
            if (drag.mode === "resize") {
              child.width = Math.max(10, original.width * scaleX);
              child.height = Math.max(10, original.height * scaleY);
            }
          });
        }
      }
    }, false);
  }
  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    setGuides({});
    setUndoStack((stack) => [...stack.slice(-79), drag.snapshot]);
    setRedoStack([]);
  }
  function updateText(objectId: string, value: string) {
    mutate((draft) => {
      const object = draft.slides[activeSlideIndex]!.objects.find(
        (candidate) => candidate.id === objectId,
      );
      if (object)
        Object.assign(object, withPresentationObjectText(object, value));
    }, false);
  }
  function beginText(objectId: string) {
    textOriginRef.current ??= cloneDeck(deck);
    setSelectedObjectId(objectId);
    onActiveRegionChange?.(objectId);
  }
  function finishText() {
    if (!textOriginRef.current) return;
    setUndoStack((stack) => [...stack.slice(-79), textOriginRef.current!]);
    setRedoStack([]);
    textOriginRef.current = undefined;
  }
  async function addMedia(file: File) {
    if (readOnly || !file.size) return;
    setAssetError(undefined);
    setAssetBusy(true);
    try {
      if (!file.type.startsWith("image/") && !file.type.startsWith("video/"))
        throw new Error("Choose an image or video file.");
      if (file.size > 100_000_000)
        throw new Error("Presentation media cannot exceed 100 MB per asset.");
      const uploaded = await uploadArtifactAsset({
        artifactId,
        path: `media/${Date.now().toString(36)}-${crypto
          .randomUUID()
          .slice(
            0,
            8,
          )}-${file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120)}`,
        name: file.name,
        mediaType: file.type,
        sha256: await sha256Blob(file),
        blob: file,
      });
      const result = await getArtifactAssets(artifactId);
      setAssets(result.assets);
      const object = createPresentationObject(
        file.type.startsWith("video/") ? "video" : "image",
        activeSlide.objects.length + 1,
      );
      object.content = { assetId: uploaded.assetId, name: file.name };
      object.altText = "";
      mutate((draft) => draft.slides[activeSlideIndex]!.objects.push(object));
      setSelectedObjectId(object.id);
      setLayerSelection([object.id]);
    } catch (error) {
      setAssetError(
        error instanceof Error ? error.message : "Media could not be added.",
      );
    } finally {
      setAssetBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function importPresentation(file: File) {
    if (readOnly || !file.size) return;
    setIoError(undefined);
    setIoMessage(undefined);
    setIoBusy("Retaining the original presentation");
    let jobId: string | undefined;
    let originalRetained = false;
    try {
      const format = file.name.split(".").at(-1)?.toLowerCase() || "unknown";
      if (file.size > 80_000_000)
        throw new Error("Presentation imports cannot exceed 80 MB.");
      const beginning = await beginArtifactImportOriginal({
        artifactId,
        typeKey: "presentation",
        format,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: file.size,
        sha256: await sha256Blob(file),
      });
      jobId = beginning.jobId;
      try {
        await uploadArtifactImportOriginal(jobId, file);
        originalRetained = true;
      } catch (error) {
        await abortArtifactImportUpload(
          jobId,
          error instanceof Error ? error.message : "Original upload failed.",
        ).catch(() => undefined);
        throw error;
      }

      setIoBusy("Converting slides into editable objects");
      const imported = await importPresentationFile(file);
      const next = cloneDeck(imported.content);
      const retainedMedia = new Map<string, string>();
      const skippedMedia: string[] = [];
      const allowedMedia = new Set([
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/avif",
        "video/mp4",
        "video/webm",
      ]);
      for (const media of imported.media) {
        if (
          !allowedMedia.has(media.mediaType) ||
          media.bytes.byteLength > 100_000_000
        ) {
          skippedMedia.push(media.name);
          continue;
        }
        setIoBusy(`Retaining ${media.name}`);
        const blob = new Blob(
          [
            media.bytes.buffer.slice(
              media.bytes.byteOffset,
              media.bytes.byteOffset + media.bytes.byteLength,
            ) as ArrayBuffer,
          ],
          { type: media.mediaType },
        );
        try {
          const uploaded = await uploadArtifactAsset({
            artifactId,
            path: `imports/${jobId}/${media.archivePath}`,
            name: media.name,
            mediaType: media.mediaType,
            sha256: await sha256Blob(blob),
            blob,
          });
          retainedMedia.set(media.archivePath, uploaded.assetId);
        } catch {
          skippedMedia.push(media.name);
        }
      }
      next.slides.forEach((slide) =>
        slide.objects.forEach((object) => {
          const source =
            object.content &&
            typeof object.content === "object" &&
            !Array.isArray(object.content)
              ? (object.content as Record<string, unknown>)
              : {};
          if (typeof source.importMediaPath !== "string") return;
          const assetId = retainedMedia.get(source.importMediaPath);
          object.content = assetId
            ? { assetId, importedFrom: source.importMediaPath }
            : { missingImportMediaPath: source.importMediaPath };
        }),
      );
      const fidelityReport = [
        ...imported.fidelityReport,
        ...(skippedMedia.length
          ? [
              {
                scope: "media requiring replacement",
                level: "unsupported" as const,
                message: `${skippedMedia.length} unsafe, unsupported, or oversized media files remain recoverable from the retained original.`,
              },
            ]
          : []),
      ];
      const unsupportedFeatures = [
        ...imported.unsupportedFeatures,
        ...(skippedMedia.length
          ? [`Media requiring replacement: ${skippedMedia.join(", ")}`]
          : []),
      ];
      setUndoStack((stack) => [...stack.slice(-79), cloneDeck(deck)]);
      setRedoStack([]);
      onChange(next);
      await completeArtifactImport({
        jobId,
        typeKey: "presentation",
        status: "imported",
        fidelityReport,
        unsupportedFeatures,
        importedContent: next,
      });
      setPendingImportVersion(jobId);
      const refreshedAssets = await getArtifactAssets(artifactId);
      setAssets(refreshedAssets.assets);
      refreshImportHistory();
      setIoBusy(undefined);
      setIoMessage(
        `Imported ${next.slides.length} slides. The fidelity record is in the inspector under Files, and the original stays recoverable.`,
      );
      setSurfacePreference("slides");
      setActiveSlideId(next.slides[0]!.id);
      setSelectedObjectId(undefined);
      setLayerSelection([]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Presentation import failed.";
      if (jobId && originalRetained) {
        await completeArtifactImport({
          jobId,
          typeKey: "presentation",
          status: "quarantined",
          fidelityReport: [
            {
              scope: "original presentation",
              level: "exact",
              message: "The original remains retained privately for recovery.",
            },
            {
              scope: "native conversion",
              level: "unsupported",
              message,
            },
          ],
          unsupportedFeatures: ["Native conversion"],
          quarantineReason: message,
        }).catch(() => undefined);
      }
      setIoError(message);
      setIoBusy(undefined);
      refreshImportHistory();
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function exportPresentation(format: "pptx" | "odp" | "pdf" | "png") {
    setIoError(undefined);
    setIoMessage(undefined);
    setIoBusy(`Building ${format.toUpperCase()} export`);
    try {
      const stem = presentationFileStem(
        deck.slides[0]?.title ?? "presentation",
      );
      const blob =
        format === "pptx"
          ? await buildPresentationPptx(deck, assets)
          : format === "odp"
            ? buildPresentationOdp(deck)
            : format === "pdf"
              ? await buildPresentationPdf(deck, assets)
              : await buildPresentationPngArchive(deck, assets);
      downloadBlob(blob, `${stem}.${format === "png" ? "slides.zip" : format}`);
      setIoMessage(
        format === "pptx"
          ? "PowerPoint export preserved editable text, shapes, images, charts, tables, and notes; unsupported live embeds and complex motion remain Spectra-native."
          : format === "odp"
            ? "OpenDocument export contains editable slide text frames; media, live embeds, and advanced motion require the Spectra source for full fidelity."
            : "Static export completed from the current synchronized scene.",
      );
    } catch (error) {
      setIoError(
        error instanceof Error
          ? error.message
          : `${format.toUpperCase()} export failed.`,
      );
    } finally {
      setIoBusy(undefined);
    }
  }

  function recordPresentedSlide(now = Date.now()) {
    if (!rehearsalModeRef.current || !presentSlideStartedAtRef.current) return;
    const index = presentIndexRef.current;
    rehearsalDurationsRef.current[index] =
      (rehearsalDurationsRef.current[index] ?? 0) +
      Math.max(0, now - presentSlideStartedAtRef.current);
  }

  function goToPresentSlide(index: number) {
    if (!presentedDeck) return;
    const next = Math.max(
      0,
      Math.min(presentedDeck.slides.length - 1, Math.round(index)),
    );
    if (next === presentIndexRef.current) return;
    const now = Date.now();
    recordPresentedSlide(now);
    presentIndexRef.current = next;
    presentSlideStartedAtRef.current = now;
    setPresentIndex(next);
    setSlideElapsed(0);
  }

  function movePresentIndex(delta: -1 | 1) {
    goToPresentSlide(presentIndexRef.current + delta);
  }

  function togglePresenterNotes() {
    setPresenterNotesVisible((visible) => {
      const next = !visible;
      try {
        window.localStorage.setItem(
          PRESENTER_NOTES_KEY,
          next ? "visible" : "hidden",
        );
      } catch {
        // Storage is optional; the toggle still governs this session.
      }
      return next;
    });
  }

  function startPresenting(rehearse = false) {
    const now = Date.now();
    rehearsalModeRef.current = rehearse;
    rehearsalDurationsRef.current = deck.slides.map(() => 0);
    presentIndexRef.current = activeSlideIndex;
    presentSlideStartedAtRef.current = now;
    setRehearsalMode(rehearse);
    if (rehearse) setRehearsalReport(undefined);
    setPresentedDeck(cloneDeck(deck));
    setPresentIndex(activeSlideIndex);
    setPresentStartedAt(now);
    setPresentElapsed(0);
    setSlideElapsed(0);
    setPresentBlackout(false);
    // Rehearsing is private by definition, so the presenter panel opens with
    // the notes already showing; a live run keeps whatever this device chose.
    const extended =
      typeof screen !== "undefined" &&
      Boolean((screen as Screen & { isExtended?: boolean }).isExtended);
    setPresentLayout(rehearse || extended ? "speaker" : "audience");
    if (rehearse || extended) setPresenterNotesVisible(true);
    setPresentChrome(true);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }
  function stopPresenting() {
    const now = Date.now();
    recordPresentedSlide(now);
    if (rehearsalModeRef.current) {
      const slideDurations = [...rehearsalDurationsRef.current];
      setRehearsalReport({
        slideDurations,
        totalMs: slideDurations.reduce(
          (total, duration) => total + duration,
          0,
        ),
      });
    }
    rehearsalModeRef.current = false;
    presentSlideStartedAtRef.current = 0;
    setRehearsalMode(false);
    setPresentedDeck(undefined);
    setPresentBlackout(false);
    // Leaving Present puts the deck on the slide it ended on, so the editor and
    // the activity never disagree about where the presenter is.
    const landed = presentedDeck?.slides[presentIndexRef.current]?.id;
    if (landed && deck.slides.some((slide) => slide.id === landed))
      setActiveSlideId(landed);
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }
  function revealPresentChrome() {
    setPresentChrome(true);
    window.clearTimeout(presentChromeHideRef.current);
    presentChromeHideRef.current = window.setTimeout(
      () => setPresentChrome(false),
      2400,
    );
  }
  const formatElapsed = `${Math.floor(presentElapsed / 60_000)}:${Math.floor(
    (presentElapsed % 60_000) / 1_000,
  )
    .toString()
    .padStart(2, "0")}`;
  const durationLabel = (milliseconds: number) =>
    `${Math.floor(milliseconds / 60_000)}:${Math.floor(
      (milliseconds % 60_000) / 1_000,
    )
      .toString()
      .padStart(2, "0")}`;

  function selectSlide(slideId: string) {
    setActiveSlideId(slideId);
    setSelectedObjectId(undefined);
    setLayerSelection([]);
    onActiveRegionChange?.(slideId);
  }
  function openInspector(section: InspectorSection) {
    setInspectorSection(section);
    setInspectorPreference("open");
    // The inspector lives beside the canvas, so asking for one of its sections
    // from the notes page has to bring the canvas back with it.
    setSurfacePreference("slides");
  }
  const slideItems = deck.slides.map((slide, index) => ({
    value: slide.id,
    label: slide.title || `Slide ${index + 1}`,
  }));
  const canvasHeight = deck.settings?.aspectRatio === "4:3" ? 750 : 562.5;
  // The rail keeps its previews and the inspector its column only while the
  // pane is at its preferred size; below that each collapses to a toggle so the
  // canvas keeps the room. Both widths come from the shared density, not from a
  // breakpoint this studio invented.
  const workspaceColumns = [
    contract.surface === "full" && surface === "slides" && slideRailOpen
      ? "292px"
      : "",
    "minmax(0, 1fr)",
  ]
    .filter(Boolean)
    .join(" ");
  /**
   * The bar carries five things at every width and nothing else. Everything
   * that used to live in a second 42px row is now either in `⋯` or in the
   * inspector, which is the only split that survives a 560px pane in one row.
   */
  const workbarActions: CommandBinding[] = [
    // The rail and the inspector are the canvas's two side panes, so their
    // toggles are absent on the notes page rather than present and inert.
    ...(surface === "slides"
      ? ([
          ...(contract.surface === "full"
            ? [
                {
                  id: "previews",
                  label: slideRailOpen
                    ? "Hide slide previews"
                    : "Show slide previews",
                  icon: LayoutTemplate,
                  priority: "essential" as const,
                  active: slideRailOpen,
                  onSelect: () =>
                    setSlideRailPreference(slideRailOpen ? "closed" : "open"),
                },
              ]
            : []),
          {
            id: "inspector",
            label: inspectorOpen ? "Hide inspector" : "Show inspector",
            icon: SlidersHorizontal,
            priority: "essential" as const,
            active: inspectorOpen,
            hint: "Slide, objects, design, sources and files",
            onSelect: () =>
              setInspectorPreference(inspectorOpen ? "closed" : "open"),
          },
        ] satisfies CommandBinding[])
      : []),
    // The notes page exists because the registry declares it, not because this
    // studio decided to have one: drop the mode and the action goes with it.
    ...(contract.modes.some((mode) => mode.id === "notes")
      ? [
          {
            id: "notes-page",
            label:
              surface === "notes" ? "Back to the slides" : "Speaker notes",
            icon: StickyNote,
            priority: "essential" as const,
            active: surface === "notes",
            hint: "Every slide's notes on one page",
            onSelect: () =>
              setSurfacePreference(surface === "notes" ? "slides" : "notes"),
          },
        ]
      : []),
    {
      id: "add-slide",
      label: "Add slide",
      icon: Plus,
      priority: "essential",
      requires: "edit",
      onSelect: addSlide,
    },
    {
      id: "undo",
      label: "Undo",
      icon: Undo2,
      priority: "essential",
      requires: "edit",
      disabled: !undoStack.length,
      hint: "Control with Z",
      onSelect: undo,
    },
    {
      // Redo is the first thing the bar gives up under pressure, because it is
      // the least reached of the five and it keeps its shortcut either way.
      id: "redo",
      label: "Redo",
      icon: Redo2,
      priority: "secondary",
      requires: "edit",
      disabled: !redoStack.length,
      hint: "Control with Shift and Z",
      onSelect: redo,
    },
    {
      id: "duplicate-slide",
      label: "Duplicate slide",
      icon: Copy,
      priority: "advanced",
      requires: "edit",
      onSelect: duplicateSlide,
    },
    {
      id: "move-slide-earlier",
      label: "Move slide earlier",
      icon: ArrowUp,
      priority: "advanced",
      requires: "edit",
      disabled: activeSlideIndex === 0,
      onSelect: () => moveSlide(-1),
    },
    {
      id: "move-slide-later",
      label: "Move slide later",
      icon: ArrowDown,
      priority: "advanced",
      requires: "edit",
      disabled: activeSlideIndex === deck.slides.length - 1,
      onSelect: () => moveSlide(1),
    },
    {
      id: "delete-slide",
      label: "Delete slide",
      icon: Trash2,
      priority: "advanced",
      requires: "edit",
      disabled: deck.slides.length === 1,
      onSelect: deleteSlide,
    },
    {
      id: "group",
      label: "Group objects",
      icon: GroupIcon,
      priority: "advanced",
      requires: "edit",
      disabled: layerSelection.length < 2,
      hint: "Shift-click objects to select several",
      onSelect: groupSelectedObjects,
    },
    {
      id: "ungroup",
      label: "Ungroup",
      icon: Ungroup,
      priority: "advanced",
      requires: "edit",
      disabled: selectedObject?.type !== "group",
      onSelect: ungroupSelectedObject,
    },
    {
      id: "rehearse",
      label: "Rehearse timings",
      icon: Clock3,
      priority: "advanced",
      requires: "present",
      hint: "Private run with per-slide timings",
      onSelect: () => startPresenting(true),
    },
    {
      id: "design",
      label: "Design and theme",
      icon: Palette,
      priority: "advanced",
      onSelect: () => openInspector("design"),
    },
    {
      id: "sources",
      label: "Sources and citations",
      icon: List,
      priority: "advanced",
      onSelect: () => openInspector("sources"),
    },
    {
      id: "files",
      label: "Import and export",
      icon: FileArchive,
      priority: "advanced",
      onSelect: () => openInspector("files"),
    },
  ];

  return (
    <section className="presentation-studio">
      <ArtifactWorkbar
        label="Presentation"
        selectionContext={
          selectedObject
            ? "Shape"
            : activeSlide.transition?.kind && activeSlide.transition.kind !== "none"
              ? "Transition"
              : undefined
        }
        // No mode row. A deck has one place you author it; Present is an
        // activity behind the primary verb and the notes page is a pane behind
        // an action, so neither can read as a peer tab beside the slides
        // (CANON D2/D3). The registry still decides both exist and who may
        // reach them, which is what `contract.modes` and `requires` below read.
        modes={[]}
        selector={
          surface !== "slides" ? undefined : (
            <WorkbarItemSelector
              ariaLabel="Slide"
              itemNoun="slide"
              items={slideItems}
              value={activeSlide.id}
              onChange={selectSlide}
            />
          )
        }
        actions={workbarActions}
        primary={{
          label: "Present",
          icon: Play,
          requires: "present",
          onSelect: () => startPresenting(false),
        }}
      />
      <div className="spectra-editor-body">
      <input
        ref={importInputRef}
        type="file"
        accept=".pptx,.pptm,.ppsm,.odp,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.oasis.opendocument.presentation"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importPresentation(file);
        }}
      />
      {ioBusy || ioError || ioMessage ? (
        <div
          className="presentation-io-status"
          data-error={ioError ? true : undefined}
          role={ioError ? "alert" : "status"}
        >
          <span>{ioError || ioBusy || ioMessage}</span>
          {ioError || ioMessage ? (
            <button
              type="button"
              onClick={() => {
                setIoError(undefined);
                setIoMessage(undefined);
              }}
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span aria-hidden="true" className="presentation-io-pulse" />
          )}
        </div>
      ) : null}

      {surface === "slides" ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif,video/mp4,video/webm"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void addMedia(file);
            }}
          />
          {assetError ? (
            <div className="presentation-notice" role="alert">
              {assetError}
              <button
                type="button"
                onClick={() => setAssetError(undefined)}
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
          <div
            className="presentation-workspace"
            data-rail-collapsed={!slideRailOpen || undefined}
            data-inspector-overlay={
              inspectorOverlays && inspectorOpen ? true : undefined
            }
            style={{ gridTemplateColumns: workspaceColumns }}
          >
            {contract.surface === "full" && surface === "slides" ? (
              <StudioItemRail
                label="Slides"
                count={deck.slides.length}
                collapsed={!slideRailOpen}
                onToggleCollapsed={() =>
                  setSlideRailPreference(slideRailOpen ? "closed" : "open")
                }
                items={deck.slides.map((slide, index) => ({
                  id: slide.id,
                  title: slide.title || `Slide ${index + 1}`,
                  subtitle: slide.speakerNotes
                    ? "Has speaker notes"
                    : undefined,
                  active: slide.id === activeSlide.id,
                  preview: (
                    <div className="spectra-item-rail-preview" data-spectra-hidden-target="true">
                      <SlideCanvas
                        slide={slide}
                        deck={deck}
                        assets={assets}
                        artifacts={artifacts}
                        readOnly
                        compact
                        aiChangedPaths={[]}
                        onSelectObject={() => undefined}
                        onPointerDown={() => undefined}
                        onResizePointerDown={() => undefined}
                        onPointerMove={() => undefined}
                        onPointerUp={() => undefined}
                        onTextChange={() => undefined}
                        onTextFocus={() => undefined}
                        onTextBlur={() => undefined}
                      />
                    </div>
                  ),
                }))}
                onSelect={selectSlide}
                onAdd={readOnly ? undefined : addSlide}
                addLabel="Add slide"
                canEdit={!readOnly}
                draggingId={draggingSlideId}
                onDragStart={setDraggingSlideId}
                onDragEnd={() => {
                  setDraggingSlideId(undefined);
                  setDropTargetSlideId(undefined);
                }}
                onMove={(from, to) => {
                  const moved = deck.slides[from];
                  const target = deck.slides[to];
                  if (moved && target) {
                    setActiveSlideId(moved.id);
                    moveSlideBefore(target.id);
                  }
                }}
              />
            ) : null}
            <div className="presentation-stage">
              <SlideCanvas
                slide={activeSlide}
                deck={deck}
                assets={assets}
                artifacts={artifacts}
                selectedObjectId={selectedObjectId}
                selectedObjectIds={layerSelection}
                guides={guides}
                showSlideNumber
                aiChangedPaths={aiChangedPaths}
                readOnly={readOnly}
                onSelectObject={(id, additive) => selectObject(id, additive)}
                onPointerDown={beginDrag}
                onResizePointerDown={beginResize}
                onPointerMove={moveDrag}
                onPointerUp={finishDrag}
                onTextChange={updateText}
                onTextFocus={beginText}
                onTextBlur={finishText}
              />
              <section
                className="presentation-notes"
                data-open={notesOpen || undefined}
              >
                <button
                  type="button"
                  className="presentation-notes-toggle"
                  aria-expanded={notesOpen}
                  onClick={() => setNotesOpen((open) => !open)}
                >
                  <strong>Speaker notes</strong>
                  <span>
                    {notesOpen
                      ? "Hide notes"
                      : activeSlide.speakerNotes
                        ? "Notes added"
                        : "Add notes"}
                  </span>
                  <ChevronRight
                    className={`h-3 w-3 transition-transform ${
                      notesOpen ? "rotate-90" : ""
                    }`}
                  />
                </button>
                {notesOpen ? (
                  <>
                    <LocalAutocompleteTextarea
                      surface="slide_text"
                      value={activeSlide.speakerNotes ?? ""}
                      readOnly={readOnly}
                      aria-label={`Speaker notes for slide ${activeSlideIndex + 1}`}
                      {...targetAttrs(
                        `/slides/${activeSlideIndex}/speakerNotes`,
                      )}
                      placeholder="Add private speaking prompts, source reminders, or rehearsal cues."
                      className="presentation-notes-field"
                      onFocus={() =>
                        onActiveRegionChange?.(`${activeSlide.id}:notes`)
                      }
                      onValueChange={(speakerNotes) =>
                        mutate((draft) => {
                          draft.slides[activeSlideIndex]!.speakerNotes =
                            speakerNotes;
                        })
                      }
                      textareaClassName="w-full"
                    />
                  </>
                ) : null}
              </section>
            </div>
            {inspectorOpen ? (
              <aside
                className="presentation-inspector"
                data-overlay={inspectorOverlays || undefined}
                aria-label="Presentation inspector"
              >
                <div className="mb-3 flex items-center gap-2">
                  <SelectField
                    ariaLabel="Inspector section"
                    size="sm"
                    className="min-w-0 flex-1"
                    value={inspectorSection}
                    onChange={(value) =>
                      setInspectorSection(value as InspectorSection)
                    }
                    options={INSPECTOR_SECTIONS}
                  />
                  <button
                    type="button"
                    className={INSPECTOR_ICON_BUTTON}
                    aria-label="Hide inspector"
                    title="Hide inspector"
                    onClick={() => setInspectorPreference("closed")}
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="presentation-settings-grid">
                  {inspectorSection === "slide" ? (
                    <>
                      <section>
                        <div className="flex items-center justify-between gap-2">
                          <h4>Slide {activeSlideIndex + 1}</h4>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              className={INSPECTOR_ICON_BUTTON}
                              onClick={() => moveSlide(-1)}
                              disabled={readOnly || activeSlideIndex === 0}
                              aria-label="Move slide earlier"
                              title="Move slide earlier"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className={INSPECTOR_ICON_BUTTON}
                              onClick={() => moveSlide(1)}
                              disabled={
                                readOnly ||
                                activeSlideIndex === deck.slides.length - 1
                              }
                              aria-label="Move slide later"
                              title="Move slide later"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className={INSPECTOR_ICON_BUTTON}
                              onClick={duplicateSlide}
                              disabled={readOnly}
                              aria-label="Duplicate slide"
                              title="Duplicate slide"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className={INSPECTOR_ICON_BUTTON}
                              onClick={deleteSlide}
                              disabled={readOnly || deck.slides.length === 1}
                              aria-label="Delete slide"
                              title="Delete slide"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <label>
                          Slide title
                          <input
                            value={activeSlide.title}
                            disabled={readOnly}
                            {...targetAttrs(
                              `/slides/${activeSlideIndex}/title`,
                            )}
                            onChange={(event) =>
                              mutate((draft) => {
                                draft.slides[activeSlideIndex]!.title =
                                  event.target.value;
                              })
                            }
                          />
                        </label>
                        <SelectField
                          label="Layout"
                          size="sm"
                          className="mt-3"
                          value={activeSlide.layoutId ?? "title-content"}
                          disabled={readOnly}
                          options={LAYOUT_OPTIONS}
                          onChange={applySlideLayout}
                        />
                        <SelectField
                          label="Transition"
                          size="sm"
                          className="mt-3"
                          value={activeSlide.transition?.kind ?? "none"}
                          disabled={readOnly}
                          options={TRANSITION_OPTIONS}
                          onChange={(kind) =>
                            mutate((draft) => {
                              draft.slides[activeSlideIndex]!.transition = {
                                kind: kind as
                                  | "none"
                                  | "fade"
                                  | "push"
                                  | "dissolve",
                                durationMs:
                                  activeSlide.transition?.durationMs ?? 720,
                              };
                            })
                          }
                        />
                        <label>
                          Accessible slide label
                          <input
                            value={activeSlide.accessibility?.label ?? ""}
                            disabled={readOnly}
                            onChange={(event) =>
                              mutate((draft) => {
                                draft.slides[activeSlideIndex]!.accessibility = {
                                  ...draft.slides[activeSlideIndex]!
                                    .accessibility,
                                  label: event.target.value,
                                };
                              })
                            }
                            placeholder="Describe this slide for navigation"
                          />
                        </label>
                        <SelectField
                          label="Section"
                          size="sm"
                          className="mt-3"
                          value={activeSlide.sectionId ?? NO_SELECTION}
                          disabled={readOnly}
                          options={[
                            { value: NO_SELECTION, label: "No section" },
                            ...(deck.sections ?? []).map((section) => ({
                              value: section.id,
                              label: section.name,
                            })),
                          ]}
                          onChange={(sectionId) =>
                            mutate((draft) => {
                              const slide = draft.slides[activeSlideIndex]!;
                              if (sectionId === NO_SELECTION)
                                delete slide.sectionId;
                              else slide.sectionId = sectionId;
                            })
                          }
                        />
                        <div className="presentation-add-section">
                          <input
                            value={sectionDraft}
                            disabled={readOnly}
                            aria-label="New section name"
                            placeholder="New section name"
                            onChange={(event) =>
                              setSectionDraft(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                addSection();
                              }
                            }}
                          />
                          <button
                            type="button"
                            disabled={readOnly || !sectionDraft.trim()}
                            onClick={addSection}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add
                          </button>
                        </div>
                        {deck.sections?.length ? (
                          <div className="presentation-section-list">
                            {deck.sections.map((section, sectionIndex) => (
                              <div key={section.id}>
                                <input
                                  aria-label="Section name"
                                  value={section.name}
                                  disabled={readOnly}
                                  onChange={(event) =>
                                    mutate((draft) => {
                                      draft.sections![sectionIndex]!.name =
                                        event.target.value;
                                    })
                                  }
                                />
                                <button
                                  type="button"
                                  aria-label={`Remove ${section.name} section`}
                                  disabled={readOnly}
                                  onClick={() =>
                                    mutate((draft) => {
                                      draft.sections?.splice(sectionIndex, 1);
                                      draft.slides.forEach((slide) => {
                                        if (slide.sectionId === section.id)
                                          delete slide.sectionId;
                                      });
                                    })
                                  }
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </section>
                      <section>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Layers3 className="h-4 w-4" />
                            <h4>Objects and reading order</h4>
                          </div>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              className={INSPECTOR_ICON_BUTTON}
                              disabled={!selectedObject || readOnly}
                              onClick={() => moveSelectedLayer(-1)}
                              aria-label="Move earlier in reading order"
                              title="Move earlier in reading order"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className={INSPECTOR_ICON_BUTTON}
                              disabled={!selectedObject || readOnly}
                              onClick={() => moveSelectedLayer(1)}
                              aria-label="Move later in reading order"
                              title="Move later in reading order"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="presentation-layer-list">
                          {[...activeSlide.objects]
                            .sort(
                              (left, right) =>
                                (left.readingOrder ?? 0) -
                                (right.readingOrder ?? 0),
                            )
                            .map((object, index) => (
                              <button
                                type="button"
                                key={object.id}
                                data-active={
                                  layerSelection.includes(object.id) ||
                                  undefined
                                }
                                onClick={(event) =>
                                  selectObject(object.id, event.shiftKey)
                                }
                              >
                                <span>{index + 1}</span>
                                <strong>
                                  {presentationObjectText(object) ||
                                    object.type}
                                </strong>
                                <small>
                                  {object.type}
                                  {object.altText
                                    ? " · alt text"
                                    : ["image", "chart", "video"].includes(
                                          object.type,
                                        )
                                      ? " · needs alt text"
                                      : ""}
                                </small>
                                {object.locked ? (
                                  <Lock className="h-3 w-3" />
                                ) : null}
                              </button>
                            ))}
                        </div>
                        <div
                          className="presentation-arrange-controls"
                          aria-label="Arrange selected objects"
                        >
                          <span>
                            {layerSelection.length > 1
                              ? `${layerSelection.length} objects selected`
                              : "Shift-click objects to select several"}
                          </span>
                          <div>
                            {(
                              [
                                ["left", "Left"],
                                ["center", "Center"],
                                ["right", "Right"],
                                ["top", "Top"],
                                ["middle", "Middle"],
                                ["bottom", "Bottom"],
                                ["distribute-x", "Space H"],
                                ["distribute-y", "Space V"],
                              ] as const
                            ).map(([mode, label]) => (
                              <button
                                key={mode}
                                type="button"
                                disabled={
                                  readOnly ||
                                  layerSelection.length <
                                    (mode.startsWith("distribute") ? 3 : 2)
                                }
                                onClick={() => arrangeSelection(mode)}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {selectedObject ? (
                          <>
                            {selectedObject.type === "text" ? (
                              <SelectField
                                label="Text style"
                                size="sm"
                                className="mt-3"
                                value={selectedTextPreset ?? "body"}
                                disabled={readOnly}
                                options={TEXT_PRESET_OPTIONS}
                                onChange={(preset) =>
                                  applyTextPreset(
                                    preset as
                                      | "title"
                                      | "subtitle"
                                      | "body"
                                      | "caption",
                                  )
                                }
                              />
                            ) : null}
                            <div
                              className="mt-3 flex flex-wrap gap-1"
                              role="group"
                              aria-label="Format selected object"
                            >
                              {OBJECT_FORMAT_TOOLS.map((tool) => (
                                <button
                                  key={tool.id}
                                  type="button"
                                  className={INSPECTOR_ICON_BUTTON}
                                  disabled={readOnly}
                                  aria-pressed={tool.pressed?.(selectedObject)}
                                  aria-label={tool.label(selectedObject)}
                                  title={tool.label(selectedObject)}
                                  onClick={() => updateSelected(tool.apply)}
                                >
                                  <tool.icon
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                </button>
                              ))}
                              <button
                                type="button"
                                className={INSPECTOR_ICON_BUTTON}
                                disabled={readOnly}
                                onClick={deleteSelectedObject}
                                aria-label="Delete object"
                                title="Delete object"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <PresentationObjectInspector
                              object={selectedObject}
                              readOnly={readOnly}
                              canvasHeight={canvasHeight}
                              artifacts={artifacts}
                              artifactId={artifactId}
                              onUpdate={updateSelected}
                            />
                            <button
                              type="button"
                              className={`${INSPECTOR_BUTTON} mt-3 justify-self-start`}
                              disabled={readOnly}
                              onClick={saveSelectedAsComponent}
                            >
                              <Copy className="h-3.5 w-3.5" /> Save as reusable
                              component
                            </button>
                          </>
                        ) : (
                          <p className="presentation-empty-copy">
                            Select an object on the slide to edit its text,
                            position and size.
                          </p>
                        )}
                      </section>
                    </>
                  ) : null}

                  {inspectorSection === "insert" ? (
                    <>
                      <section>
                        <h4>Insert onto slide {activeSlideIndex + 1}</h4>
                        <div className="mt-3 grid grid-cols-2 gap-1.5">
                          {(
                            [
                              ["text", Type, "Text box"],
                              ["shape", Square, "Shape"],
                              ["chart", BarChart3, "Chart"],
                              ["table", Table2, "Table"],
                            ] as const
                          ).map(([type, Icon, label]) => (
                            <button
                              key={type}
                              type="button"
                              className={INSPECTOR_BUTTON}
                              disabled={readOnly}
                              onClick={() => addObject(type)}
                            >
                              <Icon className="h-3.5 w-3.5" /> {label}
                            </button>
                          ))}
                          <button
                            type="button"
                            className={INSPECTOR_BUTTON}
                            disabled={readOnly || assetBusy}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <ImagePlus className="h-3.5 w-3.5" />{" "}
                            {assetBusy ? "Uploading" : "Image or video"}
                          </button>
                          <button
                            type="button"
                            className={INSPECTOR_BUTTON}
                            disabled={readOnly}
                            onClick={() => addObject("embed")}
                          >
                            <Link2 className="h-3.5 w-3.5" /> Link work
                          </button>
                        </div>
                        <p className="presentation-empty-copy">
                          A linked chart or embed asks for its source in Slide
                          and objects, under the selected object.
                        </p>
                      </section>
                      <section
                        className="presentation-component-library"
                        style={{ margin: 0, maxWidth: "none" }}
                      >
                        <div>
                          <div>
                            <h4>Reusable components</h4>
                            <p>
                              Saved objects keep their style and behavior, and
                              each inserted copy gets its own scene identity.
                            </p>
                          </div>
                          <span>{deck.components?.length ?? 0} saved</span>
                        </div>
                        {deck.components?.length ? (
                          <div>
                            {deck.components.map((component) => (
                              <button
                                key={component.id}
                                type="button"
                                disabled={readOnly}
                                onClick={() => insertComponent(component.id)}
                              >
                                <span>{component.object.type}</span>
                                <strong>{component.name}</strong>
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="presentation-empty-copy">
                            Select an object on the slide and save it here to
                            reuse it.
                          </p>
                        )}
                      </section>
                    </>
                  ) : null}

                  {inspectorSection === "design" ? (
                    <>
                      <section>
                        <div className="flex items-center gap-2">
                          <Palette className="h-4 w-4" />
                          <h4>Theme</h4>
                        </div>
                        <div
                          className="presentation-theme-grid mt-3"
                          style={{
                            gridTemplateColumns: "minmax(0, 1fr)",
                            maxWidth: "none",
                            margin: 0,
                          }}
                        >
                          {THEMES.map((theme) => (
                            <button
                              type="button"
                              key={theme.id}
                              data-active={
                                deck.theme.id === theme.id || undefined
                              }
                              disabled={readOnly}
                              onClick={() => applyTheme(theme)}
                            >
                              <span
                                style={{ background: theme.tokens.background }}
                              >
                                <i style={{ background: theme.tokens.heading }} />
                                <i style={{ background: theme.tokens.accent }} />
                                <i style={{ background: theme.tokens.soft }} />
                              </span>
                              <strong>{theme.name}</strong>
                              {deck.theme.id === theme.id ? (
                                <Check className="h-4 w-4" />
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </section>
                      <section>
                        <h4>Deck format</h4>
                        <SelectField
                          label="Aspect ratio"
                          size="sm"
                          className="mt-3"
                          value={deck.settings?.aspectRatio ?? "16:9"}
                          disabled={readOnly}
                          options={ASPECT_RATIO_OPTIONS}
                          onChange={(aspectRatio) =>
                            mutate((draft) => {
                              draft.settings = {
                                ...draft.settings,
                                aspectRatio: aspectRatio as "16:9" | "4:3",
                              };
                            })
                          }
                        />
                        <SelectField
                          label="Default transition"
                          size="sm"
                          className="mt-3"
                          value={deck.settings?.defaultTransition ?? "none"}
                          disabled={readOnly}
                          options={TRANSITION_OPTIONS}
                          onChange={(defaultTransition) =>
                            mutate((draft) => {
                              draft.settings = {
                                ...draft.settings,
                                defaultTransition: defaultTransition as
                                  | "none"
                                  | "fade"
                                  | "push"
                                  | "dissolve",
                              };
                            })
                          }
                        />
                        <label>
                          Auto-advance seconds
                          <input
                            type="number"
                            min="0"
                            max="3600"
                            step="1"
                            value={deck.settings?.autoAdvanceSeconds ?? 0}
                            disabled={readOnly}
                            onChange={(event) =>
                              mutate((draft) => {
                                draft.settings = {
                                  ...draft.settings,
                                  autoAdvanceSeconds: Math.max(
                                    0,
                                    Math.min(3_600, Number(event.target.value)),
                                  ),
                                };
                              })
                            }
                          />
                        </label>
                        <label className="presentation-check mt-3">
                          <input
                            type="checkbox"
                            checked={deck.settings?.showSlideNumbers !== false}
                            disabled={readOnly}
                            onChange={(event) =>
                              mutate((draft) => {
                                draft.settings = {
                                  ...draft.settings,
                                  showSlideNumbers: event.target.checked,
                                };
                              })
                            }
                          />{" "}
                          Show slide numbers
                        </label>
                      </section>
                    </>
                  ) : null}

                  {inspectorSection === "sources" ? (
                    <section className="presentation-citations-section">
                      <div>
                        <div>
                          <h4>Sources and citations</h4>
                          <p>
                            Citations stay attached to this slide and remain
                            visible to AI checks, history and export.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() =>
                            mutate((draft) => {
                              const slide = draft.slides[activeSlideIndex]!;
                              slide.citations = [
                                ...(slide.citations ?? []),
                                {
                                  id: localId("citation"),
                                  label: "New source",
                                },
                              ];
                            })
                          }
                        >
                          <Plus className="h-3.5 w-3.5" /> Add citation
                        </button>
                      </div>
                      {activeSlide.citations?.length ? (
                        <div className="presentation-citation-list">
                          {activeSlide.citations.map(
                            (citation, citationIndex) => (
                              <div key={citation.id}>
                                <input
                                  aria-label="Citation label"
                                  value={citation.label}
                                  disabled={readOnly}
                                  onChange={(event) =>
                                    mutate((draft) => {
                                      draft.slides[
                                        activeSlideIndex
                                      ]!.citations![citationIndex]!.label =
                                        event.target.value;
                                    })
                                  }
                                />
                                <input
                                  aria-label="Citation URL"
                                  type="url"
                                  value={citation.url ?? ""}
                                  disabled={readOnly}
                                  placeholder="https://"
                                  onChange={(event) =>
                                    mutate((draft) => {
                                      draft.slides[
                                        activeSlideIndex
                                      ]!.citations![citationIndex]!.url =
                                        event.target.value;
                                    })
                                  }
                                />
                                <button
                                  type="button"
                                  aria-label="Remove citation"
                                  disabled={readOnly}
                                  onClick={() =>
                                    mutate((draft) => {
                                      draft.slides[
                                        activeSlideIndex
                                      ]!.citations?.splice(citationIndex, 1);
                                    })
                                  }
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ),
                          )}
                        </div>
                      ) : (
                        <p className="presentation-empty-copy">
                          No citations are attached to this slide.
                        </p>
                      )}
                      <button
                        type="button"
                        className={`${INSPECTOR_BUTTON} mt-3 justify-self-start`}
                        disabled={readOnly || !deckCitationCount}
                        title="Collect every slide citation onto a references slide"
                        onClick={() =>
                          mutate((draft) => {
                            applyBibliographySlides(draft);
                          })
                        }
                      >
                        <List className="h-3.5 w-3.5" />{" "}
                        {deckHasBibliography
                          ? "Update references slide"
                          : "Build references slide"}
                      </button>
                      <p className="presentation-empty-copy">
                        {deckCitationCount
                          ? `${deckCitationCount} ${
                              deckCitationCount === 1
                                ? "citation"
                                : "citations"
                            } across the deck.`
                          : "No citations across the deck yet."}
                      </p>
                    </section>
                  ) : null}

                  {inspectorSection === "files" ? (
                    <section className="presentation-file-section">
                      <div>
                        <div>
                          <FileArchive className="h-4 w-4" />
                          <div>
                            <h4>Import and export</h4>
                            <p>
                              Originals stay private and recoverable. Native
                              conversion reports substitutions before imported
                              work enters history.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={readOnly || Boolean(ioBusy)}
                          onClick={() => importInputRef.current?.click()}
                        >
                          <Upload className="h-3.5 w-3.5" /> Import PowerPoint
                          or OpenDocument
                        </button>
                      </div>
                      <div className="presentation-export-actions">
                        {(
                          [
                            ["pdf", "PDF"],
                            ["pptx", "PowerPoint"],
                            ["odp", "OpenDocument"],
                            ["png", "Slide images"],
                          ] as const
                        ).map(([format, label]) => (
                          <button
                            key={format}
                            type="button"
                            disabled={Boolean(ioBusy)}
                            onClick={() => void exportPresentation(format)}
                          >
                            <Download className="h-3.5 w-3.5" /> {label}
                          </button>
                        ))}
                      </div>
                      {importHistory.length ? (
                        <div className="presentation-import-history">
                          {importHistory.slice(0, 5).map((entry) => (
                            <article key={entry.jobId} data-status={entry.status}>
                              <div>
                                <strong>
                                  {entry.name || entry.format.toUpperCase()}
                                </strong>
                                <span>
                                  {entry.status.replaceAll("_", " ")} ·{" "}
                                  {entry.format.toUpperCase()}
                                </span>
                              </div>
                              {entry.downloadUrl ? (
                                <a href={entry.downloadUrl} download>
                                  Original
                                </a>
                              ) : null}
                              {entry.quarantineReason ? (
                                <p>{entry.quarantineReason}</p>
                              ) : null}
                              {entry.fidelityReport?.length ? (
                                <ul>
                                  {entry.fidelityReport
                                    .slice(0, 5)
                                    .map((item, index) => (
                                      <li
                                        key={`${item.scope}:${index}`}
                                        data-level={item.level}
                                      >
                                        <strong>{item.scope}</strong>
                                        <span>{item.message}</span>
                                      </li>
                                    ))}
                                </ul>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="presentation-empty-copy">
                          Nothing has been imported into this deck yet.
                        </p>
                      )}
                    </section>
                  ) : null}
                </div>
              </aside>
            ) : null}
          </div>
        </>
      ) : null}

      {surface === "notes" ? (
        <div
          className="presentation-notes-view overflow-y-auto"
          style={{
            padding: "22px",
            background:
              "color-mix(in oklab, var(--bg-secondary) 45%, var(--bg-primary))",
          }}
        >
          <div className="mx-auto grid max-w-[880px] gap-2.5">
            {deck.slides.map((slide, index) => (
              <article
                key={slide.id}
                className="grid gap-3"
                data-ai-region={aiRegionAttr(
                  pathTouches(aiChangedPaths, `/slides/${index}`),
                )}
                style={{
                  gridTemplateColumns:
                    contract.density === "tight"
                      ? "minmax(0, 1fr)"
                      : "156px minmax(0, 1fr)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "10px",
                  background: "var(--bg-elevated)",
                  padding: "12px",
                }}
              >
                <button
                  type="button"
                  className="grid min-w-0 gap-1.5 text-left"
                  onClick={() => {
                    selectSlide(slide.id);
                    setSurfacePreference("slides");
                  }}
                  title={`Open slide ${index + 1} on the canvas`}
                >
                  <div data-spectra-hidden-target="true">
                    <SlideCanvas
                      slide={slide}
                      deck={deck}
                      assets={assets}
                      artifacts={artifacts}
                      readOnly
                      compact
                      aiChangedPaths={[]}
                      onSelectObject={() => undefined}
                      onPointerDown={() => undefined}
                      onResizePointerDown={() => undefined}
                      onPointerMove={() => undefined}
                      onPointerUp={() => undefined}
                      onTextChange={() => undefined}
                      onTextFocus={() => undefined}
                      onTextBlur={() => undefined}
                    />
                  </div>
                  <strong className="truncate text-caption font-semibold text-[var(--text-primary)]">
                    {index + 1} · {slide.title || `Slide ${index + 1}`}
                  </strong>
                </button>
                <label className="grid min-w-0 gap-1.5">
                  <span className="text-micro font-semibold text-[var(--text-secondary)]">
                    Speaker notes
                  </span>
                  <LocalAutocompleteTextarea
                    surface="slide_text"
                    value={slide.speakerNotes ?? ""}
                    readOnly={readOnly}
                    {...targetAttrs(`/slides/${index}/speakerNotes`)}
                    placeholder="What you will say on this slide."
                    onFocus={() => onActiveRegionChange?.(`${slide.id}:notes`)}
                    onValueChange={(speakerNotes) =>
                      mutate((draft) => {
                        draft.slides[index]!.speakerNotes = speakerNotes;
                      })
                    }
                    textareaClassName="min-h-[104px] w-full resize-y rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-2 text-caption leading-relaxed text-[var(--text-primary)] outline-none focus:border-[color-mix(in_oklab,var(--brand-primary)_45%,var(--border-default))]"
                  />
                </label>
              </article>
            ))}
          </div>
        </div>
      ) : null}
      </div>
      {/* A full-window surface has to leave the studio box: the studio root is
          an inline-size container, which makes it the containing block for
          `position: fixed`, so a fixed overlay rendered inside it is pinned to
          the pane rather than to the window. Present mode already portals for
          the same reason. */}
      {rehearsalReport && !presentedDeck && typeof document !== "undefined"
        ? createPortal(
            <div
              className="presentation-rehearsal-report"
              role="dialog"
              aria-modal="true"
              aria-label="Rehearsal timing report"
            >
              <header>
                <span>
                  <Clock3 className="h-4 w-4" /> Private rehearsal
                </span>
                <button type="button" onClick={() => setRehearsalReport(undefined)}>
                  <X className="h-4 w-4" />
                </button>
              </header>
              <main>
                <div>
                  <strong>{durationLabel(rehearsalReport.totalMs)}</strong>
                  <span>Total speaking time</span>
                </div>
                <div>
                  <strong>{deck.slides.length}</strong>
                  <span>Slides rehearsed</span>
                </div>
                <div>
                  <strong>
                    {durationLabel(
                      rehearsalReport.totalMs /
                        Math.max(1, rehearsalReport.slideDurations.length),
                    )}
                  </strong>
                  <span>Average per slide</span>
                </div>
              </main>
              <ol>
                {deck.slides.map((slide, index) => {
                  const duration = rehearsalReport.slideDurations[index] ?? 0;
                  const target = (deck.settings?.autoAdvanceSeconds ?? 45) * 1_000;
                  return (
                    <li key={slide.id}>
                      <span>{index + 1}</span>
                      <strong>{slide.title || `Slide ${index + 1}`}</strong>
                      <small data-over={duration > target * 1.25 || undefined}>
                        {durationLabel(duration)}
                      </small>
                    </li>
                  );
                })}
              </ol>
              <footer>
                <p>
                  Timings are private and do not alter the shared presentation.
                  Amber timings exceed the current per-slide target by more than
                  25%.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setRehearsalReport(undefined);
                    startPresenting(true);
                  }}
                >
                  Rehearse again
                </button>
              </footer>
            </div>,
            document.body,
          )
        : null}
      {presentedDeck && typeof document !== "undefined"
        ? createPortal(
            <div
              className="presentation-presenter"
              data-layout={presentLayout}
              data-chrome={presentChrome || undefined}
              data-notes={
                presentLayout === "speaker" && presenterNotesVisible
                  ? true
                  : undefined
              }
              role="dialog"
              aria-modal="true"
              aria-label={
                rehearsalMode ? "Rehearsal mode" : "Presentation mode"
              }
              onMouseMove={revealPresentChrome}
            >
              <header>
                <span>
                  <Clock3 className="h-4 w-4" /> {formatElapsed}
                  <span title="Time on this slide">
                    · slide {durationLabel(slideElapsed)}
                  </span>
                  {rehearsalMode ? " · Rehearsal" : ""}
                </span>
                <strong>{presentedDeck.slides[presentIndex]!.title}</strong>
                <span className="presentation-presenter-actions">
                  <button
                    type="button"
                    aria-pressed={presentLayout === "audience"}
                    onClick={() => setPresentLayout("audience")}
                    title="Audience: the slide fills this screen"
                  >
                    <MonitorPlay className="h-4 w-4" />
                    Audience
                  </button>
                  <button
                    type="button"
                    aria-pressed={presentLayout === "speaker"}
                    onClick={() => {
                      setPresentLayout("speaker");
                      setPresenterNotesVisible(true);
                    }}
                    title="Speaker: this slide, the next slide, and notes"
                  >
                    <Layers3 className="h-4 w-4" />
                    Speaker
                  </button>
                  <button
                    type="button"
                    aria-pressed={presenterNotesVisible}
                    onClick={togglePresenterNotes}
                    title="Show or hide speaker notes. Shortcut: S"
                  >
                    <StickyNote className="h-4 w-4" />
                    Notes
                  </button>
                  <button
                    type="button"
                    onClick={() => setPresentBlackout(true)}
                    title="Black the screen. Shortcut: B"
                  >
                    <MonitorOff className="h-4 w-4" />
                    Black
                  </button>
                  <button type="button" onClick={stopPresenting}>
                    <X className="h-5 w-5" /> Exit
                  </button>
                </span>
              </header>
              {presentBlackout ? (
                <button
                  type="button"
                  className="presentation-presenter-blackout"
                  onClick={() => setPresentBlackout(false)}
                  aria-label="Return to the slide"
                >
                  Press any key to return to the slide
                </button>
              ) : (
                <>
                  <main className="presentation-presenter-current">
                    <SlideCanvas
                      key={presentedDeck.slides[presentIndex]!.id}
                      slide={presentedDeck.slides[presentIndex]!}
                      deck={presentedDeck}
                      assets={assets}
                      artifacts={artifacts}
                      readOnly
                      compact
                      animateObjects
                      showSlideNumber={presentLayout === "audience"}
                      aiChangedPaths={[]}
                      onSelectObject={() => undefined}
                      onPointerDown={() => undefined}
                      onResizePointerDown={() => undefined}
                      onPointerMove={() => undefined}
                      onPointerUp={() => undefined}
                      onTextChange={() => undefined}
                      onTextFocus={() => undefined}
                      onTextBlur={() => undefined}
                    />
                  </main>
                  {presentLayout === "speaker" ? (
                    <>
                      <aside className="presentation-presenter-next">
                        <span>
                          Next
                          {presentIndex < presentedDeck.slides.length - 1
                            ? ` · ${presentIndex + 2}`
                            : " · last slide"}
                        </span>
                        {presentIndex < presentedDeck.slides.length - 1 ? (
                          <SlideCanvas
                            slide={presentedDeck.slides[presentIndex + 1]!}
                            deck={presentedDeck}
                            assets={assets}
                            artifacts={artifacts}
                            readOnly
                            compact
                            aiChangedPaths={[]}
                            onSelectObject={() => undefined}
                            onPointerDown={() => undefined}
                            onResizePointerDown={() => undefined}
                            onPointerMove={() => undefined}
                            onPointerUp={() => undefined}
                            onTextChange={() => undefined}
                            onTextFocus={() => undefined}
                            onTextBlur={() => undefined}
                          />
                        ) : (
                          <p>End of deck</p>
                        )}
                      </aside>
                      {presenterNotesVisible ? (
                        <section className="presentation-presenter-notes">
                          <strong>Notes</strong>
                          <p>
                            {presentedDeck.slides[presentIndex]!.speakerNotes ||
                              "No speaker notes for this slide."}
                          </p>
                        </section>
                      ) : null}
                    </>
                  ) : null}
                </>
              )}
              <footer>
                <button
                  type="button"
                  disabled={presentIndex === 0}
                  onClick={() => movePresentIndex(-1)}
                  aria-label="Previous slide"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <span>
                  {presentIndex + 1} / {presentedDeck.slides.length}
                </span>
                <button
                  type="button"
                  disabled={presentIndex === presentedDeck.slides.length - 1}
                  onClick={() => movePresentIndex(1)}
                  aria-label="Next slide"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </footer>
              <span className="sr-only" role="status" aria-live="polite">
                Slide {presentIndex + 1} of {presentedDeck.slides.length}.{" "}
                {presentedDeck.slides[presentIndex]!.title}
              </span>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
