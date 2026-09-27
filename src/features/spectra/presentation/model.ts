export type PresentationObjectType =
  "text" | "shape" | "image" | "chart" | "table" | "embed" | "video" | "group";

/** A hyperlink that can survive both the collaborative model and DrawingML. */
export type PresentationHyperlink =
  | { kind: "external"; url: string }
  | { kind: "slide"; slideId: string };

/** A DrawingML run projected into the collaborative presentation model. */
export type PresentationTextRun = {
  text: string;
  fontFamily?: string;
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  /** Legacy strings are accepted at the boundary and treated as external URLs. */
  hyperlink?: string | PresentationHyperlink;
};

/** One native a:p. Keeping paragraphs separate prevents a line break edit from
 * flattening bullets, indentation, or run formatting in the neighbouring line. */
export type PresentationParagraph = {
  runs: PresentationTextRun[];
  alignment?: "left" | "center" | "right" | "justify";
  level?: number;
  bullet?: "none" | "bullet" | "numbered";
};

export type PresentationTextContent = {
  text: string;
  paragraphs?: PresentationParagraph[];
  nativeShapeId?: string;
  nativeParagraphIndex?: number;
  nativeShapeKind?: "placeholder" | "shape" | "group";
};

export type PresentationChartSeries = {
  id?: string;
  name: string;
  categories: string[];
  values: number[];
};

export type PresentationChartContent = {
  chartType: "bar" | "column" | "line" | "pie" | "area";
  title?: string;
  categories: string[];
  series: PresentationChartSeries[];
  showLegend?: boolean;
  axisTitle?: string;
  valueAxisTitle?: string;
  nativeChartPart?: string;
  sourceArtifactId?: string;
  sourceChartId?: string;
  sourceRevision?: string;
  sourceKind?: "artifact" | "sheets_range";
  sourceRange?: string;
  sourceLive?: boolean;
};

export type PresentationTableCell = {
  text: string;
  paragraphs?: PresentationParagraph[];
  style?: Record<string, unknown>;
  rowSpan?: number;
  colSpan?: number;
};

export type PresentationTableContent = {
  rows: Array<Array<PresentationTableCell | string>>;
  nativeTable?: boolean;
};

export type PresentationObject = {
  id: string;
  type: PresentationObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  content: unknown;
  style?: Record<string, unknown>;
  altText?: string;
  locked?: boolean;
  hidden?: boolean;
  readingOrder?: number;
  parentId?: string;
  componentId?: string;
  hyperlink?: string | PresentationHyperlink;
  sourceBinding?: {
    artifactId: string;
    kind: "artifact" | "sheets_range";
    range?: string;
    versionId?: string;
    live?: boolean;
  };
  animation?: {
    kind: "none" | "fade" | "rise" | "scale" | "wipe";
    durationMs?: number;
    delayMs?: number;
  };
};

export type PresentationSlide = {
  id: string;
  title: string;
  speakerNotes?: string;
  objects: PresentationObject[];
  layoutId?: string;
  masterId?: string;
  sectionId?: string;
  /** Kept in the deck and skipped while presenting. */
  hidden?: boolean;
  background?: string;
  transition?: {
    kind: "none" | "fade" | "push" | "dissolve";
    durationMs?: number;
  };
  sourceRefs?: string[];
  citations?: Array<{ id: string; label: string; url?: string; sourceRefs?: string[] }>;
  accessibility?: { label?: string; readingOrder?: string[] };
  nativeCompatibility?: {
    transition?: "preserved";
    animations?: "preserved";
    /**
     * The linked deck has no notes page for this slide, so Spectra can hold a
     * note but cannot write it into the file. Carried so the notes command and
     * the notes surfaces can refuse before taking the text rather than after.
     */
    speakerNotes?: "unsupported";
  };
};

