import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  Boxes,
  BringToFront,
  Clock3,
  Contrast,
  Copy,
  Crop,
  Droplet,
  EyeOff,
  FileArchive,
  Film,
  Frame,
  Group as GroupIcon,
  ImagePlus,
  Layers3,
  LayoutGrid,
  LayoutTemplate,
  Link2,
  ListTree,
  Lock,
  Magnet,
  Maximize2,
  MonitorOff,
  MonitorPlay,
  MousePointer2,
  MoveHorizontal,
  MoveVertical,
  PaintBucket,
  Palette,
  PenLine,
  Play,
  Plus,
  Quote,
  RefreshCw,
  RotateCw,
  Ruler,
  ScanText,
  SendToBack,
  Shapes,
  Sigma,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  SquareStack,
  StickyNote,
  Table2,
  Trash2,
  Type,
  Ungroup,
} from "lucide-react";
import {
  PRESENTATION_EXPORT_COPIES,
  PRESENTATION_STRICT_REASONS,
  projectBindingsFromIr,
} from "../../capabilities";
import { PRESENTATION_LAYOUT_OPTIONS } from "../../presentation/layouts";
import type { CommandBinding, CommandControlOption, CommandParam, FidelityRegionKey } from "../types";
import {
  commentsBinding,
  exportBindings,
  findBindings,
  historyBindings,
  importBinding,
  printBinding,
  textFormatBindings,
  zoomBindings,
  type CommentsAdapter,
  type ExportAdapter,
  type FindAdapter,
  type HistoryAdapter,
  type ImportAdapter,
  type TextFormatAdapter,
  type ZoomAdapter,
} from "../shared";

export { PRESENTATION_STRICT_REASONS };

/**
 * The Presentation command set.
 *
 * Everything a person can do to a deck is declared here once, as data. The
 * studio supplies the implementations and its live state; this module owns the
 * ids, the tabs, the groups, the order, the priorities, the shortcuts, the
 * native regions each command writes, and the AI operations each one answers
 * for. Nothing here imports React, so the capability matrix can enumerate the
 * whole surface without mounting an editor.
 *
 * Two rules shaped the file:
 *
 * 1. One id, one execute. The inspector, a canvas gesture, the thumbnail rail,
 *    a shortcut, the presenter chrome and the AI dispatcher all reach the deck
 *    through the same binding. The inspector is an alternate *host* for a
 *    command, never a second implementation of it.
 * 2. Honest availability. A control that cannot be written into a linked
 *    PowerPoint file says so, in a sentence naming the reason, instead of
 *    pretending. That is declared as `touches` — compared against the deck's
 *    live fidelity map — or as `strictNative`, and it is declared here so the
 *    bar, the shortcut and the AI offer refuse identically.
 */

/* ------------------------------------------------------------ vocabularies */

/** The transitions Spectra models. Only Fade has a plausible OOXML mapping. */
export const PRESENTATION_TRANSITIONS: readonly CommandControlOption[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "push", label: "Push" },
  { value: "dissolve", label: "Dissolve" },
];

export const PRESENTATION_OBJECT_ANIMATIONS: readonly CommandControlOption[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade in" },
  { value: "rise", label: "Rise" },
  { value: "scale", label: "Scale up" },
  { value: "wipe", label: "Wipe" },
];

export const PRESENTATION_LAYOUTS: readonly CommandControlOption[] =
  PRESENTATION_LAYOUT_OPTIONS;

export const PRESENTATION_TEXT_PRESETS: readonly CommandControlOption[] = [
  { value: "title", label: "Title" },
  { value: "subtitle", label: "Subtitle" },
  { value: "body", label: "Body" },
  { value: "caption", label: "Caption" },
];

/**
 * The shape library. Every entry is drawn by the stage from a CSS clip path, so
 * what the menu promises is what the slide renders.
 */
export const PRESENTATION_SHAPES: readonly CommandControlOption[] = [
  { value: "rounded-rectangle", label: "Rounded rectangle" },
  { value: "rectangle", label: "Rectangle" },
  { value: "ellipse", label: "Ellipse" },
  { value: "pill", label: "Pill" },
  { value: "triangle", label: "Triangle" },
  { value: "diamond", label: "Diamond" },
  { value: "chevron", label: "Chevron" },
  { value: "arrow-right", label: "Arrow" },
  { value: "callout", label: "Speech callout" },
  { value: "line", label: "Line" },
];

export const PRESENTATION_IMAGE_FITS: readonly CommandControlOption[] = [
  { value: "contain", label: "Fit inside" },
  { value: "cover", label: "Crop to fill" },
];

/** The alignment operations `arrange.align` performs, in reading order. */
export const PRESENTATION_ALIGNMENTS: readonly CommandControlOption[] = [
  { value: "left", label: "Align left", icon: AlignStartVertical },
  { value: "center", label: "Align centre", icon: AlignCenterVertical },
  { value: "right", label: "Align right", icon: AlignEndVertical },
  { value: "top", label: "Align top", icon: AlignStartHorizontal },
  { value: "middle", label: "Align middle", icon: AlignCenterHorizontal },
  { value: "bottom", label: "Align bottom", icon: AlignEndHorizontal },
];

export const PRESENTATION_DISTRIBUTIONS: readonly CommandControlOption[] = [
  {
    value: "distribute-x",
    label: "Space evenly across",
    icon: AlignHorizontalDistributeCenter,
  },
  {
    value: "distribute-y",
    label: "Space evenly down",
    icon: AlignVerticalDistributeCenter,
  },
];

export const PRESENTATION_IMAGE_MASKS: readonly CommandControlOption[] = [
  { value: "none", label: "Square corners" },
  { value: "rounded", label: "Rounded" },
  { value: "circle", label: "Circle" },
];

export const PRESENTATION_ASPECT_RATIOS: readonly CommandControlOption[] = [
  { value: "16:9", label: "16:9" },
  { value: "4:3", label: "4:3" },
];

/** Slide fills that stay legible under every theme's body ink. */
export const PRESENTATION_BACKGROUNDS: readonly string[] = [
  "var(--bg-elevated)",
  "var(--bg-primary)",
  "#f5f7fb",
  "#f7f5fb",
  "#f6f8f6",
  "var(--accent-mint)",
  "#173252",
  "#452b54",
  "#272924",
  "#0f1115",
];

export const PRESENTATION_SHAPE_FILLS: readonly string[] = [
  "color-mix(in oklab, var(--accent-mint) 16%, var(--bg-elevated))",
  "#d1e9ff",
  "#e9d7fe",
  "#fef0c7",
  "#fee4e2",
  "#f2f4f7",
  "var(--bg-elevated)",
  "var(--accent-mint)",
  "#3538cd",
  "#101828",
];

export const PRESENTATION_SHAPE_STROKES: readonly string[] = [
  "var(--accent-mint)",
  "#84caff",
  "#b692f6",
  "#fdb022",
  "#fda29b",
  "#98a2b3",
  "#d0d5dd",
  "#2f9a72",
  "#3278bf",
  "#344054",
];

export type PresentationAlignMode =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom"
  | "distribute-x"
  | "distribute-y";

export type PresentationOrderMode = "forward" | "backward" | "front" | "back";

export type PresentationGeometryKey = "x" | "y" | "width" | "height" | "rotation";

/**
 * Operations with no command, on purpose.
 *
 * `apply_master` is the assistant's name for rewriting a deck's slide masters.
 * Spectra reads masters and never writes them — that is what keeps `masters`
 * PRESERVED and what lets a linked PowerPoint file come back out of Spectra
 * with its branding intact. So there is no button for it and there should not
 * be one, and this declares that on the record rather than leaving a hole the
 * audit has to guess about.
 */
export const PRESENTATION_CAPABILITY_DEFERRALS = [
  {
    operation: "apply_master",
    reason:
      "Spectra never rewrites a deck's slide masters: they are preserved exactly as the file has them, so its branding survives a round trip. Use Design to change the theme, which restyles the slides without touching the master.",
  },
] as const;

const SHAPES: readonly FidelityRegionKey[] = ["shapes"];

/* --------------------------------------------------------------- the state */

export type PresentationSelectionState = {
  /** The single focused object, when there is exactly one. */
  objectId?: string;
  objectType?: string;
  /** How many objects are selected on this slide. */
  count: number;
  locked: boolean;
  hidden: boolean;
  isGroup: boolean;
  isPlaceholder: boolean;
  hasText: boolean;
  hasAltText: boolean;
  /** Set when the object came from a PowerPoint shape in the linked file. */
  nativeShapeId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill?: string | null;
  stroke?: string | null;
  strokeWidth: number;
  cornerRadius: number;
  opacity: number;
  shadow: boolean;
  imageFit: string;
  imageMask: string;
  focalX: number;
  focalY: number;
  animationKind: string;
  animationDurationMs: number;
  animationDelayMs: number;
  textPreset?: string;
  /** Charts and embeds carry a source; plain shapes do not. */
  bindable: boolean;
  sourceLive: boolean;
};

