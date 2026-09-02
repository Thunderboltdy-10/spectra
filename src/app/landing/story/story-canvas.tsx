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

  /* The clock loop is self-stopping: when the page is still and the coast
     frames have run out, `advanceStory` reports idle and no further rAF is
     scheduled — idle costs zero frames. Any real input (scroll, resize,
     pointer, tab becoming visible) wakes the loop immediately. A hidden tab
     gets no rAF from the browser at all, and repaints on return. */
  useEffect(() => {
    let raf = 0;
    let running = false;
    const tick = () => {
      raf = 0;
      const active = advanceStory(
        window.scrollY,
        window.innerWidth,
        window.innerHeight,
      );
      if (active) {
        raf = window.requestAnimationFrame(tick);
      } else {
        running = false;
      }
    };
    const wake = () => {
      wakeStory();
      if (!running) {
        running = true;
        raf = window.requestAnimationFrame(tick);
      }
    };
    const onVisible = () => {
      if (!document.hidden) wake();
    };
    running = true;
    raf = window.requestAnimationFrame(tick);
    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("resize", wake);
    window.addEventListener("pointermove", wake, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      running = false;
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", wake);
      window.removeEventListener("resize", wake);
      window.removeEventListener("pointermove", wake);
      document.removeEventListener("visibilitychange", onVisible);
    };
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
          className="landing-channel z-chrome"
          data-open="false"
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
