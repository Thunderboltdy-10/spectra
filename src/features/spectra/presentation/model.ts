export type PresentationObjectType =
  "text" | "shape" | "image" | "chart" | "table" | "embed" | "video" | "group";

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
  background?: string;
  transition?: {
    kind: "none" | "fade" | "push" | "dissolve";
    durationMs?: number;
  };
  citations?: Array<{ id: string; label: string; url?: string }>;
  accessibility?: { label?: string; readingOrder?: string[] };
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
};

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
  return text(content.text, text(content.label, text(content.title)));
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
        : { ...record(object.content), text: value },
  };
}

export function createPresentationObject(
  type: PresentationObjectType,
  ordinal = 1,
): PresentationObject {
  const base = {
    id: `object-${Date.now().toString(36)}-${ordinal.toString(36)}`,
    type,
    x: type === "text" ? 110 : 300,
    y: type === "text" ? 120 : 180,
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
        color: "#183f35",
        align: "left",
      },
    };
  if (type === "shape")
    return {
      ...base,
      content: { shape: "rounded-rectangle", text: "" },
      style: { fill: "#dcefe4", stroke: "#84b79a", radius: 24 },
    };
  if (type === "chart")
    return {
      ...base,
      content: {
        chartType: "bar",
        labels: ["A", "B", "C"],
        values: [62, 84, 48],
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
      return [
        {
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
          ...(typeof object.parentId === "string"
            ? { parentId: object.parentId }
            : {}),
          ...(typeof object.componentId === "string"
            ? { componentId: object.componentId }
            : {}),
          ...(typeof sourceBinding.artifactId === "string" &&
          (sourceBinding.kind === "artifact" ||
            sourceBinding.kind === "sheets_range")
            ? {
                sourceBinding: {
                  artifactId: sourceBinding.artifactId,
                  kind: sourceBinding.kind,
                  ...(typeof sourceBinding.range === "string"
                    ? { range: sourceBinding.range }
                    : {}),
                  ...(typeof sourceBinding.versionId === "string"
                    ? { versionId: sourceBinding.versionId }
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
        } satisfies PresentationObject,
      ];
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
    const accessibility = record(slide.accessibility);
    const citations = Array.isArray(slide.citations)
      ? slide.citations.flatMap((citation, citationIndex) => {
          const row = record(citation);
          return typeof row.label === "string"
            ? [
                {
                  id: text(row.id, `citation-${citationIndex + 1}`),
                  label: row.label.slice(0, 500),
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
        ...(typeof slide.layoutId === "string"
          ? { layoutId: slide.layoutId }
          : {}),
        ...(typeof slide.masterId === "string"
          ? { masterId: slide.masterId }
          : {}),
        ...(typeof slide.sectionId === "string" &&
        sectionIdMap.has(slide.sectionId)
          ? {
              sectionId: sectionIdMap.get(slide.sectionId) ?? slide.sectionId,
            }
          : {}),
        ...(typeof slide.background === "string"
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
                      durationMs: bounded(
                        transition.durationMs,
                        350,
                        0,
                        10_000,
                      ),
                    }
                  : {}),
              },
            }
          : {}),
        ...(citations ? { citations } : {}),
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
      } satisfies PresentationSlide,
    ];
  });
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
    slides: slides.length ? slides : [createPresentationSlide(1)],
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
  };
}
