import { estimateTextOverflow } from "../../../presentation/audit";
import {
  PRESENTATION_LAYOUT_IDS,
  applyPresentationLayout,
  ensurePresentationReadingOrders,
  fitGeneratedSlide,
  isPresentationLayoutId,
  presentationLayoutRoleIssues,
  type PresentationLayoutId,
} from "../../../presentation/layouts";
import {
  createPresentationObject,
  normalizePresentationContent,
  presentationObjectText,
  withPresentationObjectText,
  type PresentationContent,
  type PresentationObject,
  type PresentationObjectType,
  type PresentationParagraph,
  type PresentationSlide,
  type PresentationTextRun,
} from "../../../presentation/model";
import { AuthoringError, type IdFactory, defaultIdFactory, isPlaceholder, record, truncate } from "./shared";

/*
 * Presentations are authored as slide operations. The model says what is on a
 * slide (layout, title, body, visual, notes); the studio's own layout engine
 * places it. Nothing here invents copy: a layout that wants a visual and has
 * none is reported in the readback instead of being filled with placeholder
 * text.
 */

export type VisualSpec =
  | {
      type: "chart";
      chartType?: "bar" | "column" | "line" | "pie" | "area";
      title?: string;
      categories: string[];
      series: Array<{ name: string; values: number[] }>;
      alt?: string;
    }
  | { type: "table"; rows: string[][]; alt?: string }
  | { type: "shape"; text: string };

export type SlideSpec = {
  layout?: PresentationLayoutId;
  title?: string;
  /** One text box; lines starting "- " or "1. " become bullets. An array makes one box per entry (columns, ideas). */
  body?: string | string[];
  visual?: VisualSpec | null;
  notes?: string;
};

export type ThemeSpec = {
  name?: string;
  background?: string;
  heading?: string;
  body?: string;
  accent?: string;
  headingFont?: string;
  bodyFont?: string;
};

export type PresentationEditOp =
  | ({ op: "add_slide"; position?: number } & SlideSpec)
  | ({ op: "update_slide"; slide: number } & SlideSpec)
  | { op: "delete_slide"; slide: number }
  | { op: "move_slide"; slide: number; to: number }
  | ({ op: "set_theme" } & ThemeSpec)
  | { op: "replace"; find: string; replace: string; all?: boolean };

export type PresentationSpec = { slides: SlideSpec[]; theme?: ThemeSpec };

const VISUAL_TYPES = new Set<PresentationObjectType>(["image", "video", "chart", "shape", "embed", "table"]);
const CHART_TYPES = new Set(["bar", "column", "line", "pie", "area"]);

function emptyDeck(): PresentationContent {
  return { theme: { id: "spectra-default" }, slides: [] };
}

function inlineRuns(line: string): PresentationTextRun[] {
  const runs: PresentationTextRun[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index! > last) runs.push({ text: line.slice(last, match.index) });
    runs.push({ text: match[1]!, bold: true });
    last = match.index! + match[0].length;
  }
  if (last < line.length || !runs.length) runs.push({ text: line.slice(last) });
  return runs;
}

/** Plain lines with optional "- " and "1. " bullets become native paragraphs. */
export function bodyParagraphs(value: string): PresentationParagraph[] {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line, index, lines) => line.trim() || (index > 0 && index < lines.length - 1))
    .map((raw) => {
      const indent = /^\s*/.exec(raw)![0].length;
      const level = Math.min(4, Math.floor(indent / 2));
      const line = raw.trim();
      const bullet = /^[-*•]\s+/.exec(line);
      const numbered = /^\d+[.)]\s+/.exec(line);
      const textLine = line.slice((bullet ?? numbered)?.[0].length ?? 0);
      return {
        runs: inlineRuns(textLine),
        ...(bullet ? { bullet: "bullet" as const } : numbered ? { bullet: "numbered" as const } : {}),
        ...(level ? { level } : {}),
      };
    });
}

function paragraphsText(paragraphs: PresentationParagraph[]) {
  return paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n");
}

function newObject(type: PresentationObjectType, ordinal: number, ids: IdFactory): PresentationObject {
  return { ...createPresentationObject(type, ordinal), id: ids("object") };
}