export type PresentationContent = {
  theme: {
    id: string;
    name?: string;
    tokens?: Record<string, string>;
    fonts?: { heading?: string; body?: string };
  };
  slides: PresentationSlide[];
  sections?: Array<{ id: string; name: string }>;
  components?: Array<{
    id: string;
    name: string;
    object: PresentationObject;
  }>;
  settings?: {
    aspectRatio?: "16:9" | "4:3";
    defaultTransition?: "none" | "fade" | "push" | "dissolve";
    autoAdvanceSeconds?: number;
    showSlideNumbers?: boolean;
  };
  nativeBinding?: {
    version: 1;
    format: "pptx" | "pptm" | "potx" | "potm" | "ppsx" | "ppsm" | "ppam";
    profile: "strict-native" | "enhanced" | "spectra-native";
    macroEnabled: boolean;
    semanticDigest: string;
    canvasWidthEmu?: number;
    canvasHeightEmu?: number;
    sourceArtifactId?: string;
    sourcePayloadHash?: string;
    themeFonts?: { heading?: string; body?: string };
  };
};

function shallowValueEqual<T extends object>(
  left: T | undefined,
  right: T | undefined,
) {
  if (left === right) return true;
  if (!left || !right) return left === right;
  const leftEntries = Object.entries(left as Record<string, unknown>);
  const rightEntries = Object.entries(right as Record<string, unknown>);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      (right as Record<string, unknown>)[key] === value,
    )
  );
}

function objectGeometryEqual(left: PresentationObject, right: PresentationObject) {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.rotation === right.rotation &&
    left.content === right.content &&
    shallowValueEqual(left.style, right.style) &&
    left.altText === right.altText &&
    left.locked === right.locked &&
    left.hidden === right.hidden &&
    left.readingOrder === right.readingOrder &&
    left.parentId === right.parentId &&
    left.componentId === right.componentId &&
    JSON.stringify(left.hyperlink) === JSON.stringify(right.hyperlink) &&
    shallowValueEqual(left.sourceBinding, right.sourceBinding) &&
    shallowValueEqual(left.animation, right.animation) &&
    left.type === right.type &&
    left.id === right.id
  );
}

/**
 * Copy-on-write deck mutation. Unchanged slides and objects keep their
 * previous identities so a pointermove does not deep-clone the whole deck.
 */
export function producePresentationContent(
  deck: PresentationContent,
  recipe: (draft: PresentationContent) => void,
): PresentationContent {
  const draft: PresentationContent = {
    ...deck,
    theme: {
      ...deck.theme,
      ...(deck.theme.tokens ? { tokens: { ...deck.theme.tokens } } : {}),
      ...(deck.theme.fonts ? { fonts: { ...deck.theme.fonts } } : {}),
    },
    slides: deck.slides.map((slide) => ({
      ...slide,
      objects: slide.objects.map((object) => ({
        ...object,
        content: cloneContent(object.content),
        ...(object.style ? { style: { ...object.style } } : {}),
        ...(object.sourceBinding
          ? { sourceBinding: { ...object.sourceBinding } }
          : {}),
        ...(object.animation ? { animation: { ...object.animation } } : {}),
      })),
    })),
    ...(deck.sections ? { sections: deck.sections.map((section) => ({ ...section })) } : {}),
    ...(deck.components
      ? { components: deck.components.map((component) => ({ ...component })) }
      : {}),
    ...(deck.settings ? { settings: { ...deck.settings } } : {}),
  };
  recipe(draft);
  draft.slides = draft.slides.map((slide, index) => {
    const previous = deck.slides[index];
    if (!previous || previous.id !== slide.id) return slide;
    const objects = slide.objects.map((object, objectIndex) => {
      const previousObject = previous.objects[objectIndex];
      if (previousObject && objectGeometryEqual(previousObject, object))
        return previousObject;
      return object;
    });
    const nextSlide = { ...slide, objects };
    if (
      previous.title === nextSlide.title &&
      previous.speakerNotes === nextSlide.speakerNotes &&
      previous.layoutId === nextSlide.layoutId &&
      previous.masterId === nextSlide.masterId &&
      previous.sectionId === nextSlide.sectionId &&
      previous.hidden === nextSlide.hidden &&
      previous.background === nextSlide.background &&
      previous.transition === nextSlide.transition &&
      previous.citations === nextSlide.citations &&
      previous.sourceRefs === nextSlide.sourceRefs &&
      previous.accessibility === nextSlide.accessibility &&
      previous.nativeCompatibility === nextSlide.nativeCompatibility &&
      previous.objects.length === objects.length &&
      previous.objects.every((object, objectIndex) => object === objects[objectIndex])
    )
      return previous;
    return nextSlide;
  });
  if (
    draft.slides.length === deck.slides.length &&
    draft.slides.every((slide, index) => slide === deck.slides[index]) &&
    draft.theme.id === deck.theme.id &&
    draft.theme.name === deck.theme.name &&
    shallowValueEqual(draft.theme.tokens, deck.theme.tokens) &&
    shallowValueEqual(draft.theme.fonts, deck.theme.fonts) &&
    draft.settings === deck.settings &&
    draft.sections === deck.sections &&
    draft.components === deck.components
  )
    return deck;
  return draft;
}

