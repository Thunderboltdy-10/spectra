"use client";

import type {
  CollaborationCursor,
  CollaborationSelection,
  CollaborationSelectionRange,
} from "../collaboration/types";

const ANCHOR_SELECTOR = [
  "[data-block-id]",
  "[data-address]",
  "[data-region-id]",
  "[data-ai-region='true']",
  "[data-spectra-region]",
  "input, textarea, select, [contenteditable='true']",
].join(",");

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function")
    return CSS.escape(value);
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function offsetsWithin(rect: DOMRect, clientX: number, clientY: number) {
  if (!rect.width || !rect.height) return undefined;
  return {
    offsetX: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    offsetY: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
  };
}

/**
 * Resolve the nearest semantic editor target under a pointer so collaborator
 * cursors can be anchored independently of pane size / scroll position.
 */
export function resolvePresenceAnchorFromPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): CollaborationCursor["anchor"] | undefined {
  const direct = document.elementFromPoint(clientX, clientY);
  if (!(direct instanceof Element) || !root.contains(direct)) return undefined;
  const target = direct.closest(ANCHOR_SELECTOR);
  if (!(target instanceof HTMLElement) || !root.contains(target))
    return undefined;
  const rect = target.getBoundingClientRect();
  const offsets = offsetsWithin(rect, clientX, clientY);
  const blockId = target.getAttribute("data-block-id");
  if (blockId)
    return {
      kind: "block",
      id: blockId,
      ...(offsets
        ? { offsetX: offsets.offsetX, offsetY: offsets.offsetY, offset: offsets.offsetX }
        : {}),
    };
  const address = target.getAttribute("data-address");
  if (address)
    return {
      kind: "address",
      id: address,
      ...(offsets
        ? { offsetX: offsets.offsetX, offsetY: offsets.offsetY, offset: offsets.offsetX }
        : {}),
    };
  const regionId =
    target.getAttribute("data-region-id") ||
    target.getAttribute("data-spectra-region");
  if (regionId)
    return {
      kind: "region",
      id: regionId,
      ...(offsets
        ? { offsetX: offsets.offsetX, offsetY: offsets.offsetY, offset: offsets.offsetX }
        : {}),
    };
  if (target.hasAttribute("data-ai-region")) {
    const labeled =
      target.getAttribute("data-block-id") ||
      target.getAttribute("data-address") ||
      target.getAttribute("data-region-id");
    if (labeled)
      return {
        kind: "block",
        id: labeled,
        ...(offsets
          ? {
              offsetX: offsets.offsetX,
              offsetY: offsets.offsetY,
              offset: offsets.offsetX,
            }
          : {}),
      };
  }
  if (
    target.matches("input, textarea, select, [contenteditable='true']") &&
    target.id
  )
    return {
      kind: "selector",
      id: `#${cssEscape(target.id)}`,
      ...(offsets
        ? { offsetX: offsets.offsetX, offsetY: offsets.offsetY, offset: offsets.offsetX }
        : {}),
    };
  return undefined;
}

