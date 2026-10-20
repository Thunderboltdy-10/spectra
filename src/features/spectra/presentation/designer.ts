import { contrastRatio, estimateTextHeight, estimateTextOverflow, resolvePaint } from "./audit";
import {
  presentationObjectText,
  type PresentationContent,
  type PresentationObject,
  type PresentationObjectType,
  type PresentationSlide,
} from "./model";

/*
 * Designer: finished looks for the slide that is open, the way PowerPoint's
 * Designer offers them. It reads what the slide holds (a title, its text, its
 * pictures and charts), decides what kind of slide that is, and lays the same
 * objects out several ways in the deck's own colours, adding only flat accents
 * (a band, a panel, a rule) that it marks as its own so the next design can
 * take them away again. Nothing is rewritten: every word and every picture
 * stays the object it was.
 */

export const DESIGNER_ACCENT = "spectra-designer";

const WIDTH = 1_000;
const MARGIN = 72;
/** The dark look's ground when the deck's own ink is not dark enough to be one. */
const NIGHT = "#111111";

type Frame = { x: number; y: number; width: number; height: number };

/** The space between text blocks stacked in one column. */
const STACK_GAP = 18;

/** A text frame's height cut to its words, with room for a wider face than the estimate's. */
function fitted(object: PresentationObject) {
  return Math.ceil(estimateTextHeight(object) * 1.15 + 8);
}

type Palette = {
  paper: string;
  ink: string;
  body: string;
  accent: string;
  soft: string;
  /** Text that reads on the accent. */
  onAccent: string;
};

type Role = "cover" | "title" | "statement" | "subtitle" | "body" | "point";

type SlideKind = "cover" | "statement" | "text" | "points" | "visual" | "gallery";

type Parts = {
  title?: PresentationObject;
  bodies: PresentationObject[];
  visuals: PresentationObject[];
};

export type DesignIdea = {
  id: string;
  name: string;
  slide: PresentationSlide;
};

/** The deck's colours as plain hex, with a page's black on white where it has none. */
const PLAIN: Omit<Palette, "onAccent"> = {
  paper: "#ffffff",
  ink: "#000000",
  body: "#000000",
  accent: "#2b59c3",
  soft: "#e9eef8",
};

const SIZES: Record<Role, readonly [number, number]> = {
  cover: [40, 66],
  statement: [36, 60],
  title: [28, 44],
  subtitle: [18, 28],
  body: [16, 24],
  point: [15, 22],
};

const WEIGHTS: Record<Role, number> = {
  cover: 700,
  statement: 680,
  title: 680,
  subtitle: 450,
  body: 420,
  point: 440,
};

const VISUAL_TYPES = new Set<PresentationObjectType>(["image", "video", "chart", "table", "embed", "shape"]);
const PICTURES = new Set<PresentationObjectType>(["image", "video"]);

function hex(value: string | undefined, fallback: string) {
  const paint = resolvePaint(value);
  return paint && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(paint) ? paint : fallback;
}

function readable(on: string, first: string, second: string) {
  return (contrastRatio(first, on) ?? 0) >= (contrastRatio(second, on) ?? 0) ? first : second;
}

export function designerPalette(deck: PresentationContent): Palette {
  const tokens = deck.theme.tokens ?? {};
  const paper = hex(tokens.background, PLAIN.paper);
  const accent = hex(tokens.accent, PLAIN.accent);
  return {
    paper,
    ink: hex(tokens.heading, PLAIN.ink),
    body: hex(tokens.body, PLAIN.body),
    accent,
    soft: hex(tokens.soft, PLAIN.soft),
    onAccent: readable(accent, "#ffffff", "#000000"),
  };
}

function textLength(object: PresentationObject) {
  return presentationObjectText(object).trim().length;
}

function partsOf(slide: PresentationSlide): Parts {
  const shown = slide.objects
    .filter((object) => !object.hidden && object.componentId !== DESIGNER_ACCENT)
    .sort(
      (left, right) =>
        (left.readingOrder ?? Number.MAX_SAFE_INTEGER) - (right.readingOrder ?? Number.MAX_SAFE_INTEGER) ||
        left.y - right.y ||
        left.x - right.x,
    );
  const texts = shown.filter((object) => object.type === "text" && textLength(object) > 0);
  return {
    title: texts[0],
    bodies: texts.slice(1),
    visuals: shown.filter((object) => VISUAL_TYPES.has(object.type)),
  };
}