export type PresentationCommandState = {
  slideCount: number;
  slideIndex: number;
  slideHidden: boolean;
  layoutId: string;
  sectionId?: string;
  sections: readonly CommandControlOption[];
  themeId: string;
  themes: readonly CommandControlOption[];
  background?: string;
  aspectRatio: string;
  transitionKind: string;
  transitionDurationMs: number;
  defaultTransition: string;
  autoAdvanceSeconds: number;
  showSlideNumbers: boolean;
  /** The linked slide already carries a transition Spectra must not replace. */
  transitionPreserved: boolean;
  animationsPreserved: boolean;
  snapToObjects: boolean;
  showGrid: boolean;
  showGuides: boolean;
  railOpen: boolean;
  inspectorOpen: boolean;
  notesSurface: boolean;
  notesPanelOpen: boolean;
  presenting: boolean;
  rehearsing: boolean;
  presenterNotesVisible: boolean;
  blackout: boolean;
  pointerVisible: boolean;
  presenterLayout: string;
  presentIndex: number;
  components: readonly CommandControlOption[];
  citationCount: number;
  hasBibliography: boolean;
  mediaBusy: boolean;
  selection: PresentationSelectionState;
};

/* ------------------------------------------------------------ the handlers */

/**
 * Every operation the deck exposes, grouped by the thing it acts on rather than
 * by where it happens to appear in the bar. Placement is this module's
 * business; behaviour is the studio's.
 */
export type PresentationHandlers = {
  state: PresentationCommandState;
  history: HistoryAdapter;
  /** Omitted by a host with no search surface, so no dead Find appears. */
  find?: FindAdapter;
  textFormat: TextFormatAdapter;
  exporter: ExportAdapter;
  importer: ImportAdapter;
  print: () => void;
  zoom: ZoomAdapter;
  comments?: CommentsAdapter;
  slide: {
    add: () => void;
    duplicate: () => void;
    remove: () => void;
    moveEarlier: () => void;
    moveLater: () => void;
    setTitle: (title: string) => void;
    toggleHidden: () => void;
    setSection: (sectionId: string) => void;
    addSection: () => void;
  };
  insert: {
    textBox: () => void;
    placeholderText: () => void;
    shape: (shape: string) => void;
    image: () => void;
    video: () => void;
    chart: () => void;
    table: () => void;
    embed: () => void;
    component: (componentId: string) => void;
  };
  design: {
    open: () => void;
    applyLayout: (layoutId: string) => void;
    resetPlaceholders: () => void;
    applyTheme: (themeId: string) => void;
    setBackground: (background: string | null) => void;
    setAspectRatio: (ratio: string) => void;
    toggleSlideNumbers: () => void;
    saveComponent: () => void;
    audit: () => void;
  };
  arrange: {
    align: (mode: PresentationAlignMode) => void;
    order: (mode: PresentationOrderMode) => void;
    group: () => void;
    ungroup: () => void;
    toggleLock: () => void;
    toggleHidden: () => void;
    remove: () => void;
    toggleSnap: () => void;
    toggleGrid: () => void;
    toggleGuides: () => void;
    openReadingOrder: () => void;
    setGeometry: (key: PresentationGeometryKey, value: number) => void;
  };
  object: {
    setText: (text: string) => void;
    setLink: (value: string | null) => void;
    applyTextPreset: (preset: string) => void;
    setFill: (color: string | null) => void;
    setStroke: (color: string | null) => void;
    setStrokeWidth: (width: number) => void;
    setCornerRadius: (radius: number) => void;
    setOpacity: (opacity: number) => void;
    toggleShadow: () => void;
    setAltText: (altText: string) => void;
    setImageFit: (fit: string) => void;
    setImageMask: (mask: string) => void;
    setFocal: (axis: "x" | "y", value: number) => void;
    replaceImage: () => void;
    bindSource: (artifactId: string | null) => void;
    toggleSourceLive: () => void;
    refreshChart: () => void;
    setAnimation: (kind: string) => void;
    setAnimationDuration: (durationMs: number) => void;
    setAnimationDelay: (delayMs: number) => void;
  };
  transition: {
    set: (kind: string) => void;
    setDuration: (durationMs: number) => void;
    applyToAll: () => void;
    setDefault: (kind: string) => void;
    setAutoAdvance: (seconds: number) => void;
  };
  notes: {
    set: (notes: string) => void;
    togglePanel: () => void;
    toggleSurface: () => void;
  };
  present: {
    start: () => void;
    rehearse: () => void;
    stop: () => void;
    next: () => void;
    previous: () => void;
    toggleNotes: () => void;
    toggleBlackout: () => void;
    togglePointer: () => void;
    setLayout: (layout: string) => void;
  };
  sources: {
    open: () => void;
    addCitation: () => void;
    buildBibliography: () => void;
  };
  view: {
    toggleRail: () => void;
    toggleInspector: () => void;
    openFiles: () => void;
  };
};

/* ----------------------------------------------------------------- helpers */