function textObject(value: string, ordinal: number, ids: IdFactory, asCard = false): PresentationObject {
  const paragraphs = bodyParagraphs(value);
  const object = newObject(asCard ? "shape" : "text", ordinal, ids);
  object.content = asCard
    ? { shape: "rounded-rectangle", text: paragraphsText(paragraphs) }
    : { text: paragraphsText(paragraphs), paragraphs };
  return object;
}

function titleObject(value: string, ordinal: number, ids: IdFactory) {
  const object = newObject("text", ordinal, ids);
  object.content = { text: value.trim() };
  return object;
}

function visualObject(spec: VisualSpec, ordinal: number, ids: IdFactory, label: string): PresentationObject {
  switch (spec.type) {
    case "chart": {
      const categories = Array.isArray(spec.categories) ? spec.categories.map(String) : [];
      if (!categories.length) throw new AuthoringError(`${label}: visual.categories is empty.`);
      if (!Array.isArray(spec.series) || !spec.series.length)
        throw new AuthoringError(`${label}: visual.series needs at least one series.`);
      const series = spec.series.map((entry, index) => {
        const values = Array.isArray(entry?.values) ? entry.values.map(Number) : [];
        if (values.length !== categories.length || values.some((value) => !Number.isFinite(value)))
          throw new AuthoringError(
            `${label}: visual.series[${index}].values must hold ${categories.length} numbers, one per category.`,
          );
        return { name: String(entry.name ?? `Series ${index + 1}`), categories, values };
      });
      const chartType = spec.chartType && CHART_TYPES.has(spec.chartType) ? spec.chartType : "bar";
      const object = newObject("chart", ordinal, ids);
      object.content = { chartType, ...(spec.title ? { title: spec.title } : {}), categories, series, showLegend: series.length > 1 };
      object.altText = spec.alt?.trim() || `${chartType} chart${spec.title ? ` of ${spec.title}` : ""}`;
      return object;
    }
    case "table": {
      const rows = Array.isArray(spec.rows) ? spec.rows.map((row) => (Array.isArray(row) ? row.map(String) : [])) : [];
      if (!rows.length || !rows[0]!.length) throw new AuthoringError(`${label}: visual.rows is empty.`);
      const width = Math.max(...rows.map((row) => row.length));
      const object = newObject("table", ordinal, ids);
      object.content = { rows: rows.map((row) => [...row, ...Array(width - row.length).fill("")]) };
      object.altText = spec.alt?.trim() || `Table with ${rows.length} rows`;
      return object;
    }
    case "shape": {
      const object = newObject("shape", ordinal, ids);
      object.content = { shape: "rounded-rectangle", text: String(spec.text ?? "").trim() };
      return object;
    }
    default:
      throw new AuthoringError(`${label}: visual.type must be chart, table or shape.`);
  }
}

function slideNumber(deck: PresentationContent, value: unknown, label: string, field = "slide") {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > deck.slides.length)
    throw new AuthoringError(
      `${label}: ${field} must be a slide number from 1 to ${deck.slides.length}${deck.slides.length ? "" : " (the deck has no slides)"}.`,
    );
  return number - 1;
}

function layoutOf(spec: SlideSpec, fallback: PresentationLayoutId, label: string): PresentationLayoutId {
  if (spec.layout === undefined) return fallback;
  if (!isPresentationLayoutId(spec.layout))
    throw new AuthoringError(`${label}: layout "${String(spec.layout)}" is unknown. Use one of ${PRESENTATION_LAYOUT_IDS.join(", ")}.`);
  return spec.layout;
}

function defaultLayout(spec: SlideSpec, index: number): PresentationLayoutId {
  const bodies = Array.isArray(spec.body) ? spec.body.length : spec.body?.trim() ? 1 : 0;
  if (spec.visual) return bodies ? "title-visual-text" : "full-bleed";
  if (!bodies) return index === 0 ? "title-only" : "statement";
  if (Array.isArray(spec.body) && spec.body.length === 3) return "three-ideas";
  if (Array.isArray(spec.body) && spec.body.length === 2) return "two-column";
  return "title-content";
}

function titleOf(slide: PresentationSlide) {
  return slide.objects.find((object) => object.type === "text" && !object.hidden);
}