const objectTypes = new Set<PresentationObjectType>([
  "text",
  "shape",
  "image",
  "chart",
  "table",
  "embed",
  "video",
  "group",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizePresentationHyperlink(
  value: unknown,
): PresentationHyperlink | undefined {
  if (typeof value === "string" && value.trim())
    return { kind: "external", url: value.trim().slice(0, 4_000) };
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "external" && typeof candidate.url === "string" && candidate.url.trim())
    return { kind: "external", url: candidate.url.trim().slice(0, 4_000) };
  if (candidate.kind === "slide" && typeof candidate.slideId === "string" && candidate.slideId.trim())
    return { kind: "slide", slideId: candidate.slideId.trim().slice(0, 180) };
  return undefined;
}

function cloneContent(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneContent);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      cloneContent(child),
    ]),
  );
}

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function bounded(value: unknown, fallback: number, min: number, max: number) {
  return Math.max(min, Math.min(max, finite(value, fallback)));
}

function uniqueIdentifier(
  candidate: string,
  fallback: string,
  occupied: Set<string>,
) {
  const base = (candidate.trim() || fallback).slice(0, 180);
  let value = base;
  let suffix = 2;
  while (occupied.has(value)) {
    const marker = `-${suffix}`;
    value = `${base.slice(0, 180 - marker.length)}${marker}`;
    suffix += 1;
  }
  occupied.add(value);
  return value;
}

export function presentationObjectText(object: PresentationObject) {
  if (typeof object.content === "string") return object.content;
  const content = record(object.content);
  if (typeof content.text === "string") return content.text;
  if (Array.isArray(content.paragraphs)) {
    const paragraphs = content.paragraphs.flatMap((candidate) => {
      const paragraph = record(candidate);
      if (!Array.isArray(paragraph.runs)) return [];
      return [paragraph.runs.map((run) => text(record(run).text)).join("")];
    });
    if (paragraphs.length) return paragraphs.join("\n");
  }
  return text(content.label, text(content.title));
}

export function presentationObjectParagraphs(
  object: PresentationObject,
): PresentationParagraph[] {
  const content = record(object.content);
  if (Array.isArray(content.paragraphs)) {
    return content.paragraphs.flatMap((candidate) => {
      const paragraph = record(candidate);
      if (!Array.isArray(paragraph.runs)) return [];
      return [{
        runs: paragraph.runs.flatMap((run) => {
          const value = record(run);
          return typeof value.text === "string"
            ? [{
                text: value.text,
                ...(typeof value.fontFamily === "string" ? { fontFamily: value.fontFamily } : {}),
                ...(typeof value.fontSizePt === "number" ? { fontSizePt: value.fontSizePt } : {}),
                ...(typeof value.bold === "boolean" ? { bold: value.bold } : {}),
                ...(typeof value.italic === "boolean" ? { italic: value.italic } : {}),
                ...(typeof value.underline === "boolean" ? { underline: value.underline } : {}),
                ...(typeof value.strike === "boolean" ? { strike: value.strike } : {}),
                ...(typeof value.color === "string" ? { color: value.color } : {}),
                ...(normalizePresentationHyperlink(value.hyperlink)
                  ? { hyperlink: normalizePresentationHyperlink(value.hyperlink) }
                  : {}),
              } satisfies PresentationTextRun]
            : [];
        }),
        ...(paragraph.alignment === "left" || paragraph.alignment === "center" || paragraph.alignment === "right" || paragraph.alignment === "justify"
          ? { alignment: paragraph.alignment }
          : {}),
        ...(typeof paragraph.level === "number" ? { level: paragraph.level } : {}),
        ...(paragraph.bullet === "none" || paragraph.bullet === "bullet" || paragraph.bullet === "numbered"
          ? { bullet: paragraph.bullet }
          : {}),
      } satisfies PresentationParagraph];
    });
  }
  const value = presentationObjectText(object);
  return value.split(/\r?\n/).map((line) => ({ runs: [{ text: line }] }));
}

