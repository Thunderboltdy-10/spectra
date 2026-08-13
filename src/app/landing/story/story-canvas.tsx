"use client";

/**
 * The persistent landing canvas.
 *
 * One tall work surface, mounted once, transformed by the camera. Every scene
 * is a region of it. Completed scenes stay on it in their finished state,
 * which is what makes the final reveal possible without a single screenshot:
 * by the time the camera pulls back, the whole page genuinely exists.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { advanceStory, onStoryFrame, wakeStory } from "./story-clock";
import {
  CANVAS_HEIGHT,
  FIRST_REST,
  LANDING_WIDTH,
  channelFor,
  opticsFor,
  totalScroll,
} from "./timeline";
import { setPrismProgress } from "../prism/prism-slot";
import { heroState } from "../scene/heroState";

export function StoryCanvas({
  children,
  ground,
  shell,
  overlay,
}: {
  children: ReactNode;
  /** Layers painted under the canvas: the environment field, the ground. */
  ground?: ReactNode;
  /**
   * The product shell the canvas turns out to have been inside all along.
   * A sibling of the channel rather than its parent, because the canvas is
   * never remounted — the shell resolves around it.
   */
  shell?: ReactNode;
  /** Fixed layers that must not scale with the canvas (presence, prism). */
  overlay?: ReactNode;
}) {
  const spacerRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  /* The scroll spacer gives the page its real height. Scene lengths are in
     viewport heights, so this is remeasured on resize rather than assumed. */
  useEffect(() => {
    const apply = () => {
      const spacer = spacerRef.current;
      if (!spacer) return;
      spacer.style.height = `${totalScroll(window.innerHeight)}px`;
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      advanceStory(window.scrollY, window.innerWidth, window.innerHeight);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  /* The camera drives on scroll; the rest of the loop wakes on it. Scroll
     events are one gesture, so a couple of wake calls per frame at worst, and
     the clock's idle deadband swallows the rest. */
  useEffect(() => {
    const onScroll = () => wakeStory();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* The camera writes one transform, and — only at the very end — one clip.
     Nothing else in the tree moves. */
  useEffect(() => {
    let open = "";
    let arrive = "";
    return onStoryFrame((frame) => {
      const node = canvasRef.current;
      const channel = channelRef.current;
      if (!node || !channel) return;
      node.style.transform = `scale(${frame.scale}) translate3d(${
        -LANDING_WIDTH / 2
      }px, ${-frame.y}px, 0)`;
      setPrismProgress(opticsFor(frame));
      heroState.progress = opticsFor(frame);

      /* `arrive` starts at zero the instant a travel begins, so a scene can
         know it is *leaving* as well as arriving. */
      const tag = frame.arrive >= 1 ? "true" : "false";
      if (arrive !== tag) {
        arrive = tag;
        node.dataset.arrive = tag;
      }

      const box = channelFor(frame, frame.viewport);
      channel.style.left = `${box.left.toFixed(1)}px`;
      channel.style.right = `${box.right.toFixed(1)}px`;
      channel.style.top = `${box.top.toFixed(1)}px`;
      channel.style.bottom = `${box.bottom.toFixed(1)}px`;
      const isOpen = box.open > 0.02 ? "true" : "false";
      if (open !== isOpen) {
        open = isOpen;
        channel.dataset.open = isOpen;
      }

      /* Proof of height, and only once the box is small enough for the claim
         to mean anything: this much viewport, that much surface. While the
         proof pass is actually running the bar is at full strength, because
         then it is the thing being demonstrated rather than a hint. */
      const bar = barRef.current;
      const thumb = thumbRef.current;
      if (!bar || !thumb) return;
      const visible = frame.viewport.height - box.top - box.bottom;
      const surface = CANVAS_HEIGHT * frame.scale;
      const ratio = Math.min(1, visible / Math.max(1, surface));
      const hint = box.open > 0.4 ? Math.min(1, (box.open - 0.4) / 0.3) : 0;
      bar.style.setProperty(
        "--bar-opacity",
        Math.max(hint, box.proof).toFixed(3),
      );
      thumb.style.setProperty("--thumb-h", `${(ratio * 100).toFixed(2)}%`);
      const travel = Math.max(0, 1 - ratio);
      const through = Math.min(
        1,
        Math.max(0, (frame.y * frame.scale) / Math.max(1, surface - visible)),
      );
      thumb.style.setProperty(
        "--thumb-y",
        `${(through * travel * 100).toFixed(2)}%`,
      );
    });
  }, []);

  return (
    <>
      <div ref={spacerRef} aria-hidden="true" />
      <div className="landing-frame" data-landing-frame>
        {ground}
        {shell}
        <div
          ref={channelRef}
          className="landing-channel"
          data-open="false"
          style={{ zIndex: 10 }}
        >
          <div
            ref={canvasRef}
            className="landing-canvas"
            data-spectra-surface="spectra-landing"
            style={{
              width: LANDING_WIDTH,
              height: CANVAS_HEIGHT,
              /* Seeded so the first paint is already framed, before the clock
                 has had a frame to run. */
              transform: `scale(1) translate3d(${
                -LANDING_WIDTH / 2
              }px, ${-FIRST_REST}px, 0)`,
            }}
          >
            {children}
          </div>
          <div ref={barRef} className="landing-channel-bar" aria-hidden="true">
            <div ref={thumbRef} className="landing-channel-thumb" />
          </div>
        </div>
        {overlay}
      </div>
    </>
  );
}