function bodyObjects(slide: PresentationSlide, title: PresentationObject | undefined) {
  return slide.objects.filter(
    (object) =>
      object.id !== title?.id &&
      (object.type === "text" ||
        (object.type === "shape" && slide.layoutId === "three-ideas" && presentationObjectText(object).trim())),
  );
}

function fillSlide(
  slide: PresentationSlide,
  spec: SlideSpec,
  layout: PresentationLayoutId,
  ids: IdFactory,
  label: string,
) {
  let title = titleOf(slide);
  if (spec.title !== undefined) {
    const value = String(spec.title).trim();
    slide.title = value;
    if (title) Object.assign(title, withPresentationObjectText(title, value));
    else if (value) {
      title = titleObject(value, slide.objects.length + 1, ids);
      slide.objects.unshift(title);
    }
  }
  if (spec.body !== undefined) {
    const keep = new Set(bodyObjects(slide, title).map((object) => object.id));
    slide.objects = slide.objects.filter((object) => !keep.has(object.id));
    const entries = (Array.isArray(spec.body) ? spec.body : [spec.body]).map(String).filter((entry) => entry.trim());
    entries.forEach((entry) =>
      slide.objects.push(textObject(entry, slide.objects.length + 1, ids, layout === "three-ideas")),
    );
  }
  if (spec.visual !== undefined) {
    const visuals = new Set(
      slide.objects.filter((object) => object.id !== title?.id && VISUAL_TYPES.has(object.type) &&
        !(object.type === "shape" && layout === "three-ideas")).map((object) => object.id),
    );
    slide.objects = slide.objects.filter((object) => !visuals.has(object.id));
    if (spec.visual) slide.objects.push(visualObject(spec.visual, slide.objects.length + 1, ids, label));
  }
  if (spec.notes !== undefined) slide.speakerNotes = String(spec.notes);
}

function newSlide(ids: IdFactory): PresentationSlide {
  return {
    id: ids("slide"),
    title: "",
    layoutId: "title-content",
    transition: { kind: "fade", durationMs: 350 },
    objects: [],
    speakerNotes: "",
  };
}

function layoutSlide(deck: PresentationContent, index: number, layout: PresentationLayoutId) {
  applyPresentationLayout(deck, index, layout, { createMissing: false, mode: "generated" });
  // Grow text boxes to their copy, as the studio's generated layout does.
  fitGeneratedSlide(deck, deck.slides[index]!, new Set());
}

function applyTheme(deck: PresentationContent, spec: ThemeSpec, label: string) {
  const tokens = { ...(deck.theme.tokens ?? {}) };
  for (const key of ["background", "heading", "body", "accent"] as const) {
    const value = spec[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value.trim())
      throw new AuthoringError(`${label}: ${key} must be a colour such as "#123456".`);
    tokens[key] = value.trim();
  }
  deck.theme = {
    ...deck.theme,
    id: deck.theme.id === "spectra-default" && spec.name ? "custom" : deck.theme.id,
    ...(spec.name ? { name: spec.name } : {}),
    tokens,
    fonts: {
      ...deck.theme.fonts,
      ...(spec.headingFont ? { heading: spec.headingFont } : {}),
      ...(spec.bodyFont ? { body: spec.bodyFont } : {}),
    },
  };
}

function replaceInObject(object: PresentationObject, find: string, replace: string, all: boolean) {
  const content = record(object.content);
  if (Array.isArray(content.paragraphs)) {
    let replaced = false;
    const paragraphs = content.paragraphs.map((paragraph) => {
      const value = record(paragraph);
      return {
        ...value,
        runs: (Array.isArray(value.runs) ? value.runs : []).map((run) => {
          const runValue = record(run);
          const runText = typeof runValue.text === "string" ? runValue.text : "";
          if ((replaced && !all) || !runText.includes(find)) return runValue;
          replaced = true;
          return { ...runValue, text: all ? runText.split(find).join(replace) : runText.replace(find, () => replace) };
        }),
      };
    });
    if (replaced) {
      return {
        ...object,
        content: { ...content, paragraphs, text: paragraphsText(paragraphs as unknown as PresentationParagraph[]) },
      };
    }
  }
  const current = presentationObjectText(object);
  if (!current.includes(find)) return object;
  return withPresentationObjectText(object, all ? current.split(find).join(replace) : current.replace(find, () => replace));
}

