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
  ImagePlus,
  Italic,
  Layers3,
  Link2,
  List,
  Lock,
  MonitorOff,
  MonitorPlay,
  MousePointer2,
  Plus,
  Search,
  Square,
  StickyNote,
  Table2,
  Trash2,
  Type,
  Underline,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { createPortal } from "react-dom";
import { LocalAutocompleteTextarea } from "../compute/autocomplete";
import {
  createPresentationObject,
  createPresentationTextBox,
  createPresentationSlide,
  normalizePresentationContent,
  presentationObjectParagraphs,
  presentationObjectText,
  presentationParagraphsText,
  presentationSlideLabel,
  producePresentationContent,
  withPresentationObjectParagraphs,
  withPresentationObjectText,
  type PresentationContent,
  type PresentationObject,
  type PresentationObjectType,
  type PresentationParagraph,
  type PresentationSlide,
} from "../presentation/model";
import {
  applyPresentationLayout,
  PRESENTATION_LAYOUT_OPTIONS,
  type PresentationLayoutId,
} from "../presentation/layouts";
import {
  applyBibliographySlides,
  BIBLIOGRAPHY_SLIDE_MARKER,
  collectDeckCitations,
} from "../presentation/bibliography";
import {
  presentationCommandBindings,
  type PresentationHandlers,
} from "../commands/office/presentation-commands";
import { PRESENTATION_EXPORT_COPIES } from "../capabilities";
import {
  commandContext,
  commandForBinding,
  eventBelongsToFocusedStudio,
  executeCommand,
} from "../commands";
import type { CommandParam } from "../commands/types";
import { auditDeck } from "../presentation/audit";
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
import { spectraBus } from "../events";
import { itemForRegion, SLIDE_NOUNS, type WorkRegion } from "../anchors/locate";
import { regionElement, useOpenAnchor, type AnchorLanding } from "../anchors/use-open-anchor";
import { targetAttrs } from "../collaboration/target-attributes";
import { ArtifactWorkbar, WorkbarItemSelector } from "./artifact-workbar";
import { useStudioContract } from "./artifact-studio-shell";
import {
  applyStudioHistory,
  commitStudioGesture,
  studioValuesEqual,
  type StudioHistoryEntry,
} from "./artifact-studio-value-utils";
import { StudioItemRail } from "./studio-item-rail";
import { PresentationDesigner } from "./presentation-designer";
import { PresentationRehearsalReport } from "./presentation-rehearsal-report";
import { designDeck, type DeckFamily } from "../presentation/designer";
import { rehearsalReport, type RehearsalReport } from "../presentation/rehearsal";
import { FileViewer, type ViewedFile } from "../files/file-viewer";
import { ImportOriginal } from "../files/import-original";
import {
  SlideCanvas,
  styleValue,
  tableRows,
  type ResizeHandle,
} from "./presentation-slide-canvas";
import { SelectField } from "@/components/ui/select";
import {
  applyLinkedChartResolution,
  refreshPresentationLinkedCharts,
  resolveLinkedChart,
} from "../presentation/linked-chart";
import {
  artifactBlobSha256,
  downloadDocumentBlob,
} from "./artifact-studio-file-utils";

/**
 * Slides and Notes are the deck's two views; both come from `work/registry`
 * through the studio contract. Present is not one of them: it is an activity
 * with an obvious exit, reached from the bar's primary verb (CANON D2/D3).
 */
