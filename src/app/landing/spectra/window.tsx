"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppWindow, type RailPlace } from "../kit/app-window";

/*
 * Spectra's window on the page. The app is laid out for a laptop, so a page
 * of it is held at a laptop's width and scaled to whatever room the scene
 * has; it reads the same on every screen, and everything in it still works.
 */

/** Holds a fixed design size and scales it to its container's width. */
export function Scaled({ width, height, children, className }: { width: number; height: number; children: ReactNode; className?: string }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const read = () => setScale(Math.min(1, outer.clientWidth / width));
    read();
    const sized = new ResizeObserver(read);
    sized.observe(outer);
    return () => sized.disconnect();
  }, [width]);
  return (
    <div ref={outerRef} className={["sp-scaled", className].filter(Boolean).join(" ")} style={{ height: height * scale }}>
      <div className="sp-scaled-inner" style={{ width, height, transform: `scale(${scale})` }}>
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
  children,
}: {
  at: RailPlace;
  width?: number;
  height?: number;
  threads?: string[];
  label: string;
  children: ReactNode;
}) {
  return (
    <Scaled width={width} height={height} className="sp-window">
      <AppWindow at={at} threads={threads} label={label} className="sp-window-app">
        {children}
      </AppWindow>
    </Scaled>
  );
}
