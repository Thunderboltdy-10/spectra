import { life } from "../life/life";
import { prismPoint } from "../life/use-life";

/*
 * Spectra setting a work into a page, as a person would: it picks the work's
 * card up where this viewer can see it (the shelf, the list, a thread), carries
 * it over the page and lets go where the embed goes, and the card becomes the
 * embed there. This is only the motion each viewer draws for itself; the
 * reference is written by the operation, and the page never waits for this.
 *
 * When the card is nowhere on screen the work comes out of Spectra's light
 * instead: a spark leaves the prism and the embed settles where it lands.
 */

const SOURCE_ATTRIBUTE = "data-work-source";
const LIFT_PX = 14;
const ARC_PX = 56;

export type CarryBox = { left: number; top: number; width: number; height: number };
type Box = CarryBox;

export function boxOf(element: Element): Box | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function onScreen(box: Box) {
  return box.left < window.innerWidth && box.left + box.width > 0 && box.top < window.innerHeight && box.top + box.height > 0;
}

/** The work's own card where the viewer can see it, if anywhere. */
export function visibleWorkCard(workId: string, exclude?: Element | null): HTMLElement | null {
  const cards = document.querySelectorAll<HTMLElement>(`[${SOURCE_ATTRIBUTE}="${CSS.escape(workId)}"]`);
  for (const card of cards) {
    if (exclude?.contains(card)) continue;
    const box = boxOf(card);
    if (box && onScreen(box)) return card;
  }
  return null;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export type CarryInput = {
  workId: string;
  /** Where the work goes, read every frame, since the page can move while the card travels. */
  target: () => CarryBox | null;
  /** From the lift to the moment the embed is set down. */
  flightMs: number;
  /** The page the work is going into, so its own embeds are never the source. */
  page?: Element | null;
  reduced?: boolean;
};

/** Carry a work into the page. Returns a function that lets go of it early. */
export function carryWork({ workId, target, flightMs, page, reduced = false }: CarryInput): () => void {
  if (typeof window === "undefined" || reduced || flightMs < 120) return () => undefined;
  const source = visibleWorkCard(workId, page);
  const from = source ? boxOf(source) : null;
  if (!source || !from) {
    // Nothing to pick up: the work comes out of Spectra's light.
    const box = target();
    if (box && life.on) void life.send(prismPoint(), { x: box.left, y: box.top, width: box.width, height: Math.min(box.height, 160) }, { colour: "spectrum", strength: 0.8, absorb: true });
    return () => undefined;
  }

  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("id");
  ghost.removeAttribute(SOURCE_ATTRIBUTE);
  ghost.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  ghost.setAttribute("aria-hidden", "true");
  ghost.classList.add("spectra-carry-ghost");
  Object.assign(ghost.style, {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
  });
  document.body.append(ghost);
  source.setAttribute("data-carry-source", "lifted");
  if (life.on) life.pulse(from.left + from.width / 2, from.top + from.height / 2, 0.5, "spectrum");

  const started = performance.now();
  let frame = 0;
  let done = false;
  let last: Box = from;
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    ghost.remove();
    source.removeAttribute("data-carry-source");
    if (life.on) life.pulse(last.left + last.width / 2, last.top + Math.min(last.height, 120) / 2, 0.7, "spectrum");
  };
  const tick = (now: number) => {
    const t = Math.min(1, (now - started) / flightMs);
    // The first moment is the lift; the rest is the journey to the place.
    const lift = Math.min(1, t / 0.16);
    const travel = easeInOut(Math.max(0, (t - 0.12) / 0.88));
    const to = target() ?? last;
    // The card keeps its own proportions, scaled to the width of its place.
    const scale = 1 + (to.width / from.width - 1) * travel;
    const left = from.left + (to.left - from.left) * travel;
    const top = from.top + (to.top - from.top) * travel - LIFT_PX * lift * (1 - travel) - ARC_PX * Math.sin(Math.PI * travel);
    last = { left, top, width: from.width * scale, height: from.height * scale };
    ghost.style.transform = `translate3d(${left - from.left}px, ${top - from.top}px, 0) scale(${(1 + 0.03 * lift * (1 - travel)) * scale})`;
    // It gives way to the embed in the last stretch.
    ghost.style.opacity = String(t < 0.86 ? 1 : Math.max(0, 1 - (t - 0.86) / 0.14));
    if (t >= 1) return finish();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return finish;
}
