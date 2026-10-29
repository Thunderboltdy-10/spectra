"use client";

/**
 * Local geometry resolution for the interaction fabric.
 *
 * Nothing here trusts a remote pixel. A peer publishes *which control* and
 * *which character*; this module answers *where that is on my screen right now*.
 * That inversion is what makes presence correct across pane widths, scroll
 * offsets, browser zoom, CSS transforms, split versus full layouts and reflowed
 * text — the cases where the previous normalized-coordinate approach silently
 * pointed at the wrong glyph.
 *
 * All returned coordinates are in **surface space**: CSS pixels relative to the
 * presence surface's padding box, already divided by any ancestor scale, so the
 * overlay can position children with plain `left`/`top`.
 */

import {
  canonicalPath,
  pathSegments,
  type SemanticTarget,
  type TextPoint,
  type TextSpan,
} from "./interaction-model";

/** Marks the scroll container that presence is painted over. */
export const SURFACE_ATTRIBUTE = "data-spectra-surface";
/** Marks a control with its canonical content path. */
export const TARGET_ATTRIBUTE = "data-spectra-target";
/** Marks a sub-element of a control, e.g. `handle:se`. */
export const PART_ATTRIBUTE = "data-spectra-part";
/** Marks an explicit line inside a multiline control. */
export const LINE_ATTRIBUTE = "data-spectra-line";

export type SurfaceBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SurfaceRect = SurfaceBox;

export type SurfaceFrame = {
  /** The scroll container searched for targets. */
  element: HTMLElement;
  /** Viewport rect of the surface, used for visibility tests. */
  rect: DOMRect;
  /**
   * Viewport rect of the overlay's own origin node. Positions are expressed
   * relative to this, because the overlay is a sticky zero-height node pinned to
   * the scroll viewport while `element` spans the scrolling content.
   */
  origin: DOMRect;
  /** Combined ancestor scale, so transformed/zoomed panes stay accurate. */
  scale: number;
};

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function")
    return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * Effective scale of an element, derived by comparing its rendered rect to its
 * layout size. Catches CSS `transform: scale`, `zoom`, and browser pinch-zoom
 * in one measurement rather than trying to enumerate transform ancestors.
 */
export function measureScale(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const layoutWidth = element.offsetWidth;
  if (!layoutWidth || !rect.width) return 1;
  const scale = rect.width / layoutWidth;
  return Number.isFinite(scale) && scale > 0.05 ? scale : 1;
}

export function resolveSurfaceFrame(
  element: HTMLElement,
  originElement?: HTMLElement | null,
): SurfaceFrame {
  const rect = element.getBoundingClientRect();
  return {
    element,
    rect,
    origin: originElement ? originElement.getBoundingClientRect() : rect,
    scale: measureScale(element),
  };
}