function numberParam(value: CommandParam, fallback: number) {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function stringParam(value: CommandParam) {
  return typeof value === "string" ? value : undefined;
}

/**
 * Moves a shared family onto the Shape tab.
 *
 * The shared modules were written for a `Format` tab, which a deck does not
 * have: a deck formats the *selected shape*, so the family belongs on the
 * contextual Shape tab and appears the moment something is selected. Ids and
 * behaviour and capability truth are untouched — only placement changes.
 */
function onShapeTab(bindings: CommandBinding[]): CommandBinding[] {
  return bindings.map((binding) => ({
    ...binding,
    tab: undefined,
    contextualTab: "Shape",
    general: false,
  }));
}

/**
 * The stage-zoom family, with the two overflow entries given a sentence.
 *
 * The shared module hints with a live percentage, which reads well beside a
 * visible zoom control and says nothing in the `⋯` menu, where the label is all
 * a person gets. Reset and Fit are the two that land there, so they explain
 * themselves. Ids, behaviour and the percentage hints are untouched.
 */
function zoomFamily(adapter: ZoomAdapter): CommandBinding[] {
  const sentences: Record<string, string> = {
    "view.zoom.reset": "Back to 100%, one slide unit to one pixel of the stage",
    "view.zoom.fit": "Sizes the slide so the whole of it is on screen",
  };
  return zoomBindings(adapter).map((binding) =>
    sentences[binding.id] ? { ...binding, hint: sentences[binding.id] } : binding,
  );
}

/**
 * The five numeric geometry fields, built from one shape so that X, Y, width,
 * height and rotation cannot drift apart in wording or in gating.
 */
function geometryBindings(
  handlers: PresentationHandlers,
  single: boolean,
): CommandBinding[] {
  const selection = handlers.state.selection;
  const fields: ReadonlyArray<{
    key: PresentationGeometryKey;
    label: string;
    icon: typeof MoveHorizontal;
    min: number;
    max: number;
    value: number;
    op?: string;
  }> = [
    // The assistant's `move_object` and `resize_object` route through the
    // position and size fields. Only one field claims each operation, because
    // one operation may have exactly one command: Y and Height are the same
    // verb on the other axis, and claiming it twice would make the audit read
    // two implementations where there is one.
    { key: "x", label: "X", icon: MoveHorizontal, min: -500, max: 1500, value: selection.x, op: "move_object" },
    { key: "y", label: "Y", icon: MoveVertical, min: -500, max: 1500, value: selection.y },
    { key: "width", label: "Width", icon: MoveHorizontal, min: 10, max: 1000, value: selection.width, op: "resize_object" },
    { key: "height", label: "Height", icon: MoveVertical, min: 10, max: 1000, value: selection.height },
    { key: "rotation", label: "Rotation", icon: RotateCw, min: -360, max: 360, value: selection.rotation },
  ];
  return fields.map((field) => ({
    id: `arrange.geometry.${field.key}`,
    label: field.label,
    icon: field.icon,
    contextualTab: "Shape",
    group: "Geometry",
    priority: "secondary" as const,
    requires: "edit" as const,
    disabled: !single || (selection.locked && field.key !== "rotation"),
    hint:
      selection.locked && field.key !== "rotation"
        ? "This object is locked"
        : `${field.label} on the slide's own scale`,
    touches: SHAPES,
    ...(field.op ? { manifestOps: [field.op] } : {}),
    control: {
      kind: "numeric" as const,
      value: Math.round(field.value),
      min: field.min,
      max: field.max,
      step: 5,
      suffix: field.key === "rotation" ? "deg" : undefined,
    },
    onSelect: (value?: CommandParam) =>
      handlers.arrange.setGeometry(field.key, numberParam(value, field.value)),
  }));
}

/* ---------------------------------------------------------------- bindings */

export function presentationCommandBindings(
  handlers: PresentationHandlers,
): CommandBinding[] {
  const state = handlers.state;
  const selection = state.selection;
  /** Exactly one object is focused: the precondition for every object command. */
  const single = Boolean(selection.objectId);
  const multiple = selection.count >= 2;
  const spread = selection.count >= 3;
  const isText = selection.objectType === "text";
  const isImage = selection.objectType === "image" || selection.objectType === "video";
  const shaped = selection.objectType === "shape" || selection.objectType === "text";

  return projectBindingsFromIr("presentation", [
    /* ------------------------------------------------- General · History */
    ...historyBindings(handlers.history),

    /* -------------------------------------------------- General · Slides */
    {
      id: "slide.add",
      label: "Add slide",
      icon: Plus,
      priority: "essential",
      general: true,
      group: "Slides",
      requires: "edit",
      shortcut: "Mod+Enter",
      hint: "Adds a slide after this one",
      touches: ["slides"],
      manifestOps: ["add_slide", "create_outline"],
      onSelect: () => handlers.slide.add(),
    },
    {
      id: "slide.duplicate",
      label: "Duplicate slide",
      icon: Copy,
      priority: "secondary",
      general: true,
      group: "Slides",
      requires: "edit",
      hint: "Copies this slide, its objects and its notes",
      touches: ["slides"],
      onSelect: () => handlers.slide.duplicate(),
    },

    /* --------------------------------------------------- General · Design */
    {
      id: "design.open",
      label: "Design",
      icon: Palette,
      priority: "secondary",
      general: true,
      group: "Design",
      hint: "Theme, background and slide size for the whole deck",
      undo: "none(explain)",
      onSelect: () => handlers.design.open(),
    },

    /* -------------------------------------------------- General · Present */
    {
      id: "present.start",
      label: "Present",
      icon: Play,
      priority: "essential",
      general: true,
      group: "Present",
      requires: "present",
      keepLabel: true,
      hint: "Full screen from this slide. Escape brings you back here.",
      undo: "none(explain)",
      manifestOps: ["prepare_presenter_output"],
      onSelect: () => handlers.present.start(),
    },

    /* ---------------------------------------------------- General · Find */
    ...(handlers.find ? findBindings(handlers.find) : []),

    /* ---------------------------------------------------- General · View */
    ...zoomFamily(handlers.zoom),
    ...(handlers.comments ? [commentsBinding(handlers.comments)] : []),

    {
      id: "slide.moveEarlier",
      tab: "General",
      label: "Move slide earlier",
      icon: ArrowUp,
      priority: "secondary",
      group: "Slides",
      requires: "edit",
      disabled: state.slideIndex <= 0,
      hint:
        state.slideIndex <= 0
          ? "This is already the first slide"
          : "Swaps this slide with the one before it",
      touches: ["slides"],
      onSelect: () => handlers.slide.moveEarlier(),
    },
    {
      id: "slide.moveLater",
      tab: "General",
      label: "Move slide later",
      icon: ArrowDown,
      priority: "secondary",
      group: "Slides",
      requires: "edit",
      disabled: state.slideIndex >= state.slideCount - 1,
      hint:
        state.slideIndex >= state.slideCount - 1
          ? "This is already the last slide"
          : "Swaps this slide with the one after it",
      touches: ["slides"],
      onSelect: () => handlers.slide.moveLater(),
    },
    {
      id: "slide.hide",
      tab: "General",
      label: state.slideHidden ? "Show this slide" : "Hide this slide",
      icon: EyeOff,
      priority: "advanced",
      group: "Slides",
      requires: "edit",
      active: state.slideHidden,
      hint: "A hidden slide stays in the deck and is skipped while presenting, including in linked PowerPoint files.",
      onSelect: () => handlers.slide.toggleHidden(),
    },
    {
      id: "slide.delete",
      tab: "General",
      label: "Delete slide",
      icon: Trash2,
      priority: "advanced",
      group: "Slides",
      requires: "edit",
      disabled: state.slideCount <= 1,
      risk: "destructive",
      hint:
        state.slideCount <= 1
          ? "A deck keeps at least one slide"
          : "Removes this slide, its objects and its notes",
      touches: ["slides"],
      onSelect: () => handlers.slide.remove(),
    },
    {
      id: "slide.setTitle",
      tab: "General",
      label: "Slide title",
      icon: ScanText,
      priority: "advanced",
      group: "Slides",
      requires: "edit",
      hint: "The title placeholder on this slide",
      touches: ["slides"],
      onSelect: (value) => {
        const title = stringParam(value);
        if (title !== undefined) handlers.slide.setTitle(title);
      },
    },

    /* ------------------------------------------------------------- Insert */
    {
      id: "insert.textBox",
      label: "Text box",
      icon: Type,
      tab: "Insert",
      group: "Text",
      priority: "essential",
      requires: "edit",
      hint: "A new text frame on this slide",
      touches: SHAPES,
      manifestOps: ["create_object"],
      onSelect: () => handlers.insert.textBox(),
    },
    {
      id: "insert.placeholderText",
      label: "Fill the empty placeholder",
      icon: Type,
      tab: "Insert",
      group: "Text",
      priority: "secondary",
      requires: "edit",
      disabled: !single || state.selection.hasText,
      hint: !single
        ? "Select an empty placeholder first"
        : state.selection.hasText
          ? "This placeholder already has text"
          : "Writes prompt text into the selected placeholder",
      touches: SHAPES,
      manifestOps: ["rewrite_object"],
      onSelect: () => handlers.insert.placeholderText(),
    },
    {
      id: "insert.shape",
      label: "Shape",
      icon: Shapes,
      tab: "Insert",
      group: "Shapes",
      priority: "essential",
      requires: "edit",
      hint: "Pick a shape from the library",
      touches: SHAPES,
      manifestOps: ["create_object"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.newShape },
      control: { kind: "menu", options: PRESENTATION_SHAPES },
      onSelect: (value) =>
        handlers.insert.shape(stringParam(value) ?? "rounded-rectangle"),
    },
    {
      id: "insert.image",
      label: "Image",
      icon: ImagePlus,
      tab: "Insert",
      group: "Media",
      priority: "essential",
      requires: "edit",
      disabled: state.mediaBusy,
      hint: state.mediaBusy ? "Still uploading media" : "Place a picture on this slide",
      touches: ["media", "images"],
      manifestOps: ["create_object"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.newMedia },
      onSelect: () => handlers.insert.image(),
    },
    {
      id: "insert.video",
      label: "Video",
      icon: Film,
      tab: "Insert",
      group: "Media",
      priority: "secondary",
      requires: "edit",
      disabled: state.mediaBusy,
      hint: "Plays inline on the slide and while presenting",
      touches: ["media"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.newMedia },
      onSelect: () => handlers.insert.video(),
    },
    {
      id: "insert.chart",
      label: "Chart",
      icon: BarChart3,
      tab: "Insert",
      group: "Data",
      priority: "essential",
      requires: "edit",
      hint: "A chart you can bind to a Sheets range",
      touches: ["charts"],
      manifestOps: ["generate_chart"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.newChart },
      onSelect: () => handlers.insert.chart(),
    },
    {
      id: "insert.table",
      label: "Table",
      icon: Table2,
      tab: "Insert",
      group: "Data",
      priority: "secondary",
      requires: "edit",
      hint: "A simple grid on the slide",
      touches: ["tables"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.newTable },
      onSelect: () => handlers.insert.table(),
    },
    {
      id: "insert.embed",
      label: "Linked work",
      icon: Link2,
      tab: "Insert",
      group: "Links",
      priority: "secondary",
      requires: "edit",
      hint: "Show another Spectra work live on this slide",
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.embed },
      onSelect: () => handlers.insert.embed(),
    },
    {
      id: "insert.equation",
      label: "Equation",
      icon: Sigma,
      tab: "Insert",
      group: "Content",
      priority: "advanced",
      requires: "edit",
      disabled: true,
      hint: "Spectra does not set equations on slides yet. Equations already in a PowerPoint deck are preserved exactly as saved.",
      touches: ["equations"],
      onSelect: noop,
    },
    {
      id: "insert.component",
      label: "Reusable component",
      icon: Boxes,
      tab: "Insert",
      group: "Components",
      priority: "advanced",
      requires: "edit",
      disabled: state.components.length === 0,
      hint: state.components.length
        ? "Insert a saved object, keeping its own scene identity"
        : "Save an object as a component first",
      touches: SHAPES,
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.component },
      control: { kind: "menu", options: state.components },
      onSelect: (value) => {
        const id = stringParam(value);
        if (id) handlers.insert.component(id);
      },
    },

    /* ------------------------------------------------------------- Design */
    {
      id: "design.applyLayout",
      label: "Layout",
      icon: LayoutTemplate,
      tab: "Design",
      group: "Layout",
      priority: "essential",
      requires: "edit",
      hint: "Rearranges this slide into a layout, keeping its content",
      touches: ["layouts"],
      manifestOps: ["apply_layout"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.layout },
      control: {
        kind: "select",
        options: PRESENTATION_LAYOUTS,
        value: state.layoutId,
        width: "10.5rem",
      },
      onSelect: (value) => {
        const layoutId = stringParam(value);
        if (layoutId) handlers.design.applyLayout(layoutId);
      },
    },
    {
      id: "design.resetPlaceholders",
      label: "Reset placeholders",
      icon: RotateCw,
      tab: "Design",
      group: "Layout",
      priority: "secondary",
      requires: "edit",
      hint: "Returns this slide's objects to the positions and sizes its layout gives them",
      touches: ["layouts"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.layout },
      onSelect: () => handlers.design.resetPlaceholders(),
    },
    {
      id: "design.applyTheme",
      label: "Theme",
      icon: Palette,
      tab: "Design",
      group: "Theme",
      priority: "essential",
      requires: "edit",
      hint: "Colour and type for every slide in the deck",
      touches: ["slides"],
      manifestOps: ["apply_theme"],
      control: {
        kind: "select",
        options: state.themes,
        value: state.themeId,
        width: "9.5rem",
      },
      onSelect: (value) => {
        const themeId = stringParam(value);
        if (themeId) handlers.design.applyTheme(themeId);
      },
    },
    {
      id: "design.background",
      label: "Slide background",
      icon: PaintBucket,
      tab: "Design",
      group: "Theme",
      priority: "essential",
      requires: "edit",
      hint: "Fills this one slide behind its objects",
      touches: ["slides"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.background },
      control: {
        kind: "color",
        value: state.background,
        swatches: PRESENTATION_BACKGROUNDS,
        clearLabel: "Theme background",
      },
      onSelect: (value) => handlers.design.setBackground(stringParam(value) ?? null),
    },
    {
      id: "design.slideSize",
      label: "Slide size",
      icon: Maximize2,
      tab: "Design",
      group: "Format",
      priority: "secondary",
      requires: "edit",
      hint: "The shape of every slide in the deck",
      touches: ["slides"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.slideSize },
      control: {
        kind: "segmented",
        options: PRESENTATION_ASPECT_RATIOS,
        value: state.aspectRatio,
      },
      onSelect: (value) => {
        const ratio = stringParam(value);
        if (ratio) handlers.design.setAspectRatio(ratio);
      },
    },
    {
      id: "design.slideNumbers",
      label: "Slide numbers",
      icon: SquareStack,
      tab: "Design",
      group: "Format",
      priority: "secondary",
      requires: "edit",
      active: state.showSlideNumbers,
      hint: "Draws the slide number in the deck's own ink. Spectra holds this, so a linked file keeps its own number placeholders exactly as they are.",
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.slideNumbers },
      onSelect: () => handlers.design.toggleSlideNumbers(),
    },
    {
      id: "slide.section",
      label: "Section",
      icon: ListTree,
      tab: "Design",
      group: "Structure",
      priority: "secondary",
      requires: "edit",
      hint: "Groups slides under a named section in the rail",
      touches: ["sections"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.sections },
      control: {
        kind: "select",
        options: [
          { value: "", label: "No section" },
          ...state.sections,
          { value: "__new__", label: "New section" },
        ],
        value: state.sectionId ?? "",
        width: "9rem",
      },
      onSelect: (value) => {
        const id = stringParam(value) ?? "";
        if (id === "__new__") handlers.slide.addSection();
        else handlers.slide.setSection(id);
      },
    },
    {
      id: "design.saveComponent",
      label: "Save as component",
      icon: Boxes,
      tab: "Design",
      group: "Structure",
      priority: "advanced",
      requires: "edit",
      disabled: !single,
      hint: single
        ? "Adds the selected object to this deck's component library"
        : "Select an object first",
      onSelect: () => handlers.design.saveComponent(),
    },
    {
      id: "design.audit",
      label: "Check this deck",
      icon: Contrast,
      tab: "Design",
      group: "Review",
      priority: "secondary",
      hint: "Reads every slide for overflowing text, weak contrast, missing alt text, reading order and uncited claims",
      undo: "none(explain)",
      manifestOps: [
        "inspect_deck",
        "plan_narrative",
        "check_overflow",
        "check_contrast",
        "check_reading_order",
        "check_source_coverage",
      ],
      onSelect: () => handlers.design.audit(),
    },
    {
      id: "sources.open",
      label: "Sources",
      icon: BookOpen,
      tab: "Design",
      group: "Sources",
      priority: "secondary",
      hint: "The citations attached to this slide",
      undo: "none(explain)",
      onSelect: () => handlers.sources.open(),
    },
    {
      id: "sources.addCitation",
      label: "Add citation",
      icon: Quote,
      tab: "Design",
      group: "Sources",
      priority: "advanced",
      requires: "edit",
      hint: "Attaches a source to this slide",
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.citations },
      onSelect: () => handlers.sources.addCitation(),
    },
    {
      id: "sources.buildBibliography",
      label: state.hasBibliography ? "Update references slide" : "Build references slide",
      icon: BookOpen,
      tab: "Design",
      group: "Sources",
      priority: "advanced",
      requires: "edit",
      disabled: state.citationCount === 0,
      hint: state.citationCount
        ? `Collects ${state.citationCount} ${state.citationCount === 1 ? "citation" : "citations"} onto a references slide`
        : "Add a citation first",
      touches: ["slides"],
      manifestOps: ["build_bibliography"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.citations },
      onSelect: () => handlers.sources.buildBibliography(),
    },

    /* ------------------------------------------------------------ Arrange */
    {
      id: "arrange.align",
      label: "Align",
      icon: AlignCenterVertical,
      tab: "Arrange",
      group: "Align",
      priority: "essential",
      requires: "edit",
      disabled: !multiple,
      hint: multiple
        ? "Lines the selected objects up on one edge"
        : "Shift-click a second object to align",
      touches: SHAPES,
      manifestOps: ["move_object"],
      control: { kind: "menu", options: PRESENTATION_ALIGNMENTS },
      onSelect: (value) => {
        const mode = stringParam(value);
        if (mode) handlers.arrange.align(mode as PresentationAlignMode);
      },
    },
    {
      id: "arrange.distribute",
      label: "Distribute",
      icon: AlignHorizontalDistributeCenter,
      tab: "Arrange",
      group: "Align",
      priority: "essential",
      requires: "edit",
      disabled: !spread,
      hint: spread
        ? "Even gaps between the selected objects"
        : "Select three or more objects to distribute",
      touches: SHAPES,
      manifestOps: ["move_object"],
      control: { kind: "menu", options: PRESENTATION_DISTRIBUTIONS },
      onSelect: (value) => {
        const mode = stringParam(value);
        if (mode) handlers.arrange.align(mode as PresentationAlignMode);
      },
    },
    {
      id: "arrange.group",
      label: "Group",
      icon: GroupIcon,
      tab: "Arrange",
      group: "Group",
      priority: "essential",
      requires: "edit",
      disabled: !multiple,
      shortcut: "Mod+G",
      hint: multiple
        ? "Moves and scales these objects as one"
        : "Select two or more objects to group them",
      touches: SHAPES,
      onSelect: () => handlers.arrange.group(),
    },
    {
      id: "arrange.ungroup",
      label: "Ungroup",
      icon: Ungroup,
      tab: "Arrange",
      group: "Group",
      priority: "secondary",
      requires: "edit",
      disabled: !selection.isGroup,
      shortcut: "Mod+Shift+G",
      hint: selection.isGroup
        ? "Releases the objects in this group"
        : "Select a group to release it",
      touches: SHAPES,
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.group },
      onSelect: () => handlers.arrange.ungroup(),
    },
    {
      id: "arrange.bringForward",
      label: "Bring forward",
      icon: BringToFront,
      tab: "Arrange",
      group: "Order",
      priority: "essential",
      requires: "edit",
      disabled: !single,
      hint: "One step up the stack, and up the reading order with it",
      touches: SHAPES,
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.order },
      onSelect: () => handlers.arrange.order("forward"),
    },
    {
      id: "arrange.sendBackward",
      label: "Send backward",
      icon: SendToBack,
      tab: "Arrange",
      group: "Order",
      priority: "essential",
      requires: "edit",
      disabled: !single,
      hint: "One step down the stack",
      touches: SHAPES,
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.order },
      onSelect: () => handlers.arrange.order("backward"),
    },
    {
      id: "arrange.bringToFront",
      label: "Bring to front",
      icon: BringToFront,
      tab: "Arrange",
      group: "Order",
      priority: "secondary",
      requires: "edit",
      disabled: !single,
      hint: single
        ? "Puts this object above everything else on the slide"
        : "Select an object to change its stacking order",
      touches: SHAPES,
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.order },
      onSelect: () => handlers.arrange.order("front"),
    },
    {
      id: "arrange.sendToBack",
      label: "Send to back",
      icon: SendToBack,
      tab: "Arrange",
      group: "Order",
      priority: "secondary",
      requires: "edit",
      disabled: !single,
      hint: single
        ? "Puts this object behind everything else on the slide"
        : "Select an object to change its stacking order",
      touches: SHAPES,
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.order },
      onSelect: () => handlers.arrange.order("back"),
    },
    {
      id: "accessibility.readingOrder",
      label: "Reading order",
      icon: ListTree,
      tab: "Arrange",
      group: "Order",
      priority: "secondary",
      hint: "The order a screen reader announces this slide in, which is the stacking order",
      undo: "none(explain)",
      manifestOps: ["check_reading_order"],
      onSelect: () => handlers.arrange.openReadingOrder(),
    },
    {
      // A stage aid, not an object operation. The id says `stage` because that
      // is what it changes and because an `arrange.*` id is read as belonging to
      // the selection-contextual Shape tab — which would leave the grid and the
      // guides unreachable with nothing selected, exactly when a person is
      // placing the first object on a slide.
      id: "stage.snap",
      label: "Snap to objects",
      icon: Magnet,
      tab: "Arrange",
      group: "Guides",
      priority: "essential",
      active: state.snapToObjects,
      hint: "Dragging aligns to slide centres and to the other objects",
      undo: "none(explain)",
      onSelect: () => handlers.arrange.toggleSnap(),
    },
    {
      id: "stage.guides",
      label: "Guides",
      icon: Ruler,
      tab: "Arrange",
      group: "Guides",
      priority: "secondary",
      active: state.showGuides,
      hint: "Centre and third guides across the stage",
      undo: "none(explain)",
      onSelect: () => handlers.arrange.toggleGuides(),
    },
    {
      id: "stage.grid",
      label: "Grid",
      icon: LayoutGrid,
      tab: "Arrange",
      group: "Guides",
      priority: "secondary",
      active: state.showGrid,
      hint: "A light grid behind the slide while you work",
      undo: "none(explain)",
      onSelect: () => handlers.arrange.toggleGrid(),
    },

    /* ------------------------------------------------------------ Animate */
    // Kind and length are declared `contextualTab: "Transition"` rather than
    // `tab: "Animate"`. Appendix B puts exactly those two on the contextual
    // Transition tab, next to the rows that explain what PowerPoint saved, so a
    // person reads "this is preserved" and "this is what you can change" in one
    // place. They are reachable whenever no object is selected — the slide is
    // then the subject — so a deck with no transition yet can still get one.
    {
      id: "animate.transition",
      label: "Transition",
      icon: Sparkles,
      contextualTab: "Transition",
      group: "Transitions",
      priority: "essential",
      requires: "edit",
      hint: state.transitionPreserved
        ? "This slide carries a PowerPoint transition that Spectra preserves rather than rewrites"
        : "How this slide arrives",
      touches: ["transitions"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.transition },
      control: {
        kind: "select",
        options: PRESENTATION_TRANSITIONS,
        value: state.transitionKind,
        width: "8.5rem",
      },
      onSelect: (value) => {
        const kind = stringParam(value);
        if (kind) handlers.transition.set(kind);
      },
    },
    {
      id: "animate.transitionDuration",
      label: "Transition length",
      icon: Clock3,
      contextualTab: "Transition",
      group: "Transitions",
      priority: "secondary",
      requires: "edit",
      disabled: state.transitionKind === "none",
      hint:
        state.transitionKind === "none"
          ? "Choose a transition first"
          : "Milliseconds",
      touches: ["transitions"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.transition },
      control: {
        kind: "numeric",
        value: state.transitionDurationMs,
        min: 0,
        max: 4000,
        step: 50,
        suffix: "ms",
        presets: [200, 350, 500, 720, 1000],
      },
      onSelect: (value) =>
        handlers.transition.setDuration(numberParam(value, state.transitionDurationMs)),
    },
    {
      id: "animate.transitionApplyAll",
      label: "Apply transition to every slide",
      icon: SquareStack,
      tab: "Animate",
      group: "Transitions",
      priority: "secondary",
      requires: "edit",
      hint: "Gives every slide this slide's transition and length",
      touches: ["transitions"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.transition },
      onSelect: () => handlers.transition.applyToAll(),
    },
    {
      id: "animate.defaultTransition",
      label: "New slide transition",
      icon: Sparkles,
      tab: "Animate",
      group: "Transitions",
      priority: "advanced",
      requires: "edit",
      hint: "What a slide added later starts with",
      touches: ["transitions"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.transition },
      control: {
        kind: "select",
        options: PRESENTATION_TRANSITIONS,
        value: state.defaultTransition,
        width: "8.5rem",
      },
      onSelect: (value) => {
        const kind = stringParam(value);
        if (kind) handlers.transition.setDefault(kind);
      },
    },
    {
      id: "animate.autoAdvance",
      label: "Auto-advance",
      icon: Clock3,
      tab: "Animate",
      group: "Timing",
      priority: "advanced",
      requires: "edit",
      hint: "Seconds before the deck moves on by itself. Zero waits for you.",
      touches: ["transitions"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.autoAdvance },
      control: {
        kind: "numeric",
        value: state.autoAdvanceSeconds,
        min: 0,
        max: 3600,
        step: 5,
        suffix: "s",
        presets: [0, 15, 30, 45, 60],
      },
      onSelect: (value) =>
        handlers.transition.setAutoAdvance(numberParam(value, state.autoAdvanceSeconds)),
    },
    {
      id: "animate.object",
      label: "Object animation",
      icon: Sparkles,
      tab: "Animate",
      group: "Emphasis",
      priority: "essential",
      requires: "edit",
      disabled: !single,
      hint: single
        ? "How the selected object arrives on the slide"
        : "Select an object to animate it",
      touches: ["animations"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.animation },
      control: {
        kind: "select",
        options: PRESENTATION_OBJECT_ANIMATIONS,
        value: selection.animationKind,
        width: "8.5rem",
      },
      onSelect: (value) => {
        const kind = stringParam(value);
        if (kind) handlers.object.setAnimation(kind);
      },
    },
    {
      id: "animate.objectDuration",
      label: "Animation length",
      icon: Clock3,
      tab: "Animate",
      group: "Emphasis",
      priority: "secondary",
      requires: "edit",
      disabled: !single || selection.animationKind === "none",
      hint:
        selection.animationKind === "none"
          ? "Give the object an animation first"
          : "How long the animation runs, in milliseconds",
      touches: ["animations"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.animation },
      control: {
        kind: "numeric",
        value: selection.animationDurationMs,
        min: 0,
        max: 10000,
        step: 50,
        suffix: "ms",
        presets: [200, 350, 450, 700, 1000],
      },
      onSelect: (value) =>
        handlers.object.setAnimationDuration(
          numberParam(value, selection.animationDurationMs),
        ),
    },
    {
      id: "animate.objectDelay",
      label: "Animation delay",
      icon: Clock3,
      tab: "Animate",
      group: "Emphasis",
      priority: "secondary",
      requires: "edit",
      disabled: !single || selection.animationKind === "none",
      hint: "Milliseconds after the slide arrives",
      touches: ["animations"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.animation },
      control: {
        kind: "numeric",
        value: selection.animationDelayMs,
        min: 0,
        max: 30000,
        step: 50,
        suffix: "ms",
        presets: [0, 150, 300, 600, 1000],
      },
      onSelect: (value) =>
        handlers.object.setAnimationDelay(numberParam(value, selection.animationDelayMs)),
    },

    /* ------------------------------------------------------------ Present */
    {
      id: "present.rehearse",
      label: "Rehearse timings",
      icon: Clock3,
      tab: "Present",
      group: "Start",
      priority: "essential",
      requires: "present",
      hint: "A private run that records how long you spend on each slide",
      undo: "none(explain)",
      manifestOps: ["prepare_presenter_output"],
      onSelect: () => handlers.present.rehearse(),
    },
    {
      id: "present.stop",
      label: "Stop presenting",
      icon: MonitorOff,
      tab: "Present",
      group: "Start",
      priority: "secondary",
      disabled: !state.presenting,
      shortcut: "Escape",
      hint: state.presenting
        ? "Leaves full screen on the slide you ended on"
        : "Available while you are presenting",
      undo: "none(explain)",
      onSelect: () => handlers.present.stop(),
    },
    {
      id: "view.notesPage",
      label: state.notesSurface ? "Back to the slides" : "Speaker notes page",
      icon: StickyNote,
      tab: "Present",
      group: "Notes",
      priority: "essential",
      active: state.notesSurface,
      hint: "Every slide's notes on one page, ready to read from",
      // A surface switch, not a write. Declaring `speakerNotes` here would make
      // the assistant refuse notes edits in a deck whose notes are preserved,
      // for a command that changes only what this screen is showing.
      undo: "none(explain)",
      onSelect: () => handlers.notes.toggleSurface(),
    },
    {
      id: "notes.panel",
      label: state.notesPanelOpen ? "Hide notes panel" : "Notes for this slide",
      icon: StickyNote,
      tab: "Present",
      group: "Notes",
      priority: "secondary",
      active: state.notesPanelOpen,
      hint: "The notes drawer under the stage",
      // Opening a drawer writes nothing, so it claims no region. `notes.set` is
      // the command that actually writes a note.
      undo: "none(explain)",
      onSelect: () => handlers.notes.togglePanel(),
    },
    {
      id: "notes.set",
      label: "Speaker notes",
      icon: StickyNote,
      tab: "Present",
      group: "Notes",
      priority: "advanced",
      requires: "edit",
      hint: "What you will say on this slide",
      touches: ["speakerNotes"],
      manifestOps: ["write_speaker_notes"],
      onSelect: (value) => {
        const notes = stringParam(value);
        if (notes === undefined) handlers.notes.togglePanel();
        else handlers.notes.set(notes);
      },
    },
    {
      id: "present.layout",
      label: "Presenter view",
      icon: Layers3,
      tab: "Present",
      group: "Presenter",
      priority: "essential",
      hint: "Audience fills the screen; Speaker adds the next slide, your notes and the clock",
      undo: "none(explain)",
      control: {
        kind: "segmented",
        value: state.presenterLayout,
        options: [
          { value: "audience", label: "Audience", icon: MonitorPlay },
          { value: "speaker", label: "Speaker", icon: Layers3 },
        ],
      },
      onSelect: (value) => {
        const layout = stringParam(value);
        if (layout) handlers.present.setLayout(layout);
      },
    },
    {
      id: "present.toggleNotes",
      label: "Presenter notes",
      icon: StickyNote,
      tab: "Present",
      group: "Presenter",
      priority: "secondary",
      active: state.presenterNotesVisible,
      shortcut: "S",
      hint: "A preference on this machine, not a change to the deck",
      undo: "none(explain)",
      onSelect: () => handlers.present.toggleNotes(),
    },
    {
      id: "present.blackout",
      label: "Black the screen",
      icon: MonitorOff,
      tab: "Present",
      group: "Presenter",
      priority: "secondary",
      active: state.blackout,
      disabled: !state.presenting,
      shortcut: "B",
      hint: state.presenting
        ? "Holds the room. Any key brings the slide back."
        : "Available while you are presenting",
      undo: "none(explain)",
      onSelect: () => handlers.present.toggleBlackout(),
    },
    {
      id: "present.pointer",
      label: "Pointer",
      icon: MousePointer2,
      tab: "Present",
      group: "Presenter",
      priority: "secondary",
      active: state.pointerVisible,
      disabled: !state.presenting,
      shortcut: "P",
      hint: state.presenting
        ? "A soft spotlight follows the cursor on the presented slide"
        : "Available while you are presenting",
      undo: "none(explain)",
      onSelect: () => handlers.present.togglePointer(),
    },
    {
      id: "present.next",
      label: "Next slide",
      icon: SkipForward,
      tab: "Present",
      group: "Presenter",
      priority: "advanced",
      disabled: !state.presenting || state.presentIndex >= state.slideCount - 1,
      hint: state.presenting
        ? "Moves the presented deck on one slide"
        : "Available while you are presenting",
      undo: "none(explain)",
      onSelect: () => handlers.present.next(),
    },
    {
      id: "present.previous",
      label: "Previous slide",
      icon: SkipBack,
      tab: "Present",
      group: "Presenter",
      priority: "advanced",
      disabled: !state.presenting || state.presentIndex <= 0,
      hint: state.presenting
        ? "Steps the presented deck back one slide"
        : "Available while you are presenting",
      undo: "none(explain)",
      onSelect: () => handlers.present.previous(),
    },

    /* ------------------------------------------------- Shape · Text */
    ...onShapeTab(textFormatBindings("presentation", handlers.textFormat)),
    {
      id: "format.textPreset",
      label: "Text style",
      icon: Type,
      contextualTab: "Shape",
      group: "Styles",
      priority: "essential",
      requires: "edit",
      disabled: !isText,
      hint: isText
        ? "Title, subtitle, body or caption, in the deck's own type scale"
        : "Select a text object",
      touches: SHAPES,
      control: {
        kind: "select",
        options: PRESENTATION_TEXT_PRESETS,
        value: selection.textPreset,
        placeholder: "Style",
        width: "8rem",
      },
      onSelect: (value) => {
        const preset = stringParam(value);
        if (preset) handlers.object.applyTextPreset(preset);
      },
    },
    {
      id: "object.setText",
      label: "Object text",
      icon: Type,
      contextualTab: "Shape",
      group: "Styles",
      priority: "advanced",
      requires: "edit",
      disabled: !single || selection.locked,
      hint: "The words inside the selected shape",
      touches: SHAPES,
      manifestOps: ["rewrite_object"],
      onSelect: (value) => {
        const text = stringParam(value);
        if (text !== undefined) handlers.object.setText(text);
      },
    },
    {
      id: "object.setLink",
      label: "Object link",
      icon: Link2,
      contextualTab: "Shape",
      group: "Styles",
      priority: "advanced",
      requires: "edit",
      disabled: !single || selection.locked,
      hint: "Set an external URL, or an internal target as slide:<slide-id>",
      touches: ["hyperlinks"],
      manifestOps: ["rewrite_object"],
      onSelect: (value) => {
        const link = stringParam(value);
        if (link !== undefined) handlers.object.setLink(link || null);
      },
    },
    {
      id: "object.removeLink",
      label: "Remove object link",
      icon: Link2,
      contextualTab: "Shape",
      group: "Styles",
      priority: "advanced",
      requires: "edit",
      disabled: !single || selection.locked,
      hint: "Remove the selected object's native hyperlink",
      touches: ["hyperlinks"],
      manifestOps: ["rewrite_object"],
      onSelect: () => handlers.object.setLink(null),
    },

    /* ------------------------------------------------ Shape · Appearance */
    {
      id: "format.fill",
      label: "Fill",
      icon: PaintBucket,
      contextualTab: "Shape",
      group: "Shape",
      priority: "essential",
      requires: "edit",
      disabled: !shaped,
      hint: shaped ? "The selected shape's fill" : "Select a shape or text box",
      touches: SHAPES,
      control: {
        kind: "color",
        value: selection.fill ?? undefined,
        swatches: PRESENTATION_SHAPE_FILLS,
        clearLabel: "No fill",
      },
      onSelect: (value) => handlers.object.setFill(stringParam(value) ?? null),
    },
    {
      id: "format.border",
      label: "Border",
      icon: PenLine,
      contextualTab: "Shape",
      group: "Shape",
      priority: "essential",
      requires: "edit",
      disabled: !shaped,
      hint: shaped ? "A line around the selected shape" : "Select a shape or text box",
      touches: SHAPES,
      control: {
        kind: "color",
        value: selection.stroke ?? undefined,
        swatches: PRESENTATION_SHAPE_STROKES,
        clearLabel: "No border",
      },
      onSelect: (value) => handlers.object.setStroke(stringParam(value) ?? null),
    },
    {
      id: "format.borderWidth",
      label: "Border width",
      icon: PenLine,
      contextualTab: "Shape",
      group: "Shape",
      priority: "secondary",
      requires: "edit",
      disabled: !shaped || !selection.stroke,
      hint: selection.stroke ? "Pixels at slide scale" : "Give the shape a border first",
      touches: SHAPES,
      control: {
        kind: "numeric",
        value: selection.strokeWidth,
        min: 0,
        max: 24,
        step: 1,
        presets: [0, 1, 2, 3, 4, 6],
      },
      onSelect: (value) =>
        handlers.object.setStrokeWidth(numberParam(value, selection.strokeWidth)),
    },
    {
      id: "format.cornerRadius",
      label: "Corner radius",
      icon: Frame,
      contextualTab: "Shape",
      group: "Shape",
      priority: "secondary",
      requires: "edit",
      disabled: !shaped,
      hint: shaped ? "How round the shape's corners are" : "Select a shape or text box",
      touches: SHAPES,
      control: {
        kind: "numeric",
        value: selection.cornerRadius,
        min: 0,
        max: 120,
        step: 2,
        presets: [0, 8, 16, 24, 48],
      },
      onSelect: (value) =>
        handlers.object.setCornerRadius(numberParam(value, selection.cornerRadius)),
    },
    {
      id: "format.opacity",
      label: "Opacity",
      icon: Droplet,
      contextualTab: "Shape",
      group: "Shape",
      priority: "secondary",
      requires: "edit",
      disabled: !single,
      hint: single ? "How solid the object is" : "Select an object first",
      touches: SHAPES,
      control: {
        kind: "numeric",
        value: selection.opacity,
        min: 10,
        max: 100,
        step: 5,
        suffix: "%",
        presets: [25, 50, 75, 100],
      },
      onSelect: (value) => handlers.object.setOpacity(numberParam(value, selection.opacity)),
    },
    {
      id: "format.shadow",
      label: "Soft shadow",
      icon: Droplet,
      contextualTab: "Shape",
      group: "Shape",
      priority: "secondary",
      requires: "edit",
      disabled: !single,
      active: selection.shadow,
      hint: "Lifts the object off the slide a little",
      touches: SHAPES,
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.shapeStyle },
      onSelect: () => handlers.object.toggleShadow(),
    },

    /* -------------------------------------------------- Shape · Geometry */
    ...geometryBindings(handlers, single),
    {
      id: "arrange.lock",
      label: selection.locked ? "Unlock object" : "Lock object",
      icon: Lock,
      contextualTab: "Shape",
      group: "Geometry",
      priority: "secondary",
      requires: "edit",
      disabled: !single,
      active: selection.locked,
      hint: "A locked object cannot be dragged or resized on the stage",
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.objectState },
      onSelect: () => handlers.arrange.toggleLock(),
    },
    {
      id: "arrange.hideObject",
      label: selection.hidden ? "Show while presenting" : "Hide while presenting",
      icon: EyeOff,
      contextualTab: "Shape",
      group: "Geometry",
      priority: "advanced",
      requires: "edit",
      disabled: !single,
      active: selection.hidden,
      hint: "Keeps the object on the slide but out of the presented view",
      onSelect: () => handlers.arrange.toggleHidden(),
    },
    {
      id: "arrange.delete",
      label: "Delete object",
      icon: Trash2,
      contextualTab: "Shape",
      group: "Geometry",
      priority: "secondary",
      requires: "edit",
      disabled: !single,
      shortcut: "Delete",
      risk: "destructive",
      hint: single
        ? "Removes the selected object from this slide"
        : "Select an object first",
      touches: SHAPES,
      onSelect: () => handlers.arrange.remove(),
    },

    /* ----------------------------------------------------- Shape · Image */
    {
      id: "image.fit",
      label: "Image fit",
      icon: Crop,
      contextualTab: "Shape",
      group: "Image",
      priority: "essential",
      requires: "edit",
      disabled: !isImage,
      hint: isImage ? "Fit the whole picture, or crop it to fill" : "Select a picture",
      touches: ["images"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.crop },
      control: {
        kind: "segmented",
        options: PRESENTATION_IMAGE_FITS,
        value: selection.imageFit,
      },
      onSelect: (value) => {
        const fit = stringParam(value);
        if (fit) handlers.object.setImageFit(fit);
      },
    },
    {
      id: "image.mask",
      label: "Image shape",
      icon: Frame,
      contextualTab: "Shape",
      group: "Image",
      priority: "secondary",
      requires: "edit",
      disabled: !isImage,
      hint: isImage ? "Square, rounded or circular" : "Select a picture",
      touches: ["images"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.crop },
      control: {
        kind: "menu",
        options: PRESENTATION_IMAGE_MASKS,
        value: selection.imageMask,
      },
      onSelect: (value) => {
        const mask = stringParam(value);
        if (mask) handlers.object.setImageMask(mask);
      },
    },
    {
      id: "image.cropX",
      label: "Crop across",
      icon: MoveHorizontal,
      contextualTab: "Shape",
      group: "Image",
      priority: "secondary",
      requires: "edit",
      disabled: !isImage || selection.imageFit !== "cover",
      hint:
        selection.imageFit === "cover"
          ? "Which part of the picture stays visible"
          : "Crop to fill first",
      touches: ["images"],
      // Focal-point changes are translated into native a:srcRect crop
      // percentages by the PPTX projection writer.
      control: {
        kind: "numeric",
        value: selection.focalX,
        min: 0,
        max: 100,
        step: 5,
        suffix: "%",
        presets: [0, 25, 50, 75, 100],
      },
      onSelect: (value) => handlers.object.setFocal("x", numberParam(value, selection.focalX)),
    },
    {
      id: "image.cropY",
      label: "Crop down",
      icon: MoveVertical,
      contextualTab: "Shape",
      group: "Image",
      priority: "secondary",
      requires: "edit",
      disabled: !isImage || selection.imageFit !== "cover",
      hint:
        selection.imageFit === "cover"
          ? "Which part of the picture stays visible top to bottom"
          : "Crop to fill first",
      touches: ["images"],
      control: {
        kind: "numeric",
        value: selection.focalY,
        min: 0,
        max: 100,
        step: 5,
        suffix: "%",
        presets: [0, 25, 50, 75, 100],
      },
      onSelect: (value) => handlers.object.setFocal("y", numberParam(value, selection.focalY)),
    },
    {
      id: "image.replace",
      label: "Replace picture",
      icon: ImagePlus,
      contextualTab: "Shape",
      group: "Image",
      priority: "secondary",
      requires: "edit",
      disabled: !isImage || state.mediaBusy,
      hint: "Keeps this object's position, size and alt text",
      touches: ["media", "images"],
      strictNative: { available: false, reason: PRESENTATION_STRICT_REASONS.newMedia },
      onSelect: () => handlers.object.replaceImage(),
    },

    /* --------------------------------------------- Shape · Accessibility */
    {
      id: "accessibility.altText",
      label: "Alternative text",
      icon: ScanText,
      contextualTab: "Shape",
      group: "Accessibility",
      priority: "essential",
      requires: "edit",
      disabled: !single,
      active: selection.hasAltText,
      hint: !single
        ? "Select an object to describe it"
        : selection.hasAltText
          ? "This object has a description"
          : "This object has no description yet",
      touches: SHAPES,
      // The lens writes `cNvPr/@descr` natively, so this is a real native write
      // and the assistant has to be able to reach it by the same name a person
      // does. Without the claim the capability audit reads the operation as
      // ai-only: something the assistant can ask for that no control performs.
      manifestOps: ["describe_object"],
      onSelect: (value) => {
        const altText = stringParam(value);
        if (altText === undefined) handlers.view.toggleInspector();
        else handlers.object.setAltText(altText);
      },
    },

    /* ------------------------------------------------------ Shape · Data */
    {
      id: "data.bindSource",
      label: "Linked source",
      icon: Link2,
      contextualTab: "Shape",
      group: "Data",
      priority: "secondary",
      requires: "edit",
      disabled: !selection.bindable,
      hint: selection.bindable
        ? "Bind this object to another Spectra work, so the slide follows the numbers"
        : "Charts and linked works carry a source",
      touches: ["charts"],
      onSelect: (value) => handlers.object.bindSource(stringParam(value) ?? null),
    },
    {
      id: "data.live",
      label: selection.sourceLive ? "Pin the current values" : "Follow the source live",
      icon: RefreshCw,
      contextualTab: "Shape",
      group: "Data",
      priority: "secondary",
      requires: "edit",
      disabled: !selection.bindable,
      active: selection.sourceLive,
      hint: "A pinned chart keeps the numbers it had when you pinned it",
      touches: ["charts"],
      onSelect: () => handlers.object.toggleSourceLive(),
    },
    {
      id: "data.refreshChart",
      label: "Refresh chart data",
      icon: RefreshCw,
      contextualTab: "Shape",
      group: "Data",
      priority: "advanced",
      requires: "edit",
      disabled: !selection.bindable,
      hint: selection.bindable
        ? "Reads the source again and redraws the chart"
        : "Charts and linked works carry a source",
      touches: ["charts"],
      manifestOps: ["generate_chart"],
      onSelect: () => handlers.object.refreshChart(),
    },

    /* ------------------------------------------- Transition (contextual) */
    {
      id: "transition.native",
      label: "PowerPoint transition",
      icon: Sparkles,
      contextualTab: "Transition",
      group: "Native",
      priority: "essential",
      disabled: true,
      hint: state.transitionPreserved
        ? "PowerPoint saved this slide's transition. Spectra keeps its XML exactly, including the effect and the timing, and does not rewrite it."
        : "This slide has no PowerPoint transition to preserve.",
      touches: ["transitions"],
      undo: "none(explain)",
      onSelect: noop,
    },
    {
      id: "transition.nativeTiming",
      label: "PowerPoint animation timing",
      icon: Clock3,
      contextualTab: "Transition",
      group: "Native",
      priority: "essential",
      disabled: true,
      hint: state.animationsPreserved
        ? "This slide has PowerPoint animation timing. Spectra preserves the whole timing tree rather than approximating it."
        : "This slide has no PowerPoint animation timing to preserve.",
      touches: ["animations"],
      undo: "none(explain)",
      onSelect: noop,
    },

    /* --------------------------------------------------- General · Files */
    {
      id: "files.open",
      tab: "General",
      label: "Import and export",
      icon: FileArchive,
      priority: "advanced",
      group: "Export",
      hint: "The original file stays private and recoverable",
      undo: "none(explain)",
      onSelect: () => handlers.view.openFiles(),
    },
    {
      id: "view.slidePreviews",
      tab: "General",
      label: state.railOpen ? "Hide slide previews" : "Show slide previews",
      icon: LayoutTemplate,
      priority: "secondary",
      group: "View",
      active: state.railOpen,
      hint: "The thumbnail rail beside the stage",
      undo: "none(explain)",
      onSelect: () => handlers.view.toggleRail(),
    },
    {
      id: "view.inspector",
      tab: "General",
      label: state.inspectorOpen ? "Hide inspector" : "Show inspector",
      icon: SlidersHorizontal,
      priority: "secondary",
      group: "View",
      active: state.inspectorOpen,
      hint: "Slide, objects, design, sources and files",
      undo: "none(explain)",
      onSelect: () => handlers.view.toggleInspector(),
    },
    ...exportBindings(handlers.exporter),
    printBinding(handlers.print, "deck"),
    importBinding(handlers.importer),
  ]);
}

