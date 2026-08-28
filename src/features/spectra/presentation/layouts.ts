import type { CommandControlOption } from "../commands/types";
import {
  createPresentationObject,
  normalizePresentationContent,
  presentationObjectText,
  withPresentationObjectText,
  type PresentationContent,
  type PresentationObject,
  type PresentationObjectType,
  type PresentationSlide,
} from "./model";

export const PRESENTATION_LAYOUT_OPTIONS = [
  { value: "title-content", label: "Title and content" },
  { value: "title-only", label: "Title only" },
  { value: "two-column", label: "Two columns" },
  { value: "title-visual-text", label: "Title, visual and text" },
  { value: "visual-story", label: "Visual story" },
  { value: "three-ideas", label: "Three ideas" },
  { value: "statement", label: "Statement" },
  { value: "full-bleed", label: "Full bleed" },
  { value: "blank", label: "Blank" },
] as const satisfies readonly CommandControlOption[];

export const PRESENTATION_LAYOUT_IDS = PRESENTATION_LAYOUT_OPTIONS.map(
  (option) => option.value,
);

export type PresentationLayoutId =
  (typeof PRESENTATION_LAYOUT_OPTIONS)[number]["value"];

export function isPresentationLayoutId(
  value: unknown,
): value is PresentationLayoutId {
  return PRESENTATION_LAYOUT_IDS.includes(value as PresentationLayoutId);
}

type LayoutMode = "preserve" | "generated";

type ApplyPresentationLayoutOptions = {
  createMissing?: boolean;
  mode?: LayoutMode;
};

const VISUAL_TYPES = new Set<PresentationObjectType>([
  "image",
  "video",
  "chart",
  "shape",
  "embed",
]);

function canvasHeight(deck: PresentationContent) {
  return deck.settings?.aspectRatio === "4:3" ? 750 : 562.5;
}

