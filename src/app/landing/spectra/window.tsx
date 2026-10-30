"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppWindow, type RailPlace } from "../kit/app-window";

/*
 * Spectra's window on the page. The app is laid out for a laptop, so a page
 * of it is held at a laptop's width and scaled to whatever room the scene
 * has; it reads the same on every screen, and everything in it still works.
 * The page shows the page alone: no rail, no island, nothing that scrolls.
 */

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
