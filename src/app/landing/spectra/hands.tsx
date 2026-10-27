"use client";

import { useCallback, useEffect, useRef } from "react";
import { flash } from "./light/light";

/*
 * The people on the page. Each scene has its hands: a classmate, a teacher,
 * Henry himself, and Spectra working beside them. They are drawn as Spectra
 * draws collaborators (the same arrow, the same name flag in the person's
 * colour, Spectra's prism pointer with its spark) and they move like people:
 * a curved path, a little hesitation before a press, a small overshoot that
 * corrects itself. A press lights the paper where it lands.
 */

export type Person = { name: string; colour: string; hue: number; ai?: boolean; action?: string };

export const PEOPLE = {
  henry: { name: "Henry", colour: "#4f9fe6", hue: 4 },
  gonzalez: { name: "Ms Gonzalez", colour: "#e8853a", hue: 1 },
  leo: { name: "Leo", colour: "#2fae7d", hue: 3 },
  spectra: { name: "Spectra", colour: "#7d63e0", hue: 5, ai: true },
} satisfies Record<string, Person>;

type Point = [number, number];
type Target = Element | Point | null | undefined;

const ARROW = "M4.2 1.6 11.6 8H7.9l2 4.7-1.9.8-2-4.7-2.5 2.4z";
const PRISM = "M4.2 1.6 12.3 9.6 3.2 11.9z";
const GRAB =
  "M5 7V3.6a1.1 1.1 0 0 1 2.2 0V7m0-.4V2.9a1.1 1.1 0 0 1 2.2 0V7m0-.2V4.1a1.1 1.1 0 0 1 2.2 0V9.4c0 2.4-1.5 4.2-3.9 4.2S4 12.2 4 9.8V8.4c0-.9.4-1.4 1-1.4";

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve();
    });
  });

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Hand {
  readonly node: HTMLDivElement;
  private glyph: SVGPathElement;
  private flag: HTMLSpanElement;
  private note: HTMLSpanElement;
  private carried: HTMLElement | null = null;
  private at: Point = [0, 0];
  private shown = false;

  constructor(
    private stage: HTMLElement,
    private layer: HTMLElement,
    readonly person: Person,
    private signal?: AbortSignal,
  ) {
    const node = document.createElement("div");
    node.className = "sp-hand";
    node.dataset.ai = person.ai ? "true" : "false";
    node.style.setProperty("--hand", person.colour);
    node.innerHTML = `<svg class="sp-hand-glyph" viewBox="0 0 16 16" width="20" height="20" aria-hidden="true">${
      person.ai
        ? `<defs><linearGradient id="sp-hand-prism" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b6cf6"/><stop offset="0.5" stop-color="#4f9fe6"/><stop offset="1" stop-color="#40c48e"/></linearGradient></defs>`
        : ""
    }<path d="${person.ai ? PRISM : ARROW}" fill="${person.ai ? "url(#sp-hand-prism)" : "currentColor"}" stroke="#fff" stroke-width="0.9" stroke-linejoin="round"/></svg><span class="sp-hand-flag">${
      person.ai ? `<svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true"><path d="M6 .6 7 4.3l3.6 1.1L7 6.5 6 10.2 5 6.5 1.4 5.4 5 4.3z" fill="currentColor"/></svg>` : ""
    }<span class="sp-hand-name"></span><span class="sp-hand-note"></span></span>`;
    this.glyph = node.querySelector("path:last-of-type") as SVGPathElement;
    this.flag = node.querySelector(".sp-hand-flag") as HTMLSpanElement;
    (node.querySelector(".sp-hand-name") as HTMLSpanElement).textContent = person.name;
    this.note = node.querySelector(".sp-hand-note") as HTMLSpanElement;
    layer.appendChild(node);
    this.node = node;
  }

  /** A point in the stage for an element (a little inside it, as a hand aims) or a stage point. */
  private pointOf(target: Target, aim: Point = [0.5, 0.5]): Point {
    if (!target) return this.at;
    if (Array.isArray(target)) return target;
    const box = target.getBoundingClientRect();
    const stage = this.layer.getBoundingClientRect();
    return [box.left - stage.left + box.width * aim[0], box.top - stage.top + box.height * aim[1]];
  }

  private place([x, y]: Point, tilt = 0) {
    this.at = [x, y];
    this.node.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${tilt}deg)`;
    if (this.carried) this.carried.style.transform = `translate3d(${x - 24}px, ${y - 18}px, 0) rotate(${-2 + tilt * 0.4}deg)`;
  }

  say(note: string | null) {
    this.note.textContent = note ?? "";
    this.flag.dataset.note = note ? "true" : "false";
  }

  /** Comes in: from just off its first spot, the way a hand enters a shared page. */
  async show(target: Target, aim?: Point) {
    const point = this.pointOf(target, aim);
    this.place([point[0] + 26, point[1] + 34]);
    this.node.dataset.shown = "true";
    this.shown = true;
    await this.move(point, { ms: 420 });
  }

  /** Moves along a gentle curve; a person overshoots a little and settles. */
  async move(target: Target, { ms = 620, aim, overshoot = true }: { ms?: number; aim?: Point; overshoot?: boolean } = {}) {
    if (!this.shown) return this.show(target, aim);
    const from = this.at;
    const to = this.pointOf(target, aim);
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const distance = Math.hypot(dx, dy);
    if (distance < 1) return;
    // Bend the path to one side, as a wrist does.
    const bend = Math.min(90, distance * 0.22) * (dx > 0 ? -1 : 1);
    const control: Point = [from[0] + dx * 0.5 - (dy / distance) * bend, from[1] + dy * 0.5 + (dx / distance) * bend];
    const past: Point = overshoot && distance > 80 ? [to[0] + (dx / distance) * 7, to[1] + (dy / distance) * 7] : to;
    const duration = Math.max(260, Math.min(ms, 260 + distance * 0.9));
    await new Promise<void>((resolve) => {
      const start = performance.now();
      const step = (now: number) => {
        if (this.signal?.aborted) return resolve();
        const t = Math.min(1, (now - start) / duration);
        const k = ease(t);
        const x = (1 - k) * (1 - k) * from[0] + 2 * (1 - k) * k * control[0] + k * k * past[0];
        const y = (1 - k) * (1 - k) * from[1] + 2 * (1 - k) * k * control[1] + k * k * past[1];
        this.place([x, y], Math.max(-8, Math.min(8, dx * 0.02)) * Math.sin(Math.PI * t));
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    if (past !== to) {
      await sleep(40, this.signal);
      const from2 = this.at;
      await new Promise<void>((resolve) => {
        const start = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / 140);
          const k = ease(t);
          this.place([from2[0] + (to[0] - from2[0]) * k, from2[1] + (to[1] - from2[1]) * k]);
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
    }
  }

  /** A press: the tip dips, and the paper lights where it lands. */
  async press({ light = true }: { light?: boolean } = {}) {
    await sleep(90, this.signal);
    this.node.dataset.pressed = "true";
    if (light) {
      const stage = this.layer.getBoundingClientRect();
      flash({
        x: stage.left + this.at[0],
        y: stage.top + window.scrollY + this.at[1],
        rx: 70,
        ry: 70,
        strength: 0.55,
        hues: this.person.ai ? [0, 6] : [this.person.hue - 0.4, this.person.hue + 0.4],
        hold: 160,
      });
    }
    await sleep(130, this.signal);
    delete this.node.dataset.pressed;
  }

  /** Moves to an element and presses it. */
  async click(target: Target, options: { ms?: number; aim?: Point } = {}) {
    await this.move(target, options);
    await this.press();
  }

  /** Picks up a copy of an element and carries it. The original stays put; the scene decides what happens to it. */
  grab(element: HTMLElement) {
    const box = element.getBoundingClientRect();
    const copy = element.cloneNode(true) as HTMLElement;
    copy.classList.add("sp-carried");
    copy.style.width = `${box.width}px`;
    copy.style.height = `${box.height}px`;
    copy.removeAttribute("id");
    this.layer.insertBefore(copy, this.node);
    this.carried = copy;
    this.glyph.setAttribute("d", GRAB);
    this.place(this.at);
    return copy;
  }

  /** Lets go of what it carries; it shrinks into where it was dropped. */
  async drop() {
    const copy = this.carried;
    this.carried = null;
    this.glyph.setAttribute("d", this.person.ai ? PRISM : ARROW);
    if (!copy) return;
    copy.dataset.dropped = "true";
    await sleep(320, this.signal);
    copy.remove();
  }

  async hide() {
    delete this.node.dataset.shown;
    this.shown = false;
    await sleep(260, this.signal);
  }

  remove() {
    this.carried?.remove();
    this.node.remove();
  }

  get stageElement() {
    return this.stage;
  }
}

/** A stage's hands. Render `layer` inside the stage (it covers it, and lets every press through). */
export function useHands() {
  const layerRef = useRef<HTMLDivElement>(null);
  const made = useRef<Hand[]>([]);

  const hand = useCallback((person: Person, signal?: AbortSignal) => {
    const layer = layerRef.current;
    if (!layer) throw new Error("The hands' layer is not mounted.");
    const made_ = new Hand(layer.parentElement ?? layer, layer, person, signal);
    made.current.push(made_);
    return made_;
  }, []);

  useEffect(
    () => () => {
      for (const each of made.current) each.remove();
      made.current = [];
    },
    [],
  );

  const layer = <div ref={layerRef} className="sp-hands" aria-hidden />;
  return { layer, hand };
}

export { sleep };