/** Convert a viewport rect into surface space. */
export function toSurfaceBox(frame: SurfaceFrame, rect: DOMRect): SurfaceBox {
  const scale = frame.scale || 1;
  return {
    left: (rect.left - frame.origin.left) / scale,
    top: (rect.top - frame.origin.top) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

/* ------------------------------------------------------------------ *
 * Target -> element
 * ------------------------------------------------------------------ */

/** A block segment's id as the page writes it: paths carry it encoded (Word ids hold colons). */
function blockIdOf(segment: string) {
  const raw = segment.startsWith("id:") ? segment.slice(3) : segment;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Candidate selectors for a target, in descending order of trust.
 *
 * The canonical `data-spectra-target` comes first. Everything after it exists so
 * a not-yet-annotated editor degrades to a *containing* element rather than to a
 * wrong one — and `resolveTargetElement` reports which precision it achieved so
 * callers can choose to draw a coarse affordance instead of a fake caret.
 */
function candidateSelectors(target: SemanticTarget): string[] {
  const path = canonicalPath(target.path);
  const selectors = [`[${TARGET_ATTRIBUTE}="${cssEscape(path)}"]`];

  // Legacy `data-ai-path` accepted both bare and /content-prefixed forms.
  selectors.push(`[data-ai-path="${cssEscape(path)}"]`);
  selectors.push(`[data-ai-path="${cssEscape(`/content${path}`)}"]`);

  const segments = pathSegments(path);

  // Documents address blocks by stable id, which survives reflow and reorder.
  if (segments[0] === "blocks" && segments[1]) {
    selectors.push(`[data-block-id="${cssEscape(blockIdOf(segments[1]))}"]`);
  }

  // Sheets address cells A1-style.
  if (segments[0] === "sheets" && segments[2] === "cells" && segments[3]) {
    selectors.push(`[data-address="${cssEscape(segments[3])}"]`);
  }

  if (target.regionId) {
    selectors.push(`[data-region-id="${cssEscape(target.regionId)}"]`);
    selectors.push(`[data-spectra-region="${cssEscape(target.regionId)}"]`);
  }

  return selectors;
}

export type TargetResolution = {
  element: HTMLElement;
  /**
   * `exact` — the element is the control itself.
   * `container` — an ancestor of the control; draw a container affordance, never
   *   a caret, because character offsets cannot be trusted here.
   */
  precision: "exact" | "container";
  /** The sub-element for `target.part`, when the editor exposes one. */
  part?: HTMLElement;
};

/**
 * Find the element for a target within a root. Walks up the path to find the
 * nearest annotated ancestor when the exact control is absent — which happens
 * legitimately when a collaborator is on another slide, a virtualized row is
 * unmounted, or a collapsed section hides the field.
 */
export function resolveTargetElement(
  root: HTMLElement,
  target: SemanticTarget,
): TargetResolution | null {
  for (const selector of candidateSelectors(target)) {
    const found = queryVisible(root, selector);
    if (found) {
      return {
        element: found,
        precision: "exact",
        ...(target.part ? { part: resolvePart(found, target.part) } : {}),
      };
    }
  }

  // Ancestor fallback: shorten the path one segment at a time.
  const segments = pathSegments(target.path);
  for (let length = segments.length - 1; length > 0; length -= 1) {
    const ancestorPath = `/${segments.slice(0, length).join("/")}`;
    const found =
      queryVisible(
        root,
        `[${TARGET_ATTRIBUTE}="${cssEscape(ancestorPath)}"]`,
      ) ??
      (segments[0] === "blocks" && length >= 2
        ? queryVisible(
            root,
            `[data-block-id="${cssEscape(blockIdOf(segments[1]!))}"]`,
          )
        : null);
    if (found) return { element: found, precision: "container" };
  }

  return null;
}

function queryVisible(root: HTMLElement, selector: string): HTMLElement | null {
  let candidates: NodeListOf<HTMLElement>;
  try {
    candidates = root.querySelectorAll<HTMLElement>(selector);
  } catch {
    return null;
  }
  for (const found of candidates) {
    const hiddenTarget = found.closest<HTMLElement>(
      '[data-spectra-hidden-target="true"]',
    );
    if (
      hiddenTarget &&
      (!document.activeElement ||
        !hiddenTarget.contains(document.activeElement))
    )
      continue;
    // A zero-box element is present but not paintable (collapsed, display:none
    // ancestor, virtualized-out). Keep searching: editors may render a
    // non-interactive preview and the native control with the same semantic
    // path (slide thumbnails are the common example).
    const rect = found.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) continue;
    return found;
  }
  return null;
}

function resolvePart(
  element: HTMLElement,
  part: string,
): HTMLElement | undefined {
  const found = element.querySelector<HTMLElement>(
    `[${PART_ATTRIBUTE}="${cssEscape(part)}"]`,
  );
  return found ?? undefined;
}

/* ------------------------------------------------------------------ *
 * Text geometry
 * ------------------------------------------------------------------ */

function isFormField(
  element: HTMLElement,
): element is HTMLInputElement | HTMLTextAreaElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  );
}

/**
 * Narrow an element to the line a text point refers to. Uses explicit line
 * marks first, then the structures that genuinely define visual lines per
 * editor: CodeMirror rows, list items, then block children.
 */
