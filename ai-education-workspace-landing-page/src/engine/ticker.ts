import { useEffect, useRef } from "react";

export type Ctx = {
  /** elapsed seconds */
  t: number;
  /** delta seconds (clamped) */
  dt: number;
  /** eased scroll position in px (continues settling after input stops) */
  y: number;
  /** raw scroll position in px */
  rawY: number;
  vw: number;
  vh: number;
  /** pointer in px, eased */
  px: number;
  py: number;
  /** pointer normalised -1..1, eased */
  nx: number;
  ny: number;
  /** scroll velocity px/s (eased) */
  vel: number;
  mobile: boolean;
  reduced: boolean;
};

type Sub = { fn: (c: Ctx) => void; order: number };

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const inv = (v: number, a: number, b: number) => clamp((v - a) / (b - a || 1));
export const smooth = (v: number) => v * v * (3 - 2 * v);
/** local progress inside [a,b] of p, smoothstepped */
export const seg = (p: number, a: number, b: number) => smooth(inv(p, a, b));
/** linear local progress inside [a,b] */
export const segL = (p: number, a: number, b: number) => inv(p, a, b);
export const easeOut = (v: number) => 1 - Math.pow(1 - v, 3);
export const easeIn = (v: number) => v * v * v;
export const easeInOut = (v: number) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2);
/** frame-rate independent damping */
export const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));
/** 0 -> 1 -> 0 hump */
export const hump = (p: number, a: number, b: number) => {
  const l = inv(p, a, b);
  return Math.sin(l * Math.PI);
};

class Engine {
  ctx: Ctx = {
    t: 0,
    dt: 0,
    y: 0,
    rawY: 0,
    vw: 1440,
    vh: 900,
    px: 0,
    py: 0,
    nx: 0,
    ny: 0,
    vel: 0,
    mobile: false,
    reduced: false,
  };
  private subs: Sub[] = [];
  private raf = 0;
  private last = 0;
  private started = false;
  private tPx = 0;
  private tPy = 0;
  private lastY = 0;

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.ctx.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.measure();
    this.ctx.y = window.scrollY;
    this.ctx.rawY = window.scrollY;
    this.lastY = window.scrollY;
    this.tPx = window.innerWidth / 2;
    this.tPy = window.innerHeight / 2;
    this.ctx.px = this.tPx;
    this.ctx.py = this.tPy;
    window.addEventListener("resize", this.measure, { passive: true });
    window.addEventListener("pointermove", this.onPointer, { passive: true });
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.measure);
    window.removeEventListener("pointermove", this.onPointer);
    this.started = false;
  }

  private measure = () => {
    this.ctx.vw = window.innerWidth;
    this.ctx.vh = window.innerHeight;
    this.ctx.mobile = window.innerWidth < 860;
    for (const s of sections.values()) s.dirty = true;
  };

  private onPointer = (e: PointerEvent) => {
    this.tPx = e.clientX;
    this.tPy = e.clientY;
  };

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const c = this.ctx;
    c.dt = dt;
    c.t += dt;
    c.rawY = window.scrollY;
    const rate = c.reduced ? 40 : 9.5;
    c.y = damp(c.y, c.rawY, rate, dt);
    const v = (c.rawY - this.lastY) / (dt || 0.016);
    this.lastY = c.rawY;
    c.vel = damp(c.vel, v, 6, dt);
    c.px = damp(c.px, this.tPx, c.reduced ? 40 : 7, dt);
    c.py = damp(c.py, this.tPy, c.reduced ? 40 : 7, dt);
    c.nx = (c.px / c.vw) * 2 - 1;
    c.ny = (c.py / c.vh) * 2 - 1;
    for (let i = 0; i < this.subs.length; i++) this.subs[i].fn(c);
  };

  subscribe(fn: (c: Ctx) => void, order = 0) {
    const s = { fn, order };
    this.subs.push(s);
    this.subs.sort((a, b) => a.order - b.order);
    return () => {
      const i = this.subs.indexOf(s);
      if (i >= 0) this.subs.splice(i, 1);
    };
  }
}

export const engine = new Engine();

/* ---------------- section registry ---------------- */

type SectionRec = { el: HTMLElement; top: number; height: number; dirty: boolean };
const sections = new Map<string, SectionRec>();

export function registerSection(name: string, el: HTMLElement) {
  sections.set(name, { el, top: 0, height: 0, dirty: true });
  return () => {
    sections.delete(name);
  };
}

function rec(name: string) {
  const r = sections.get(name);
  if (!r) return null;
  if (r.dirty) {
    const box = r.el.getBoundingClientRect();
    r.top = box.top + window.scrollY;
    r.height = box.height;
    r.dirty = false;
  }
  return r;
}

/** progress 0..1 across a sticky section (0 = section top hits viewport top) */
export function sectionProgress(name: string, y: number, vh: number) {
  const r = rec(name);
  if (!r) return 0;
  const span = Math.max(1, r.height - vh);
  return clamp((y - r.top) / span);
}

/** returns section top in px */
export function sectionTop(name: string) {
  const r = rec(name);
  return r ? r.top : 0;
}

export function markDirty() {
  for (const s of sections.values()) s.dirty = true;
}

/* ---------------- react hooks ---------------- */

export function useTick(fn: (c: Ctx) => void, order = 0) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => engine.subscribe((c) => ref.current(c), order), [order]);
}

/** Scene hook: gives local progress of a named sticky section. */
export function useScene(name: string, fn: (p: number, c: Ctx) => void, order = 0) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    return engine.subscribe((c) => {
      ref.current(sectionProgress(name, c.y, c.vh), c);
    }, order);
  }, [name, order]);
}

export function useSectionRef(name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null);
  useEffect(() => {
    if (!ref.current) return;
    const un = registerSection(name, ref.current);
    const ro = new ResizeObserver(() => markDirty());
    ro.observe(document.body);
    return () => {
      un();
      ro.disconnect();
    };
  }, [name]);
  return ref;
}

/* ---------------- dom helpers ---------------- */

export function setT(el: HTMLElement | null, x: number, y: number, s = 1, rot = 0) {
  if (!el) return;
  el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)${
    s !== 1 ? ` scale(${s.toFixed(4)})` : ""
  }${rot ? ` rotate(${rot.toFixed(2)}deg)` : ""}`;
}

export function setO(el: HTMLElement | null, o: number) {
  if (!el) return;
  el.style.opacity = o.toFixed(3);
}

/** show/hide with pointer-events + visibility for perf */
export function setVis(el: HTMLElement | null, o: number) {
  if (!el) return;
  el.style.opacity = o.toFixed(3);
  el.style.visibility = o < 0.004 ? "hidden" : "visible";
}

/** streamed text with believable pacing (pauses at punctuation / word ends) */
export function streamText(full: string, p: number) {
  if (p <= 0) return "";
  if (p >= 1) return full;
  const raw = p * full.length;
  // slight jitter so characters don't appear metronomically
  const j = Math.sin(raw * 0.9) * 1.4 + Math.sin(raw * 0.31) * 1.1;
  const n = Math.max(0, Math.min(full.length, Math.round(raw + j)));
  return full.slice(0, n);
}
