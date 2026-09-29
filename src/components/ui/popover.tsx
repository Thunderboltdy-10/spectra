"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { LAYER_CLASS, type SpectraLayer } from "./layers";
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
    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={ref}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
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