function countIn(haystack: string, needle: string) {
  return haystack.split(needle).length - 1;
}

function replaceAcrossDeck(deck: PresentationContent, op: { find: string; replace: string; all?: boolean }, label: string) {
  if (!op.find) throw new AuthoringError(`${label}: \`find\` is empty.`);
  let total = 0;
  for (const slide of deck.slides) {
    for (const object of slide.objects) total += countIn(presentationObjectText(object), op.find);
    total += countIn(slide.speakerNotes ?? "", op.find);
  }
  if (!total) throw new AuthoringError(`${label}: \`find\` text was not found on any slide or in the notes.`);
  if (total > 1 && !op.all)
    throw new AuthoringError(`${label}: \`find\` text appears ${total} times. Include more text, or set "all": true.`);
  for (const slide of deck.slides) {
    slide.objects = slide.objects.map((object) => replaceInObject(object, op.find, op.replace, Boolean(op.all)));
    const title = titleOf(slide);
    if (title) slide.title = presentationObjectText(title);
    if (slide.speakerNotes?.includes(op.find))
      slide.speakerNotes = op.all ? slide.speakerNotes.split(op.find).join(op.replace) : slide.speakerNotes.replace(op.find, () => op.replace);
  }
}

/** Applies slide operations to a copy of the deck. Throws naming the failing op. */
export function applyPresentationEdits(
  content: unknown,
  ops: PresentationEditOp[],
  ids: IdFactory = defaultIdFactory(),
): PresentationContent {
  const deck = content ? normalizePresentationContent(structuredClone(content)) : emptyDeck();
  if (!Array.isArray(ops) || !ops.length) throw new AuthoringError("No operations were given.");
  ops.forEach((op, index) => {
    const label = `Edit ${index + 1} (${String(op?.op)})`;
    switch (op?.op) {
      case "add_slide": {
        const at = op.position === undefined ? deck.slides.length : Number(op.position) - 1;
        if (!Number.isInteger(at) || at < 0 || at > deck.slides.length)
          throw new AuthoringError(`${label}: position must be from 1 to ${deck.slides.length + 1}.`);
        if (!op.title?.trim() && !op.body && !op.visual)
          throw new AuthoringError(`${label}: a slide needs a title, body or visual.`);
        const layout = layoutOf(op, defaultLayout(op, at), label);
        const slide = newSlide(ids);
        deck.slides.splice(at, 0, slide);
        fillSlide(slide, op, layout, ids, label);
        layoutSlide(deck, at, layout);
        break;
      }
      case "update_slide": {
        const at = slideNumber(deck, op.slide, label);
        const slide = deck.slides[at]!;
        const current = isPresentationLayoutId(slide.layoutId) ? slide.layoutId : "title-content";
        const layout = layoutOf(op, current, label);
        slide.layoutId = layout;
        fillSlide(slide, op, layout, ids, label);
        if (op.layout !== undefined || op.body !== undefined || op.visual !== undefined) layoutSlide(deck, at, layout);
        break;
      }
      case "delete_slide": {
        const at = slideNumber(deck, op.slide, label);
        if (deck.slides.length === 1) throw new AuthoringError(`${label}: a presentation keeps at least one slide.`);
        deck.slides.splice(at, 1);
        break;
      }
      case "move_slide": {
        const from = slideNumber(deck, op.slide, label);
        const to = slideNumber(deck, op.to, label, "to");
        const [slide] = deck.slides.splice(from, 1);
        deck.slides.splice(to, 0, slide!);
        break;
      }
      case "set_theme":
        applyTheme(deck, op, label);
        break;
      case "replace":
        replaceAcrossDeck(deck, op, label);
        break;
      default:
        throw new AuthoringError(
          `${label}: unknown operation. Use add_slide, update_slide, delete_slide, move_slide, set_theme or replace.`,
        );
    }
  });
  if (!deck.slides.length) throw new AuthoringError("A presentation needs at least one slide.");
  return ensurePresentationReadingOrders(deck);
}

