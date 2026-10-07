"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ImageIcon, Play } from "@/components/icons/glyph-icons";
import {
  presentationObjectParagraphs,
  presentationObjectText,
  type PresentationContent,
  type PresentationObject,
  type PresentationParagraph,
  type PresentationSlide,
  type PresentationTableCell,
} from "../presentation/model";
import { presentationFontFamily } from "../presentation/io";
import { linkedChartValues } from "../presentation/linked-chart";
import { pptxNativeMediaUrl } from "../lenses/office-content";
import { richContentFromSlideParagraphs } from "../rich-content";
import { spectraBus } from "../events";
import { targetAttrs } from "../collaboration/target-attributes";
import type { SpectraArtifact, SpectraArtifactAsset } from "../data/api";
import { aiRegionAttr, pathTouches } from "./ai-region-path";
import { SpectraRichContent } from "./spectra-rich-content";
import { SlideTextField } from "./slide-text-field";

/**
 * One slide drawn at the deck's own scale. The studio writes on it; the rail,
 * the presenter and the file viewer only show it, so every handler is
 * optional and a slide with none is a picture of itself.
 */

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

function nativePptxImageAsset(
  source: Record<string, unknown>,
  binding: PresentationContent["nativeBinding"],
): SpectraArtifactAsset | undefined {
  // A pending replacement should preview its new durable bytes. After native
  // readback, matching hashes make the embedded image authoritative again.
  if (typeof source.assetId === "string" && source.sha256 !== source.nativeMediaSha256) return undefined;
  const partName =
    typeof source.nativeMediaPart === "string" ? source.nativeMediaPart : "";
  const downloadUrl = pptxNativeMediaUrl(binding, partName);
  if (!downloadUrl) return undefined;
  return {
    assetId: partName,
    status: "active",
    downloadUrl,
    mediaType:
      typeof source.nativeMediaType === "string"
        ? source.nativeMediaType
        : undefined,
  };
}

function objectStyle(
  object: PresentationObject,
  canvasHeight: number,
): CSSProperties {
  // Opacity and shadow are object-level, not shape-level: a person who fades a
  // picture and a person who fades a rectangle used the same control, so the
  // frame carries both rather than each renderer repeating them.
  const opacity = Number(object.style?.opacity ?? 1);
  const shadow = object.style?.shadow === true;
  return {
    left: `${(object.x / 1_000) * 100}%`,
    top: `${(object.y / canvasHeight) * 100}%`,
    width: `${(object.width / 1_000) * 100}%`,
    height: `${(object.height / canvasHeight) * 100}%`,
    transform: `rotate(${object.rotation}deg)`,
    zIndex: Math.max(1, (object.readingOrder ?? 0) + 1),
    ...(Number.isFinite(opacity) && opacity < 1 ? { opacity } : {}),
    ...(shadow
      ? { filter: "drop-shadow(0 1.2cqw 2cqw rgb(23 34 30 / 26%))" }
      : {}),
  };
}

export function styleValue(
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

function tableCell(value: unknown): PresentationTableCell {
  if (typeof value === "string" || typeof value === "number") {
    return { text: String(value) };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    return {
      text: typeof candidate.text === "string" ? candidate.text : "",
      ...(candidate.paragraphs && Array.isArray(candidate.paragraphs)
        ? { paragraphs: candidate.paragraphs as PresentationTableCell["paragraphs"] }
        : {}),
      ...(candidate.style && typeof candidate.style === "object"
        ? { style: candidate.style as Record<string, unknown> }
        : {}),
      ...(typeof candidate.rowSpan === "number"
        ? { rowSpan: candidate.rowSpan }
        : {}),
      ...(typeof candidate.colSpan === "number"
        ? { colSpan: candidate.colSpan }
        : {}),
    };
  }
  return { text: "" };
}

export function tableRows(object: PresentationObject): PresentationTableCell[][] {
  const content =
    object.content &&
    typeof object.content === "object" &&
    !Array.isArray(object.content)
      ? (object.content as Record<string, unknown>)
      : {};
  return Array.isArray(content.rows)
    ? content.rows.map((row) =>
        Array.isArray(row) ? row.map((cell) => tableCell(cell)) : [],
      )
    : [];
}

function savedChartValues(object: PresentationObject) {
  const content = object.content && typeof object.content === "object" && !Array.isArray(object.content)
    ? object.content as Record<string, unknown>
    : {};
  const series = Array.isArray(content.series)
    ? content.series.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const values = (candidate as Record<string, unknown>).values;
        return Array.isArray(values)
          ? values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
          : [];
      })
    : [];
  if (series.length) return series;
  return Array.isArray(content.values)
    ? content.values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    : [];
}

