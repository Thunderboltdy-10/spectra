import { life } from "../life/life";
import { prismPoint } from "../life/use-life";

/*
 * Spectra setting a work into a page, as a person would: its hand comes to
 * the work's card where this viewer can see it (the shelf, the list, a
 * thread), presses, picks it up by the corner and carries it across the
 * screen to its place between two blocks, where the card gives way to the
 * embed. One hand does all of it, drawn as Spectra draws every collaborator,
 * so the eye follows the work from where it was to where it goes. This is
 * only the motion each viewer draws for itself; the reference is written by
 * the operation, and the page never waits for this.
 *
 * When the card is nowhere on screen the work comes out of Spectra's light
 * instead: a spark leaves the prism and the embed settles where it lands.
 */

const SOURCE_ATTRIBUTE = "data-work-source";
/** Where the hand holds a card: by its corner, so the card never jumps into it. */
const HOLD = { x: 24, y: 18 };
/** The most nodes a carried copy restyles; past it the copy keeps its own classes. */
const LIKENESS_NODES = 400;

const ARROW = "M4.2 1.6 11.6 8H7.9l2 4.7-1.9.8-2-4.7-2.5 2.4z";
const GRAB =
  "M5 7V3.6a1.1 1.1 0 0 1 2.2 0V7m0-.4V2.9a1.1 1.1 0 0 1 2.2 0V7m0-.2V4.1a1.1 1.1 0 0 1 2.2 0V9.4c0 2.4-1.5 4.2-3.9 4.2S4 12.2 4 9.8V8.4c0-.9.4-1.4 1-1.4";

export type CarryBox = { left: number; top: number; width: number; height: number };
type Box = CarryBox;
type Point = { x: number; y: number };

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
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/**
 * A copy that looks like the card wherever it is put: a card's look often
 * comes from the page it sits in, so every node keeps its computed style.
 */
function likeness(source: HTMLElement) {
  const copy = source.cloneNode(true) as HTMLElement;
  const from = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const to = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
  if (from.length <= LIKENESS_NODES)
    from.forEach((node, index) => {
      const target = to[index];
      if (!target?.style) return;
      const style = getComputedStyle(node);
      for (let i = 0; i < style.length; i += 1) {
        const name = style[i]!;
        target.style.setProperty(name, style.getPropertyValue(name));
      }
      target.style.setProperty("animation", "none");
      target.style.setProperty("transition", "none");
    });
  copy.removeAttribute("id");
  copy.removeAttribute(SOURCE_ATTRIBUTE);
  copy.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  copy.setAttribute("aria-hidden", "true");
  copy.classList.add("spectra-carry-ghost");
  return copy;
}

/** The hand, drawn exactly as the presence layer draws a collaborator's cursor. */
function handElement(name: string, color: string) {
  const hand = document.createElement("div");
  hand.className = "spectra-carry-hand";
  hand.setAttribute("aria-hidden", "true");
  hand.style.setProperty("--presence-color", color);
  hand.innerHTML = `<svg class="spectra-presence-glyph" viewBox="0 0 16 16" width="16" height="16"><path d="${ARROW}" fill="currentColor" stroke="var(--bg-elevated)" stroke-width="0.9" stroke-linejoin="round"/></svg><span class="spectra-presence-flag"><span class="spectra-presence-flag-name"></span></span>`;
  (hand.querySelector(".spectra-presence-flag-name") as HTMLElement).textContent = name;
  return hand;
}

export type CarryInput = {
  workId: string;
  /** Where the work goes, read every frame, since the page can move while the card travels. */
  target: () => CarryBox | null;
  /** From the lift to the moment the embed is set down. */
  flightMs: number;
  /** The page the work is going into, so its own embeds are never the source. */
  page?: Element | null;
  /** Who is carrying it, named and coloured as their cursor is. */
  hand?: { name: string; color: string };
  reduced?: boolean;
};