function resolveLineScope(element: HTMLElement, line: number): HTMLElement {
  const groups = [
    `:scope [${LINE_ATTRIBUTE}]`,
    ":scope > .cm-line",
    ":scope .cm-line",
    ":scope > li",
    ":scope > ul > li, :scope > ol > li",
    ":scope > p, :scope > div",
  ];
  for (const selector of groups) {
    let items: HTMLElement[];
    try {
      items = Array.from(element.querySelectorAll<HTMLElement>(selector));
    } catch {
      continue;
    }
    if (items.length <= 1) continue;
    const item = items[Math.min(Math.max(line, 0), items.length - 1)];
    if (!item) continue;
    const paragraph = item.querySelector<HTMLElement>(":scope > p");
    return paragraph ?? item;
  }
  return element;
}

function textNodesUnder(element: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    // Words a collaborator has not written yet are in the room but hidden.
    if (!current.parentElement?.closest("[data-spectra-unwritten]")) nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

/** Locate a character offset among an element's text nodes. */
function locateOffset(
  nodes: readonly Text[],
  offset: number,
): { node: Text; offset: number } | null {
  if (!nodes.length) return null;
  let consumed = 0;
  for (const node of nodes) {
    const length = node.data.length;
    if (consumed + length >= offset) {
      return { node, offset: Math.max(0, Math.min(length, offset - consumed)) };
    }
    consumed += length;
  }
  const last = nodes[nodes.length - 1]!;
  return { node: last, offset: last.data.length };
}

/* --- form-field measurement ---------------------------------------- */

let measureCanvas: HTMLCanvasElement | null = null;

/**
 * Width of a text run as the browser would lay it out inside `element`.
 * `<input>` has no text nodes, so a caret inside a plain field cannot be found
 * with a Range; measuring against the field's own computed font is the only way
 * to place it on the correct character.
 */
function measureTextWidth(element: HTMLElement, text: string): number {
  if (!text) return 0;
  measureCanvas ??= document.createElement("canvas");
  const context = measureCanvas.getContext("2d");
  if (!context) return 0;
  const style = window.getComputedStyle(element);
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
  const spacing = Number.parseFloat(style.letterSpacing);
  const width = context.measureText(text).width;
  return Number.isFinite(spacing) && spacing !== 0
    ? width + spacing * text.length
    : width;
}

/**
 * Caret rect inside an `<input>`/`<textarea>`, honouring padding, border,
 * horizontal scroll, and text alignment.
 */
function formFieldCaretRect(
  field: HTMLInputElement | HTMLTextAreaElement,
  point: TextPoint,
): DOMRect | null {
  const rect = field.getBoundingClientRect();
  const style = window.getComputedStyle(field);
  const value = field.value ?? "";
  const lines = value.split("\n");
  const lineIndex =
    typeof point.line === "number"
      ? Math.min(Math.max(point.line, 0), lines.length - 1)
      : 0;
  const lineText = lines[lineIndex] ?? "";
  const prefix = lineText.slice(
    0,
    Math.max(0, Math.min(point.offset, lineText.length)),
  );

  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
  const fontSize = Number.parseFloat(style.fontSize) || 13;
  const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.4;

  let x = rect.left + borderLeft + paddingLeft - field.scrollLeft;
  const prefixWidth = measureTextWidth(field, prefix);

  if (style.textAlign === "center" || style.textAlign === "right") {
    const inner =
      rect.width -
      borderLeft -
      (Number.parseFloat(style.borderRightWidth) || 0) -
      paddingLeft -
      (Number.parseFloat(style.paddingRight) || 0);
    const full = measureTextWidth(field, lineText);
    const slack = Math.max(0, inner - full);
    x += style.textAlign === "center" ? slack / 2 : slack;
  }

  x += prefixWidth;
  const y =
    rect.top +
    borderTop +
    paddingTop +
    lineIndex * lineHeight -
    field.scrollTop;

  return new DOMRect(x, y, 0, Math.min(lineHeight, rect.height));
}

/* --- public text geometry ------------------------------------------ */

/**
 * Viewport caret rect for a text point inside a resolved control. Returns null
 * when the offset cannot be located honestly — callers must then fall back to a
 * control-level affordance instead of inventing a position.
 */
export function caretRectFor(
  element: HTMLElement,
  point: TextPoint,
): DOMRect | null {
  if (isFormField(element)) return formFieldCaretRect(element, point);

  const scope =
    typeof point.line === "number"
      ? resolveLineScope(element, point.line)
      : element;
  const nodes = textNodesUnder(scope);
  if (!nodes.length) {
    // Empty paragraph or freshly created block: the start of the box is true.
    const rect = scope.getBoundingClientRect();
    if (rect.height <= 0) return null;
    return new DOMRect(rect.left, rect.top, 0, rect.height);
  }
  const located = locateOffset(nodes, point.offset);
  if (!located) return null;
  try {
    const range = document.createRange();
    range.setStart(located.node, located.offset);
    range.setEnd(located.node, located.offset);
    const rects = Array.from(range.getClientRects());
    const usable = rects.find((rect) => rect.height > 0);
    if (usable) return usable;
    const bounding = range.getBoundingClientRect();
    return bounding.height > 0 ? bounding : null;
  } catch {
    return null;
  }
}

/**
 * Viewport rects covering a text span. Multiple rects are returned for spans
 * that wrap, so a remote selection paints as real line boxes rather than one
 * blunt rectangle over unrelated content.
 */
export function selectionRectsFor(
  element: HTMLElement,
  span: TextSpan,
): DOMRect[] {
  const { anchor, head } = orderSpan(span);

  if (isFormField(element)) {
    // Fields cannot expose per-character rects; approximate with the run
    // between the two carets on each covered line.
    const start = formFieldCaretRect(element, anchor);
    const end = formFieldCaretRect(element, head);
    if (!start || !end) return [];
    if (Math.abs(start.top - end.top) < 1) {
      const left = Math.min(start.left, end.left);
      return [
        new DOMRect(
          left,
          start.top,
          Math.abs(end.left - start.left),
          start.height,
        ),
      ];
    }
    const rect = element.getBoundingClientRect();
    return [
      new DOMRect(start.left, start.top, rect.right - start.left, start.height),
      new DOMRect(rect.left, end.top, end.left - rect.left, end.height),
    ];
  }

  const sameLine =
    anchor.line === head.line ||
    (anchor.line === undefined && head.line === undefined);
  const startScope =
    typeof anchor.line === "number"
      ? resolveLineScope(element, anchor.line)
      : element;
  const endScope =
    typeof head.line === "number"
      ? resolveLineScope(element, head.line)
      : element;

  const startNodes = textNodesUnder(startScope);
  const endNodes =
    sameLine && startScope === endScope ? startNodes : textNodesUnder(endScope);
  const start = locateOffset(startNodes, anchor.offset);
  const end = locateOffset(endNodes, head.offset);
  if (!start || !end) return [];

  try {
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    if (range.collapsed) {
      const caret = caretRectFor(element, anchor);
      return caret ? [caret] : [];
    }
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.height > 0 && rect.width > 0,
    );
    if (rects.length) return rects;
    const bounding = range.getBoundingClientRect();
    return bounding.height > 0 ? [bounding] : [];
  } catch {
    return [];
  }
}

