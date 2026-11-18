"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { clearOfIsland, LAYER_CLASS, type SpectraLayer } from "./layers";
import { useFloatingLayer } from "./layer-context";

/**
 * Spectra's one anchored popover.
 *
 * Positioning, collision handling, focus return and dismissal belong to the
 * primitive. Feature code supplies the content and names a layer; it never
 * negotiates a numeric z-index or installs document-level pointer listeners.
 */
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;
const PopoverClose = PopoverPrimitive.Close;

function scrollerFrom(target: EventTarget | null, root: HTMLElement, deltaY: number) {
  for (let node = target instanceof Element ? target : null; node && root.contains(node); node = node.parentElement) {
    if (!(node instanceof HTMLElement) || node.scrollHeight <= node.clientHeight) continue;
    const overflow = getComputedStyle(node).overflowY;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    const room = deltaY < 0 ? node.scrollTop : node.scrollHeight - node.clientHeight - node.scrollTop;
    if (room > 0.5) return node;
  }
  return null;
}

/*
 * A popover opened from a dialog sits outside it, and the dialog's scroll lock
 * swallows the wheel and touch there: its lists scroll by hand instead.
 */
// Set on the body while a dialog holds the page still; otherwise the browser scrolls as usual.
const locked = () => document.body.hasAttribute("data-scroll-locked");

function useScrollThroughLock(root: HTMLElement | null) {
  React.useEffect(() => {
    if (!root) return;
    let lastY: number | null = null;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || !locked()) return;
      const delta = event.deltaMode === 1 ? event.deltaY * 32 : event.deltaMode === 2 ? event.deltaY * root.clientHeight : event.deltaY;
      const scroller = scrollerFrom(event.target, root, delta);
      event.preventDefault();
      event.stopPropagation();
      if (scroller) scroller.scrollTop += delta;
    };
    const touchStart = (event: TouchEvent) => {
      lastY = event.touches.length === 1 && locked() ? event.touches[0]!.clientY : null;
    };
    const touchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (y === undefined || lastY === null) return;
      const scroller = scrollerFrom(event.target, root, lastY - y);
      event.stopPropagation();
      if (event.cancelable) event.preventDefault();
      if (scroller) scroller.scrollTop += lastY - y;
      lastY = y;
    };
    root.addEventListener("wheel", wheel, { passive: false });
    root.addEventListener("touchstart", touchStart, { passive: true });
    root.addEventListener("touchmove", touchMove, { passive: false });
    return () => {
      root.removeEventListener("wheel", wheel);
      root.removeEventListener("touchstart", touchStart);
      root.removeEventListener("touchmove", touchMove);
    };
  }, [root]);
}

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
    layer?: SpectraLayer;
  }
>(
  (
    {
      className,
      sideOffset = 5,
      collisionPadding = 8,
      layer: explicitLayer,
      ...props
    },
    ref,
  ) => {
    const layer = useFloatingLayer(explicitLayer);
    const [root, setRoot] = React.useState<HTMLDivElement | null>(null);
    useScrollThroughLock(root);
    const setRefs = React.useCallback(
      (node: HTMLDivElement | null) => {
        setRoot(node);
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );
    // Usable at once; its dots gather onto it from what opened it.
    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={setRefs}
          sideOffset={sideOffset}
          collisionPadding={typeof collisionPadding === "number" ? clearOfIsland(layer, collisionPadding) : collisionPadding}
          className={cn(
            "max-h-[min(70dvh,32rem)] overflow-y-auto rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 text-[var(--text-primary)] shadow-[var(--shadow-lg)] outline-none",
            LAYER_CLASS[layer],
            "spectra-float origin-[var(--radix-popover-content-transform-origin)]",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Portal>
    );
  },
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger };
