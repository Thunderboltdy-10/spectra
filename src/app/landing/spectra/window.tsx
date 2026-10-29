"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AppWindow, type RailPlace } from "../kit/app-window";

/*
 * Spectra's window on the page. The app is laid out for a laptop, so a page
 * of it is held at a laptop's width and scaled to whatever room the scene
 * has; it reads the same on every screen, and everything in it still works.
 * The page shows the page alone: no rail, no island, nothing that scrolls.
 */

/** The page's pictures of the app: a wheel over any of them scrolls the page. */
const PICTURES = ".sp-scaled, .sp-together-desk, .sp-studio, .sp-people, .landing-studio, .sp-bridge-app";
const LINE = 16;

/**
 * A wheel or a swipe over a picture of the app scrolls the page, never something inside the picture: whatever
 * would scroll under the pointer is made still as the pointer comes to it. A still box still holds the wheel,
 * so the wheel over a picture is taken before the app sees it and handed to the page.
 */
export function useStill(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const outer = ref.current;
    if (!outer) return;
    const still = (event: Event) => {
      for (let node = event.target as HTMLElement | null; node && node !== outer; node = node.parentElement) {
        if (node.dataset.still) continue;
        // Only what scrolls is marked, so a surface that becomes scrollable later is still caught.
        const style = getComputedStyle(node);
        if (!/(auto|scroll)/.test(style.overflowY + style.overflowX)) continue;
        node.style.setProperty("overflow", "hidden", "important");
        node.dataset.still = "";
      }
    };
    const forward = (event: WheelEvent) => {
      // A pinch or ctrl-wheel stays the browser's zoom.
      if (event.ctrlKey || event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (!target?.closest?.(PICTURES)) return;
      event.preventDefault();
      event.stopPropagation();
      const unit = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? window.innerHeight : 1;
      window.scrollBy({ top: event.deltaY * unit, left: 0, behavior: "instant" });
    };
    outer.addEventListener("pointerover", still, { passive: true });
    outer.addEventListener("wheel", still, { passive: true });
    outer.addEventListener("wheel", forward, { passive: false, capture: true });
    return () => {
      outer.removeEventListener("pointerover", still);
      outer.removeEventListener("wheel", still);
      outer.removeEventListener("wheel", forward, { capture: true });
    };
  }, [ref]);
}

/**
 * Holds a design size and scales it to its container's width, keeping its
 * shape. On a smaller screen it is never drawn smaller than `least` of its
 * size: the page inside is laid out a little narrower instead (the app's pages
 * are made to reflow), so its type stays readable on a laptop.
 */
export function Scaled({
  width,
  height,
  least = 0.84,
  children,
  className,
}: {
  width: number;
  height: number;
  least?: number;
  children: ReactNode;
  className?: string;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(width);
  useStill(outerRef);
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const read = () => setRoom(outer.clientWidth || width);
    read();
    const sized = new ResizeObserver(read);
    sized.observe(outer);
    return () => sized.disconnect();
  }, [width]);
  const scale = Math.max(Math.min(1, room / width), Math.min(least, 1));
  const inner = Math.min(width, room / scale);
  const tall = height * (inner / width);
  return (
    <div ref={outerRef} className={["sp-scaled", className].filter(Boolean).join(" ")} style={{ height: tall * scale }}>
      <div className="sp-scaled-inner" style={{ width: inner, height: tall, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

export function Window({
  at,
  width = 1280,
  height = 800,
  threads,
  label,
  className,
  children,
}: {
  at: RailPlace;
  className?: string;
  width?: number;
  height?: number;
  threads?: string[];
  label: string;
  children: ReactNode;
}) {
  return (
    <Scaled width={width} height={height} className={className ? `sp-window ${className}` : "sp-window"}>
      <AppWindow at={at} threads={threads} label={label} rail="none" className="sp-window-app">
        {children}
      </AppWindow>
    </Scaled>
  );
}