function kindOf(parts: Parts, slideIndex: number): SlideKind | undefined {
  if (!parts.title && !parts.visuals.length) return undefined;
  if (parts.visuals.length >= 2) return "gallery";
  if (parts.visuals.length === 1) return "visual";
  if (!parts.bodies.length) return slideIndex === 0 ? "cover" : "statement";
  if (slideIndex === 0 && parts.bodies.length === 1 && textLength(parts.bodies[0]!) <= 140) return "cover";
  if (parts.bodies.length >= 2 && parts.bodies.length <= 4 && parts.bodies.every((body) => textLength(body) <= 220))
    return "points";
  return "text";
}

/**
 * Why a slide gets no designs, or undefined when it does. Grouped objects
 * move together under their group and a strictly linked file keeps its own
 * geometry, so Designer leaves both alone rather than half-moving them.
 */
export function designerRefusal(deck: PresentationContent, slideIndex: number) {
  const slide = deck.slides[slideIndex];
  if (!slide) return "There is no slide here.";
  if (deck.nativeBinding?.profile === "strict-native")
    return "This deck is linked to its file strictly, so its slides keep the file's own layout.";
  if (slide.objects.some((object) => object.type === "group" || object.parentId))
    return "Designer leaves slides with grouped objects as they are. Ungroup them to see designs.";
  if (!kindOf(partsOf(slide), slideIndex)) return "Write a title or add a picture, and designs for it appear here.";
  return undefined;
}

/* ------------------------------------------------------------------ drawing */

class Sheet {
  readonly slide: PresentationSlide;
  readonly height: number;
  private readonly accents: PresentationObject[] = [];
  /** Pictures set behind everything else, under the accents that frame them. */
  private readonly behind = new Set<string>();

  constructor(
    source: PresentationSlide,
    height: number,
    readonly palette: Palette,
    readonly ideaId: string,
  ) {
    this.slide = structuredClone(source);
    this.slide.objects = this.slide.objects.filter((object) => object.componentId !== DESIGNER_ACCENT);
    // A fill Designer gave the slide goes with its accents; a fill the author chose stays.
    if ([palette.ink, palette.accent, NIGHT].includes(this.slide.background ?? "")) delete this.slide.background;
    this.height = height;
  }

  get parts() {
    return partsOf(this.slide);
  }

  /** What the text over this point is read against. */
  get ground() {
    return hex(this.slide.background, this.palette.paper);
  }

  fill(color: string) {
    this.slide.background = color;
  }

  /** A flat block of colour behind the content. */
  block(frame: Frame, color: string, shape: "rectangle" | "rounded-rectangle" | "ellipse" = "rectangle") {
    this.accents.push({
      id: `${DESIGNER_ACCENT}-${this.slide.id}-${this.ideaId}-${this.accents.length}`,
      type: "shape",
      ...frame,
      rotation: 0,
      componentId: DESIGNER_ACCENT,
      content: { shape, text: "" },
      style: { shape, fill: color, stroke: color, strokeWidth: 0, radius: shape === "rounded-rectangle" ? 14 : 0 },
    });
  }

  /** Places a text object and sets it at the largest size of its role that fits. */
  text(
    object: PresentationObject | undefined,
    frame: Frame,
    role: Role,
    options: { align?: "left" | "center" | "right"; on?: string; ink?: string } = {},
  ) {
    if (!object) return;
    const on = options.on ?? this.ground;
    const wanted = options.ink ?? (role === "body" || role === "point" || role === "subtitle" ? this.palette.body : this.palette.ink);
    const ink = (contrastRatio(wanted, on) ?? 21) >= 4.5 ? wanted : readable(on, "#ffffff", "#000000");
    Object.assign(object, frame);
    object.style = {
      ...object.style,
      color: ink,
      // Read by the contrast check as what sits behind the words.
      fill: on,
      align: options.align ?? "left",
      fontWeight: WEIGHTS[role],
      lineHeight: role === "body" || role === "point" || role === "subtitle" ? 1.3 : 1.08,
    };
    const [smallest, largest] = SIZES[role];
    let size = largest;
    for (; size > smallest; size -= 2) {
      object.style.fontSize = size;
      if (!estimateTextOverflow(object)) break;
    }
    object.style.fontSize = size;
  }