/** A whole new deck from slide specs. */
export function presentationFromSpec(spec: PresentationSpec, ids: IdFactory = defaultIdFactory()) {
  if (!Array.isArray(spec?.slides) || !spec.slides.length)
    throw new AuthoringError("slides: give at least one slide.");
  const ops: PresentationEditOp[] = [
    ...(spec.theme ? [{ op: "set_theme" as const, ...spec.theme }] : []),
    ...spec.slides.map((slide) => ({ op: "add_slide" as const, ...slide })),
  ];
  return applyPresentationEdits(null, ops, ids);
}

// ---------------------------------------------------------------- reading

function objectSummary(object: PresentationObject) {
  if (object.type === "chart") {
    const content = record(object.content);
    return `[${String(content.chartType ?? "chart")} chart${content.title ? `: ${String(content.title)}` : ""}]`;
  }
  if (object.type === "table") return `[table, ${(record(object.content).rows as unknown[] | undefined)?.length ?? 0} rows]`;
  if (object.type === "image") return `[image: ${object.altText ?? "no alt text"}]`;
  return presentationObjectText(object).replace(/\n+/g, " / ");
}

/** Each slide with its layout, text, visuals and notes; used by read_artifact. */
export function presentationOutline(content: unknown, options: { max?: number; slides?: [number, number] } = {}) {
  const deck = normalizePresentationContent(content);
  const [from, to] = options.slides ?? [1, deck.slides.length];
  const lines = deck.slides.slice(from - 1, to).map((slide, offset) => {
    const title = titleOf(slide);
    const parts = slide.objects
      .filter((object) => object.id !== title?.id && !object.hidden)
      .map(objectSummary)
      .filter(Boolean);
    return [
      `${from + offset}. [${slide.layoutId ?? "free"}] ${title ? presentationObjectText(title) : "(no title)"}`,
      ...parts.map((part) => `   ${part}`),
      ...(slide.speakerNotes?.trim() ? [`   notes: ${slide.speakerNotes.trim().replace(/\n+/g, " ")}`] : []),
    ].join("\n");
  });
  return truncate(lines.join("\n"), options.max ?? 6_000);
}

/** Slides that are empty, hold placeholder copy, overflow or miss a layout role. */
export function presentationProblems(content: unknown) {
  const deck = normalizePresentationContent(content);
  const problems: string[] = [];
  deck.slides.forEach((slide, index) => {
    const visible = slide.objects.filter((object) => !object.hidden);
    const label = `Slide ${index + 1}`;
    if (!visible.length) {
      problems.push(`${label} is empty`);
      return;
    }
    for (const object of visible) {
      const value = presentationObjectText(object).trim();
      const placeholder =
        object.type === "text"
          ? isPlaceholder(value)
          : object.type === "shape" && (value ? isPlaceholder(value) : slide.layoutId === "three-ideas");
      if (placeholder)
        problems.push(`${label} has an empty or placeholder ${object.type === "text" ? "text box" : "shape"}`);
      else if (object.type === "text" && estimateTextOverflow(object))
        problems.push(`${label}: "${truncate(presentationObjectText(object), 40)}" overflows its box; shorten it or split the slide`);
    }
    for (const issue of presentationLayoutRoleIssues(slide)) problems.push(`${label}: ${issue}`);
  });
  return problems;
}

export function presentationReadback(content: unknown, previous?: unknown) {
  const deck = normalizePresentationContent(content);
  const before = previous ? normalizePresentationContent(previous) : null;
  const priorIds = new Map(before?.slides.map((slide) => [slide.id, JSON.stringify(slide)]) ?? []);
  const lines = [`${deck.slides.length} slides.`];
  const problems = presentationProblems(deck);
  if (problems.length) lines.push(`Problems: ${problems.join("; ")}.`);
  if (before) {
    const changed = deck.slides
      .map((slide, index) => ({ slide, index }))
      .filter(({ slide }) => priorIds.get(slide.id) !== JSON.stringify(slide));
    const removed = before.slides.length - deck.slides.filter((slide) => priorIds.has(slide.id)).length;
    lines.push(
      changed.length
        ? `Changed or new slides:\n${changed
            .map(({ index }) => presentationOutline(deck, { slides: [index + 1, index + 1], max: 600 }))
            .join("\n")}`
        : "No slide content changed.",
    );
    if (removed > 0) lines.push(`${removed} slide${removed === 1 ? "" : "s"} removed.`);
  } else lines.push(presentationOutline(deck, { max: 2_400 }));
  return lines.join("\n");
}