function orderSpan(span: TextSpan): TextSpan {
  const { anchor, head } = span;
  const anchorLine = anchor.line ?? 0;
  const headLine = head.line ?? 0;
  if (
    anchorLine > headLine ||
    (anchorLine === headLine && anchor.offset > head.offset)
  )
    return { anchor: head, head: anchor };
  return span;
}

/* ------------------------------------------------------------------ *
 * Local point -> semantic target
 * ------------------------------------------------------------------ */

/**
 * Which control is under a pointer, and where inside it. Runs on the *acting*
 * client so the published state names a semantic control, never a coordinate.
 */
export function hitTest(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): {
  path: string;
  part?: string;
  element: HTMLElement;
  fraction: { x: number; y: number };
} | null {
  const direct = document.elementFromPoint(clientX, clientY);
  if (!(direct instanceof Element) || !root.contains(direct)) return null;

  const control = direct.closest<HTMLElement>(`[${TARGET_ATTRIBUTE}]`);
  if (!control || !root.contains(control)) return null;
  const path = control.getAttribute(TARGET_ATTRIBUTE);
  if (!path) return null;

  const partElement = direct.closest<HTMLElement>(`[${PART_ATTRIBUTE}]`);
  const part =
    partElement && control.contains(partElement)
      ? (partElement.getAttribute(PART_ATTRIBUTE) ?? undefined)
      : undefined;

  const rect = control.getBoundingClientRect();
  return {
    path: canonicalPath(path),
    ...(part ? { part } : {}),
    element: control,
    fraction: {
      x: rect.width
        ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
        : 0,
      y: rect.height
        ? Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
        : 0,
    },
  };
}