  /** Text blocks stacked down a column, each as tall as its words need. */
  stack(objects: readonly PresentationObject[], frame: Frame, role: Role, options: { align?: "left" | "center"; on?: string } = {}) {
    if (!objects.length) return;
    const gap = STACK_GAP;
    const weights = objects.map((object) => Math.max(40, textLength(object)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const room = frame.height - gap * (objects.length - 1);
    let y = frame.y;
    objects.forEach((object, index) => {
      const height = Math.max(44, (room * weights[index]!) / total);
      this.text(object, { x: frame.x, y, width: frame.width, height }, role, options);
      y += height + gap;
    });
  }

  /**
   * A title with its words under it, set as one block and centred down the
   * frame, so the space between them is the type's and not the layout's.
   * Returns where the block starts, for an accent that sits above it.
   */
  column(frame: Frame, roles: { title: Role; body: Role }, options: { on?: string } = {}) {
    const { title, bodies } = this.parts;
    const gap = 28;
    const titleRoom = bodies.length ? frame.height * 0.5 : frame.height;
    this.text(title, { ...frame, height: titleRoom }, roles.title, options);
    const titleHeight = title ? Math.min(titleRoom, fitted(title)) : 0;
    const bodyRoom = frame.height - (titleHeight ? titleHeight + gap : 0);
    this.stack(bodies, { ...frame, height: bodyRoom }, roles.body, options);
    const bodyHeights = bodies.map((body) => Math.min(body.height, fitted(body)));
    const words = bodyHeights.reduce((sum, height) => sum + height, 0) + STACK_GAP * Math.max(0, bodies.length - 1);
    const total = titleHeight + (titleHeight && bodies.length ? gap : 0) + words;
    let y = frame.y + Math.max(0, (frame.height - total) / 2);
    const top = y;
    if (title) {
      Object.assign(title, { y, height: titleHeight });
      y += titleHeight + gap;
    }
    bodies.forEach((body, index) => {
      Object.assign(body, { y, height: bodyHeights[index]! });
      y += bodyHeights[index]! + STACK_GAP;
    });
    return top;
  }

  visual(object: PresentationObject | undefined, frame: Frame, bleed = false) {
    if (!object) return;
    Object.assign(object, frame);
    if (PICTURES.has(object.type)) object.style = { ...object.style, fit: "cover" };
    if (bleed) this.behind.add(object.id);
  }

  finish(name: string): DesignIdea {
    const { title, bodies, visuals } = this.parts;
    this.slide.objects = [...this.accents, ...this.slide.objects];
    // The canvas stacks objects in reading order, so the order is also the
    // depth: a picture set behind, then the accents, then what is read.
    const content = [title, ...bodies, ...visuals].filter((object): object is PresentationObject => Boolean(object));
    const rank = (object: PresentationObject) =>
      this.behind.has(object.id) ? 0 : object.componentId === DESIGNER_ACCENT ? 1 : content.includes(object) ? 2 : 3;
    const order = this.slide.objects
      .filter((object) => !object.hidden)
      .map((object, index) => ({ object, index }))
      .sort((left, right) => rank(left.object) - rank(right.object) || left.index - right.index)
      .map(({ object }) => object.id);
    this.slide.objects.forEach((object) => {
      const index = order.indexOf(object.id);
      if (index >= 0) object.readingOrder = index;
    });
    this.slide.accessibility = { ...this.slide.accessibility, readingOrder: order };
    return { id: this.ideaId, name, slide: this.slide };
  }
}

/* ------------------------------------------------------------------ recipes */

type Recipe = {
  id: string;
  name: string;
  kinds: readonly SlideKind[];
  draw: (sheet: Sheet, kind: SlideKind) => void;
};

/** The words of a text slide under its title, in one column or side by side. */
function writeBodies(sheet: Sheet, kind: SlideKind, frame: Frame, on?: string) {
  const { bodies } = sheet.parts;
  if (kind === "points" && frame.width >= 600) {
    const gap = 32;
    const width = (frame.width - gap * (bodies.length - 1)) / bodies.length;
    bodies.forEach((body, index) =>
      sheet.text(body, { x: frame.x + index * (width + gap), y: frame.y, width, height: frame.height }, "point", { on }),
    );
    return;
  }
  sheet.stack(bodies, frame, kind === "cover" ? "subtitle" : kind === "points" ? "point" : "body", { on });
}

function headingRole(kind: SlideKind): Role {
  return kind === "cover" ? "cover" : kind === "statement" ? "statement" : "title";
}

const RECIPES: readonly Recipe[] = [
  {
    id: "rule",
    name: "Rule",
    kinds: ["cover", "statement", "text", "points"],
    draw(sheet, kind) {
      const { title } = sheet.parts;
      const H = sheet.height;
      const open = kind === "cover" || kind === "statement";
      const titleFrame = open
        ? { x: MARGIN, y: H * 0.3, width: 790, height: H * 0.28 }
        : { x: MARGIN, y: 74, width: 850, height: 92 };
      // A short heavy rule set on the title's left edge, just above its first line.
      sheet.block({ x: MARGIN, y: titleFrame.y - 26, width: 84, height: 10 }, sheet.palette.accent);
      sheet.text(title, titleFrame, headingRole(kind));
      writeBodies(sheet, kind, open
        ? { x: MARGIN, y: H * 0.62, width: 730, height: H * 0.22 }
        : { x: MARGIN, y: 190, width: 850, height: H - 246 });
    },
  },
  {
    id: "band",
    name: "Colour band",
    kinds: ["cover", "statement", "text", "points"],
    draw(sheet, kind) {
      const { title } = sheet.parts;
      const H = sheet.height;
      const open = kind === "cover" || kind === "statement";
      const band = open ? H * 0.64 : H * 0.34;
      sheet.block({ x: 0, y: 0, width: WIDTH, height: band }, sheet.palette.accent);
      sheet.text(
        title,
        { x: MARGIN, y: band * (open ? 0.3 : 0.2), width: 820, height: band * (open ? 0.6 : 0.68) },
        headingRole(kind),
        { on: sheet.palette.accent, ink: sheet.palette.onAccent },
      );
      writeBodies(sheet, kind, { x: MARGIN, y: band + 34, width: 856, height: H - band - 70 });
    },
  },
  {
    id: "panel",
    name: "Side panel",
    kinds: ["cover", "statement", "text", "points"],
    draw(sheet, kind) {
      const { title, bodies } = sheet.parts;
      const H = sheet.height;
      const panel = bodies.length ? 380 : 440;
      sheet.block({ x: 0, y: 0, width: panel, height: H }, sheet.palette.soft);
      sheet.text(title, { x: 52, y: H * 0.18, width: panel - 96, height: H * 0.64 }, headingRole(kind) === "cover" ? "statement" : "title", {
        on: sheet.palette.soft,
      });
      if (bodies.length) sheet.stack(bodies, { x: panel + 52, y: H * 0.16, width: WIDTH - panel - 104, height: H * 0.68 }, kind === "cover" ? "subtitle" : "body");
    },
  },
  {
    id: "centred",
    name: "Centred",
    kinds: ["cover", "statement", "text"],
    draw(sheet, kind) {
      const { title, bodies } = sheet.parts;
      const H = sheet.height;
      const titleHeight = bodies.length ? H * 0.3 : H * 0.42;
      const titleY = bodies.length ? H * 0.2 : H * 0.26;
      sheet.text(title, { x: 120, y: titleY, width: 760, height: titleHeight }, headingRole(kind), { align: "center" });
      sheet.block({ x: WIDTH / 2 - 32, y: titleY + titleHeight + 14, width: 64, height: 4 }, sheet.palette.accent);
      if (bodies.length)
        sheet.stack(bodies, { x: 160, y: titleY + titleHeight + 42, width: 680, height: H - titleY - titleHeight - 84 }, kind === "cover" ? "subtitle" : "body", {
          align: "center",
        });
    },
  },
  {
    id: "night",
    name: "Dark",
    kinds: ["cover", "statement", "text", "points"],
    draw(sheet, kind) {
      const { title } = sheet.parts;
      const H = sheet.height;
      const dark = (contrastRatio(sheet.palette.ink, "#ffffff") ?? 0) >= 7 && sheet.palette.ink !== "#000000" ? sheet.palette.ink : NIGHT;
      sheet.fill(dark);
      const open = kind === "cover" || kind === "statement";
      const titleFrame = open
        ? { x: MARGIN, y: H * 0.28, width: 820, height: H * 0.32 }
        : { x: MARGIN, y: 64, width: 856, height: 96 };
      sheet.block({ x: MARGIN, y: titleFrame.y - 26, width: 84, height: 10 }, sheet.palette.accent);
      sheet.text(title, titleFrame, headingRole(kind), { on: dark, ink: sheet.palette.paper });
      writeBodies(sheet, kind, open
        ? { x: MARGIN, y: H * 0.64, width: 720, height: H * 0.22 }
        : { x: MARGIN, y: 190, width: 856, height: H - 246 }, dark);
    },
  },
  {
    id: "cards",
    name: "Cards",
    kinds: ["points"],
    draw(sheet) {
      const { title, bodies } = sheet.parts;
      const H = sheet.height;
      sheet.text(title, { x: MARGIN, y: 52, width: 856, height: 96 }, "title");
      const gap = 24;
      const width = (WIDTH - MARGIN * 2 - gap * (bodies.length - 1)) / bodies.length;
      bodies.forEach((body, index) => {
        const x = MARGIN + index * (width + gap);
        sheet.block({ x, y: 176, width, height: H - 228 }, sheet.palette.soft, "rounded-rectangle");
        sheet.block({ x: x + 24, y: 200, width: 28, height: 4 }, sheet.palette.accent);
        sheet.text(body, { x: x + 24, y: 224, width: width - 48, height: H - 300 }, "point", { on: sheet.palette.soft });
      });
    },
  },
  {
    id: "half",
    name: "Picture half",
    kinds: ["visual"],
    draw(sheet) {
      const { visuals } = sheet.parts;
      const H = sheet.height;
      const picture = PICTURES.has(visuals[0]!.type);
      sheet.visual(visuals[0], picture ? { x: 0, y: 0, width: 480, height: H } : { x: 40, y: 60, width: 440, height: H - 120 }, picture);
      sheet.column({ x: 532, y: 56, width: 396, height: H - 112 }, { title: "title", body: "body" });
    },
  },
  {
    id: "half-right",
    name: "Picture right",
    kinds: ["visual"],
    draw(sheet) {
      const { visuals } = sheet.parts;
      const H = sheet.height;
      const picture = PICTURES.has(visuals[0]!.type);
      sheet.visual(visuals[0], picture ? { x: 520, y: 0, width: 480, height: H } : { x: 520, y: 60, width: 440, height: H - 120 }, picture);
      const top = sheet.column({ x: MARGIN, y: 72, width: 400, height: H - 132 }, { title: "title", body: "body" });
      sheet.block({ x: MARGIN, y: top - 24, width: 56, height: 8 }, sheet.palette.accent);
    },
  },
  {
    id: "framed",
    name: "Framed",
    kinds: ["visual"],
    draw(sheet) {
      const { visuals } = sheet.parts;
      const H = sheet.height;
      sheet.block({ x: 560, y: 40, width: 400, height: H - 120 }, sheet.palette.soft);
      sheet.visual(visuals[0], { x: 520, y: 80, width: 400, height: H - 140 });
      sheet.column({ x: MARGIN, y: 56, width: 400, height: H - 112 }, { title: "title", body: "body" });
    },
  },
  {
    id: "stage",
    name: "Picture behind",
    kinds: ["visual"],
    draw(sheet) {
      const { title, bodies, visuals } = sheet.parts;
      const H = sheet.height;
      if (!PICTURES.has(visuals[0]!.type)) {
        // A chart or a table is read, not set behind words: give it the stage under the title.
        sheet.text(title, { x: MARGIN, y: 40, width: 856, height: 80 }, "title");
        sheet.visual(visuals[0], { x: MARGIN, y: 140, width: bodies.length ? 560 : 856, height: H - 190 });
        sheet.stack(bodies, { x: 680, y: 150, width: 248, height: H - 210 }, "point");
        return;
      }
      sheet.visual(visuals[0], { x: 0, y: 0, width: WIDTH, height: H }, true);
      const scrim = sheet.palette.ink === "#000000" ? NIGHT : sheet.palette.ink;
      const top = bodies.length ? H * 0.56 : H * 0.66;
      sheet.block({ x: 0, y: top, width: WIDTH, height: H - top }, scrim);
      sheet.text(title, { x: MARGIN, y: top + 26, width: 856, height: bodies.length ? 84 : H - top - 52 }, "title", {
        on: scrim,
        ink: "#ffffff",
      });
      if (bodies.length)
        sheet.stack(bodies, { x: MARGIN, y: top + 116, width: 856, height: H - top - 140 }, "body", { on: scrim });
    },
  },
  {
    id: "row",
    name: "In a row",
    kinds: ["gallery"],
    draw(sheet) {
      const { title, bodies, visuals } = sheet.parts;
      const H = sheet.height;
      const shown = visuals.slice(0, 4);
      sheet.text(title, { x: MARGIN, y: 44, width: 856, height: 84 }, "title");
      const gap = 20;
      const width = (WIDTH - MARGIN * 2 - gap * (shown.length - 1)) / shown.length;
      const height = bodies.length ? H * 0.46 : H - 210;
      shown.forEach((visual, index) => sheet.visual(visual, { x: MARGIN + index * (width + gap), y: 152, width, height }));
      if (bodies.length) sheet.stack(bodies, { x: MARGIN, y: 152 + height + 24, width: 856, height: H - height - 210 }, "body");
    },
  },
  {
    id: "mosaic",
    name: "Mosaic",
    kinds: ["gallery"],
    draw(sheet) {
      const { visuals } = sheet.parts;
      const H = sheet.height;
      const shown = visuals.slice(0, 4);
      sheet.block({ x: 0, y: 0, width: 360, height: H }, sheet.palette.soft);
      sheet.column({ x: 48, y: 48, width: 270, height: H - 96 }, { title: "title", body: "point" }, { on: sheet.palette.soft });
      const columns = shown.length > 2 ? 2 : shown.length;
      const rows = Math.ceil(shown.length / columns);
      const gap = 16;
      const width = (WIDTH - 360 - 48 - gap * (columns - 1)) / columns;
      const height = (H - 64 - gap * (rows - 1)) / rows;
      shown.forEach((visual, index) =>
        sheet.visual(visual, {
          x: 360 + 24 + (index % columns) * (width + gap),
          y: 32 + Math.floor(index / columns) * (height + gap),
          width,
          height,
        }),
      );
    },
  },
];

/** The designs Designer offers for one slide, best fit first. */
export function designIdeas(deck: PresentationContent, slideIndex: number): DesignIdea[] {
  if (designerRefusal(deck, slideIndex)) return [];
  const slide = deck.slides[slideIndex]!;
  const kind = kindOf(partsOf(slide), slideIndex)!;
  const height = deck.settings?.aspectRatio === "4:3" ? 750 : 562.5;
  const palette = designerPalette(deck);
  return RECIPES.filter((recipe) => recipe.kinds.includes(kind)).map((recipe) => {
    const sheet = new Sheet(slide, height, palette, recipe.id);
    recipe.draw(sheet, kind);
    return sheet.finish(recipe.name);
  });
}

/**
 * Designs every slide at once in one family of looks, so the deck reads as
 * one piece: the first slide as a cover, text slides with the same treatment,
 * pictures beside their words. Slides Designer leaves alone stay as they are.
 */
export function designDeck(deck: PresentationContent, family: DeckFamily = "rule") {
  const visualFor = { rule: "half", band: "half-right", panel: "framed", night: "stage" } as const;
  return deck.slides.map((slide, slideIndex) => {
    const ideas = designIdeas(deck, slideIndex);
    const pick =
      ideas.find((idea) => idea.id === family) ??
      ideas.find((idea) => idea.id === visualFor[family]) ??
      ideas.find((idea) => idea.id === "cards") ??
      ideas[0];
    return pick?.slide ?? slide;
  });
}

/** The look a slide wears now, read from the accents Designer gave it. */
export function currentDesign(slide: PresentationSlide) {
  const accent = slide.objects.find((object) => object.componentId === DESIGNER_ACCENT);
  return accent?.id.slice(`${DESIGNER_ACCENT}-${slide.id}-`.length).replace(/-\d+$/, "");
}

export const DECK_FAMILIES = [
  { id: "rule", name: "Rule" },
  { id: "band", name: "Colour band" },
  { id: "panel", name: "Side panel" },
  { id: "night", name: "Dark" },
] as const;

export type DeckFamily = (typeof DECK_FAMILIES)[number]["id"];
