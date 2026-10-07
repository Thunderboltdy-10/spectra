"use client";
/*
 * A studio landing where a work was opened (open-anchor.ts). Each studio
 * wires one resolver: given the region, what state to change first (the
 * slide, sheet, file, card or question to show) and how to find the element
 * the region names once that state has rendered. The landing then scrolls it
 * into view and marks it: the target-pulse ring drawn over the content, and
 * the light arriving into it from where the user asked (LIFE.md, send).
 *
 * A resolver that cannot read the region returns null: the landing waits a
 * little in case the content is still loading, then expires, and the work
 * stays open where it was. Nothing is said about it.
 */
import { createContext, createElement, useContext, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { sendInto } from "../life/use-life";
import { getSpectraMotionSnapshot } from "../motion/motion-level";
import { claimLanding, usePendingLanding, type PendingLanding } from "./open-anchor";
import type { WorkRegion } from "./locate";

/** Marks an element as the place a region id names, for studios whose content is not otherwise addressable. */
export const ANCHOR_REGION_ATTRIBUTE = "data-anchor-region";

export type AnchorLanding = {
  /** Show what the region is in (a slide, sheet, file, card, view). Runs once, before the element is looked for. */
  select?: () => void;
  /** The element to land on, once `select` has rendered. */
  find: (root: ParentNode) => Element | null;
  /** False when the studio frames the element itself (a canvas that pans rather than scrolls). */
  scroll?: boolean;
  /** The box to mark when it is more than the element (a range of cells from its first). */
  extent?: (element: Element) => DOMRect | null;
};

export type AnchorResolver = (region: WorkRegion) => AnchorLanding | null;

type OpenAnchorScopeValue = {
  /** False where a copy of a studio is shown (an inline preview): only the work itself lands. */
  enabled: boolean;
  /** Where the studio's content is, to search in and to clip the mark to. */
  root?: RefObject<Element | null>;
};

const OpenAnchorScopeContext = createContext<OpenAnchorScopeValue>({ enabled: true });

export function OpenAnchorScope({ enabled, root, children }: OpenAnchorScopeValue & { children: ReactNode }) {
  return createElement(OpenAnchorScopeContext.Provider, { value: { enabled, root } }, children);
}

const FIND_INTERVAL_MS = 80;
const FIND_TRIES = 25;
const SCROLL_SETTLE_MS = 320;
const MARK_MS = 1200;
/** The press that asked for the landing still reads as its cause this long after. */
const CAUSE_MS = 4000;

/** `[name="value"]`, with the value quoted safely. */
export function attributeSelector(name: string, value: string) {
  return `[${name}="${value.replace(/["\\]/g, "\\$&")}"]`;
}

/** The element marked as `regionId`, preferring one that is painted. */
export function regionElement(root: ParentNode, regionId: string) {
  return paintedFirst(root.querySelectorAll(attributeSelector(ANCHOR_REGION_ATTRIBUTE, regionId)));
}

/** The first painted element of `elements` (one with a box), or the first at all. */
export function paintedFirst(elements: Iterable<Element>) {
  let first: Element | null = null;
  for (const element of elements) {
    first ??= element;
    if (element.getClientRects().length > 0) return element;
  }
  return first;
}

/**
 * Land on the pending region for `workId` once `ready` (the studio's content
 * has loaded). `resolve` is re-read whenever it changes, so a region the
 * content could not yet name is tried again when it can.
 */
export function useOpenAnchor(workId: string | undefined, resolve: AnchorResolver, { ready = true }: { ready?: boolean } = {}) {
  const scope = useContext(OpenAnchorScopeContext);
  const landing = usePendingLanding(scope.enabled ? workId : undefined);
  const run = useRef<{ cancel: () => void } | null>(null);
  const root = scope.root;

  useEffect(() => () => run.current?.cancel(), []);

  useEffect(() => {
    if (!landing || !ready || !workId) return;
    const target = resolve(landing.region);
    if (!target || !claimLanding(workId, landing.seq)) return;
    run.current?.cancel();
    run.current = land(target, landing, () => root?.current ?? document);
  }, [landing, ready, resolve, root, workId]);
}

function land(target: AnchorLanding, landing: PendingLanding, rootOf: () => ParentNode) {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unmark: (() => void) | undefined;
  let tries = 0;
  const arrive = (element: Element) => {
    const { reduced } = getSpectraMotionSnapshot();
    if (target.scroll !== false) element.scrollIntoView?.({ block: "center", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
    timer = setTimeout(
      () => {
        if (cancelled || !element.isConnected) return;
        const root = rootOf();
        unmark = markLanding(element, root instanceof Element ? root : null, target.extent);
        const fresh = landing.from && performance.now() - landing.at < CAUSE_MS;
        sendInto(element, fresh ? landing.from : null);
      },
      reduced ? 0 : SCROLL_SETTLE_MS,
    );
  };
  const attempt = () => {
    if (cancelled) return;
    const element = target.find(rootOf());
    if (element) return arrive(element);
    tries += 1;
    if (tries < FIND_TRIES) timer = setTimeout(attempt, FIND_INTERVAL_MS);
  };
  target.select?.();
  timer = setTimeout(attempt, 0);
  return {
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unmark?.();
    },
  };
}

/**
 * The ring over the landed element. It is drawn on its own layer rather than
 * on the element: editors own their nodes (a document's blocks re-read any
 * attribute change as an edit), and a ring on the element would be clipped by
 * its scroller anyway. It follows the element while it settles and is clipped
 * to the studio.
 */
export function markLanding(element: Element, clip: Element | null, extent?: (element: Element) => DOMRect | null) {
  const mark = document.createElement("div");
  mark.className = "spectra-anchor-landing";
  mark.setAttribute("data-spectra-anchor-landing", "");
  mark.setAttribute("aria-hidden", "true");
  document.body.append(mark);
  let frame = 0;
  const place = () => {
    if (!element.isConnected) return remove();
    const box = extent?.(element) ?? element.getBoundingClientRect();
    const bounds = clip?.getBoundingClientRect();
    const left = bounds?.width ? Math.max(box.left, bounds.left) : box.left;
    const top = bounds?.height ? Math.max(box.top, bounds.top) : box.top;
    const right = bounds?.width ? Math.min(box.right, bounds.right) : box.right;
    const bottom = bounds?.height ? Math.min(box.bottom, bounds.bottom) : box.bottom;
    mark.style.left = `${left}px`;
    mark.style.top = `${top}px`;
    mark.style.width = `${Math.max(0, right - left)}px`;
    mark.style.height = `${Math.max(0, bottom - top)}px`;
    mark.hidden = right <= left || bottom <= top;
    frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(place) : 0;
  };
  const timer = setTimeout(() => remove(), MARK_MS);
  function remove() {
    clearTimeout(timer);
    if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    frame = 0;
    mark.remove();
  }
  place();
  return remove;
}
