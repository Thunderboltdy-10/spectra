"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

const LIFT_MS = 640;
const RISE_MS = 520;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Home's day, above the conversation it gives way to. When a thread starts
 * (one is sent, or one is opened) the day lifts off the top of the page in
 * one piece and the conversation rises in under it: the day leaves the
 * scroll first, so nothing jumps, and is gone when it has cleared the page.
 */
export function HomeLead({ leaving, onGone, children }: { leaving: boolean; onGone: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const goneRef = useRef(onGone);
  useLayoutEffect(() => {
    goneRef.current = onGone;
  });

  useLayoutEffect(() => {
    const lead = ref.current;
    const stage = lead?.closest<HTMLElement>(".spectra-conversation");
    if (!leaving || !lead || !stage) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const box = lead.getBoundingClientRect();
    const frame = stage.getBoundingClientRect();
    // Out of the scroll, where it stood: the conversation takes the page from the top.
    Object.assign(lead.style, { position: "absolute", left: `${box.left - frame.left}px`, width: `${box.width}px`, top: `${box.top - frame.top}px`, zIndex: "1", pointerEvents: "none" });
    const conversation = lead.nextElementSibling as HTMLElement | null;
    if (reduce) {
      goneRef.current();
      return;
    }
    const lift = lead.animate(
      [
        { transform: "translateY(0)", opacity: 1 },
        { transform: `translateY(${-(box.bottom - frame.top) * 0.55}px)`, opacity: 0 },
      ],
      { duration: LIFT_MS, easing: EASE, fill: "forwards" },
    );
    conversation?.animate(
      [
        { transform: "translateY(56px)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      { duration: RISE_MS, delay: 90, easing: EASE, fill: "backwards" },
    );
    lift.onfinish = () => goneRef.current();
    return () => lift.cancel();
  }, [leaving]);

  return (
    <div ref={ref} data-home-lead={leaving ? "leaving" : "shown"} className="home-lead">
      {children}
    </div>
  );
}