function PresentationObjectView({
  object,
  themeFonts,
  asset,
  linkedValues,
  linkedArtifact,
  animate,
  selected,
  readOnly,
  compact,
  aiActive = false,
  nativeText = false,
  onSelect,
  onPointerDown,
  onResizePointerDown,
  onTextChange,
  onTextFocus,
  onTextBlur,
  path,
}: {
  object: PresentationObject;
  themeFonts?: PresentationContent["theme"]["fonts"];
  asset?: SpectraArtifactAsset;
  linkedValues?: number[] | null;
  linkedArtifact?: SpectraArtifact;
  animate: boolean;
  selected: boolean;
  readOnly: boolean;
  compact: boolean;
  aiActive?: boolean;
  /** Its deck is linked to a PowerPoint file: its text holds only what DrawingML can. */
  nativeText?: boolean;
  onSelect: (additive: boolean) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (
    handle: ResizeHandle,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onTextChange: (paragraphs: PresentationParagraph[]) => void;
  onTextFocus: () => void;
  onTextBlur: () => void;
  /** Canonical pointer for this object, e.g. `/slides/2/objects/1`. */
  path?: string;
}) {
  const textRef = useRef<HTMLDivElement>(null);
  const [textOverflow, setTextOverflow] = useState(false);
  const paragraphs = useMemo(
    () => (object.type === "text" ? presentationObjectParagraphs(object) : []),
    // The paragraphs are the object's content; nothing else shapes them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [object.content, object.type],
  );
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
      const element = textRef.current;
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
    paragraphs,
  ]);
  const textStyle: CSSProperties = {
    color: String(styleValue(object, "color", "#173f35")),
    fontFamily: presentationFontFamily(
      object.style?.fontFamily,
      themeFonts,
      textFontSize,
    ),
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
    // One of the deck's points on this canvas, for runs with their own size:
    // the same scale as the object's size above.
    "--rich-pt": compact ? "0.1cqw" : "min(0.1cqw, 1px)",
  } as CSSProperties;
  if (object.hidden) return null;
  if (object.type === "group" && compact) return null;
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
      {object.type === "text" && (compact || readOnly) ? (
        // A slide that is shown, not written (a thumbnail, presenting, a
        // reader without edit rights) draws its runs: bold, colour, links,
        // bullets and levels from the deck, through the shared renderer.
        <div
          className="presentation-object-text"
          data-text-preset={textPreset}
          data-ai-region={aiRegionAttr(aiActive)}
          {...(path ? targetAttrs(`${path}/text`) : {})}
          style={textStyle}
        >
          <SpectraRichContent
            ast={richContentFromSlideParagraphs(paragraphs)}
            className="spectra-prose-inherit presentation-object-copy"
          />
        </div>
      ) : object.type === "text" ? (
        // Written in place with the field every editor shares (EDITORS.md,
        // Shared rich content), storing the deck's own paragraphs and runs.
        <SlideTextField
          hostRef={textRef}
          className="presentation-object-text"
          data-text-preset={textPreset}
          data-ai-region={aiRegionAttr(aiActive)}
          {...(path ? targetAttrs(`${path}/text`) : {})}
          paragraphs={paragraphs}
          editable={!object.locked}
          native={nativeText}
          style={textStyle}
          onFocus={onTextFocus}
          onBlur={onTextBlur}
          onChange={onTextChange}
        />
      ) : object.type === "shape" ? (
        <div
          className="presentation-shape"
          // The shape library is real geometry, not ten names for a rectangle:
          // the clip path lives in CSS so a triangle stays a triangle at every
          // size and in the thumbnail rail.
          data-shape={String(
            styleValue(object, "shape", "rounded-rectangle"),
          )}
          style={{
            background: String(styleValue(object, "fill", "#dfeee4")),
            borderColor: String(styleValue(object, "stroke", "#82b79b")),
            borderWidth: `${Number(styleValue(object, "strokeWidth", 1))}px`,
            // Only the rounded rectangle takes a radius from the inspector; the
            // other nine get their corners from their own geometry, so the
            // stylesheet is not fighting an inline value it cannot see.
            ...(String(styleValue(object, "shape", "rounded-rectangle")) ===
            "rounded-rectangle"
              ? {
                  borderRadius: Number(
                    styleValue(
                      object,
                      "cornerRadius",
                      Number(styleValue(object, "radius", 24)),
                    ),
                  ),
                }
              : {}),
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
            <ImageIcon className="h-5 w-5" />
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
            <Play className="h-5 w-5" />
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
          {(linkedValues === null ? savedChartValues(object) : linkedValues ?? savedChartValues(object)).map((value, index) => (
            <span
              key={index}
              style={{
                height: `${Math.max(6, Math.min(100, Number(value) || 0))}%`,
              }}
            />
          ))}
          {linkedValues === null ? (
            <em>Linked Sheets range is unavailable; showing last saved values.</em>
          ) : null}
        </div>
      ) : object.type === "table" ? (
        <table className="presentation-table">
          <tbody>
            {tableRows(object).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    style={{
                      backgroundColor:
                        typeof cell.style?.fill === "string"
                          ? cell.style.fill
                          : undefined,
                      color:
                        typeof cell.style?.color === "string"
                          ? cell.style.color
                          : undefined,
                    }}
                  >
                    {cell.text}
                  </td>
                ))}
              </tr>
            ))}
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
          {linkedArtifact ? (
            <button
              type="button"
              className="presentation-linked-open"
              aria-label={`Open ${linkedArtifact.title}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void spectraBus.command("work.open", {
                  workId: linkedArtifact._id,
                  surface: "panel",
                });
              }}
            >
              Open linked work
            </button>
          ) : null}
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

export function SlideCanvas({
  slide,
  deck,
  assets,
  artifacts = [],
  selectedObjectId,
  selectedObjectIds = [],
  guides,
  aiChangedPaths = [],
  readOnly,
  compact = false,
  animateObjects = false,
  showSlideNumber = false,
  showGrid = false,
  showGuides = false,
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
  artifacts?: SpectraArtifact[];
  selectedObjectId?: string;
  aiChangedPaths?: string[];
  readOnly: boolean;
  compact?: boolean;
  animateObjects?: boolean;
  showSlideNumber?: boolean;
  /** Authoring aids. They are drawn over the slide and never saved into it. */
  showGrid?: boolean;
  showGuides?: boolean;
  selectedObjectIds?: string[];
  guides?: { x?: number; y?: number };
  onSelectObject?: (id?: string, additive?: boolean) => void;
  onPointerDown?: (
    object: PresentationObject,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  onResizePointerDown?: (
    object: PresentationObject,
    handle: ResizeHandle,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onTextChange?: (objectId: string, paragraphs: PresentationParagraph[]) => void;
  onTextFocus?: (objectId: string) => void;
  onTextBlur?: () => void;
}) {
  const canvasHeight = deck.settings?.aspectRatio === "4:3" ? 750 : 562.5;
  const tokens = deck.theme.tokens ?? {};
  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.assetId, asset])),
    [assets],
  );
  const slideIndex = deck.slides.indexOf(slide);
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
            ? slide.background || tokens.background || "var(--bg-primary)"
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
      onClick={() => onSelectObject?.(undefined)}
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
          className="pointer-events-none z-chrome"
          style={{
            position: "absolute",
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
      {/* Grid and centre guides are authoring aids: they live over the slide,
          never in it, so nothing here reaches the saved file or a projector. */}
      {showGrid && !compact ? (
        <span className="presentation-grid-overlay" aria-hidden="true" />
      ) : null}
      {showGuides && !compact ? (
        <>
          <span
            className="presentation-guide presentation-guide--vertical presentation-guide--static"
            style={{ left: "50%" }}
            aria-hidden="true"
          />
          <span
            className="presentation-guide presentation-guide--horizontal presentation-guide--static"
            style={{ top: "50%" }}
            aria-hidden="true"
          />
          <span
            className="presentation-safe-area"
            aria-hidden="true"
          />
        </>
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
              themeFonts={deck.theme.fonts}
              asset={
                nativePptxImageAsset(source, deck.nativeBinding) ??
                (typeof source.assetId === "string" ? assetById.get(source.assetId) : undefined)
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
              onSelect={(additive) => onSelectObject?.(object.id, additive)}
              onPointerDown={(event) => onPointerDown?.(object, event)}
              onResizePointerDown={(handle, event) =>
                onResizePointerDown?.(object, handle, event)
              }
              nativeText={Boolean(deck.nativeBinding) || typeof source.nativeShapeId === "string"}
              onTextChange={(paragraphs) => onTextChange?.(object.id, paragraphs)}
              onTextFocus={() => onTextFocus?.(object.id)}
              onTextBlur={() => onTextBlur?.()}
              path={`/slides/${slideIndex}/objects/${objectIndex}`}
            />
          </div>
        );
      })}
    </div>
  );
}
