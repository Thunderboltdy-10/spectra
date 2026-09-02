import type { CommandControlOption } from "../commands/types";
import { contrastRatio, estimateTextOverflow } from "./audit";
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

const NEEDS_ALT_TEXT = new Set<PresentationObjectType>([
  "image",
  "video",
  "chart",
  "table",
  "embed",
]);

export const GENERATED_PRESENTATION_LAYOUT_CYCLE = [
  "statement",
  "title-content",
  "two-column",
  "title-visual-text",
  "three-ideas",
  "visual-story",
] as const satisfies readonly PresentationLayoutId[];

const GENERATED_THEME = {
  background: "var(--bg-secondary)",
  heading: "var(--accent-mint)",
  body: "var(--text-primary)",
} as const;

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

function generatedFontBounds(role: "title" | "body") {
  return role === "title"
    ? { minimum: 30, maximum: 48 }
    : { minimum: 20, maximum: 26 };
}

function fittedFontSize(object: PresentationObject, role: "title" | "body") {
  const { minimum, maximum } = generatedFontBounds(role);
  const text = presentationObjectText(object).trim();
  if (!text) return maximum;
  let low = minimum;
  let high = maximum;
  let best = minimum;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    object.style = { ...object.style, fontSize: mid };
    if (estimateTextOverflow(object)) high = mid - 1;
    else {
      best = mid;
      low = mid + 1;
    }
  }
  return best;
}

function applyGeneratedTextStyle(
  deck: PresentationContent,
  object: PresentationObject,
  role: "title" | "body",
  align?: "left" | "center" | "right",
) {
  const tokens = deck.theme.tokens ?? {};
  const color =
    (role === "title" ? tokens.heading : tokens.body) ??
    (role === "title" ? GENERATED_THEME.heading : GENERATED_THEME.body);
  object.style = {
    ...object.style,
    color,
    // Contrast is ink against the slide, not an authored fill that can match
    // the text. Generated decks own this pairing.
    fill: tokens.background ?? GENERATED_THEME.background,
    fontWeight:
      role === "title"
        ? Math.max(650, numericStyle(object, "fontWeight", 700))
        : numericStyle(object, "fontWeight", 420),
    lineHeight: role === "title" ? 1.08 : 1.22,
    align: align ?? object.style?.align ?? "left",
  };
  object.style.fontSize = fittedFontSize(object, role);
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
    if (mode === "generated") {
      applyGeneratedTextStyle(deck, title, "title");
      cards.slice(0, 3).forEach((card) =>
        applyGeneratedTextStyle(deck, card, "body"),
      );
    }
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

function layoutSequenceNeedsRepair(layouts: readonly string[]) {
  if (layouts.length < 6) return false;
  const expectedVariety = Math.min(4, Math.ceil(layouts.length / 3));
  if (new Set(layouts.filter(Boolean)).size < expectedVariety) return true;
  for (let index = 2; index < layouts.length; index += 1) {
    if (
      layouts[index] &&
      layouts[index] === layouts[index - 1] &&
      layouts[index] === layouts[index - 2]
    )
      return true;
  }
  return false;
}

function generatedLayoutForSlide(
  slide: PresentationSlide,
  slideIndex: number,
  repairVariety: boolean,
): PresentationLayoutId {
  if (!repairVariety) return inferredLayout(slide, slideIndex);
  return GENERATED_PRESENTATION_LAYOUT_CYCLE[
    slideIndex % GENERATED_PRESENTATION_LAYOUT_CYCLE.length
  ];
}

const GENERIC_COPY =
  /^(?:slide \d+|title|subtitle|add a clear idea|add the supporting idea|add a visual|new slide|key idea \d+|visual)$/i;

function shortIdea(value: string, fallback: string, limit = 8) {
  const words = value
    .replace(/[.:;!?].*$/, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, limit);
  return words.length ? words.join(" ") : fallback;
}

function collectSlideCopy(slide: PresentationSlide) {
  const blobs = [
    slide.title,
    ...slide.objects.map((object) => presentationObjectText(object)),
    slide.speakerNotes ?? "",
  ]
    .map((value) => value.trim())
    .filter((value) => value && !GENERIC_COPY.test(value));
  const unique: string[] = [];
  for (const blob of blobs) {
    const key = blob.toLocaleLowerCase();
    if (unique.some((entry) => entry.toLocaleLowerCase() === key)) continue;
    unique.push(blob);
  }
  return unique;
}

function writeCopy(object: PresentationObject, value: string) {
  Object.assign(object, withPresentationObjectText(object, value));
}

function hydrateGeneratedRoles(
  slide: PresentationSlide,
  layoutId: PresentationLayoutId,
) {
  const copy = collectSlideCopy(slide);
  const heading = copy[0] || slide.title.trim() || "Key idea";
  if (!slide.title.trim() || GENERIC_COPY.test(slide.title.trim()))
    slide.title = heading;
  const title = ensureTitle(slide, true);
  if (title && GENERIC_COPY.test(presentationObjectText(title).trim()))
    writeCopy(title, heading);
  if (!title) return;

  const extras = copy.filter(
    (value) => value.toLocaleLowerCase() !== heading.toLocaleLowerCase(),
  );
  const supporting = extras.length ? extras : [shortIdea(heading, heading, 6)];

  if (layoutId === "title-content" || layoutId === "two-column") {
    const needed = layoutId === "two-column" ? 2 : 1;
    const bodies = [...ensureSupportingText(slide, title, true)];
    while (bodies.length < needed) {
      const body = createObject(slide, "text");
      writeCopy(
        body,
        shortIdea(
          supporting[bodies.length] ?? supporting[0] ?? heading,
          heading,
          12,
        ),
      );
      bodies.push(body);
    }
    bodies.slice(0, needed).forEach((body, index) => {
      const source = supporting[index] ?? supporting[0] ?? heading;
      if (GENERIC_COPY.test(presentationObjectText(body).trim()))
        writeCopy(body, shortIdea(source, source, 12));
    });
  }

  if (layoutId === "three-ideas") {
    const cards = visibleObjects(slide).filter(
      (object) => object.id !== title.id && object.type !== "group",
    );
    while (cards.length < 3) {
      const card = createObject(slide, "shape");
      card.content = {
        shape: "rounded-rectangle",
        text: shortIdea(
          supporting[cards.length] ?? heading,
          `Idea ${cards.length + 1}`,
          8,
        ),
      };
      cards.push(card);
    }
    cards.slice(0, 3).forEach((card, index) => {
      const source = supporting[index] ?? heading;
      if (GENERIC_COPY.test(presentationObjectText(card).trim()))
        writeCopy(card, shortIdea(source, source, 8));
    });
  }

  if (
    layoutId === "title-visual-text" ||
    layoutId === "visual-story" ||
    layoutId === "full-bleed"
  ) {
    const visual = ensureVisual(slide, title, true);
    if (visual && GENERIC_COPY.test(presentationObjectText(visual).trim()))
      writeCopy(visual, shortIdea(heading, "Visual", 5));
    const bodies = ensureSupportingText(slide, title, true);
    bodies.forEach((body, index) => {
      const source = supporting[index] ?? supporting[0] ?? heading;
      if (GENERIC_COPY.test(presentationObjectText(body).trim()))
        writeCopy(body, shortIdea(source, source, 12));
    });
  }
}

function parkExtraObjectsForSparseLayout(
  slide: PresentationSlide,
  layoutId: PresentationLayoutId,
) {
  if (layoutId !== "statement" && layoutId !== "title-only") return;
  const title = firstVisibleText(slide);
  if (!title) return;
  slide.objects = slide.objects.filter((object) => {
    if (object.id === title.id) return true;
    const text = presentationObjectText(object).trim();
    if (text && !GENERIC_COPY.test(text))
      slide.speakerNotes = [slide.speakerNotes?.trim(), text]
        .filter(Boolean)
        .join(" ");
    return false;
  });
}

function parkOverflowingText(
  slide: PresentationSlide,
  object: PresentationObject,
) {
  const words = presentationObjectText(object)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 3 && estimateTextOverflow(object)) {
    const parked = words.pop();
    if (!parked) break;
    slide.speakerNotes = [slide.speakerNotes?.trim(), parked]
      .filter(Boolean)
      .join(" ");
    Object.assign(object, withPresentationObjectText(object, words.join(" ")));
  }
}