function numericStyle(
  object: PresentationObject,
  key: string,
  fallback: number,
) {
  const value = object.style?.[key];
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function fittedFontSize(object: PresentationObject, role: "title" | "body") {
  const text = presentationObjectText(object).trim();
  const maximum = role === "title" ? 48 : 26;
  const minimum = role === "title" ? 30 : 20;
  if (!text) return maximum;
  const approximateCharactersPerLine = Math.max(
    8,
    object.width / (maximum * 0.52),
  );
  const approximateLines = Math.max(
    1,
    Math.ceil(text.length / approximateCharactersPerLine),
  );
  const heightLimited = Math.floor(object.height / (approximateLines * 1.2));
  return Math.max(minimum, Math.min(maximum, heightLimited));
}

function applyGeneratedTextStyle(
  deck: PresentationContent,
  object: PresentationObject,
  role: "title" | "body",
  align?: "left" | "center" | "right",
) {
  const tokens = deck.theme.tokens ?? {};
  object.style = {
    ...object.style,
    color:
      object.style?.color ??
      (role === "title" ? tokens.heading : tokens.body) ??
      "#183f35",
    fontSize: fittedFontSize(object, role),
    fontWeight:
      role === "title"
        ? Math.max(650, numericStyle(object, "fontWeight", 700))
        : numericStyle(object, "fontWeight", 420),
    lineHeight: role === "title" ? 1.08 : 1.22,
    align: align ?? object.style?.align ?? "left",
  };
}

function firstVisibleText(slide: PresentationSlide) {
  return slide.objects.find(
    (object) => object.type === "text" && !object.hidden,
  );
}

function visibleObjects(slide: PresentationSlide) {
  return slide.objects.filter((object) => !object.hidden);
}

function createObject(slide: PresentationSlide, type: PresentationObjectType) {
  const object = createPresentationObject(type, slide.objects.length + 1);
  slide.objects.push(object);
  return object;
}

function ensureTitle(slide: PresentationSlide, createMissing: boolean) {
  const existing = firstVisibleText(slide);
  if (existing || !createMissing) return existing;
  return createObject(slide, "text");
}

function ensureSupportingText(
  slide: PresentationSlide,
  title: PresentationObject,
  createMissing: boolean,
) {
  const bodies = visibleObjects(slide).filter(
    (object) => object.type === "text" && object.id !== title.id,
  );
  if (bodies.length || !createMissing) return bodies;
  const body = withPresentationObjectText(
    createObject(slide, "text"),
    "Add the supporting idea",
  );
  slide.objects[slide.objects.length - 1] = body;
  return [body];
}

function ensureVisual(
  slide: PresentationSlide,
  title: PresentationObject,
  createMissing: boolean,
) {
  const existing = visibleObjects(slide).find(
    (object) => object.id !== title.id && VISUAL_TYPES.has(object.type),
  );
  if (existing || !createMissing) return existing;
  const visual = createObject(slide, "shape");
  visual.content = { shape: "rounded-rectangle", text: "Add a visual" };
  return visual;
}

function finalizeReadingOrder(slide: PresentationSlide) {
  const visible = visibleObjects(slide)
    .slice()
    .sort((left, right) => left.y - right.y || left.x - right.x);
  visible.forEach((object, index) => {
    object.readingOrder = index;
  });
  slide.accessibility = {
    ...slide.accessibility,
    readingOrder: visible.map((object) => object.id),
  };
}

export function applyPresentationLayout(
  deck: PresentationContent,
  slideIndex: number,
  layoutId: PresentationLayoutId,
  options: ApplyPresentationLayoutOptions = {},
) {
  const slide = deck.slides[slideIndex];
  if (!slide) return deck;
  const createMissing = options.createMissing === true;
  const mode = options.mode ?? "preserve";
  const height = canvasHeight(deck);
  slide.layoutId = layoutId;
  if (layoutId === "blank" || !slide.objects.length) return deck;

  const title = ensureTitle(slide, createMissing);
  if (!title) return deck;

  const remaining = () =>
    visibleObjects(slide).filter((object) => object.id !== title.id);

  if (layoutId === "title-only") {
    Object.assign(title, {
      x: 90,
      y: height * 0.33,
      width: 820,
      height: height * 0.22,
    });
    if (mode === "generated") applyGeneratedTextStyle(deck, title, "title");
    finalizeReadingOrder(slide);
    return deck;
  }

  if (layoutId === "statement") {
    Object.assign(title, {
      x: 110,
      y: height * 0.25,
      width: 780,
      height: height * 0.5,
      style: {
        ...title.style,
        fontSize: 58,
        fontWeight: 720,
        align: "center",
      },
    });
    if (mode === "generated")
      applyGeneratedTextStyle(deck, title, "title", "center");
    finalizeReadingOrder(slide);
    return deck;
  }

  if (layoutId === "full-bleed") {
    const hero =
      visibleObjects(slide).find((object) =>
        ["image", "video", "shape"].includes(object.type),
      ) ?? visibleObjects(slide)[0];
    if (hero) Object.assign(hero, { x: 0, y: 0, width: 1_000, height });
    if (title.id !== hero?.id) {
      Object.assign(title, {
        x: 70,
        y: height * 0.68,
        width: 860,
        height: height * 0.18,
      });
      if (mode === "generated") applyGeneratedTextStyle(deck, title, "title");
    }
    finalizeReadingOrder(slide);
    return deck;
  }

  if (layoutId === "title-visual-text" || layoutId === "visual-story") {
    const visual = ensureVisual(slide, title, createMissing);
    const bodies = ensureSupportingText(slide, title, createMissing);
    if (layoutId === "title-visual-text") {
      Object.assign(title, { x: 70, y: 45, width: 860, height: 90 });
      if (visual)
        Object.assign(visual, {
          x: 70,
          y: 165,
          width: 500,
          height: height - 215,
        });
      const bodyGap = 16;
      const bodyHeight = Math.max(
        40,
        (height - 215 - bodyGap * Math.max(0, bodies.length - 1)) /
          Math.max(1, bodies.length),
      );
      bodies.forEach((body, index) =>
        Object.assign(body, {
          x: 610,
          y: 165 + index * (bodyHeight + bodyGap),
          width: 320,
          height: bodyHeight,
        }),
      );
    } else {
      if (visual) Object.assign(visual, { x: 0, y: 0, width: 570, height });
      Object.assign(title, { x: 620, y: 100, width: 320, height: 145 });
      const bodyGap = 14;
      const bodyHeight = Math.max(
        40,
        (height - 320 - bodyGap * Math.max(0, bodies.length - 1)) /
          Math.max(1, bodies.length),
      );
      bodies.forEach((body, index) =>
        Object.assign(body, {
          x: 620,
          y: 270 + index * (bodyHeight + bodyGap),
          width: 310,
          height: bodyHeight,
        }),
      );
    }
    if (mode === "generated") {
      applyGeneratedTextStyle(deck, title, "title");
      bodies.forEach((body) => applyGeneratedTextStyle(deck, body, "body"));
    }
    finalizeReadingOrder(slide);
    return deck;
  }

  if (layoutId === "three-ideas") {
    Object.assign(title, { x: 70, y: 45, width: 860, height: 90 });
    const cards = remaining().filter((object) => object.type !== "group");
    while (cards.length < 3 && createMissing) {
      const card = createObject(slide, "shape");
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
        height: height - 235,
      }),
    );
    if (mode === "generated") applyGeneratedTextStyle(deck, title, "title");
    finalizeReadingOrder(slide);
    return deck;
  }

  Object.assign(title, { x: 70, y: 52, width: 860, height: 92 });
  remaining().forEach((object, index) => {
    if (layoutId === "two-column") {
      const column = index % 2;
      const row = Math.floor(index / 2);
      Object.assign(object, {
        x: column ? 525 : 70,
        y: Math.min(height - 40, 175 + row * 170),
        width: 405,
        height: Math.max(40, Math.min(145, height - 190 - row * 170)),
      });
    } else {
      Object.assign(object, {
        x: 90,
        y: Math.min(height - 40, 175 + index * 155),
        width: 820,
        height: Math.max(40, Math.min(130, height - 190 - index * 155)),
      });
    }
    if (mode === "generated" && object.type === "text")
      applyGeneratedTextStyle(deck, object, "body");
  });
  if (mode === "generated") applyGeneratedTextStyle(deck, title, "title");
  finalizeReadingOrder(slide);
  return deck;
}