/** Carry a work into the page. Returns a function that lets go of it early. */
export function carryWork({ workId, target, flightMs, page, hand: who, reduced = false }: CarryInput): () => void {
  if (typeof window === "undefined" || reduced || flightMs < 120) return () => undefined;
  const source = visibleWorkCard(workId, page);
  const from = source ? boxOf(source) : null;
  if (!source || !from) {
    // Nothing to pick up: the work comes out of Spectra's light.
    const box = target();
    if (box && life.on) void life.send(prismPoint(), { x: box.left, y: box.top, width: box.width, height: Math.min(box.height, 160) }, { colour: "spectrum", strength: 0.8, absorb: true });
    return () => undefined;
  }

  const ghost = likeness(source);
  Object.assign(ghost.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: "0",
    opacity: "0",
    transformOrigin: "0 0",
  });
  const hand = handElement(who?.name ?? "Spectra", who?.color ?? "var(--accent)");
  const glyph = hand.querySelector("path")!;
  document.body.append(ghost, hand);
  // The AI's cursor in the page steps aside: this hand is that cursor now.
  document.documentElement.dataset.spectraCarrying = "";

  // The journey, as fractions of the flight: the hand comes to the card and
  // presses it, picks it up, carries it, then sets it down into its place.
  const reach = Math.min(0.22, 300 / flightMs);
  const press = reach + Math.min(0.08, 110 / flightMs);
  const arrive = 0.8;
  const hold: Point = { x: from.left + HOLD.x, y: from.top + HOLD.y };
  const enter: Point = { x: hold.x + 26, y: hold.y + 34 };
  const started = performance.now();
  let frame = 0;
  let done = false;
  let lifted = false;
  let end: Point = hold;
  let last: Box = from;

  const placeHand = (point: Point, tilt = 0) => {
    hand.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) rotate(${tilt}deg)`;
  };
  const leave = () => {
    // The hand lets go, rests a moment beside the work, and goes.
    glyph.setAttribute("d", ARROW);
    hand.dataset.leaving = "";
    window.setTimeout(() => hand.remove(), 320);
    delete document.documentElement.dataset.spectraCarrying;
  };
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    ghost.remove();
    source.removeAttribute("data-carry-source");
    leave();
    if (life.on) life.pulse(last.left + last.width / 2, last.top + Math.min(last.height, 120) / 2, 0.6, "spectrum");
  };

  const tick = (now: number) => {
    const t = Math.min(1, (now - started) / flightMs);
    if (t < reach) {
      // Coming in from just off the card, the way a hand enters a page.
      const k = easeInOut(t / reach);
      placeHand({ x: enter.x + (hold.x - enter.x) * k, y: enter.y + (hold.y - enter.y) * k });
      hand.style.opacity = String(Math.min(1, k * 2));
    } else if (t < press) {
      // A press: the tip dips on the card.
      placeHand(hold);
      hand.style.opacity = "1";
      hand.dataset.pressed = "";
    } else {
      if (!lifted) {
        lifted = true;
        delete hand.dataset.pressed;
        glyph.setAttribute("d", GRAB);
        ghost.style.opacity = "1";
        source.setAttribute("data-carry-source", "lifted");
        if (life.on) life.pulse(from.left + from.width / 2, from.top + from.height / 2, 0.45, "spectrum");
      }
      const place = target() ?? last;
      end = { x: place.left + HOLD.x, y: place.top + HOLD.y };
      const travel = easeInOut(clamp01((t - press) / (arrive - press)));
      // A wrist bends the path to one side.
      const dx = end.x - hold.x;
      const dy = end.y - hold.y;
      const distance = Math.hypot(dx, dy) || 1;
      const bend = Math.min(90, distance * 0.22) * (dx > 0 ? -1 : 1);
      const control = { x: hold.x + dx * 0.5 - (dy / distance) * bend, y: hold.y + dy * 0.5 + (dx / distance) * bend };
      const at = {
        x: (1 - travel) ** 2 * hold.x + 2 * (1 - travel) * travel * control.x + travel ** 2 * end.x,
        y: (1 - travel) ** 2 * hold.y + 2 * (1 - travel) * travel * control.y + travel ** 2 * end.y,
      };
      const tilt = Math.max(-8, Math.min(8, dx * 0.02)) * Math.sin(Math.PI * travel);
      placeHand(at, tilt);
      if (t < arrive) {
        // Carried at its own size, a little lifted, hanging from the hand.
        ghost.style.transform = `translate3d(${at.x - HOLD.x}px, ${at.y - HOLD.y}px, 0) rotate(${-2 + tilt * 0.4}deg) scale(1.02)`;
        last = { left: at.x - HOLD.x, top: at.y - HOLD.y, width: from.width, height: from.height };
      } else {
        // Set down: the card becomes the place it was carried to.
        const k = easeInOut((t - arrive) / (1 - arrive));
        const sx = 1.02 + (place.width / from.width - 1.02) * k;
        const sy = 1.02 + (Math.min(place.height, from.height * 3) / from.height - 1.02) * k;
        const left = at.x - HOLD.x + (place.left - (at.x - HOLD.x)) * k;
        const top = at.y - HOLD.y + (place.top - (at.y - HOLD.y)) * k;
        ghost.style.transform = `translate3d(${left}px, ${top}px, 0) rotate(${-2 * (1 - k)}deg) scale(${sx}, ${sy})`;
        ghost.style.opacity = String(1 - k);
        ghost.style.filter = `blur(${k * 5}px)`;
        last = { left, top, width: from.width * sx, height: from.height * sy };
      }
    }
    if (t >= 1) return finish();
    frame = requestAnimationFrame(tick);
  };
  placeHand(enter);
  hand.style.opacity = "0";
  frame = requestAnimationFrame(tick);
  return finish;
}