/* -------------------------------------------------------------- the stub */

const noop = () => undefined;

/**
 * A neutral, exhaustive set of handlers. The capability matrix builds the whole
 * command surface from this with no live deck, so every handler exists and
 * every state field has a defined value: a missing one would silently shrink
 * the surface the matrix believes exists.
 */
export function presentationStubHandlers(
  /**
   * State overrides, so a test can ask what the bar says about a *particular*
   * deck — one with no notes page, one whose transition PowerPoint preserved —
   * without standing up a studio. Everything not named keeps the neutral value.
   */
  state?: Partial<PresentationCommandState>,
): PresentationHandlers {
  return {
    state: {
      slideCount: 1,
      slideIndex: 0,
      slideHidden: false,
      layoutId: "title-content",
      sections: [],
      themeId: "spectra-botanical",
      themes: [{ value: "spectra-botanical", label: "Botanical" }],
      aspectRatio: "16:9",
      transitionKind: "none",
      transitionDurationMs: 350,
      defaultTransition: "none",
      autoAdvanceSeconds: 0,
      showSlideNumbers: true,
      transitionPreserved: false,
      animationsPreserved: false,
      snapToObjects: true,
      showGrid: false,
      showGuides: false,
      railOpen: true,
      inspectorOpen: false,
      notesSurface: false,
      notesPanelOpen: false,
      presenting: false,
      rehearsing: false,
      presenterNotesVisible: true,
      blackout: false,
      pointerVisible: false,
      presenterLayout: "audience",
      presentIndex: 0,
      components: [],
      citationCount: 0,
      hasBibliography: false,
      mediaBusy: false,
      selection: {
        count: 0,
        locked: false,
        hidden: false,
        isGroup: false,
        isPlaceholder: false,
        hasText: false,
        hasAltText: false,
        x: 0,
        y: 0,
        width: 400,
        height: 220,
        rotation: 0,
        fill: null,
        stroke: null,
        strokeWidth: 1,
        cornerRadius: 24,
        opacity: 100,
        shadow: false,
        imageFit: "contain",
        imageMask: "none",
        focalX: 50,
        focalY: 50,
        animationKind: "none",
        animationDurationMs: 450,
        animationDelayMs: 0,
        bindable: false,
        sourceLive: false,
      },
      ...state,
    },
    history: { undo: noop, redo: noop, canUndo: true, canRedo: true },
    find: { toggle: noop },
    textFormat: {
      fontFamily: { set: noop },
      fontSize: { set: noop },
      bold: { toggle: noop },
      italic: { toggle: noop },
      underline: { toggle: noop },
      strike: { toggle: noop },
      color: { set: noop },
      alignment: { set: noop },
      lineHeight: { set: noop },
      bulletList: { toggle: noop },
      numberedList: { toggle: noop },
      clear: noop,
      generalPins: [],
    },
    exporter: {
      noun: "deck",
      formats: [...PRESENTATION_EXPORT_COPIES],
      run: noop,
    },
    importer: { open: noop, noun: "deck" },
    print: noop,
    zoom: { zoom: 1, setZoom: noop, fit: { label: "Fit the slide", run: noop } },
    comments: { toggle: noop },
    slide: {
      add: noop,
      duplicate: noop,
      remove: noop,
      moveEarlier: noop,
      moveLater: noop,
      setTitle: noop,
      toggleHidden: noop,
      setSection: noop,
      addSection: noop,
    },
    insert: {
      textBox: noop,
      placeholderText: noop,
      shape: noop,
      image: noop,
      video: noop,
      chart: noop,
      table: noop,
      embed: noop,
      component: noop,
    },
    design: {
      open: noop,
      applyLayout: noop,
      resetPlaceholders: noop,
      applyTheme: noop,
      setBackground: noop,
      setAspectRatio: noop,
      toggleSlideNumbers: noop,
      saveComponent: noop,
      audit: noop,
    },
    arrange: {
      align: noop,
      order: noop,
      group: noop,
      ungroup: noop,
      toggleLock: noop,
      toggleHidden: noop,
      remove: noop,
      toggleSnap: noop,
      toggleGrid: noop,
      toggleGuides: noop,
      openReadingOrder: noop,
      setGeometry: noop,
    },
    object: {
      setText: noop,
      setLink: noop,
      applyTextPreset: noop,
      setFill: noop,
      setStroke: noop,
      setStrokeWidth: noop,
      setCornerRadius: noop,
      setOpacity: noop,
      toggleShadow: noop,
      setAltText: noop,
      setImageFit: noop,
      setImageMask: noop,
      setFocal: noop,
      replaceImage: noop,
      bindSource: noop,
      toggleSourceLive: noop,
      refreshChart: noop,
      setAnimation: noop,
      setAnimationDuration: noop,
      setAnimationDelay: noop,
    },
    transition: {
      set: noop,
      setDuration: noop,
      applyToAll: noop,
      setDefault: noop,
      setAutoAdvance: noop,
    },
    notes: { set: noop, togglePanel: noop, toggleSurface: noop },
    present: {
      start: noop,
      rehearse: noop,
      stop: noop,
      next: noop,
      previous: noop,
      toggleNotes: noop,
      toggleBlackout: noop,
      togglePointer: noop,
      setLayout: noop,
    },
    sources: { open: noop, addCitation: noop, buildBibliography: noop },
    view: { toggleRail: noop, toggleInspector: noop, openFiles: noop },
  };
}

/** The stub as a value, for callers that prefer a constant. */
export const presentationCommandStubHandlers: PresentationHandlers =
  presentationStubHandlers();