function inferredLayout(slide: PresentationSlide, slideIndex: number) {
  if (isPresentationLayoutId(slide.layoutId)) return slide.layoutId;
  const visible = visibleObjects(slide);
  const visuals = visible.filter((object) => VISUAL_TYPES.has(object.type));
  const texts = visible.filter((object) => object.type === "text");
  if (slideIndex === 0 && visible.length === 1) return "statement";
  if (visuals.length && texts.length >= 2) return "title-visual-text";
  if (visible.length === 4) return "three-ideas";
  if (visible.length >= 3) return "two-column";
  return "title-content";
}

/**
 * The AI authors semantic objects and a layout intent. This realizes that
 * intent through the same geometry the studio uses, then returns canonical
 * content for storage and verification.
 */
export function realizeGeneratedPresentation(value: unknown) {
  const deck = normalizePresentationContent(value);
  deck.slides.forEach((slide, slideIndex) => {
    applyPresentationLayout(
      deck,
      slideIndex,
      inferredLayout(slide, slideIndex),
      {
        createMissing: false,
        mode: "generated",
      },
    );
  });
  return deck;
}

export function presentationLayoutRoleIssues(slide: PresentationSlide) {
  if (!isPresentationLayoutId(slide.layoutId))
    return ["Choose one supported layout intent for the slide."];
  if (slide.layoutId === "blank") return [];
  const visible = visibleObjects(slide);
  const texts = visible.filter((object) => object.type === "text");
  const visuals = visible.filter((object) => VISUAL_TYPES.has(object.type));
  const issues: string[] = [];
  if (texts.length === 0) issues.push("Add a readable title object.");
  if (
    (slide.layoutId === "title-visual-text" ||
      slide.layoutId === "visual-story" ||
      slide.layoutId === "full-bleed") &&
    visuals.length === 0
  )
    issues.push("Add an editable visual object for this layout.");
  if (slide.layoutId === "three-ideas" && visible.length < 4)
    issues.push("Provide a title and three complete ideas.");
  if (slide.layoutId === "two-column" && visible.length < 3)
    issues.push("Provide a title and content for both columns.");
  if (slide.layoutId === "title-content" && visible.length < 2)
    issues.push("Provide a title and supporting content.");
  return issues;
}
