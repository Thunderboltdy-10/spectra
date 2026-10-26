"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { spectrumCss } from "@/features/spectra/life/spectrum";
import { prefersStill } from "./use-motion";

/*
 * The light that leaves the hero's prism and runs down the page. It is drawn
 * through every element marked `data-beam`, in order, and it reaches as far
 * as the reader has: its tip rides 62% of the way down the window, which is
 * exactly where scenes start. Ahead of it the route is pencilled in, so the
 * eye always knows where it is going next.
 *
 * The page's content sits above it, so the beam runs behind a window and out
 * the other side. It is hidden on narrow screens, where the page is one
 * column and needs no thread.
 */

const TIP = 0.62;

type Sample = { x: number; y: number; at: number };
type Route = { d: string; length: number; height: number; samples: Sample[] };

function measure(root: HTMLElement): Route | null {
  const rootRect = root.getBoundingClientRect();
  const points = [...root.querySelectorAll<HTMLElement>("[data-beam]")].map((node) => {
    const rect = node.getBoundingClientRect();
    const at = node.dataset.beam;
    return {
      x: rect.left - rootRect.left + rect.width / 2,
      y: rect.top - rootRect.top + (at === "top" ? 0 : at === "bottom" ? rect.height : rect.height / 2),
    };
  });
  if (points.length < 2) return null;
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const reach = Math.max(40, (b.y - a.y) * 0.55);
    d += ` C ${a.x.toFixed(1)} ${(a.y + reach).toFixed(1)}, ${b.x.toFixed(1)} ${(b.y - reach).toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  const probe = document.createElementNS("http://www.w3.org/2000/svg", "path");
  probe.setAttribute("d", d);
  const length = probe.getTotalLength();
  const count = Math.min(2400, Math.max(60, Math.ceil(length / 6)));
  const samples: Sample[] = [];
  let lowest = -Infinity;
  for (let index = 0; index <= count; index += 1) {
    const at = (length * index) / count;
    const point = probe.getPointAtLength(at);
    // Keep y increasing, so a scroll position finds one place on the route.
    lowest = Math.max(lowest, point.y);
    samples.push({ x: point.x, y: lowest, at });
  }
  return { d, length, height: root.scrollHeight, samples };
}

function lengthAt(samples: Sample[], y: number) {
  if (y <= samples[0].y) return { at: 0, x: samples[0].x, y: samples[0].y };
  const last = samples[samples.length - 1];
  if (y >= last.y) return { at: last.at, x: last.x, y: last.y };
  let low = 0;
  let high = samples.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (samples[middle].y < y) low = middle;
    else high = middle;
  }
  const a = samples[low];
  const b = samples[high];
  const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
  return { at: a.at + (b.at - a.at) * t, x: a.x + (b.x - a.x) * t, y };
}

export function Beam({ rootRef, ready }: { rootRef: RefObject<HTMLElement | null>; ready: boolean }) {
  const [route, setRoute] = useState<Route | null>(null);
  const litRef = useRef<SVGPathElement>(null);
  const haloRef = useRef<SVGPathElement>(null);
  const tipRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !ready) return;
    let pending = 0;
    const remeasure = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        if (window.innerWidth < 900) return setRoute(null);
        setRoute(measure(root));
      });
    };
    remeasure();
    const sized = new ResizeObserver(remeasure);
    sized.observe(root);
    window.addEventListener("resize", remeasure);
    void document.fonts?.ready.then(remeasure);
    // Scenes settle a little after they arrive; measure again once they have.
    const later = [1200, 3200].map((delay) => window.setTimeout(remeasure, delay));
    return () => {
      cancelAnimationFrame(pending);
      sized.disconnect();
      window.removeEventListener("resize", remeasure);
      later.forEach((timer) => window.clearTimeout(timer));
    };
  }, [rootRef, ready]);

  useEffect(() => {
    const root = rootRef.current;
    if (!route || !root) return;
    const still = prefersStill();
    let shown = still ? route.length : 0;
    let frame = 0;
    const target = () => {
      const top = root.getBoundingClientRect().top;
      return lengthAt(route.samples, window.innerHeight * TIP - top);
    };
    const paint = (at: number) => {
      const offset = (route.length - at).toFixed(1);
      litRef.current?.style.setProperty("stroke-dashoffset", offset);
      haloRef.current?.style.setProperty("stroke-dashoffset", offset);
      // Samples are evenly spaced along the route, so a length is an index.
      const last = route.samples.length - 1;
      const exact = Math.max(0, Math.min(last, (at / route.length) * last));
      const a = route.samples[Math.floor(exact)];
      const b = route.samples[Math.min(last, Math.floor(exact) + 1)];
      const t = exact - Math.floor(exact);
      const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (tipRef.current) {
        tipRef.current.style.transform = `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px)`;
        tipRef.current.style.opacity = at <= 2 || at >= route.length - 2 ? "0" : "1";
      }
    };
    const tick = () => {
      const goal = target().at;
      // The light catches up with the reader rather than snapping to them.
      shown += (goal - shown) * 0.16;
      if (Math.abs(goal - shown) < 0.5) shown = goal;
      paint(shown);
      frame = shown === goal ? 0 : requestAnimationFrame(tick);
    };
    const onScroll = () => {
      if (still) return;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    paint(shown);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [route, rootRef]);

  if (!route) return null;
  const bands = Math.max(2, Math.ceil(route.height / 1500));
  const stops = Array.from({ length: bands * 6 + 1 }, (_, index) => ({ offset: index / (bands * 6), color: spectrumCss((index / 6) % 1) }));
  return (
    <svg className="sp-beam" width="100%" height={route.height} aria-hidden>
      <defs>
        <linearGradient id="sp-beam-light" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={route.height}>
          {stops.map((stop, index) => (
            <stop key={index} offset={stop.offset} stopColor={stop.color} />
          ))}
        </linearGradient>
        <radialGradient id="sp-beam-tip">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d={route.d} className="sp-beam-route" />
      <path ref={haloRef} d={route.d} className="sp-beam-halo" stroke="url(#sp-beam-light)" strokeDasharray={route.length} strokeDashoffset={route.length} />
      <path ref={litRef} d={route.d} className="sp-beam-lit" stroke="url(#sp-beam-light)" strokeDasharray={route.length} strokeDashoffset={route.length} />
      <g ref={tipRef} className="sp-beam-tip">
        <circle r="22" fill="url(#sp-beam-tip)" />
        <circle r="3.5" fill="#fff" />
      </g>
    </svg>
  );
}