const GENERIC_SLIDE_LABEL =
  /^(?:slide \d+|title|subtitle|untitled(?: presentation)?|add a clear idea|add the supporting idea|new slide|key idea \d+)$/i;

/** Rail / outline label that matches what people see on the canvas. */
export function presentationSlideLabel(
  slide: PresentationSlide,
  index: number,
): string {
  const titled = slide.title.trim();
  if (titled && !GENERIC_SLIDE_LABEL.test(titled)) return titled.slice(0, 120);
  for (const object of slide.objects) {
    if (object.type !== "text") continue;
    const value = presentationObjectText(object).trim();
    if (value && !GENERIC_SLIDE_LABEL.test(value)) return value.slice(0, 120);
  }
  return `Slide ${index + 1}`;
}


export function withPresentationObjectText(
  object: PresentationObject,
  value: string,
) {
  return {
    ...object,
    content:
      typeof object.content === "string"
        ? value
        : {
            ...record(object.content),
            text: value,
            ...(Array.isArray(record(object.content).paragraphs)
              ? {
                  paragraphs: value.split(/\r?\n/).map((line) => ({
                    runs: [{ text: line }],
                  })),
                }
              : {}),
          },
  };
}

export function createPresentationObject(
  type: PresentationObjectType,
  ordinal = 1,
): PresentationObject {
  const cascade = ((Math.max(1, ordinal) - 1) % 7) * 22;
  const base = {
    id: `object-${Date.now().toString(36)}-${ordinal.toString(36)}`,
    type,
    // Keep newly inserted layers discoverable instead of stacking them at the
    // exact same coordinates. The subtle cascade also makes insertion order
    // legible before the user starts arranging the slide.
    x: (type === "text" ? 110 : 300) + cascade,
    y: (type === "text" ? 120 : 180) + cascade,
    width: type === "text" ? 780 : 400,
    height: type === "text" ? 120 : 220,
    rotation: 0,
    readingOrder: ordinal,
  } satisfies Omit<PresentationObject, "content">;
  if (type === "text")
    return {
      ...base,
      content: { text: "Add a clear idea" },
      style: {
        fontSize: 48,
        fontWeight: 650,
        color: "var(--accent-mint)",
        align: "left",
      },
    };
  if (type === "shape")
    return {
      ...base,
      content: { shape: "rounded-rectangle", text: "" },
      style: { fill: "color-mix(in oklab, var(--accent-mint) 16%, var(--bg-elevated))", stroke: "var(--accent-mint)", radius: 24 },
    };
  if (type === "chart")
    return {
      ...base,
      content: {
        chartType: "bar",
        categories: ["A", "B", "C"],
        series: [
          {
            name: "Series 1",
            categories: ["A", "B", "C"],
            values: [62, 84, 48],
          },
        ],
      },
      altText: "Bar chart with three values",
    };
  if (type === "table")
    return {
      ...base,
      content: {
        rows: [
          ["Heading", "Value"],
          ["Example", "1"],
        ],
      },
      altText: "Two-column table",
    };
  return { ...base, content: {} };
}

export function createPresentationSlide(ordinal: number): PresentationSlide {
  return {
    id: `slide-${Date.now().toString(36)}-${ordinal.toString(36)}`,
    title: `Slide ${ordinal}`,
    layoutId: "title-content",
    transition: { kind: "fade", durationMs: 350 },
    objects: [createPresentationObject("text", 1)],
    speakerNotes: "",
  };
}