/**
 * Character offset nearest a viewport point inside a control — used to publish
 * an accurate caret when a collaborator clicks into text.
 */
export function textPointAtClient(
  element: HTMLElement,
  clientX: number,
  clientY: number,
): TextPoint | null {
  if (isFormField(element)) {
    const value = element.value ?? "";
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
    const local =
      clientX - rect.left - borderLeft - paddingLeft + element.scrollLeft;
    let best = 0;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let index = 0; index <= value.length; index += 1) {
      const delta = Math.abs(
        measureTextWidth(element, value.slice(0, index)) - local,
      );
      if (delta < bestDelta) {
        bestDelta = delta;
        best = index;
      }
    }
    return { offset: best };
  }

  const caret = caretPositionFromPoint(clientX, clientY);
  if (!caret || !element.contains(caret.node)) return null;
  const nodes = textNodesUnder(element);
  let consumed = 0;
  for (const node of nodes) {
    if (node === caret.node) return { offset: consumed + caret.offset };
    consumed += node.data.length;
  }
  return { offset: consumed };
}

function caretPositionFromPoint(
  clientX: number,
  clientY: number,
): { node: Node; offset: number } | null {
  const target = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof target.caretPositionFromPoint === "function") {
    const position = target.caretPositionFromPoint(clientX, clientY);
    if (position) return { node: position.offsetNode, offset: position.offset };
  }
  if (typeof target.caretRangeFromPoint === "function") {
    const range = target.caretRangeFromPoint(clientX, clientY);
    if (range) return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Composite placement
 * ------------------------------------------------------------------ */

export type OffSurfaceEdge = "top" | "bottom" | "left" | "right";

/**
 * Where to paint an actor's presence, plus enough context to paint the right
 * *kind* of affordance.
 *
 * `offSurface` is set when the target is scrolled out of the visible surface. It
 * exists so a collaborator who has scrolled away shows a calm edge marker
 * instead of a cursor clamped to the surface border — the previous behaviour
 * that made cursors appear to hover over unrelated controls.
 */
export type InteractionPlacement = {
  /** Box of the control itself. */
  box: SurfaceBox;
  /** Anchor point for the cursor glyph. */
  point: { left: number; top: number };
  /** Caret box when the act places a caret. */
  caret?: SurfaceBox;
  /** Selection line boxes when the act selects a span. */
  selection?: SurfaceBox[];
  /** Box of the addressed sub-part, e.g. a resize handle. */
  part?: SurfaceBox;
  precision: "exact" | "container";
  offSurface?: OffSurfaceEdge;
};

/**
 * Whether a box falls outside the visible surface, and on which side. Callers
 * draw a calm edge marker in that direction instead of clamping a cursor to the
 * border, which previously made collaborators appear to hover over whatever
 * happened to be at the edge.
 */
export function offSurfaceEdge(
  frame: SurfaceFrame,
  box: SurfaceBox,
): OffSurfaceEdge | undefined {
  const scale = frame.scale || 1;
  // The visible viewport of the scroll container, in overlay-origin space.
  const viewport = {
    left: (frame.rect.left - frame.origin.left) / scale,
    top: (frame.rect.top - frame.origin.top) / scale,
    width: frame.rect.width / scale,
    height: frame.rect.height / scale,
  };
  if (box.top + box.height < viewport.top) return "top";
  if (box.top > viewport.top + viewport.height) return "bottom";
  if (box.left + box.width < viewport.left) return "left";
  if (box.left > viewport.left + viewport.width) return "right";
  return undefined;
}

export type PlacementRequest = {
  target: SemanticTarget;
  /** Caret point, when the act carries one. */
  point?: TextPoint;
  /** Selection span, when the act carries one. */
  span?: TextSpan;
  /** Pointer fraction inside the control, for hover and drag. */
  fraction?: { x: number; y: number };
};

/**
 * Resolve a full placement for one actor. Single entry point used by the
 * rendering layer, so cursors, carets, selections and handles can never drift
 * apart into separate coordinate systems.
 */
export function resolvePlacement(
  frame: SurfaceFrame,
  request: PlacementRequest,
): InteractionPlacement | null {
  const resolved = resolveTargetElement(frame.element, request.target);
  if (!resolved) return null;

  const box = toSurfaceBox(frame, resolved.element.getBoundingClientRect());
  const placement: InteractionPlacement = {
    box,
    point: { left: box.left, top: box.top },
    precision: resolved.precision,
  };

  const edge = offSurfaceEdge(frame, box);
  if (edge) placement.offSurface = edge;

  if (resolved.part) {
    placement.part = toSurfaceBox(frame, resolved.part.getBoundingClientRect());
  }

  // Caret and selection are only trustworthy on an exactly resolved control.
  if (resolved.precision === "exact") {
    if (request.span) {
      const rects = selectionRectsFor(resolved.element, request.span);
      if (rects.length) {
        placement.selection = rects.map((rect) => toSurfaceBox(frame, rect));
        const last = placement.selection[placement.selection.length - 1]!;
        placement.point = {
          left: last.left + last.width,
          top: last.top,
        };
        placement.caret = { ...last, left: last.left + last.width, width: 0 };
        return placement;
      }
    }
    if (request.point) {
      const rect = caretRectFor(resolved.element, request.point);
      if (rect) {
        const caret = toSurfaceBox(frame, rect);
        placement.caret = caret;
        placement.point = { left: caret.left, top: caret.top };
        return placement;
      }
    }
  }

  if (placement.part) {
    placement.point = {
      left: placement.part.left + placement.part.width / 2,
      top: placement.part.top + placement.part.height / 2,
    };
    return placement;
  }

  if (request.fraction) {
    placement.point = {
      left: box.left + box.width * request.fraction.x,
      top: box.top + box.height * request.fraction.y,
    };
    return placement;
  }

  // No sub-position available: sit just inside the control's leading edge, which
  // reads as "at this control" without pretending to a character position.
  placement.point = {
    left: box.left + Math.min(10, box.width * 0.08),
    top: box.top + Math.min(10, box.height * 0.3),
  };
  return placement;
}

/** Scroll a target into view without stealing focus. */
export function revealTarget(
  root: HTMLElement,
  target: SemanticTarget,
  options?: { reducedMotion?: boolean },
): boolean {
  const resolved = resolveTargetElement(root, target);
  if (!resolved) return false;
  resolved.element.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: options?.reducedMotion ? "auto" : "smooth",
  });
  return true;
}

/**
 * Reveal that retries when the control is not mounted yet (view switch, slide
 * change). A single 120ms one-shot used to drop the first beat silently.
 */
export function scheduleRevealTarget(
  getRoot: () => HTMLElement | null,
  target: SemanticTarget,
  options?: {
    reducedMotion?: boolean;
    attempts?: number;
    intervalMs?: number;
  },
): () => void {
  const attempts = options?.attempts ?? 8;
  const intervalMs = options?.intervalMs ?? 80;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  const tick = () => {
    if (cancelled) return;
    const root = getRoot();
    if (root && revealTarget(root, target, options)) return;
    attempt += 1;
    if (attempt >= attempts) return;
    timer = setTimeout(tick, intervalMs);
  };
  tick();
  return () => {
    cancelled = true;
    if (timer !== null) clearTimeout(timer);
  };
}