type PresentationSurface = "slides" | "notes";
/** Sections of the type's own inspector pane, not modes. */
type InspectorSection = "slide" | "insert" | "design" | "sources" | "files";
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
const LAYOUT_OPTIONS = PRESENTATION_LAYOUT_OPTIONS;
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
  { value: "design", label: "Designer" },
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
    // Real bullets on every paragraph, as PowerPoint holds them. A "• " typed
    // before each line used to stand in, which exported as text and could not
    // be numbered, nested or ticked.
    pressed: (object) =>
      presentationObjectParagraphs(object).every(
        (paragraph) => paragraph.bullet === "bullet" && paragraph.checked === undefined,
      ),
    apply: (object) => {
      const paragraphs = presentationObjectParagraphs(object);
      const bulleted = paragraphs.every(
        (paragraph) => paragraph.bullet === "bullet" && paragraph.checked === undefined,
      );
      Object.assign(
        object,
        withPresentationObjectParagraphs(
          object,
          paragraphs.map(({ checked: _checked, ...paragraph }) => ({
            ...paragraph,
            bullet: bulleted ? "none" : "bullet",
          })),
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
/**
 * A select that carries the registry's own refusal. When a command is not
 * available the control goes quiet and prints the reason underneath, in the
 * same words the workbar uses, so no surface can look willing while the
 * command behind it is refusing.
 */
function GatedSelect({
  refusal,
  ...rest
}: ComponentProps<typeof SelectField> & { refusal?: string }) {
  return (
    <div className="presentation-gated-field">
      <SelectField {...rest} disabled={rest.disabled || Boolean(refusal)} />
      {refusal ? (
        <p className="presentation-refusal" role="note">
          {refusal}
        </p>
      ) : null}
    </div>
  );
}

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

/** Slide colours are the deck's own data, not the app's theme. */
const PAPER = "#ffffff";

const THEMES = [
  {
    id: "spectra-plain",
    name: "Plain",
    tokens: {
      background: PAPER,
      heading: "#000000",
      body: "#000000",
      accent: "#c4501c",
      soft: "#f2efe9",
    },
  },
  {
    id: "spectra-botanical",
    name: "Botanical",
    tokens: {
      background: "var(--bg-primary)",
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
      background: "var(--bg-secondary)",
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
      background: "var(--bg-user-bubble)",
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
      background: "var(--bg-secondary)",
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

function downloadBlob(blob: Blob, name: string) {
  downloadDocumentBlob(name, blob);
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

function presentationHyperlinkValue(object: PresentationObject) {
  if (typeof object.hyperlink === "string") return object.hyperlink;
  if (object.hyperlink?.kind === "slide") return `slide:${object.hyperlink.slideId}`;
  return object.hyperlink?.url ?? "";
}

/**
 * A read-only picture of one slide. It draws again only when that slide, the
 * deck's look or its media change, so an edit to one slide leaves every other
 * picture (the rail, the notes view) alone.
 */
const StillSlide = memo(
  function StillSlide({
    slide,
    deck,
    assets,
    artifacts,
    className,
  }: {
    slide: PresentationSlide;
    deck: PresentationContent;
    assets: SpectraArtifactAsset[];
    artifacts: SpectraArtifact[];
    className?: string;
  }) {
    return (
      <div
        className={className}
        data-spectra-hidden-target="true"
        data-slide-hidden={slide.hidden || undefined}
      >
        <SlideCanvas
          slide={slide}
          deck={deck}
          assets={assets}
          artifacts={artifacts}
          readOnly
          compact
        />
      </div>
    );
  },
  (previous, next) =>
    previous.slide === next.slide &&
    previous.assets === next.assets &&
    previous.artifacts === next.artifacts &&
    previous.deck.theme === next.deck.theme &&
    previous.deck.settings === next.deck.settings &&
    previous.deck.nativeBinding === next.deck.nativeBinding &&
    previous.className === next.className,
);

function PresentationObjectInspector({
  object,
  readOnly,
  canvasHeight,
  artifacts,
  artifactId,
  onUpdate,
  run,
  refusalFor,
}: {
  object: PresentationObject;
  readOnly: boolean;
  canvasHeight: number;
  artifacts: SpectraArtifact[];
  artifactId: string;
  onUpdate: (recipe: (object: PresentationObject) => void) => void;
  /** The studio's one execute path, so this pane is not a second one. */
  run: (id: string, params?: CommandParam) => boolean;
  refusalFor: (id: string) => string | undefined;
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
              disabled={
                readOnly ||
                (object.locked && key !== "rotation") ||
                refusalFor(`arrange.geometry.${key}`) !== undefined
              }
              title={refusalFor(`arrange.geometry.${key}`)}
              onChange={(event) =>
                run(
                  `arrange.geometry.${key}`,
                  Math.max(
                    minimum,
                    Math.min(maximum, Number(event.target.value)),
                  ),
                )
              }
            />
          </label>
        ))}
      </div>
      <GatedSelect
        label="Animation"
        size="sm"
        value={object.animation?.kind ?? "none"}
        disabled={readOnly}
        refusal={refusalFor("animate.object")}
        options={OBJECT_ANIMATION_OPTIONS}
        onChange={(kind) => run("animate.object", kind)}
      />
      {["image", "chart", "video"].includes(object.type) ? (
        <label>
          Alternative text
          <LocalAutocompleteTextarea
            surface="description"
            value={object.altText ?? ""}
            disabled={
              readOnly || refusalFor("accessibility.altText") !== undefined
            }
            placeholder="Describe the meaning, not only the appearance."
            onValueChange={(altText) => run("accessibility.altText", altText)}
            textareaClassName="w-full"
          />
        </label>
      ) : null}
      {object.type !== "group" ? (
        <label>
          Hyperlink
          <input
            type="url"
            value={presentationHyperlinkValue(object)}
            disabled={readOnly}
            placeholder="https://… or slide:slide-id"
            onChange={(event) =>
              onUpdate((candidate) => {
                const value = event.target.value.trim();
                if (!value) delete candidate.hyperlink;
                else if (value.startsWith("slide:")) {
                  candidate.hyperlink = {
                    kind: "slide",
                    slideId: value.slice("slide:".length).trim(),
                  };
                } else candidate.hyperlink = { kind: "external", url: value };
              })
            }
          />
        </label>
      ) : null}
      {object.type === "chart" || (object.type === "embed" && !(object.content as { diagram?: unknown } | null)?.diagram) ? (
        <div className="presentation-source-binding">
          <SelectField
            label="Source work"
            size="sm"
            value={object.sourceBinding?.artifactId ?? NO_SELECTION}
            disabled={readOnly}
            options={[
              { value: NO_SELECTION, label: "No linked source" },
              ...artifacts
                .filter(
                  (artifact) =>
                    artifact._id !== artifactId &&
                    (artifact.status === "active" || artifact._id === object.sourceBinding?.artifactId) &&
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
                      const live = event.target.checked;
                      const resolution = resolveLinkedChart(candidate, artifacts);
                      candidate.sourceBinding.live = live;
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
                            ...(resolution.chart
                              ? {
                                  pinnedCategories: resolution.chart.categories,
                                  pinnedSeries: resolution.chart.series,
                                  pinnedValues: resolution.chart.series.flatMap((series) => series.values),
                                }
                              : {}),
                            pinnedAt: Date.now(),
                          };
                        }
                      } else {
                        delete candidate.sourceBinding.versionId;
                        if (candidate.type === "chart" && candidate.content && typeof candidate.content === "object" && !Array.isArray(candidate.content)) {
                          const content = candidate.content as Record<string, unknown>;
                          delete content.pinnedCategories;
                          delete content.pinnedSeries;
                          delete content.pinnedValues;
                          delete content.pinnedAt;
                        }
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
            <GatedSelect
              label="Image fit"
              size="sm"
              value={String(styleValue(object, "fit", "contain"))}
              disabled={readOnly}
              refusal={refusalFor("image.fit")}
              options={IMAGE_FIT_OPTIONS}
              onChange={(fit) => run("image.fit", fit)}
            />
            <GatedSelect
              label="Mask"
              size="sm"
              value={String(styleValue(object, "mask", "none"))}
              disabled={readOnly}
              refusal={refusalFor("image.mask")}
              options={IMAGE_MASK_OPTIONS}
              onChange={(mask) => run("image.mask", mask)}
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
      {object.type === "table" ? (
        <div className="presentation-source-binding">
          <strong>Table cells</strong>
          <div className="grid gap-2">
            {tableRows(object).map((row, rowIndex) =>
              row.map((cell, columnIndex) => (
                <div
                  key={`${rowIndex}-${columnIndex}`}
                  className="grid grid-cols-[1fr_auto] gap-2"
                >
                  <label>
                    {rowIndex + 1},{columnIndex + 1}
                    <input
                      value={cell.text}
                      disabled={readOnly}
                      aria-label={`Table cell ${rowIndex + 1},${columnIndex + 1}`}
                      onChange={(event) =>
                        onUpdate((candidate) => {
                          const rows = tableRows(candidate);
                          const next = rows[rowIndex]?.[columnIndex];
                          if (!next) return;
                          next.text = event.target.value;
                          candidate.content = {
                            ...(candidate.content &&
                            typeof candidate.content === "object" &&
                            !Array.isArray(candidate.content)
                              ? candidate.content
                              : {}),
                            rows,
                          };
                        })
                      }
                    />
                  </label>
                  <label>
                    Fill
                    <input
                      type="color"
                      value={
                        typeof cell.style?.fill === "string" &&
                        /^#[0-9a-f]{6}$/i.test(cell.style.fill)
                          ? cell.style.fill
                          : "#ffffff"
                      }
                      disabled={readOnly}
                      aria-label={`Table cell fill ${rowIndex + 1},${columnIndex + 1}`}
                      onChange={(event) =>
                        onUpdate((candidate) => {
                          const rows = tableRows(candidate);
                          const next = rows[rowIndex]?.[columnIndex];
                          if (!next) return;
                          next.style = {
                            ...next.style,
                            fill: event.target.value,
                          };
                          candidate.content = {
                            ...(candidate.content &&
                            typeof candidate.content === "object" &&
                            !Array.isArray(candidate.content)
                              ? candidate.content
                              : {}),
                            rows,
                          };
                        })
                      }
                    />
                  </label>
                </div>
              )),
            )}
          </div>
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
  onActiveRegionChange?: (regionId: string) => void;
}) {
  const committedDeck = useMemo(
    () => normalizePresentationContent(content),
    [content],
  );
  const [gestureDeck, setGestureDeck] = useState<PresentationContent | null>(
    null,
  );
  const gestureDeckRef = useRef<PresentationContent | null>(null);
  gestureDeckRef.current = gestureDeck;
  const deck = gestureDeck ?? committedDeck;
  // The deck an edit applies to. Async work (a media upload, an import) edits
  // it after an await, when the render that started it holds a stale deck;
  // applying there would silently revert everything since, peers included.
  const deckRef = useRef(deck);
  deckRef.current = deck;
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
  /** A text box just drawn, which takes the caret once it is on the slide. */
  const [freshTextId, setFreshTextId] = useState<string>();
  const [layerSelection, setLayerSelection] = useState<string[]>([]);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [draggingSlideId, setDraggingSlideId] = useState<string>();
  const [undoStack, setUndoStack] = useState<
    StudioHistoryEntry<PresentationContent>[]
  >([]);
  const [redoStack, setRedoStack] = useState<
    StudioHistoryEntry<PresentationContent>[]
  >([]);
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
  const [rehearsal, setRehearsal] = useState<RehearsalReport>();
  const presenterRef = useRef<HTMLDivElement>(null);
  // Present mode keeps its own window key handler (Escape stops presenting);
  // the hook traps Tab inside and returns focus when presenting ends.
  useModalFocus(presenterRef, { open: Boolean(presentedDeck) });
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
  // An imported file's original, read-only in the shared file viewer.
  const [viewingOriginal, setViewingOriginal] = useState<ViewedFile | null>(null);
  const [importHistory, setImportHistory] = useState<SpectraArtifactImport[]>(
    [],
  );
  const [pendingImportVersion, setPendingImportVersion] = useState<string>();
  const [sectionDraft, setSectionDraft] = useState("");
  // Stage aids. They change what you see while authoring and never the deck, so
  // they live here rather than in the content, and their commands say so by
  // declaring `undo: "none(explain)"`.
  const [snapToObjects, setSnapToObjects] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [showGuides, setShowGuides] = useState(false);
  const [pointerVisible, setPointerVisible] = useState(false);
  /** Where the laser sits, in percent of the presenter surface. */
  const [pointerAt, setPointerAt] = useState<{ x: number; y: number }>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [stageZoom, setStageZoom] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const studioRef = useRef<HTMLElement>(null);
  const mediaTargetRef = useRef<{ slideId: string; objectId?: string } | undefined>(undefined);
  const importInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragState | undefined>(undefined);
  /**
   * A typing session (a slide text box or the speaker notes, from focus to
   * blur) commits every keystroke but is one undo step. `after` gathers only
   * this person's edits, so undoing the session never reverts what a
   * collaborator changed while it went on.
   */
  const typingSessionRef = useRef<
    StudioHistoryEntry<PresentationContent> | undefined
  >(undefined);
  useEffect(() => {
    if (dragRef.current) return;
    setGestureDeck(null);
  }, [content]);
  const runCommandRef = useRef<(id: string, params?: CommandParam) => boolean>(
    () => false,
  );
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
    function onReveal(detail: { workId: string; path?: string }) {
      if (detail.workId !== artifactId || !detail.path) return;
      const match = /^\/slides\/(\d+)/.exec(detail.path);
      if (!match) return;
      const slide = deck.slides[Number(match[1])];
      if (slide && slide.id !== activeSlideId) setActiveSlideId(slide.id);
    }
    return spectraBus.handle("work.reveal", onReveal);
  }, [artifactId, activeSlideId, deck.slides]);
  // Opened at a slide (a search hit, a citation): show it, then land on it.
  const landOnSlide = useCallback(
    (region: WorkRegion): AnchorLanding | null => {
      const slide = itemForRegion(deck.slides, region, SLIDE_NOUNS);
      if (!slide) return null;
      return {
        select: () => {
          setActiveSlideId(slide.id);
          setSelectedObjectId(undefined);
          setLayerSelection([]);
        },
        find: (root) => regionElement(root, slide.id),
      };
    },
    [deck.slides],
  );
  useOpenAnchor(artifactId, landOnSlide);
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
      if (event.defaultPrevented) return;
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
      } else if (event.key === "Escape") {
        event.preventDefault();
        stopPresenting();
      }
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
      const session = typingSessionRef.current;
      if (record && session) {
        session.after = commitStudioGesture(deckRef.current, next, session.after);
      } else if (record) {
        setUndoStack((stack) => [
          ...stack.slice(-79),
          { before: cloneDeck(deckRef.current), after: next },
        ]);
        setRedoStack([]);
      }
      setGestureDeck(null);
      // Re-normalize so settings/speakerNotes/layout fields match the Yjs
      // projection before onChange dirties the studio (same class of drift as
      // whiteboard zOrder — otherwise first ack looks like a remote conflict).
      const normalized = normalizePresentationContent(next);
      deckRef.current = normalized;
      onChange(normalized);
    },
    [onChange, readOnly],
  );
  const mutate = useCallback(
    (recipe: (draft: PresentationContent) => void, record = true) => {
      const current = deckRef.current;
      const next = producePresentationContent(current, recipe);
      if (next === current) return;
      emit(next, record);
    },
    [emit],
  );
  const mutateLocal = useCallback(
    (recipe: (draft: PresentationContent) => void) => {
      setGestureDeck((current) =>
        producePresentationContent(current ?? committedDeck, recipe),
      );
    },
    [committedDeck],
  );
  // Escape steps out one level at a time, as in PowerPoint: out of the words
  // first, keeping the box selected; a second Escape lets go of the box. It is
  // read on the way down, because ProseMirror marks every Escape it sees as
  // handled; the slash menu and a ghost suggestion keep their own Escape.
  useEffect(() => {
    if (readOnly || surface !== "slides") return;
    const leaveText = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".presentation-text-field")) return;
      if (!studioRef.current?.contains(target)) return;
      if (document.querySelector(".slash-command-portal")) return;
      if (target.querySelector(".spectra-autocomplete-ghost")) return;
      // A box that was just inserted asks for the caret; once left it must
      // not, or it would take the caret straight back.
      setFreshTextId(undefined);
      target.blur();
      studioRef.current
        .querySelector<HTMLElement>(".presentation-stage")
        ?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", leaveText, true);
    return () => window.removeEventListener("keydown", leaveText, true);
  }, [readOnly, surface]);
  useEffect(() => {
    if (readOnly || surface !== "slides" || !selectedObjectId) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!eventBelongsToFocusedStudio(event, artifactId, studioRef.current)) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select") ||
        target?.isContentEditable
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedObjectId(undefined);
        setLayerSelection([]);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        runCommandRef.current("arrange.delete");
        return;
      }
      const movement = event.shiftKey ? 10 : 1;
      const object = deck.slides[activeSlideIndex]?.objects.find(
        (candidate) => candidate.id === selectedObjectId,
      );
      if (!object || object.locked) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        runCommandRef.current("arrange.geometry.x", object.x - movement);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        runCommandRef.current("arrange.geometry.x", object.x + movement);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        runCommandRef.current("arrange.geometry.y", object.y - movement);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        runCommandRef.current("arrange.geometry.y", object.y + movement);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [
    activeSlideIndex,
    artifactId,
    deck.slides,
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
      if (event.defaultPrevented) return;
      if (!eventBelongsToFocusedStudio(event, artifactId, studioRef.current)) return;
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
        runCommandRef.current("history.undo");
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        runCommandRef.current("history.redo");
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [artifactId, readOnly, surface]);

  function undo() {
    const entry = undoStack.at(-1);
    if (!entry || readOnly) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack.slice(-79), entry]);
    onChange(
      normalizePresentationContent(
        applyStudioHistory(entry, "undo", committedDeck),
      ),
    );
  }
  function redo() {
    const entry = redoStack.at(-1);
    if (!entry || readOnly) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack.slice(-79), entry]);
    onChange(
      normalizePresentationContent(
        applyStudioHistory(entry, "redo", committedDeck),
      ),
    );
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
    const ordinal = activeSlide.objects.length + 1;
    const object = type === "text" ? createPresentationTextBox(ordinal) : createPresentationObject(type, ordinal);
    mutate((draft) => {
      draft.slides[activeSlideIndex]!.objects.push(object);
    });
    setSelectedObjectId(object.id);
    setLayerSelection([object.id]);
    onActiveRegionChange?.(object.id);
    // A new text box takes the caret, so writing starts where it was drawn.
    if (type === "text") setFreshTextId(object.id);
  }
  function applyTextPreset(preset: "title" | "subtitle" | "body" | "caption") {
    // Presets take the deck's own inks; a deck without a theme writes in black.
    const heading = deck.theme.tokens?.heading ?? "#000000";
    const body = deck.theme.tokens?.body ?? "#000000";
    const tokens = {
      title: { fontSize: 54, fontWeight: 700, color: heading },
      subtitle: { fontSize: 27, fontWeight: 520, color: heading },
      body: { fontSize: 21, fontWeight: 430, color: body },
      caption: { fontSize: 15, fontWeight: 520, color: body },
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
      applyPresentationLayout(
        draft,
        activeSlideIndex,
        layoutId as PresentationLayoutId,
        { createMissing: true, mode: "preserve" },
      );
    });
  }
  /** Wears one of Designer's looks on the open slide; undo takes it off. */
  function applyDesign(designed: PresentationSlide) {
    mutate((draft) => {
      draft.slides[activeSlideIndex] = structuredClone(designed);
    });
    setSelectedObjectId(undefined);
    setLayerSelection([]);
  }
  function applyDeckDesign(family: DeckFamily) {
    mutate((draft) => {
      draft.slides = structuredClone(designDeck(draft, family));
    });
    setSelectedObjectId(undefined);
    setLayerSelection([]);
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
    mutateLocal((draft) => {
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
    });
  }
  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    setGuides({});
    const gesture = gestureDeckRef.current;
    if (gesture) {
      // Only the moved/resized objects come from the gesture copy; everything
      // a collaborator changed during the drag stays theirs.
      const next = normalizePresentationContent(
        commitStudioGesture(drag.snapshot, gesture, committedDeck),
      );
      setUndoStack((stack) => [
        ...stack.slice(-79),
        { before: drag.snapshot, after: gesture },
      ]);
      setRedoStack([]);
      onChange(next);
      setGestureDeck(null);
    }
  }
  function updateText(objectId: string, value: string) {
    // Typing commits on every keystroke like any other edit: collaborators
    // see it live, a reload or crash cannot lose an unblurred text box, and a
    // peer's edit elsewhere is never replaced by a copy taken at focus. The
    // whole typing session is still one undo step (recorded on blur).
    mutate((draft) => {
      const slide = draft.slides[activeSlideIndex]!;
      const object = slide.objects.find(
        (candidate) => candidate.id === objectId,
      );
      if (!object) return;
      Object.assign(object, withPresentationObjectText(object, value));
      // Keep the slides rail label aligned with the text on the canvas.
      const firstText = slide.objects.find((candidate) => candidate.type === "text");
      if (firstText && firstText.id === objectId) {
        const next = value.trim();
        if (next) slide.title = next.slice(0, 300);
      }
    });
  }
  function updateTextParagraphs(objectId: string, paragraphs: PresentationParagraph[]) {
    // As `updateText`, from the rich field: the paragraphs it wrote, with
    // their words beside them for search, the slide title and the AI.
    mutate((draft) => {
      const slide = draft.slides[activeSlideIndex]!;
      const object = slide.objects.find(
        (candidate) => candidate.id === objectId,
      );
      if (!object) return;
      const text = presentationParagraphsText(paragraphs);
      const plain = paragraphs.every(
        (paragraph) =>
          Object.keys(paragraph).length === 1 &&
          paragraph.runs.length <= 1 &&
          paragraph.runs.every((run) => Object.keys(run).length === 1),
      );
      // A box that only ever held words keeps holding words until it is formatted.
      Object.assign(
        object,
        plain &&
          !Array.isArray((object.content as { paragraphs?: unknown } | null)?.paragraphs)
          ? withPresentationObjectText(object, text)
          : withPresentationObjectParagraphs(object, paragraphs),
      );
      const firstText = slide.objects.find((candidate) => candidate.type === "text");
      if (firstText && firstText.id === objectId) {
        const next = text.trim();
        if (next) slide.title = next.slice(0, 300);
      }
    });
  }
  function beginTyping() {
    if (typingSessionRef.current) return;
    const origin = cloneDeck(deckRef.current);
    typingSessionRef.current = { before: origin, after: origin };
  }
  function finishTyping() {
    const session = typingSessionRef.current;
    if (!session) return;
    typingSessionRef.current = undefined;
    if (studioValuesEqual(session.before, session.after)) return;
    setUndoStack((stack) => [...stack.slice(-79), session]);
    setRedoStack([]);
  }
  function beginText(objectId: string) {
    beginTyping();
    setFreshTextId(undefined);
    setSelectedObjectId(objectId);
    onActiveRegionChange?.(objectId);
  }
  function chooseMedia(kind: "image" | "video", replace = false) {
    mediaTargetRef.current = { slideId: activeSlide.id, ...(replace && selectedObject ? { objectId: selectedObject.id } : {}) };
    if (fileInputRef.current) {
      fileInputRef.current.accept = kind === "video" ? "video/mp4,video/webm" : contract.compatibilityProfile === "strict-native" ? "image/png,image/jpeg" : "image/*";
      fileInputRef.current.click();
    }
  }
  async function addMedia(file: File) {
    if (readOnly || !file.size) return;
    setAssetError(undefined);
    setAssetBusy(true);
    try {
      const target = mediaTargetRef.current ?? { slideId: activeSlide.id };
      if (!file.type.startsWith("image/") && !file.type.startsWith("video/"))
        throw new Error("Choose an image or video file.");
      if (contract.compatibilityProfile === "strict-native" && !["image/png", "image/jpeg"].includes(file.type))
        throw new Error("Choose a PNG or JPEG picture for this PowerPoint file.");
      if (file.size > 100_000_000)
        throw new Error("Presentation media cannot exceed 100 MB per asset.");
      const sha256 = await artifactBlobSha256(file);
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
        sha256,
        blob: file,
      });
      const result = await getArtifactAssets(artifactId);
      setAssets(result.assets);
      const object = createPresentationObject(
        file.type.startsWith("video/") ? "video" : "image",
        activeSlide.objects.length + 1,
      );
      const imageContent = { assetId: uploaded.assetId, name: file.name, mediaType: file.type, sha256 };
      object.content = imageContent;
      object.altText = "";
      mutate((draft) => {
        const slide = draft.slides.find((candidate) => candidate.id === target.slideId);
        if (!slide) throw new Error("The slide was removed while the media uploaded.");
        if (target.objectId) {
          const picture = slide.objects.find((candidate) => candidate.id === target.objectId);
          if (!picture || !["image", "video"].includes(picture.type)) throw new Error("The picture was removed while its replacement uploaded.");
          picture.content = { ...(picture.content && typeof picture.content === "object" ? picture.content : {}), ...imageContent };
          picture.type = object.type;
        } else {
          object.readingOrder = slide.objects.length;
          slide.objects.push(object);
        }
      });
      setSelectedObjectId(target.objectId ?? object.id);
      setLayerSelection([target.objectId ?? object.id]);
    } catch (error) {
      setAssetError(
        error instanceof Error ? error.message : "Media could not be added.",
      );
    } finally {
      setAssetBusy(false);
      mediaTargetRef.current = undefined;
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
        sha256: await artifactBlobSha256(file),
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
            sha256: await artifactBlobSha256(blob),
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
      const importedDeck = normalizePresentationContent(next);
      setUndoStack((stack) => [
        ...stack.slice(-79),
        { before: cloneDeck(deckRef.current), after: importedDeck },
      ]);
      setRedoStack([]);
      onChange(importedDeck);
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
      const linked = refreshPresentationLinkedCharts(deck, artifacts);
      const linkedWarning = linked.unavailable.length
        ? " One or more linked Sheets sources were unavailable; their last saved chart values were exported."
        : "";
      const exportDeck = linked.deck;
      const stem = presentationFileStem(
        exportDeck.slides[0]?.title ?? "presentation",
      );
      const blob =
        format === "pptx"
          ? await buildPresentationPptx(exportDeck, assets)
          : format === "odp"
            ? buildPresentationOdp(exportDeck)
            : format === "pdf"
              ? await buildPresentationPdf(exportDeck, assets)
              : await buildPresentationPngArchive(exportDeck, assets);
      downloadBlob(blob, `${stem}.${format === "png" ? "slides.zip" : format}`);
      setIoMessage(
        `${format === "pptx"
          ? "Exported to PowerPoint. Text, shapes, charts, tables and notes stay editable there, and diagrams come across as pictures."
          : format === "odp"
            ? "OpenDocument export contains editable slide text frames; media, live embeds, and advanced motion require the Spectra source for full fidelity."
            : "Static export completed from the current synchronized scene."}${linkedWarning}`,
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
    const staged = cloneDeck(deck);
    const visible = staged.slides.filter((slide) => slide.hidden !== true);
    // Hidden means hidden: the run skips those slides entirely, so the hide
    // control is not a label that changes nothing. A deck with every slide
    // hidden still presents, because a black room is the worse answer.
    const shown = visible.length > 0 ? visible : [...staged.slides];
    const startIndex = Math.max(
      0,
      shown.findIndex((slide) => slide.id === activeSlide.id),
    );
    rehearsalModeRef.current = rehearse;
    rehearsalDurationsRef.current = shown.map(() => 0);
    presentIndexRef.current = startIndex;
    presentSlideStartedAtRef.current = now;
    setRehearsalMode(rehearse);
    if (rehearse) setRehearsal(undefined);
    setPresentedDeck({ ...staged, slides: shown });
    setPresentIndex(startIndex);
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
    if (rehearsalModeRef.current && presentedDeck)
      setRehearsal(rehearsalReport(presentedDeck.slides, rehearsalDurationsRef.current));
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
  /**
   * Shapes come from one library, and the shape a person picked is the shape the
   * stage draws: the name is stored on the object and the CSS clip path keyed to
   * it does the drawing, so the menu cannot promise a shape that does not exist.
   */
  function addShape(shape: string) {
    const object = createPresentationObject("shape", activeSlide.objects.length + 1);
    object.style = { ...object.style, shape };
    if (shape === "line") {
      object.height = 4;
      object.style = { ...object.style, fill: deck.theme.tokens?.accent };
    }
    mutate((draft) => {
      draft.slides[activeSlideIndex]!.objects.push(object);
    });
    setSelectedObjectId(object.id);
    setLayerSelection([object.id]);
    onActiveRegionChange?.(object.id);
  }
  /**
   * Slide text is plain text, so a list is a real prefix on every line rather
   * than a paragraph property Spectra cannot round-trip. Toggling off removes
   * exactly what toggling on added.
   */
  function toggleObjectList(kind: "bullet" | "numbered") {
    updateSelected((object) => {
      const current = styleValue(object, "listStyle", "none");
      const lines = presentationObjectText(object)
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*(?:•\s+|\d+\.\s+)/, ""));
      const next = current === kind ? "none" : kind;
      const rendered =
        next === "none"
          ? lines
          : lines.map((line, index) =>
              line.trim()
                ? next === "bullet"
                  ? `• ${line}`
                  : `${index + 1}. ${line}`
                : line,
            );
      Object.assign(object, withPresentationObjectText(object, rendered.join("\n")));
      object.style = { ...object.style, listStyle: next };
    });
  }
  /** Reads the deck and reports through the one status line this studio has. */
  function runDeckAudit() {
    const report = auditDeck(deck);
    setIoError(undefined);
    setIoMessage(report.summary);
  }
  function buildBibliographySlide() {
    mutate((draft) => {
      const next = applyBibliographySlides(draft);
      draft.slides = [...next.slides];
    });
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
    label: presentationSlideLabel(slide, index),
  }));
  /**
   * Find is a filter on the rail, not a modal. The query narrows the previews to
   * the slides that contain it and the count goes into the command hint, so the
   * number a person reads is the number of slides they can click.
   */
  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return deck.slides.filter((slide) => {
      if (slide.title.toLowerCase().includes(query)) return true;
      if ((slide.speakerNotes ?? "").toLowerCase().includes(query)) return true;
      return slide.objects.some((object) =>
        presentationObjectText(object).toLowerCase().includes(query),
      );
    });
  }, [deck.slides, searchQuery]);
  const railSlides =
    searchOpen && searchQuery.trim() ? searchMatches : deck.slides;
  /** A style read that answers honestly when nothing is selected. */
  const selectedStyle = (key: string, fallback: string | number | boolean) =>
    selectedObject ? styleValue(selectedObject, key, fallback) : fallback;
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
   * The whole deck surface, in one place.
   *
   * Every semantic operation this studio performs is reachable through exactly
   * one registered command, so the bar, a shortcut, the inspector, a canvas
   * gesture, the thumbnail rail, the presenter chrome and the AI plane all land
   * on the same function. The declarations that make each one honest — which
   * native region it writes, whether a linked PowerPoint file will take the
   * write, what the AI calls it — live in `presentation-commands.ts`, beside the
   * ids, so this file stays about behaviour.
   */
  const presentationHandlers: PresentationHandlers = {
    state: {
      slideCount: deck.slides.length,
      slideIndex: activeSlideIndex,
      slideHidden: activeSlide.hidden === true,
      layoutId: activeSlide.layoutId ?? "title-content",
      sectionId: activeSlide.sectionId,
      sections: (deck.sections ?? []).map((section) => ({
        value: section.id,
        label: section.name,
      })),
      themeId: deck.theme.id,
      themes: THEMES.map((theme) => ({ value: theme.id, label: theme.name })),
      background: activeSlide.background,
      aspectRatio: deck.settings?.aspectRatio ?? "16:9",
      transitionKind: activeSlide.transition?.kind ?? "none",
      transitionDurationMs: activeSlide.transition?.durationMs ?? 350,
      defaultTransition: deck.settings?.defaultTransition ?? "none",
      autoAdvanceSeconds: deck.settings?.autoAdvanceSeconds ?? 0,
      showSlideNumbers: deck.settings?.showSlideNumbers !== false,
      transitionPreserved:
        activeSlide.nativeCompatibility?.transition === "preserved",
      animationsPreserved:
        activeSlide.nativeCompatibility?.animations === "preserved",
      snapToObjects,
      showGrid,
      showGuides,
      railOpen: slideRailOpen,
      inspectorOpen,
      notesSurface: surface === "notes",
      notesPanelOpen: notesOpen,
      presenting: Boolean(presentedDeck),
      rehearsing: rehearsalMode,
      presenterNotesVisible,
      blackout: presentBlackout,
      pointerVisible,
      presenterLayout: presentLayout,
      presentIndex,
      components: (deck.components ?? []).map((component) => ({
        value: component.id,
        label: component.name,
      })),
      citationCount: deckCitationCount,
      hasBibliography: deckHasBibliography,
      mediaBusy: assetBusy,
      selection: {
        objectId: selectedObjectId,
        objectType: selectedObject?.type,
        count: layerSelection.length || (selectedObjectId ? 1 : 0),
        locked: selectedObject?.locked === true,
        hidden: selectedObject?.hidden === true,
        isGroup: selectedObject?.type === "group",
        isPlaceholder: Boolean(selectedObject?.componentId),
        hasText: Boolean(
          selectedObject && presentationObjectText(selectedObject).trim(),
        ),
        hasAltText: Boolean(selectedObject?.altText?.trim()),
        x: selectedObject?.x ?? 0,
        y: selectedObject?.y ?? 0,
        width: selectedObject?.width ?? 400,
        height: selectedObject?.height ?? 220,
        rotation: selectedObject?.rotation ?? 0,
        fill: selectedObject
          ? (selectedStyle("fill", "") as string) || null
          : null,
        stroke: selectedObject
          ? (selectedStyle("stroke", "") as string) || null
          : null,
        strokeWidth: Number(selectedStyle("strokeWidth", 1)),
        cornerRadius: Number(selectedStyle("cornerRadius", 24)),
        opacity: Math.round(
          Number(selectedStyle("opacity", 1)) * 100,
        ),
        shadow: selectedStyle("shadow", false) === true,
        imageFit: String(selectedStyle("fit", "contain")),
        imageMask: String(selectedStyle("mask", "none")),
        focalX: Number(selectedStyle("focalX", 50)),
        focalY: Number(selectedStyle("focalY", 50)),
        animationKind: selectedObject?.animation?.kind ?? "none",
        animationDurationMs: selectedObject?.animation?.durationMs ?? 450,
        animationDelayMs: selectedObject?.animation?.delayMs ?? 0,
        textPreset: selectedTextPreset,
        bindable:
          selectedObject?.type === "chart" || selectedObject?.type === "embed",
        sourceLive: selectedObject?.sourceBinding?.live === true,
      },
    },
    history: {
      undo,
      redo,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
    },
    find: {
      toggle: () => {
        setSearchOpen((open) => {
          if (open) setSearchQuery("");
          return !open;
        });
        setSurfacePreference("slides");
      },
      open: searchOpen,
      matchCount: searchOpen ? searchMatches.length : undefined,
      matchNoun: "slide",
    },
    textFormat: {
      fontFamily: {
        value: selectedObject
          ? (selectedStyle("fontFamily", "") as string) || undefined
          : undefined,
        set: (family) =>
          updateSelected((object) => {
            object.style = { ...object.style, fontFamily: family };
          }),
      },
      fontSize: {
        value: selectedObject
          ? Number(selectedStyle("fontSize", 21))
          : undefined,
        set: (size) =>
          updateSelected((object) => {
            object.style = { ...object.style, fontSize: size };
          }),
      },
      bold: {
        active: Number(selectedStyle("fontWeight", 430)) >= 600,
        toggle: () =>
          updateSelected((object) => {
            const weight = Number(styleValue(object, "fontWeight", 430));
            object.style = { ...object.style, fontWeight: weight >= 600 ? 430 : 700 };
          }),
      },
      italic: {
        active: Boolean(selectedStyle("italic", false)),
        toggle: () =>
          updateSelected((object) => {
            const italic = Boolean(styleValue(object, "italic", false));
            object.style = { ...object.style, italic: !italic };
          }),
      },
      underline: {
        active: Boolean(selectedStyle("underline", false)),
        toggle: () =>
          updateSelected((object) => {
            const underlined = Boolean(styleValue(object, "underline", false));
            object.style = { ...object.style, underline: !underlined };
          }),
      },
      strike: {
        active:
          selectedStyle("textDecoration", "none") === "line-through",
        toggle: () =>
          updateSelected((object) => {
            const struck =
              styleValue(object, "textDecoration", "none") === "line-through";
            object.style = {
              ...object.style,
              textDecoration: struck ? "none" : "line-through",
            };
          }),
      },
      color: {
        value: selectedObject
          ? (selectedStyle("color", "") as string) || null
          : null,
        set: (color) =>
          updateSelected((object) => {
            object.style = { ...object.style, color: color ?? undefined };
          }),
      },
      alignment: {
        value: String(selectedStyle("textAlign", "left")),
        set: (align) =>
          updateSelected((object) => {
            object.style = { ...object.style, textAlign: align };
          }),
      },
      lineHeight: {
        value: Number(selectedStyle("lineHeight", 1.25)),
        set: (lineHeight) =>
          updateSelected((object) => {
            object.style = { ...object.style, lineHeight };
          }),
      },
      bulletList: {
        active: selectedStyle("listStyle", "none") === "bullet",
        toggle: () => toggleObjectList("bullet"),
      },
      numberedList: {
        active: selectedStyle("listStyle", "none") === "numbered",
        toggle: () => toggleObjectList("numbered"),
      },
      clear: () =>
        updateSelected((object) => {
          object.style = {
            ...object.style,
            italic: undefined,
            underline: undefined,
            fontWeight: undefined,
            color: undefined,
            fontFamily: undefined,
          };
        }),
      disabled: !selectedObject,
      generalPins: [],
    },
    exporter: {
      noun: "deck",
      busyFormat: ioBusy ? "pptx" : null,
      formats: [...PRESENTATION_EXPORT_COPIES],
      run: (format) =>
        void exportPresentation(format as "pptx" | "odp" | "pdf" | "png"),
    },
    importer: {
      noun: "deck",
      busy: Boolean(ioBusy),
      open: () => importInputRef.current?.click(),
    },
    print: () => window.print(),
    zoom: {
      zoom: stageZoom,
      setZoom: setStageZoom,
      min: 0.5,
      max: 2,
      fit: { label: "Fit the slide", run: () => setStageZoom(1) },
    },
    slide: {
      add: addSlide,
      duplicate: duplicateSlide,
      remove: deleteSlide,
      moveEarlier: () => moveSlide(-1),
      moveLater: () => moveSlide(1),
      setTitle: (title) =>
        mutate((draft) => {
          draft.slides[activeSlideIndex]!.title = title.slice(0, 300);
        }),
      toggleHidden: () =>
        mutate((draft) => {
          const slide = draft.slides[activeSlideIndex]!;
          if (slide.hidden) delete slide.hidden;
          else slide.hidden = true;
        }),
      setSection: (sectionId) =>
        mutate((draft) => {
          const slide = draft.slides[activeSlideIndex]!;
          if (sectionId) slide.sectionId = sectionId;
          else delete slide.sectionId;
        }),
      addSection: () => {
        // The rail's own field is the place a section is named, so the command
        // takes you there rather than inventing an untitled one.
        openInspector("slide");
      },
    },
    insert: {
      textBox: () => addObject("text"),
      placeholderText: () =>
        updateSelected((object) => {
          if (object.type !== "text") return;
          object.content = { text: "Say the one thing this slide is for." };
        }),
      shape: (shape) => addShape(shape),
      image: () => chooseMedia("image"),
      video: () => chooseMedia("video"),
      chart: () => addObject("chart"),
      table: () => addObject("table"),
      embed: () => addObject("embed"),
      component: insertComponent,
    },
    design: {
      open: () => openInspector("design"),
      applyLayout: applySlideLayout,
      resetPlaceholders: () => applySlideLayout(activeSlide.layoutId ?? "title-content"),
      applyTheme: (themeId) => {
        const theme = THEMES.find((candidate) => candidate.id === themeId);
        if (theme) applyTheme(theme);
      },
      setBackground: (background) =>
        mutate((draft) => {
          const slide = draft.slides[activeSlideIndex]!;
          if (background) slide.background = background;
          else delete slide.background;
        }),
      setAspectRatio: (ratio) =>
        mutate((draft) => {
          draft.settings = {
            ...draft.settings,
            aspectRatio: ratio === "4:3" ? "4:3" : "16:9",
          };
        }),
      toggleSlideNumbers: () =>
        mutate((draft) => {
          draft.settings = {
            ...draft.settings,
            showSlideNumbers: draft.settings?.showSlideNumbers === false,
          };
        }),
      saveComponent: saveSelectedAsComponent,
      audit: runDeckAudit,
    },
    arrange: {
      align: (mode) => arrangeSelection(mode),
      order: (mode) => {
        if (mode === "forward") moveSelectedLayer(1);
        else if (mode === "backward") moveSelectedLayer(-1);
        else {
          // Front and back are the same one-step move repeated until the object
          // runs out of neighbours, so there is one ordering implementation.
          const steps = activeSlide.objects.length;
          for (let step = 0; step < steps; step += 1)
            moveSelectedLayer(mode === "front" ? 1 : -1);
        }
      },
      group: groupSelectedObjects,
      ungroup: ungroupSelectedObject,
      toggleLock: () =>
        updateSelected((object) => {
          if (object.locked) delete object.locked;
          else object.locked = true;
        }),
      toggleHidden: () =>
        updateSelected((object) => {
          if (object.hidden) delete object.hidden;
          else object.hidden = true;
        }),
      remove: deleteSelectedObject,
      toggleSnap: () => setSnapToObjects((value) => !value),
      toggleGrid: () => setShowGrid((value) => !value),
      toggleGuides: () => setShowGuides((value) => !value),
      openReadingOrder: () => openInspector("slide"),
      setGeometry: (key, value) =>
        updateSelected((object) => {
          if (object.locked && key !== "rotation") return;
          if (key === "rotation") object.rotation = value;
          else if (key === "width") object.width = Math.max(10, value);
          else if (key === "height") object.height = Math.max(10, value);
          else object[key] = value;
        }),
    },
    object: {
      setText: (text) => {
        if (selectedObjectId) updateText(selectedObjectId, text);
      },
      setLink: (value) =>
        updateSelected((object) => {
          if (!value) {
            delete object.hyperlink;
            return;
          }
          object.hyperlink = value.startsWith("slide:")
            ? { kind: "slide", slideId: value.slice("slide:".length).trim() }
            : { kind: "external", url: value.trim() };
        }),
      applyTextPreset: (preset) =>
        applyTextPreset(preset as "title" | "subtitle" | "body" | "caption"),
      setFill: (color) =>
        updateSelected((object) => {
          object.style = { ...object.style, fill: color ?? undefined };
        }),
      setStroke: (color) =>
        updateSelected((object) => {
          object.style = { ...object.style, stroke: color ?? undefined };
        }),
      setStrokeWidth: (width) =>
        updateSelected((object) => {
          object.style = { ...object.style, strokeWidth: width };
        }),
      setCornerRadius: (radius) =>
        updateSelected((object) => {
          object.style = { ...object.style, cornerRadius: radius };
        }),
      setOpacity: (opacity) =>
        updateSelected((object) => {
          object.style = {
            ...object.style,
            opacity: Math.min(1, Math.max(0.1, opacity / 100)),
          };
        }),
      toggleShadow: () =>
        updateSelected((object) => {
          const shadow = styleValue(object, "shadow", false) === true;
          object.style = { ...object.style, shadow: !shadow };
        }),
      setAltText: (altText) =>
        updateSelected((object) => {
          const trimmed = altText.trim();
          if (trimmed) object.altText = trimmed.slice(0, 500);
          else delete object.altText;
        }),
      setImageFit: (fit) =>
        updateSelected((object) => {
          object.style = { ...object.style, fit };
        }),
      setImageMask: (mask) =>
        updateSelected((object) => {
          object.style = { ...object.style, mask };
        }),
      setFocal: (axis, value) =>
        updateSelected((object) => {
          object.style = {
            ...object.style,
            [axis === "x" ? "focalX" : "focalY"]: Math.min(100, Math.max(0, value)),
          };
        }),
      replaceImage: () => chooseMedia("image", true),
      bindSource: (artifactId) =>
        updateSelected((object) => {
          if (!artifactId) {
            delete object.sourceBinding;
            return;
          }
          object.sourceBinding = {
            ...object.sourceBinding,
            artifactId,
            kind: object.sourceBinding?.kind ?? "artifact",
          };
        }),
      toggleSourceLive: () =>
        updateSelected((object) => {
          if (!object.sourceBinding) return;
          object.sourceBinding = {
            ...object.sourceBinding,
            live: !object.sourceBinding.live,
          };
        }),
      refreshChart: () => {
        if (!selectedObject || selectedObject.type !== "chart") return;
        const resolution = resolveLinkedChart(selectedObject, artifacts);
        if (resolution.status === "unavailable") {
          setIoError(resolution.detail ?? "The linked Sheets source is unavailable.");
          return;
        }
        if (resolution.status === "not-linked") return;
        updateSelected((object) => {
          const refreshed = applyLinkedChartResolution(object, resolution);
          object.content = refreshed.content;
          object.sourceBinding = refreshed.sourceBinding;
        });
        setIoMessage(resolution.status === "pinned"
          ? "The chart is pinned; its saved values are already current."
          : `Chart refreshed from committed Sheets revision ${resolution.sourceRevision ?? "available"}.`);
      },
      setAnimation: (kind) =>
        updateSelected((object) => {
          if (kind === "none") {
            delete object.animation;
            return;
          }
          object.animation = {
            ...object.animation,
            kind: kind as "fade" | "rise" | "scale" | "wipe",
          };
        }),
      setAnimationDuration: (durationMs) =>
        updateSelected((object) => {
          if (!object.animation) return;
          object.animation = { ...object.animation, durationMs };
        }),
      setAnimationDelay: (delayMs) =>
        updateSelected((object) => {
          if (!object.animation) return;
          object.animation = { ...object.animation, delayMs };
        }),
    },
    transition: {
      set: (kind) =>
        mutate((draft) => {
          const slide = draft.slides[activeSlideIndex]!;
          if (kind === "none") {
            delete slide.transition;
            return;
          }
          slide.transition = {
            kind: kind as "fade" | "push" | "dissolve",
            durationMs: slide.transition?.durationMs ?? 350,
          };
        }),
      setDuration: (durationMs) =>
        mutate((draft) => {
          const slide = draft.slides[activeSlideIndex]!;
          if (!slide.transition) return;
          slide.transition = { ...slide.transition, durationMs };
        }),
      applyToAll: () => {
        const source = activeSlide.transition;
        mutate((draft) => {
          draft.slides.forEach((slide) => {
            // A slide whose transition PowerPoint wrote keeps it: applying to
            // every slide must not be the one gesture that overwrites what the
            // rest of this studio refuses to touch.
            if (slide.nativeCompatibility?.transition === "preserved") return;
            if (!source) delete slide.transition;
            else slide.transition = { ...source };
          });
        });
      },
      setDefault: (kind) =>
        mutate((draft) => {
          draft.settings = {
            ...draft.settings,
            defaultTransition: kind as "none" | "fade" | "push" | "dissolve",
          };
        }),
      setAutoAdvance: (seconds) =>
        mutate((draft) => {
          draft.settings = {
            ...draft.settings,
            autoAdvanceSeconds: Math.max(0, Math.round(seconds)),
          };
        }),
    },
    notes: {
      set: (notes) =>
        mutate((draft) => {
          draft.slides[activeSlideIndex]!.speakerNotes = notes.slice(0, 250_000);
        }),
      togglePanel: () => {
        setNotesOpen((open) => !open);
        setSurfacePreference("slides");
      },
      toggleSurface: () =>
        setSurfacePreference(surface === "notes" ? "slides" : "notes"),
    },
    present: {
      start: () => startPresenting(false),
      rehearse: () => startPresenting(true),
      stop: stopPresenting,
      next: () => movePresentIndex(1),
      previous: () => movePresentIndex(-1),
      toggleNotes: togglePresenterNotes,
      toggleBlackout: () => setPresentBlackout((value) => !value),
      togglePointer: () => setPointerVisible((value) => !value),
      setLayout: (layout) =>
        setPresentLayout(layout === "speaker" ? "speaker" : "audience"),
    },
    sources: {
      open: () => openInspector("sources"),
      addCitation: () => openInspector("sources"),
      buildBibliography: buildBibliographySlide,
    },
    view: {
      toggleRail: () => setSlideRailPreference(slideRailOpen ? "closed" : "open"),
      toggleInspector: () =>
        setInspectorPreference(inspectorOpen ? "closed" : "open"),
      openFiles: () => openInspector("files"),
    },
  };

  const workbarActions = presentationCommandBindings(presentationHandlers);

  // Which contextual tab the selection opens. The bar and the one execute path
  // read the same value, so a Shape refusal cannot differ between them.
  //
  // With an object selected the subject is that object, so Shape is raised. With
  // nothing selected the subject is the slide itself, and the slide-level thing
  // a person changes is how it arrives — so Transition is raised, carrying its
  // kind and length beside the rows that say what PowerPoint already saved here.
  // Raising it only for slides that *already* have a transition would be a trap:
  // the control that sets the first one would live on a tab that appears only
  // after the first one is set.
  const selectionContext = selectedObject ? "Shape" : "Transition";
  /**
   * The one execute path (C1). Every surface reaches a verb by its command id —
   * the bar, the inspector, the rail, the canvas, the presenter — so the
   * availability a person reads in the bar is the availability that actually
   * governs the write. A control that calls a handler directly would be a
   * second path, and in a strict-native deck it would happily write where the
   * bar says it must not.
   */
  const commandCtx = commandContext(
    "presentation",
    contract.can,
    contract.role,
    selectionContext,
    {
      compatibilityProfile: contract.compatibilityProfile,
      fidelity: contract.fidelity,
      artifactId,
    },
    contract.executeApplicationCommand,
    { ids: layerSelection.length ? layerSelection : selectedObject ? [selectedObject.id] : [] },
  );
  function commandById(id: string) {
    const index = workbarActions.findIndex((binding) => binding.id === id);
    if (index < 0) return undefined;
    return commandForBinding("presentation", workbarActions[index]!, index);
  }
  /** Run a command by id. Returns false when the registry refuses it. */
  function runCommand(id: string, params?: CommandParam) {
    const command = commandById(id);
    if (!command) return false;
    return executeCommand(command, commandCtx, params);
  }
  runCommandRef.current = runCommand;
  /** Why a surface is refusing, in the registry's own words. */
  function commandRefusal(id: string) {
    const availability = commandById(id)?.availability(commandCtx);
    if (!availability || availability.state === "enabled") return undefined;
    return availability.state === "disabled" ? availability.reason : undefined;
  }
  const commandBlocked = (id: string) => commandRefusal(id) !== undefined;

  return (
    <section
      ref={studioRef}
      className="presentation-studio"
      // A selected object is let go of before Escape closes the deck.
      data-escape-claim={!readOnly && surface === "slides" && selectedObjectId ? "" : undefined}
    >
      <ArtifactWorkbar
        label="Presentation"
        selectionContext={selectionContext}
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
                count={railSlides.length}
                collapsed={!slideRailOpen}
                onToggleCollapsed={() =>
                  setSlideRailPreference(slideRailOpen ? "closed" : "open")
                }
                tools={
                  searchOpen ? (
                    <div className="presentation-rail-find">
                      <Search className="h-3.5 w-3.5" aria-hidden="true" />
                      <input
                        type="search"
                        value={searchQuery}
                        autoFocus
                        placeholder="Find in deck"
                        aria-label="Find in deck"
                        onChange={(event) => setSearchQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape") return;
                          setSearchOpen(false);
                          setSearchQuery("");
                        }}
                      />
                      <span aria-live="polite">
                        {searchQuery.trim()
                          ? `${searchMatches.length} of ${deck.slides.length}`
                          : `${deck.slides.length} slides`}
                      </span>
                      <button
                        type="button"
                        aria-label="Close find"
                        onClick={() => {
                          setSearchOpen(false);
                          setSearchQuery("");
                        }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : undefined
                }
                items={railSlides.map((slide) => ({
                  id: slide.id,
                  title: presentationSlideLabel(
                    slide,
                    deck.slides.indexOf(slide),
                  ),
                  subtitle: [
                    slide.hidden ? "Hidden in Present" : undefined,
                    slide.speakerNotes ? "Has speaker notes" : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined,
                  active: slide.id === activeSlide.id,
                  preview: (
                    <StillSlide
                      className="spectra-item-rail-preview"
                      slide={slide}
                      deck={deck}
                      assets={assets}
                      artifacts={artifacts}
                    />
                  ),
                }))}
                onSelect={selectSlide}
                onAdd={
                  readOnly || commandBlocked("slide.add")
                    ? undefined
                    : () => runCommand("slide.add")
                }
                addLabel="Add slide"
                canEdit={!readOnly}
                draggingId={draggingSlideId}
                onDragStart={setDraggingSlideId}
                onDragEnd={() => setDraggingSlideId(undefined)}
                onMove={(from, to) => {
                  // The rail can be filtered by a find, so a drop maps through
                  // the list a person is actually looking at.
                  const moved = railSlides[from];
                  const target = railSlides[to];
                  if (moved && target) {
                    setActiveSlideId(moved.id);
                    moveSlideBefore(target.id);
                  }
                }}
              />
            ) : null}
            <div
              className="presentation-stage"
              // Focus rests here when Escape steps out of a text box, so the
              // next key still belongs to this deck.
              tabIndex={-1}
              data-zoomed={stageZoom !== 1 || undefined}
              style={
                {
                  "--presentation-stage-zoom": stageZoom,
                  // The slide is fitted to the stage by height as well as
                  // width, so the whole page is always in view.
                  "--presentation-ratio":
                    deck.settings?.aspectRatio === "4:3" ? 4 / 3 : 16 / 9,
                } as CSSProperties
              }
            >
              <SlideCanvas
                slide={activeSlide}
                deck={deck}
                assets={assets}
                artifacts={artifacts}
                selectedObjectId={selectedObjectId}
                selectedObjectIds={layerSelection}
                guides={guides}
                showSlideNumber
                showGrid={showGrid}
                showGuides={showGuides}
                aiChangedPaths={aiChangedPaths}
                readOnly={readOnly}
                onSelectObject={(id, additive) => selectObject(id, additive)}
                onPointerDown={beginDrag}
                onResizePointerDown={beginResize}
                onPointerMove={moveDrag}
                onPointerUp={finishDrag}
                onTextChange={updateTextParagraphs}
                onTextFocus={beginText}
                onTextBlur={finishTyping}
                focusTextId={freshTextId}
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
                    <LocalAutocompleteTextarea
                      surface="slide_text"
                      value={activeSlide.speakerNotes ?? ""}
                      readOnly={readOnly}
                      aria-label={`Speaker notes for slide ${activeSlideIndex + 1}`}
                      {...targetAttrs(
                        `/slides/${activeSlideIndex}/speakerNotes`,
                      )}
                      placeholder="No speaker notes"
                      className="presentation-notes-field"
                      onFocus={() => {
                        beginTyping();
                        onActiveRegionChange?.(`${activeSlide.id}:notes`);
                      }}
                      onBlur={finishTyping}
                      // Through the command, not around it (C1). The panel and
                      // the bar then agree by construction: when a linked deck
                      // has no notes page the field is read-only and says why,
                      // instead of taking a note the file cannot hold.
                      onValueChange={(speakerNotes) =>
                        runCommand("notes.set", speakerNotes)
                      }
                      textareaClassName="w-full"
                    />
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
                        <GatedSelect
                          label="Layout"
                          size="sm"
                          className="mt-3"
                          value={activeSlide.layoutId ?? "title-content"}
                          disabled={readOnly}
                          refusal={commandRefusal("design.applyLayout")}
                          options={LAYOUT_OPTIONS}
                          onChange={(layoutId) =>
                            runCommand("design.applyLayout", layoutId)
                          }
                        />
                        <GatedSelect
                          label="Transition"
                          size="sm"
                          className="mt-3"
                          value={activeSlide.transition?.kind ?? "none"}
                          disabled={readOnly}
                          refusal={commandRefusal("animate.transition")}
                          options={TRANSITION_OPTIONS}
                          onChange={(kind) =>
                            runCommand("animate.transition", kind)
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
                              <GatedSelect
                                label="Text style"
                                size="sm"
                                className="mt-3"
                                value={selectedTextPreset ?? "body"}
                                disabled={readOnly}
                                refusal={commandRefusal("format.textPreset")}
                                options={TEXT_PRESET_OPTIONS}
                                onChange={(preset) =>
                                  runCommand("format.textPreset", preset)
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
                              run={runCommand}
                              refusalFor={commandRefusal}
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
                            onClick={() => chooseMedia("image")}
                          >
                            <ImagePlus className="h-3.5 w-3.5" />{" "}
                            {assetBusy ? "Uploading" : "Image"}
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
                      <PresentationDesigner
                        deck={deck}
                        slideIndex={activeSlideIndex}
                        readOnly={readOnly || commandBlocked("design.applyLayout")}
                        preview={(slide) => (
                          <StillSlide
                            className="presentation-designer-still"
                            slide={slide}
                            deck={deck}
                            assets={assets}
                            artifacts={artifacts}
                          />
                        )}
                        onApply={applyDesign}
                        onApplyDeck={applyDeckDesign}
                      />
                      <section>
                        <h4>Theme</h4>
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
                              disabled={
                                readOnly || commandBlocked("design.applyTheme")
                              }
                              title={commandRefusal("design.applyTheme")}
                              onClick={() =>
                                runCommand("design.applyTheme", theme.id)
                              }
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
                        {commandRefusal("design.applyTheme") ? (
                          <p className="presentation-refusal" role="note">
                            {commandRefusal("design.applyTheme")}
                          </p>
                        ) : null}
                      </section>
                      <section>
                        <h4>Deck format</h4>
                        <GatedSelect
                          label="Aspect ratio"
                          size="sm"
                          className="mt-3"
                          value={deck.settings?.aspectRatio ?? "16:9"}
                          disabled={readOnly}
                          refusal={commandRefusal("design.slideSize")}
                          options={ASPECT_RATIO_OPTIONS}
                          onChange={(aspectRatio) =>
                            runCommand("design.slideSize", aspectRatio)
                          }
                        />
                        <GatedSelect
                          label="Default transition"
                          size="sm"
                          className="mt-3"
                          value={deck.settings?.defaultTransition ?? "none"}
                          disabled={readOnly}
                          refusal={commandRefusal("animate.defaultTransition")}
                          options={TRANSITION_OPTIONS}
                          onChange={(defaultTransition) =>
                            runCommand(
                              "animate.defaultTransition",
                              defaultTransition,
                            )
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
                            disabled={
                              readOnly || commandBlocked("animate.autoAdvance")
                            }
                            onChange={(event) =>
                              runCommand(
                                "animate.autoAdvance",
                                Math.max(
                                  0,
                                  Math.min(3_600, Number(event.target.value)),
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="presentation-check mt-3">
                          <input
                            type="checkbox"
                            checked={deck.settings?.showSlideNumbers !== false}
                            disabled={
                              readOnly || commandBlocked("design.slideNumbers")
                            }
                            onChange={() => runCommand("design.slideNumbers")}
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
                                <ImportOriginal
                                  className="presentation-import-original"
                                  entry={entry}
                                  downloadUrl={entry.downloadUrl}
                                  onView={setViewingOriginal}
                                />
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
                  <StillSlide
                    slide={slide}
                    deck={deck}
                    assets={assets}
                    artifacts={artifacts}
                  />
                  <strong className="truncate text-caption font-semibold text-[var(--text-primary)]">
                    {index + 1} · {presentationSlideLabel(slide, index)}
                  </strong>
                </button>
                <label className="grid min-w-0 gap-1.5">
                  <span className="text-micro font-semibold text-[var(--text-secondary)]">
                    Speaker notes
                  </span>
                  <LocalAutocompleteTextarea
                    surface="slide_text"
                    value={slide.speakerNotes ?? ""}
                    // Per slide, because a deck can have a notes page for one
                    // slide and none for the next. This surface writes to the
                    // slide in the row rather than the active one, so it reads
                    // that slide's own honesty flag.
                    readOnly={readOnly}
                    {...targetAttrs(`/slides/${index}/speakerNotes`)}
                    placeholder="No speaker notes"
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
      {rehearsal && !presentedDeck && typeof document !== "undefined" ? (
        <PresentationRehearsalReport
          report={rehearsal}
          targetMs={deck.settings?.autoAdvanceSeconds ? deck.settings.autoAdvanceSeconds * 1_000 : undefined}
          preview={(slide) => (
            <StillSlide className="presentation-rehearsal-still" slide={slide} deck={deck} assets={assets} artifacts={artifacts} />
          )}
          onClose={() => setRehearsal(undefined)}
          onRehearseAgain={() => {
            setRehearsal(undefined);
            startPresenting(true);
          }}
        />
      ) : null}
      {presentedDeck && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={presenterRef}
              tabIndex={-1}
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
              onMouseMove={(event) => {
                revealPresentChrome();
                if (!pointerVisible) return;
                const frame = event.currentTarget.getBoundingClientRect();
                setPointerAt({
                  x: ((event.clientX - frame.left) / frame.width) * 100,
                  y: ((event.clientY - frame.top) / frame.height) * 100,
                });
              }}
            >
              <header>
                <span>
                  <Clock3 className="h-4 w-4" /> {formatElapsed}
                  <span title="Time on this slide">
                    · slide {durationLabel(slideElapsed)}
                  </span>
                  {rehearsalMode ? " · Rehearsal" : ""}
                </span>
                <strong>{presentationSlideLabel(presentedDeck.slides[presentIndex]!, presentIndex)}</strong>
                <span className="presentation-presenter-actions">
                  <button
                    type="button"
                    aria-pressed={presentLayout === "audience"}
                    onClick={() => runCommand("present.layout", "audience")}
                    title="Audience: the slide fills this screen"
                  >
                    <MonitorPlay className="h-4 w-4" />
                    Audience
                  </button>
                  <button
                    type="button"
                    aria-pressed={presentLayout === "speaker"}
                    onClick={() => {
                      runCommand("present.layout", "speaker");
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
                    onClick={() => runCommand("present.toggleNotes")}
                    title="Show or hide speaker notes. Shortcut: S"
                  >
                    <StickyNote className="h-4 w-4" />
                    Notes
                  </button>
                  <button
                    type="button"
                    aria-pressed={pointerVisible}
                    onClick={() => runCommand("present.pointer")}
                    title="Laser pointer: follows your cursor on this screen"
                  >
                    <MousePointer2 className="h-4 w-4" />
                    Laser
                  </button>
                  <button
                    type="button"
                    onClick={() => runCommand("present.blackout")}
                    title="Black the screen. Shortcut: B"
                  >
                    <MonitorOff className="h-4 w-4" />
                    Black
                  </button>
                  <button
                    type="button"
                    onClick={() => runCommand("present.stop")}
                  >
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
                              "No speaker notes"}
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
              {/* The laser follows the presenter's own cursor. It is drawn over
                  the run and never recorded, which is why the command that
                  turns it on declares no undo. */}
              {pointerVisible && pointerAt && !presentBlackout ? (
                <span
                  className="presentation-laser"
                  aria-hidden="true"
                  style={{ left: `${pointerAt.x}%`, top: `${pointerAt.y}%` }}
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}
      <FileViewer file={viewingOriginal} onClose={() => setViewingOriginal(null)} />
    </section>
  );
}