export function normalizePresentationContent(
  value: unknown,
  options: {
    onObjectNormalized?: (
      object: Readonly<PresentationObject>,
      raw: Readonly<Record<string, unknown>>,
    ) => void;
  } = {},
): PresentationContent {
  const input = record(value);
  const theme = record(input.theme);
  const settings = record(input.settings);
  const canvasHeight = settings.aspectRatio === "4:3" ? 750 : 562.5;
  const incomingSlides = Array.isArray(input.slides) ? input.slides : [];
  const occupiedSlideIds = new Set<string>();
  const occupiedObjectIds = new Set<string>();
  const occupiedComponentIds = new Set<string>();
  const occupiedSectionIds = new Set<string>();
  const sectionIdMap = new Map<string, string>();
  const normalizedSections = Array.isArray(input.sections)
    ? input.sections.flatMap((section, index) => {
        const row = record(section);
        if (typeof row.name !== "string") return [];
        const originalId = text(row.id, `section-${index + 1}`);
        const id = uniqueIdentifier(
          originalId,
          `section-${index + 1}`,
          occupiedSectionIds,
        );
        if (!sectionIdMap.has(originalId)) sectionIdMap.set(originalId, id);
        return [{ id, name: row.name.slice(0, 120) }];
      })
    : undefined;
  const slides = incomingSlides.flatMap((candidate, slideIndex) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return [];
    const slide = candidate as Record<string, unknown>;
    const slideId = uniqueIdentifier(
      text(slide.id),
      `slide-${slideIndex + 1}`,
      occupiedSlideIds,
    );
    const incomingObjects = Array.isArray(slide.objects) ? slide.objects : [];
    const objects = incomingObjects.flatMap((candidateObject, objectIndex) => {
      if (
        !candidateObject ||
        typeof candidateObject !== "object" ||
        Array.isArray(candidateObject)
      )
        return [];
      const object = candidateObject as Record<string, unknown>;
      const type = objectTypes.has(object.type as PresentationObjectType)
        ? (object.type as PresentationObjectType)
        : "text";
      const sourceBinding = record(object.sourceBinding);
      const animation = record(object.animation);
      const width = bounded(
        object.width,
        type === "text" ? 760 : 380,
        10,
        1_000,
      );
      const height = bounded(
        object.height,
        type === "text" ? 120 : 220,
        10,
        canvasHeight,
      );
      const normalizedObject = {
        id: uniqueIdentifier(
          text(object.id),
          `${slideId}:object-${objectIndex + 1}`,
          occupiedObjectIds,
        ),
        type,
        x: bounded(object.x, 100 + objectIndex * 20, 0, 1_000 - width),
        y: bounded(
          object.y,
          100 + objectIndex * 20,
          0,
          canvasHeight - height,
        ),
        width,
        height,
        rotation: bounded(object.rotation, 0, -360, 360),
        content: object.content ?? {},
        ...(object.style && typeof object.style === "object"
          ? { style: record(object.style) }
          : {}),
        ...(typeof object.altText === "string"
          ? { altText: object.altText.slice(0, 2_000) }
          : {}),
        ...(typeof object.locked === "boolean"
          ? { locked: object.locked }
          : {}),
        ...(typeof object.hidden === "boolean"
          ? { hidden: object.hidden }
          : {}),
        readingOrder: Math.max(
          0,
          Math.round(finite(object.readingOrder, objectIndex)),
        ),
        ...(typeof object.parentId === "string" && object.parentId.trim()
          ? { parentId: object.parentId.trim().slice(0, 180) }
          : {}),
        ...(typeof object.componentId === "string" &&
        object.componentId.trim()
          ? { componentId: object.componentId.trim().slice(0, 180) }
          : {}),
        ...(normalizePresentationHyperlink(object.hyperlink)
          ? { hyperlink: normalizePresentationHyperlink(object.hyperlink) }
          : {}),
        ...(typeof sourceBinding.artifactId === "string" &&
        sourceBinding.artifactId.trim() &&
        (sourceBinding.kind === "artifact" ||
          sourceBinding.kind === "sheets_range")
          ? {
              sourceBinding: {
                artifactId: sourceBinding.artifactId.trim().slice(0, 180),
                kind: sourceBinding.kind,
                ...(typeof sourceBinding.range === "string" &&
                sourceBinding.range.trim()
                  ? { range: sourceBinding.range.slice(0, 160) }
                  : {}),
                ...(typeof sourceBinding.versionId === "string" &&
                sourceBinding.versionId.trim()
                  ? {
                      versionId: sourceBinding.versionId.trim().slice(0, 180),
                    }
                  : {}),
                ...(typeof sourceBinding.live === "boolean"
                  ? { live: sourceBinding.live }
                  : {}),
              },
            }
          : {}),
        ...(animation.kind === "none" ||
        animation.kind === "fade" ||
        animation.kind === "rise" ||
        animation.kind === "scale" ||
        animation.kind === "wipe"
          ? {
              animation: {
                kind: animation.kind,
                ...(typeof animation.durationMs === "number"
                  ? {
                      durationMs: bounded(
                        animation.durationMs,
                        350,
                        0,
                        10_000,
                      ),
                    }
                  : {}),
                ...(typeof animation.delayMs === "number"
                  ? {
                      delayMs: bounded(animation.delayMs, 0, 0, 30_000),
                    }
                  : {}),
              },
            }
          : {}),
      } satisfies PresentationObject;
      // Observe the canonical ID and frame before invalid groups are removed.
      // Optional metadata consumers need not reconstruct the normalization.
      options.onObjectNormalized?.(normalizedObject, object);
      return [normalizedObject];
    });
    const invalidGroupIds = new Set<string>();
    objects
      .filter((object) => object.type === "group")
      .forEach((group) => {
        const groupContent = record(group.content);
        const childIds = Array.isArray(groupContent.childIds)
          ? groupContent.childIds.filter(
              (childId): childId is string =>
                typeof childId === "string" &&
                objects.some(
                  (object) =>
                    object.id === childId && object.parentId === group.id,
                ),
            )
          : [];
        if (childIds.length < 2) invalidGroupIds.add(group.id);
        else group.content = { ...groupContent, childIds };
      });
    if (invalidGroupIds.size) {
      for (let index = objects.length - 1; index >= 0; index -= 1) {
        if (invalidGroupIds.has(objects[index]!.id)) objects.splice(index, 1);
      }
    }
    const groupIds = new Set(
      objects
        .filter((object) => object.type === "group")
        .map((object) => object.id),
    );
    objects.forEach((object) => {
      if (object.parentId && !groupIds.has(object.parentId))
        delete object.parentId;
    });
    const transition = record(slide.transition);
    const nativeCompatibility = record(slide.nativeCompatibility);
    const accessibility = record(slide.accessibility);
    const citations = Array.isArray(slide.citations)
      ? slide.citations.flatMap((citation, citationIndex) => {
          const row = record(citation);
          return typeof row.label === "string"
            ? [
                {
                  id: text(row.id, `citation-${citationIndex + 1}`),
                  label: row.label.slice(0, 500),
                  ...(Array.isArray(row.sourceRefs) ? { sourceRefs: row.sourceRefs.filter((ref): ref is string => typeof ref === "string" && ref.length <= 300).slice(0, 100) } : {}),
                  ...(typeof row.url === "string"
                    ? { url: row.url.slice(0, 2_000) }
                    : {}),
                },
              ]
            : [];
        })
      : undefined;
    return [
      {
        id: slideId,
        title: text(slide.title, `Slide ${slideIndex + 1}`).slice(0, 300),
        speakerNotes: text(slide.speakerNotes).slice(0, 250_000),
        objects,
        ...(typeof slide.layoutId === "string" && slide.layoutId.trim()
          ? { layoutId: slide.layoutId.trim().slice(0, 180) }
          : {}),
        ...(typeof slide.masterId === "string" && slide.masterId.trim()
          ? { masterId: slide.masterId.trim().slice(0, 180) }
          : {}),
        ...(typeof slide.sectionId === "string" &&
        sectionIdMap.has(slide.sectionId)
          ? {
              sectionId: sectionIdMap.get(slide.sectionId) ?? slide.sectionId,
            }
          : {}),
        ...(slide.hidden === true ? { hidden: true } : {}),
        ...(typeof slide.background === "string" && slide.background.trim()
          ? { background: slide.background.slice(0, 100) }
          : {}),
        ...(transition.kind === "none" ||
        transition.kind === "fade" ||
        transition.kind === "push" ||
        transition.kind === "dissolve"
          ? {
              transition: {
                kind: transition.kind,
                ...(typeof transition.durationMs === "number"
                  ? {
                      // Native p14:dur is an unsigned 32-bit millisecond value.
                      // Preserve long imported transitions instead of clipping
                      // them to the studio's usual animation preset range.
                      durationMs: Math.max(0, Math.min(4_294_967_295, Math.round(finite(transition.durationMs, 350)))),
                    }
                  : {}),
              },
            }
          : {}),
        ...(citations ? { citations } : {}),
        ...(Array.isArray(slide.sourceRefs) ? { sourceRefs: slide.sourceRefs.filter((ref): ref is string => typeof ref === "string" && ref.length <= 300).slice(0, 100) } : {}),
        ...(typeof accessibility.label === "string" ||
        Array.isArray(accessibility.readingOrder)
          ? {
              accessibility: {
                ...(typeof accessibility.label === "string"
                  ? { label: accessibility.label.slice(0, 500) }
                  : {}),
                ...(Array.isArray(accessibility.readingOrder)
                  ? {
                      readingOrder: accessibility.readingOrder.flatMap(
                        (objectId) =>
                          typeof objectId === "string" &&
                          objects.some((object) => object.id === objectId)
                            ? [objectId]
                            : [],
                      ),
                    }
                  : {}),
              },
            }
          : {}),
        ...(nativeCompatibility.transition === "preserved" ||
        nativeCompatibility.animations === "preserved" ||
        nativeCompatibility.speakerNotes === "unsupported"
          ? {
              nativeCompatibility: {
                ...(nativeCompatibility.transition === "preserved"
                  ? { transition: "preserved" as const }
                  : {}),
                ...(nativeCompatibility.animations === "preserved"
                  ? { animations: "preserved" as const }
                  : {}),
                ...(nativeCompatibility.speakerNotes === "unsupported"
                  ? { speakerNotes: "unsupported" as const }
                  : {}),
              },
            }
          : {}),
      } satisfies PresentationSlide,
    ];
  });
  const nativeBindingSource = record(input.nativeBinding);
  const nativeFormat = [
    "pptx",
    "pptm",
    "potx",
    "potm",
    "ppsx",
    "ppsm",
    "ppam",
  ].includes(String(nativeBindingSource.format))
    ? (nativeBindingSource.format as NonNullable<
        PresentationContent["nativeBinding"]
      >["format"])
    : undefined;
  const nativeProfile = [
    "strict-native",
    "enhanced",
    "spectra-native",
  ].includes(String(nativeBindingSource.profile))
    ? (nativeBindingSource.profile as NonNullable<
        PresentationContent["nativeBinding"]
      >["profile"])
    : undefined;
  const nativeBinding =
    nativeBindingSource.version === 1 &&
    nativeFormat &&
    nativeProfile &&
    typeof nativeBindingSource.macroEnabled === "boolean" &&
    typeof nativeBindingSource.semanticDigest === "string" &&
    /^[a-f0-9]{64}$/.test(nativeBindingSource.semanticDigest)
      ? {
          version: 1 as const,
          format: nativeFormat,
          profile: nativeProfile,
          macroEnabled: nativeBindingSource.macroEnabled,
          semanticDigest: nativeBindingSource.semanticDigest,
          ...(typeof nativeBindingSource.canvasWidthEmu === "number" ? { canvasWidthEmu: nativeBindingSource.canvasWidthEmu } : {}),
          ...(typeof nativeBindingSource.canvasHeightEmu === "number" ? { canvasHeightEmu: nativeBindingSource.canvasHeightEmu } : {}),
          ...(typeof nativeBindingSource.sourceArtifactId === "string"
            ? { sourceArtifactId: nativeBindingSource.sourceArtifactId }
            : {}),
          ...(typeof nativeBindingSource.sourcePayloadHash === "string" &&
          /^[a-f0-9]{64}$/.test(nativeBindingSource.sourcePayloadHash)
            ? { sourcePayloadHash: nativeBindingSource.sourcePayloadHash }
            : {}),
          ...(nativeBindingSource.themeFonts && typeof nativeBindingSource.themeFonts === "object"
            ? {
                themeFonts: {
                  ...(typeof record(nativeBindingSource.themeFonts).heading === "string"
                    ? { heading: String(record(nativeBindingSource.themeFonts).heading) }
                    : {}),
                  ...(typeof record(nativeBindingSource.themeFonts).body === "string"
                    ? { body: String(record(nativeBindingSource.themeFonts).body) }
                    : {}),
                },
              }
            : {}),
        }
      : undefined;
  return {
    theme: {
      id: text(theme.id, "spectra-default"),
      ...(typeof theme.name === "string" ? { name: theme.name } : {}),
      ...(theme.tokens && typeof theme.tokens === "object"
        ? {
            tokens: Object.fromEntries(
              Object.entries(record(theme.tokens)).flatMap(([key, value]) =>
                typeof value === "string" ? [[key, value]] : [],
              ),
            ),
          }
        : {}),
      ...(theme.fonts && typeof theme.fonts === "object"
        ? {
            fonts: {
              ...(typeof record(theme.fonts).heading === "string"
                ? { heading: String(record(theme.fonts).heading) }
                : {}),
              ...(typeof record(theme.fonts).body === "string"
                ? { body: String(record(theme.fonts).body) }
                : {}),
            },
          }
        : {}),
    },
    slides: slides.length ? slides : [{
      ...createPresentationSlide(1),
      id: "slide-1",
      objects: [{ ...createPresentationObject("text", 1), id: "slide-1:object-1" }],
    }],
    ...(normalizedSections ? { sections: normalizedSections } : {}),
    ...(Array.isArray(input.components)
      ? {
          components: input.components
            .slice(0, 200)
            .flatMap((component, index) => {
              const row = record(component);
              if (typeof row.name !== "string") return [];
              const object = normalizePresentationContent({
                theme: { id: "component-normalization" },
                slides: [
                  {
                    id: "component-slide",
                    title: "Component",
                    objects: [row.object],
                  },
                ],
              }).slides[0]?.objects[0];
              const componentId = uniqueIdentifier(
                text(row.id),
                `component-${index + 1}`,
                occupiedComponentIds,
              );
              if (object) object.componentId = componentId;
              return object
                ? [
                    {
                      id: componentId,
                      name: row.name.slice(0, 120),
                      object,
                    },
                  ]
                : [];
            }),
        }
      : {}),
    settings: {
      aspectRatio: settings.aspectRatio === "4:3" ? "4:3" : "16:9",
      defaultTransition:
        settings.defaultTransition === "fade" ||
        settings.defaultTransition === "push" ||
        settings.defaultTransition === "dissolve"
          ? settings.defaultTransition
          : "none",
      ...(typeof settings.autoAdvanceSeconds === "number"
        ? {
            autoAdvanceSeconds: bounded(
              settings.autoAdvanceSeconds,
              0,
              0,
              3_600,
            ),
          }
        : {}),
      showSlideNumbers: settings.showSlideNumbers !== false,
    },
    ...(nativeBinding ? { nativeBinding } : {}),
  };
}

export function createDefaultPresentationContent(): PresentationContent {
  // Layout presets ship with the product, so a brand-new deck opens on a title
  // slide rather than an empty stage. Stable ids keep create → Yjs → reopen
  // comparable and avoid false remote-conflict banners from bootstrap hydrate.
  const titleObject: PresentationObject = {
    id: "object-1",
    type: "text",
    x: 90,
    y: 185.625,
    width: 820,
    height: 123.75,
    rotation: 0,
    readingOrder: 0,
    content: { text: "Presentation title" },
    style: {
      fontSize: 48,
      fontWeight: 700,
      color: "var(--accent-mint)",
      align: "center",
    },
  };
  return normalizePresentationContent({
    theme: { id: "spectra-default" },
    slides: [
      {
        id: "slide-1",
        title: "Untitled presentation",
        layoutId: "title-only",
        transition: { kind: "fade", durationMs: 350 },
        speakerNotes: "",
        objects: [titleObject],
        accessibility: { readingOrder: [titleObject.id] },
      },
    ],
    settings: {
      aspectRatio: "16:9",
      defaultTransition: "none",
      showSlideNumbers: true,
    },
  });
}

