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
  CheckCircle2,
  Circle,
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
  Loader2,
  Lock,
  MonitorPlay,
  Palette,
  Play,
  Plus,
  Redo2,
  Square,
  Table2,
  Trash2,
  Type,
  Underline,
  Undo2,
  Ungroup,
  Unlock,
  Upload,
  X,
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
  calculateWorkbook,
  coordinateToAddress,
  normalizeSheetsContent,
  parseRange,
} from "../sheets/model";

type PresentationSurface = "slides" | "settings" | "theme" | "preview";
type ResizeHandle = "nw" | "ne" | "sw" | "se";
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
          {(["nw", "ne", "sw", "se"] as const).map((handle) => (
            <button
              key={handle}
              type="button"
              className={`presentation-object-handle is-${handle}`}
              data-spectra-part={`handle:${handle}`}
              aria-label={`Resize from ${handle.toUpperCase()} corner`}
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
      data-transition={
        animateObjects && slide.transition?.kind !== "none"
          ? slide.transition?.kind
          : undefined
      }
      style={
        {
          aspectRatio:
            deck.settings?.aspectRatio === "4:3" ? "4 / 3" : "16 / 9",
          background: slide.background || tokens.background || "#fbfaf5",
          color: tokens.body || "#324b43",
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
      {deck.settings?.showSlideNumbers !== false ? (
        <span className="presentation-slide-number" aria-hidden="true">
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
      <div className="presentation-geometry-grid">
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
        <label>
          Animation
          <select
            value={object.animation?.kind ?? "none"}
            disabled={readOnly}
            onChange={(event) =>
              onUpdate((candidate) => {
                candidate.animation = {
                  kind: event.target.value as
                    "none" | "fade" | "rise" | "scale" | "wipe",
                  durationMs: candidate.animation?.durationMs ?? 450,
                };
              })
            }
          >
            <option value="none">None</option>
            <option value="fade">Fade</option>
            <option value="rise">Rise</option>
            <option value="scale">Scale</option>
            <option value="wipe">Wipe</option>
          </select>
        </label>
      </div>
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
          <label>
            Source artifact
            <select
              value={object.sourceBinding?.artifactId ?? ""}
              disabled={readOnly}
              onChange={(event) =>
                onUpdate((candidate) => {
                  if (!event.target.value) {
                    delete candidate.sourceBinding;
                    return;
                  }
                  candidate.sourceBinding = {
                    artifactId: event.target.value,
                    kind:
                      candidate.type === "chart" ? "sheets_range" : "artifact",
                    ...(candidate.type === "chart"
                      ? { range: candidate.sourceBinding?.range ?? "A1:B8" }
                      : {}),
                    live: true,
                  };
                })
              }
            >
              <option value="">No linked source</option>
              {artifacts
                .filter(
                  (artifact) =>
                    artifact._id !== artifactId &&
                    artifact.status === "active" &&
                    (object.type !== "chart" ||
                      artifact.blueprintKey === "sheets"),
                )
                .map((artifact) => (
                  <option key={artifact._id} value={artifact._id}>
                    {artifact.title} ·{" "}
                    {artifact.blueprintKey.replaceAll("_", " ")}
                  </option>
                ))}
            </select>
          </label>
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
            <label>
              Image fit
              <select
                value={String(styleValue(object, "fit", "contain"))}
                disabled={readOnly}
                onChange={(event) =>
                  onUpdate((candidate) => {
                    candidate.style = {
                      ...candidate.style,
                      fit: event.target.value,
                    };
                  })
                }
              >
                <option value="contain">Fit inside</option>
                <option value="cover">Crop to fill</option>
              </select>
            </label>
            <label>
              Mask
              <select
                value={String(styleValue(object, "mask", "none"))}
                disabled={readOnly}
                onChange={(event) =>
                  onUpdate((candidate) => {
                    candidate.style = {
                      ...candidate.style,
                      mask: event.target.value,
                    };
                  })
                }
              >
                <option value="none">None</option>
                <option value="rounded">Rounded</option>
                <option value="circle">Circle</option>
              </select>
            </label>
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
  readOnly,
  synchronizationReady,
  syncMessage = "Auto-saved",
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
  const studioRef = useRef<HTMLElement>(null);
  const [surface, setSurface] = useState<PresentationSurface>("slides");
  const [slideRailPreference, setSlideRailPreference] = useState<
    "auto" | "open" | "closed"
  >("auto");
  const [wideEnoughForSlideRail, setWideEnoughForSlideRail] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [activeSlideId, setActiveSlideId] = useState(deck.slides[0]!.id);
  const [selectedObjectId, setSelectedObjectId] = useState<string>();
  const [layerSelection, setLayerSelection] = useState<string[]>([]);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [draggingSlideId, setDraggingSlideId] = useState<string>();
  const [undoStack, setUndoStack] = useState<PresentationContent[]>([]);
  const [redoStack, setRedoStack] = useState<PresentationContent[]>([]);
  const [presentedDeck, setPresentedDeck] = useState<PresentationContent>();
  const [presentIndex, setPresentIndex] = useState(0);
  const [presentStartedAt, setPresentStartedAt] = useState(0);
  const [presentElapsed, setPresentElapsed] = useState(0);
  const [rehearsalMode, setRehearsalMode] = useState(false);
  const [rehearsalReport, setRehearsalReport] = useState<{
    slideDurations: number[];
    totalMs: number;
  }>();
  const slideRailOpen =
    slideRailPreference === "auto"
      ? wideEnoughForSlideRail
      : slideRailPreference === "open";

  useEffect(() => {
    const studio = studioRef.current;
    if (!studio) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWideEnoughForSlideRail(entry.contentRect.width >= 880);
    });
    observer.observe(studio);
    return () => observer.disconnect();
  }, []);
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
    if (!presentedDeck) return;
    const update = () => setPresentElapsed(Date.now() - presentStartedAt);
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [presentStartedAt, presentedDeck]);
  useEffect(() => {
    if (!presentedDeck) return;
    const keydown = (event: KeyboardEvent) => {
      if (["ArrowRight", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        movePresentIndex(1);
      } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        movePresentIndex(-1);
      } else if (event.key === "Escape") stopPresenting();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- present handlers declared below
  }, [presentedDeck]);
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
    copy.id = `slide-${Date.now().toString(36)}-copy`;
    copy.title = `${copy.title} copy`;
    copy.objects = copy.objects.map((object, index) => ({
      ...object,
      id: `object-${Date.now().toString(36)}-${index + 1}`,
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
  function moveSlide(direction: -1 | 1) {
    const destination = activeSlideIndex + direction;
    if (destination < 0 || destination >= deck.slides.length) return;
    mutate((draft) => {
      const [slide] = draft.slides.splice(activeSlideIndex, 1);
      if (slide) draft.slides.splice(destination, 0, slide);
    });
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
    setSurface("slides");
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
      if (drag.handle?.includes("w")) {
        x = Math.max(
          0,
          Math.min(
            drag.startX + drag.startWidth - minimumWidth,
            drag.startX + deltaX,
          ),
        );
        width = drag.startWidth + (drag.startX - x);
      } else {
        width = Math.max(
          minimumWidth,
          Math.min(1_000 - drag.startX, drag.startWidth + deltaX),
        );
      }
      if (drag.handle?.includes("n")) {
        y = Math.max(
          0,
          Math.min(
            drag.startY + drag.startHeight - minimumHeight,
            drag.startY + deltaY,
          ),
        );
        height = drag.startHeight + (drag.startY - y);
      } else {
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
        `Imported ${next.slides.length} slides. Review the fidelity record in Settings; the original remains recoverable.`,
      );
      setSurface("slides");
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

  function movePresentIndex(delta: -1 | 1) {
    if (!presentedDeck) return;
    const next = Math.max(
      0,
      Math.min(
        presentedDeck.slides.length - 1,
        presentIndexRef.current + delta,
      ),
    );
    if (next === presentIndexRef.current) return;
    const now = Date.now();
    recordPresentedSlide(now);
    presentIndexRef.current = next;
    presentSlideStartedAtRef.current = now;
    setPresentIndex(next);
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
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
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

  return (
    <section ref={studioRef} className="presentation-studio">
      <div className="spectra-editor-workbar presentation-primary-bar">
        <div role="tablist" aria-label="Presentation views">
          {(
            [
              ["slides", "Slides"],
              ["settings", "Settings"],
              ["theme", "Theme"],
              ["preview", "Preview"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={surface === id}
              data-active={surface === id || undefined}
              onClick={() => setSurface(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span
            className="hidden items-center gap-1.5 text-micro text-[var(--text-secondary)] md:inline-flex"
            role="status"
            aria-live="polite"
          >
            {syncMessage === "Auto-saved" ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />
            ) : syncMessage === "Synchronizing" ||
              syncMessage === "Reconnecting" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)]" />
            ) : (
              <Circle className="h-3 w-3 fill-[#d88922] text-[#d88922]" />
            )}
            {syncMessage}
          </span>
          <button
            type="button"
            className="presentation-secondary-action"
            onClick={() => setSurface("preview")}
          >
            <MonitorPlay className="h-3.5 w-3.5" /> Preview
          </button>
          <button
            type="button"
            className="presentation-present-action"
            onClick={() => startPresenting(false)}
          >
            <Play className="h-3.5 w-3.5 fill-current" /> Present (
            {deck.slides.length})
          </button>
          <button
            type="button"
            className="presentation-secondary-action"
            onClick={() => startPresenting(true)}
          >
            <Clock3 className="h-3.5 w-3.5" /> Rehearse
          </button>
        </div>
      </div>
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
          <div className="presentation-toolbar" aria-label="Slide toolbar">
            <button type="button" onClick={addSlide} disabled={readOnly}>
              <Plus className="h-3.5 w-3.5" /> Slide
            </button>
            <button
              type="button"
              onClick={() =>
                setSlideRailPreference(slideRailOpen ? "closed" : "open")
              }
              aria-pressed={slideRailOpen}
              title={
                slideRailOpen
                  ? "Collapse slide previews"
                  : "Show slide previews"
              }
              aria-label={
                slideRailOpen
                  ? "Collapse slide previews"
                  : "Show slide previews"
              }
            >
              <LayoutTemplate className="h-3.5 w-3.5" />
            </button>
            <span className="presentation-toolbar-rule" />
            <button
              type="button"
              onClick={undo}
              disabled={!undoStack.length}
              aria-label="Undo"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!redoStack.length}
              aria-label="Redo"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
            <select
              value={
                selectedTextPreset ?? activeSlide.layoutId ?? "title-content"
              }
              disabled={readOnly}
              aria-label={selectedTextPreset ? "Text style" : "Slide layout"}
              onChange={(event) => {
                if (selectedTextPreset)
                  applyTextPreset(
                    event.target.value as
                      "title" | "subtitle" | "body" | "caption",
                  );
                else applySlideLayout(event.target.value);
              }}
            >
              {selectedTextPreset ? (
                <>
                  <option value="title">Title</option>
                  <option value="subtitle">Subtitle</option>
                  <option value="body">Body</option>
                  <option value="caption">Caption</option>
                </>
              ) : (
                <>
                  <option value="title-content">Title & content</option>
                  <option value="title-only">Title only</option>
                  <option value="two-column">Two columns</option>
                  <option value="title-visual-text">
                    Title, visual & text
                  </option>
                  <option value="visual-story">Visual story</option>
                  <option value="three-ideas">Three ideas</option>
                  <option value="statement">Statement</option>
                  <option value="full-bleed">Full bleed</option>
                  <option value="blank">Blank</option>
                </>
              )}
            </select>
            <span className="presentation-toolbar-rule" />
            <button
              type="button"
              onClick={() => addObject("text")}
              disabled={readOnly}
              title="Add text"
            >
              <Type className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => addObject("shape")}
              disabled={readOnly}
              title="Add shape"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={readOnly || assetBusy}
              title="Add media"
            >
              <ImagePlus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => addObject("chart")}
              disabled={readOnly}
              title="Add chart"
            >
              <BarChart3 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => addObject("table")}
              disabled={readOnly}
              title="Add table"
            >
              <Table2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                addObject("embed");
                setSurface("settings");
              }}
              disabled={readOnly}
              title="Link an artifact"
            >
              <Link2 className="h-3.5 w-3.5" />
            </button>
            <span className="presentation-toolbar-rule" />
            <button
              type="button"
              disabled={layerSelection.length < 2 || readOnly}
              onClick={groupSelectedObjects}
              title="Group selected layers (Shift-click in Layers to select several)"
            >
              <GroupIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={selectedObject?.type !== "group" || readOnly}
              onClick={ungroupSelectedObject}
              title="Ungroup selected group"
            >
              <Ungroup className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={!selectedObject || readOnly}
              onClick={() =>
                updateSelected((object) => {
                  object.style = {
                    ...object.style,
                    fontWeight:
                      Number(styleValue(object, "fontWeight", 400)) >= 600
                        ? 400
                        : 700,
                  };
                })
              }
              title="Bold"
            >
              <Bold className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={!selectedObject || readOnly}
              onClick={() =>
                updateSelected((object) => {
                  object.style = {
                    ...object.style,
                    italic: !styleValue(object, "italic", false),
                  };
                })
              }
              title="Italic"
            >
              <Italic className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={!selectedObject || readOnly}
              onClick={() =>
                updateSelected((object) => {
                  object.style = {
                    ...object.style,
                    underline: !styleValue(object, "underline", false),
                  };
                })
              }
              title="Underline"
            >
              <Underline className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={!selectedObject || readOnly}
              onClick={() =>
                updateSelected((object) => {
                  object.style = { ...object.style, align: "left" };
                })
              }
              title="Align left"
            >
              <AlignLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={!selectedObject || readOnly}
              onClick={() =>
                updateSelected((object) => {
                  object.style = { ...object.style, align: "center" };
                })
              }
              title="Align center"
            >
              <AlignCenter className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={!selectedObject || readOnly}
              onClick={() =>
                updateSelected((object) => {
                  object.style = { ...object.style, align: "right" };
                })
              }
              title="Align right"
            >
              <AlignRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={!selectedObject || readOnly}
              onClick={() =>
                updateSelected((object) => {
                  const current = presentationObjectText(object);
                  Object.assign(
                    object,
                    withPresentationObjectText(
                      object,
                      current.startsWith("• ")
                        ? current.replace(/^• /gm, "")
                        : current
                            .split("\n")
                            .map((line) => `• ${line}`)
                            .join("\n"),
                    ),
                  );
                })
              }
              title="Bulleted list"
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={!selectedObject || readOnly}
              onClick={() =>
                updateSelected((object) => {
                  object.locked = !object.locked;
                })
              }
              title={selectedObject?.locked ? "Unlock object" : "Lock object"}
            >
              {selectedObject?.locked ? (
                <Unlock className="h-3.5 w-3.5" />
              ) : (
                <Lock className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              disabled={!selectedObject || readOnly}
              onClick={deleteSelectedObject}
              title="Delete object"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
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
          </div>
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
          >
            {slideRailOpen ? (
              <aside className="presentation-slide-rail" aria-label="Slides">
                {deck.slides.map((slide, index) => (
                  <button
                    type="button"
                    key={slide.id}
                    data-active={slide.id === activeSlide.id || undefined}
                    data-dragging={draggingSlideId === slide.id || undefined}
                    data-ai-region={aiRegionAttr(
                      pathTouches(aiChangedPaths, `/slides/${index}`),
                    )}
                    {...targetAttrs(`/slides/${index}`)}
                    draggable={!readOnly}
                    onDragStart={(event) => {
                      setDraggingSlideId(slide.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(
                        "application/x-spectra-slide",
                        slide.id,
                      );
                    }}
                    onDragEnd={() => setDraggingSlideId(undefined)}
                    onDragOver={(event) => {
                      if (!readOnly) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      moveSlideBefore(slide.id);
                    }}
                    onClick={() => {
                      setActiveSlideId(slide.id);
                      setSelectedObjectId(undefined);
                      setLayerSelection([]);
                      onActiveRegionChange?.(slide.id);
                    }}
                  >
                    <span>{index + 1}</span>
                    <div
                      // The rail is a visual preview, not a second editable
                      // presentation surface. Its canvas deliberately reuses the
                      // same semantic paths as the real slide, so exclude it from
                      // presence geometry: otherwise an AI or collaborator cursor
                      // lands in the thumbnail while the operation trace animates
                      // on the native canvas.
                      data-spectra-hidden-target="true"
                    >
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
                    <strong>{slide.title}</strong>
                  </button>
                ))}
                <button
                  type="button"
                  className="presentation-add-slide"
                  onClick={addSlide}
                  disabled={readOnly}
                >
                  <Plus className="h-3.5 w-3.5" /> Add slide
                </button>
              </aside>
            ) : null}
            <div className="presentation-stage">
              {!slideRailOpen ? (
                <div className="presentation-slide-switcher">
                  <button
                    type="button"
                    aria-label="Previous slide"
                    disabled={activeSlideIndex <= 0}
                    onClick={() => {
                      const slide = deck.slides[activeSlideIndex - 1];
                      if (!slide) return;
                      setActiveSlideId(slide.id);
                      setSelectedObjectId(undefined);
                      setLayerSelection([]);
                      onActiveRegionChange?.(slide.id);
                    }}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <select
                    aria-label="Current slide"
                    value={activeSlide.id}
                    onChange={(event) => {
                      setActiveSlideId(event.target.value);
                      setSelectedObjectId(undefined);
                      setLayerSelection([]);
                      onActiveRegionChange?.(event.target.value);
                    }}
                  >
                    {deck.slides.map((slide, index) => (
                      <option key={slide.id} value={slide.id}>
                        {index + 1} · {slide.title || `Slide ${index + 1}`}
                      </option>
                    ))}
                  </select>
                  <span>
                    {activeSlideIndex + 1} of {deck.slides.length}
                  </span>
                  <button
                    type="button"
                    aria-label="Next slide"
                    disabled={activeSlideIndex >= deck.slides.length - 1}
                    onClick={() => {
                      const slide = deck.slides[activeSlideIndex + 1];
                      if (!slide) return;
                      setActiveSlideId(slide.id);
                      setSelectedObjectId(undefined);
                      setLayerSelection([]);
                      onActiveRegionChange?.(slide.id);
                    }}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSlideRailPreference("open")}
                  >
                    Show previews
                  </button>
                </div>
              ) : null}
              <SlideCanvas
                slide={activeSlide}
                deck={deck}
                assets={assets}
                artifacts={artifacts}
                selectedObjectId={selectedObjectId}
                selectedObjectIds={layerSelection}
                guides={guides}
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
              <section className="presentation-notes">
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
                      placeholder="Add private speaking prompts, source reminders, or rehearsal cues."
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
                    <span>
                      {(activeSlide.speakerNotes ?? "").length} characters
                    </span>
                  </>
                ) : null}
              </section>
            </div>
          </div>
        </>
      ) : null}

      {surface === "theme" ? (
        <div className="presentation-settings-view">
          <header>
            <Palette className="h-5 w-5" />
            <div>
              <h3>Presentation theme</h3>
              <p>
                Apply a coherent native Spectra palette without flattening slide
                objects.
              </p>
            </div>
          </header>
          <div className="presentation-theme-grid">
            {THEMES.map((theme) => (
              <button
                type="button"
                key={theme.id}
                data-active={deck.theme.id === theme.id || undefined}
                disabled={readOnly}
                onClick={() => applyTheme(theme)}
              >
                <span style={{ background: theme.tokens.background }}>
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
          <section className="presentation-component-library">
            <div>
              <div>
                <h4>Reusable components</h4>
                <p>
                  Saved objects retain their style and behavior while each
                  inserted instance receives a stable scene identity.
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
                Select an object in Settings and save it here for reuse.
              </p>
            )}
          </section>
        </div>
      ) : null}

      {surface === "settings" ? (
        <div className="presentation-settings-view">
          <header>
            <LayoutTemplate className="h-5 w-5" />
            <div>
              <h3>Deck and slide settings</h3>
              <p>
                Common controls stay visible; timing, layers, reading order, and
                accessibility remain inspectable here.
              </p>
            </div>
          </header>
          <div className="presentation-settings-grid">
            <section>
              <h4>Deck format</h4>
              <label>
                Aspect ratio
                <select
                  value={deck.settings?.aspectRatio ?? "16:9"}
                  disabled={readOnly}
                  onChange={(event) =>
                    mutate((draft) => {
                      draft.settings = {
                        ...draft.settings,
                        aspectRatio: event.target.value as "16:9" | "4:3",
                      };
                    })
                  }
                >
                  <option value="16:9">16:9 widescreen</option>
                  <option value="4:3">4:3 standard</option>
                </select>
              </label>
              <label>
                Default transition
                <select
                  value={deck.settings?.defaultTransition ?? "none"}
                  disabled={readOnly}
                  onChange={(event) =>
                    mutate((draft) => {
                      draft.settings = {
                        ...draft.settings,
                        defaultTransition: event.target.value as
                          "none" | "fade" | "push" | "dissolve",
                      };
                    })
                  }
                >
                  <option value="none">None</option>
                  <option value="fade">Fade</option>
                  <option value="push">Push</option>
                  <option value="dissolve">Dissolve</option>
                </select>
              </label>
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
              <label className="presentation-check">
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
            <section>
              <div className="flex items-center justify-between">
                <h4>Current slide</h4>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => moveSlide(-1)}
                    disabled={readOnly || activeSlideIndex === 0}
                    title="Move slide earlier"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSlide(1)}
                    disabled={
                      readOnly || activeSlideIndex === deck.slides.length - 1
                    }
                    title="Move slide later"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={duplicateSlide}
                    disabled={readOnly}
                    title="Duplicate slide"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={deleteSlide}
                    disabled={readOnly || deck.slides.length === 1}
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
                  onChange={(event) =>
                    mutate((draft) => {
                      draft.slides[activeSlideIndex]!.title =
                        event.target.value;
                    })
                  }
                />
              </label>
              <label>
                Transition
                <select
                  value={activeSlide.transition?.kind ?? "none"}
                  disabled={readOnly}
                  onChange={(event) =>
                    mutate((draft) => {
                      draft.slides[activeSlideIndex]!.transition = {
                        kind: event.target.value as
                          "none" | "fade" | "push" | "dissolve",
                        durationMs: activeSlide.transition?.durationMs ?? 350,
                      };
                    })
                  }
                >
                  <option value="none">None</option>
                  <option value="fade">Fade</option>
                  <option value="push">Push</option>
                  <option value="dissolve">Dissolve</option>
                </select>
              </label>
              <label>
                Accessible slide label
                <input
                  value={activeSlide.accessibility?.label ?? ""}
                  disabled={readOnly}
                  onChange={(event) =>
                    mutate((draft) => {
                      draft.slides[activeSlideIndex]!.accessibility = {
                        ...draft.slides[activeSlideIndex]!.accessibility,
                        label: event.target.value,
                      };
                    })
                  }
                  placeholder="Describe this slide for navigation"
                />
              </label>
              <label>
                Section
                <select
                  value={activeSlide.sectionId ?? ""}
                  disabled={readOnly}
                  onChange={(event) =>
                    mutate((draft) => {
                      const slide = draft.slides[activeSlideIndex]!;
                      if (event.target.value)
                        slide.sectionId = event.target.value;
                      else delete slide.sectionId;
                    })
                  }
                >
                  <option value="">No section</option>
                  {(deck.sections ?? []).map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="presentation-add-section">
                <input
                  value={sectionDraft}
                  disabled={readOnly}
                  placeholder="New section name"
                  onChange={(event) => setSectionDraft(event.target.value)}
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
            <section className="lg:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Layers3 className="h-4 w-4" />
                  <h4>Layers and reading order</h4>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={!selectedObject || readOnly}
                    onClick={() => moveSelectedLayer(-1)}
                    title="Move earlier in reading order"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={!selectedObject || readOnly}
                    onClick={() => moveSelectedLayer(1)}
                    title="Move later in reading order"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div
                className="presentation-arrange-controls"
                aria-label="Arrange selected objects"
              >
                <span>
                  {layerSelection.length > 1
                    ? `${layerSelection.length} objects selected`
                    : "Shift-click layers or objects to select several"}
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
              <div className="presentation-layer-list">
                {[...activeSlide.objects]
                  .sort(
                    (left, right) =>
                      (left.readingOrder ?? 0) - (right.readingOrder ?? 0),
                  )
                  .map((object, index) => (
                    <button
                      type="button"
                      key={object.id}
                      data-active={
                        layerSelection.includes(object.id) || undefined
                      }
                      onClick={(event) =>
                        selectObject(object.id, event.shiftKey)
                      }
                    >
                      <span>{index + 1}</span>
                      <strong>
                        {presentationObjectText(object) || object.type}
                      </strong>
                      <small>
                        {object.type}
                        {object.altText
                          ? " · alt text"
                          : ["image", "chart", "video"].includes(object.type)
                            ? " · needs alt text"
                            : ""}
                      </small>
                      {object.locked ? <Lock className="h-3 w-3" /> : null}
                    </button>
                  ))}
              </div>
              {selectedObject ? (
                <>
                  <PresentationObjectInspector
                    object={selectedObject}
                    readOnly={readOnly}
                    canvasHeight={
                      deck.settings?.aspectRatio === "4:3" ? 750 : 562.5
                    }
                    artifacts={artifacts}
                    artifactId={artifactId}
                    onUpdate={updateSelected}
                  />
                  <button
                    type="button"
                    className="presentation-save-component"
                    disabled={readOnly}
                    onClick={saveSelectedAsComponent}
                  >
                    <Copy className="h-3.5 w-3.5" /> Save as reusable component
                  </button>
                </>
              ) : null}
            </section>
            <section className="lg:col-span-2 presentation-citations-section">
              <div>
                <div>
                  <h4>Sources and citations</h4>
                  <p>
                    Citations stay attached to this slide and remain visible to
                    AI checks, history, and export.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() =>
                      mutate((draft) => {
                        const slide = draft.slides[activeSlideIndex]!;
                        slide.citations = [
                          ...(slide.citations ?? []),
                          {
                            id: `citation-${Date.now().toString(36)}`,
                            label: "New source",
                          },
                        ];
                      })
                    }
                  >
                    <Plus className="h-3.5 w-3.5" /> Add citation
                  </button>
                  <button
                    type="button"
                    disabled={readOnly}
                    title="Collect every slide citation onto a References slide"
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
                </div>
              </div>
              {deckCitationCount > 0 && !deckHasBibliography ? (
                <p className="presentation-empty-copy">
                  {deckCitationCount}{" "}
                  {deckCitationCount === 1 ? "citation" : "citations"} across
                  the deck — build a references slide to close it.
                </p>
              ) : null}
              {activeSlide.citations?.length ? (
                <div className="presentation-citation-list">
                  {activeSlide.citations.map((citation, citationIndex) => (
                    <div key={citation.id}>
                      <input
                        aria-label="Citation label"
                        value={citation.label}
                        disabled={readOnly}
                        onChange={(event) =>
                          mutate((draft) => {
                            draft.slides[activeSlideIndex]!.citations![
                              citationIndex
                            ]!.label = event.target.value;
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
                            draft.slides[activeSlideIndex]!.citations![
                              citationIndex
                            ]!.url = event.target.value;
                          })
                        }
                      />
                      <button
                        type="button"
                        aria-label="Remove citation"
                        disabled={readOnly}
                        onClick={() =>
                          mutate((draft) => {
                            draft.slides[activeSlideIndex]!.citations?.splice(
                              citationIndex,
                              1,
                            );
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="presentation-empty-copy">
                  No citations are attached to this slide.
                </p>
              )}
            </section>
            <section className="lg:col-span-2 presentation-file-section">
              <div>
                <div>
                  <FileArchive className="h-4 w-4" />
                  <div>
                    <h4>Import and export</h4>
                    <p>
                      Originals stay private and recoverable. Native conversion
                      reports substitutions before imported work enters history.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={readOnly || Boolean(ioBusy)}
                  onClick={() => importInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" /> Import PPTX or ODP
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
              ) : null}
            </section>
          </div>
        </div>
      ) : null}

      {surface === "preview" ? (
        <div className="presentation-preview-view">
          <SlideCanvas
            slide={activeSlide}
            deck={deck}
            assets={assets}
            artifacts={artifacts}
            readOnly
            compact
            animateObjects
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
          <div>
            <button
              type="button"
              disabled={activeSlideIndex === 0}
              onClick={() =>
                setActiveSlideId(
                  deck.slides[Math.max(0, activeSlideIndex - 1)]!.id,
                )
              }
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <span>
              Slide {activeSlideIndex + 1} of {deck.slides.length}
            </span>
            <button
              type="button"
              disabled={activeSlideIndex === deck.slides.length - 1}
              onClick={() =>
                setActiveSlideId(
                  deck.slides[
                    Math.min(deck.slides.length - 1, activeSlideIndex + 1)
                  ]!.id,
                )
              }
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {rehearsalReport && !presentedDeck ? (
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
        </div>
      ) : null}

      {presentedDeck && typeof document !== "undefined"
        ? createPortal(
            <div
              className="presentation-presenter"
              role="dialog"
              aria-modal="true"
              aria-label="Presentation mode"
            >
              <header>
                <span>
                  <Clock3 className="h-4 w-4" /> {formatElapsed}
                  {rehearsalMode ? " · Rehearsal" : ""}
                </span>
                <strong>{presentedDeck.slides[presentIndex]!.title}</strong>
                <button type="button" onClick={stopPresenting}>
                  <X className="h-5 w-5" /> Exit
                </button>
              </header>
              <main>
                <SlideCanvas
                  key={presentedDeck.slides[presentIndex]!.id}
                  slide={presentedDeck.slides[presentIndex]!}
                  deck={presentedDeck}
                  assets={assets}
                  artifacts={artifacts}
                  readOnly
                  compact
                  animateObjects
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
              <footer>
                <button
                  type="button"
                  disabled={presentIndex === 0}
                  onClick={() => movePresentIndex(-1)}
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div>
                  <span>
                    {presentIndex + 1} / {presentedDeck.slides.length}
                  </span>
                  <p>
                    {presentedDeck.slides[presentIndex]!.speakerNotes ||
                      "No speaker notes for this slide."}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={presentIndex === presentedDeck.slides.length - 1}
                  onClick={() => movePresentIndex(1)}
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </footer>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