function fitGeneratedSlide(deck: PresentationContent, slide: PresentationSlide) {
  const height = canvasHeight(deck);
  const title = firstVisibleText(slide);
  visibleObjects(slide).forEach((object) => {
    const role = title && object.id === title.id ? "title" : "body";
    if (
      object.type === "text" ||
      (object.type === "shape" && presentationObjectText(object).trim())
    )
      applyGeneratedTextStyle(
        deck,
        object,
        role,
        object.style?.align === "center" ? "center" : undefined,
      );
    const room = Math.max(40, height - object.y - 16);
    while (estimateTextOverflow(object) && object.height < room)
      object.height = Math.min(room, object.height + 16);
    if (estimateTextOverflow(object)) parkOverflowingText(slide, object);
    if (NEEDS_ALT_TEXT.has(object.type) && !object.altText?.trim())
      object.altText = `${object.type} on ${slide.title || "this slide"}`;
  });
}

function ensureGeneratedTheme(deck: PresentationContent) {
  const tokens = { ...(deck.theme.tokens ?? {}) };
  const background = tokens.background || GENERATED_THEME.background;
  const heading = tokens.heading || GENERATED_THEME.heading;
  const body = tokens.body || GENERATED_THEME.body;
  const headingRatio = contrastRatio(heading, background) ?? 0;
  const bodyRatio = contrastRatio(body, background) ?? 0;
  deck.theme.tokens = {
    ...tokens,
    background:
      headingRatio >= 3 && bodyRatio >= 4.5
        ? background
        : GENERATED_THEME.background,
    heading: headingRatio >= 3 ? heading : GENERATED_THEME.heading,
    body: bodyRatio >= 4.5 ? body : GENERATED_THEME.body,
  };
}

/**
 * The AI authors semantic objects and a layout intent. This realizes that
 * intent through the same geometry the studio uses, then returns canonical
 * content for storage and verification.
 */
export function realizeGeneratedPresentation(value: unknown) {
  const deck = normalizePresentationContent(value);
  ensureGeneratedTheme(deck);
  const authored = deck.slides.map((slide, index) =>
    inferredLayout(slide, index),
  );
  const repairVariety = layoutSequenceNeedsRepair(authored);
  deck.slides.forEach((slide, slideIndex) => {
    const layoutId = generatedLayoutForSlide(slide, slideIndex, repairVariety);
    hydrateGeneratedRoles(slide, layoutId);
    applyPresentationLayout(deck, slideIndex, layoutId, {
      createMissing: true,
      mode: "generated",
    });
    parkExtraObjectsForSparseLayout(slide, layoutId);
    fitGeneratedSlide(deck, slide);
    // Reading order is derived from objects that remain after parking and
    // overflow. Authored IDs are not an identity for writes.
    finalizeReadingOrder(slide);
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
