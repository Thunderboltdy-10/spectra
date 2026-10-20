"use client";

import { getSpectraMotionSnapshot } from "../motion/motion-level";

/*
 * When a run changes something outside an editor (a Library item, a calendar
 * event, a setting) and that thing is on screen, it gets the same single band
 * pass a work's region gets when Spectra writes it. Nothing off screen moves
 * and the viewport never scrolls: following the run is what moves the page.
 * The band is an overlay laid over the element's box, so the element's own
 * layout is never touched.
 */

const TARGET_SELECTOR = "[data-spectra-ai-target], [data-ai-region], [data-node-id], [data-calendar-item-id]";
const PASS_MS = 1_500;

/** The element on the page that stands for a target id, if there is one. */
export function aiTargetElement(targetId: string) {
  if (typeof document === "undefined" || !targetId) return null;
  return (
    Array.from(document.querySelectorAll<HTMLElement>(TARGET_SELECTOR)).find((element) =>
      [element.dataset.spectraAiTarget, element.dataset.aiRegion, element.dataset.nodeId, element.dataset.calendarItemId].includes(
        targetId,
      ),
    ) ?? null
  );
}

function onScreen(rect: DOMRect) {
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

/** One band pass over the target when it is on screen; nothing otherwise. */
export function touchOnScreen(targetId: string) {
  const element = aiTargetElement(targetId);
  const rect = element?.getBoundingClientRect();
  if (!rect || !onScreen(rect) || getSpectraMotionSnapshot().disabled) return;
  const band = document.createElement("div");
  band.className = "spectra-ai-touch";
  band.setAttribute("aria-hidden", "true");
  Object.assign(band.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  band.appendChild(document.createElement("i"));
  document.body.appendChild(band);
  window.setTimeout(() => band.remove(), PASS_MS);
}