export function resolvePresenceAnchorElement(
  root: HTMLElement,
  anchor: NonNullable<CollaborationCursor["anchor"]>,
): HTMLElement | null {
  if (anchor.kind === "block")
    return root.querySelector(`[data-block-id="${cssEscape(anchor.id)}"]`);
  if (anchor.kind === "address")
    return root.querySelector(`[data-address="${cssEscape(anchor.id)}"]`);
  if (anchor.kind === "region")
    return (
      root.querySelector(`[data-region-id="${cssEscape(anchor.id)}"]`) ||
      root.querySelector(`[data-spectra-region="${cssEscape(anchor.id)}"]`)
    );
  if (anchor.kind === "path") {
    const candidates = [
      anchor.id,
      anchor.id.startsWith("/content/")
        ? anchor.id.slice("/content".length)
        : `/content${anchor.id.startsWith("/") ? anchor.id : `/${anchor.id}`}`,
    ];
    for (const id of candidates) {
      const byPath = root.querySelector(`[data-ai-path="${cssEscape(id)}"]`);
      if (byPath instanceof HTMLElement) return byPath;
    }
    const match = anchor.id.match(/^\/(?:content\/)?blocks\/(?:id:)?([^/]+)/i);
    if (match)
      return root.querySelector(
        `[data-block-id="${cssEscape(decodeURIComponent(match[1]!))}"]`,
      );
    return null;
  }
  if (anchor.kind === "selector") {
    try {
      const found = root.querySelector(anchor.id);
      return found instanceof HTMLElement ? found : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Place a caret at an exact character offset inside a block. Uses Range so the
 * caret sits between characters (or on a newline), not at a guessed % of the box.
 */
export function clientRectForCharOffset(
  root: HTMLElement,
  blockId: string,
  charOffset: number,
  lineIndex?: number,
): DOMRect | null {
  const rects = clientRectsForSelectionRange(root, {
    blockId,
    startOffset: charOffset,
    endOffset: charOffset,
    ...(typeof lineIndex === "number" ? { lineIndex } : {}),
  });
  return rects[0] ?? null;
}

export function positionForPresenceAnchor(
  layer: HTMLElement,
  root: HTMLElement,
  cursor: CollaborationCursor,
): { left: number; top: number } | null {
  if (!cursor.anchor) return null;
  const layerRect = layer.getBoundingClientRect();
  const mode = cursor.mode ?? "pointer";
  const wantsExactCaret =
    mode === "typing" ||
    mode === "selecting" ||
    typeof cursor.anchor.charOffset === "number";

  if (
    wantsExactCaret &&
    cursor.anchor.kind === "block" &&
    typeof cursor.anchor.charOffset === "number"
  ) {
    const caretRect = clientRectForCharOffset(
      root,
      cursor.anchor.id,
      cursor.anchor.charOffset,
      cursor.anchor.lineIndex,
    );
    if (caretRect) {
      return {
        left: Math.max(
          4,
          Math.min(layerRect.width - 8, caretRect.left - layerRect.left),
        ),
        top: Math.max(
          4,
          Math.min(
            layerRect.height - 20,
            caretRect.top - layerRect.top,
          ),
        ),
      };
    }
  }

  const target = resolvePresenceAnchorElement(root, cursor.anchor);
  if (!target) return null;
  const targetRect = target.getBoundingClientRect();
  if (targetRect.width <= 0 || targetRect.height <= 0) return null;

  // Pointer hover may use fractional offsets. Typing without charOffset falls
  // back to the start of the line — never a mid-box guess.
  if (wantsExactCaret) {
    return {
      left: Math.max(
        4,
        Math.min(layerRect.width - 8, targetRect.left - layerRect.left + 2),
      ),
      top: Math.max(
        4,
        Math.min(
          layerRect.height - 20,
          targetRect.top - layerRect.top + Math.min(4, targetRect.height * 0.1),
        ),
      ),
    };
  }

  const offsetX = cursor.anchor.offsetX ?? cursor.anchor.offset ?? 0.12;
  const offsetY = cursor.anchor.offsetY ?? 0.28;
  return {
    left: Math.max(
      8,
      Math.min(
        layerRect.width - 24,
        targetRect.left - layerRect.left + targetRect.width * offsetX,
      ),
    ),
    top: Math.max(
      8,
      Math.min(
        layerRect.height - 24,
        targetRect.top - layerRect.top + targetRect.height * offsetY,
      ),
    ),
  };
}

function textNodesUnder(element: HTMLElement) {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

/**
 * Map a character range inside a block to peer-local client rectangles so
 * collaborator text selections can be painted without sharing viewport coords.
 * When `lineIndex` is set, offsets are measured inside that visual line
 * (list item / soft-broken row), not the concatenated block string.
 */
export function clientRectsForSelectionRange(
  root: HTMLElement,
  range: CollaborationSelectionRange,
): DOMRect[] {
  const block = root.querySelector<HTMLElement>(
    `[data-block-id="${cssEscape(range.blockId)}"]`,
  );
  if (!block) return [];
  const scope =
    typeof range.lineIndex === "number" && range.lineIndex >= 0
      ? resolveLineScope(block, range.lineIndex)
      : block;
  const nodes = textNodesUnder(scope);
  if (nodes.length === 0) {
    const rect = scope.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? [rect] : [];
  }
  const start = Math.max(0, Math.min(range.startOffset, range.endOffset));
  const end = Math.max(range.startOffset, range.endOffset);
  let consumed = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  for (const node of nodes) {
    const length = node.data.length;
    if (!startNode && consumed + length >= start) {
      startNode = node;
      startOffset = Math.max(0, start - consumed);
    }
    if (!endNode && consumed + length >= end) {
      endNode = node;
      endOffset = Math.max(0, end - consumed);
      break;
    }
    consumed += length;
  }
  if (!startNode) return [];
  if (!endNode) {
    endNode = nodes[nodes.length - 1]!;
    endOffset = endNode.data.length;
  }
  try {
    const domRange = document.createRange();
    domRange.setStart(startNode, Math.min(startOffset, startNode.data.length));
    domRange.setEnd(endNode, Math.min(endOffset, endNode.data.length));
    const rects = Array.from(domRange.getClientRects());
    // Collapsed carets often report width 0 — still valid for caret placement.
    const usable = rects.filter((rect) => rect.height > 0);
    if (usable.length > 0) return usable;
    const bounding = domRange.getBoundingClientRect();
    return bounding.height > 0 || bounding.width > 0 ? [bounding] : [];
  } catch {
    return [];
  }
}

function resolveLineScope(block: HTMLElement, lineIndex: number): HTMLElement {
  const listItems = block.querySelectorAll<HTMLElement>(":scope > li");
  if (listItems.length > 0) {
    const item = listItems[Math.min(lineIndex, listItems.length - 1)];
    if (item) {
      const paragraph = item.querySelector<HTMLElement>(":scope > p");
      return paragraph ?? item;
    }
  }
  const softLines = block.querySelectorAll<HTMLElement>(
    ":scope > p, :scope > div",
  );
  if (softLines.length > 1) {
    return softLines[Math.min(lineIndex, softLines.length - 1)] ?? block;
  }
  return block;
}

export function selectionIsActive(
  selection: CollaborationSelection | null | undefined,
) {
  return Boolean(
    selection &&
      selection.kind === "text" &&
      !selection.collapsed &&
      selection.ranges.length > 0,
  );
}
