"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LAYER_CLASS, type SpectraLayer } from "./layers";
import { HostLayer, useFocusReturn } from "./layer-context";

/**
 * Spectra's edge panel for content that must remain reachable when an inline
 * rail no longer fits. It shares Dialog's focus trap, Escape behavior, overlay,
 * accessible close control, and named layer contract.
 */
const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    layer?: SpectraLayer;
  }
>(
  (
    {
      className,
      children,
      layer = "modal",
      onOpenAutoFocus,
      onCloseAutoFocus,
      ...props
    },
    ref,
  ) => {
    const focusReturn = useFocusReturn(onOpenAutoFocus, onCloseAutoFocus);
    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "spectra-veil fixed inset-0 bg-[var(--bg-overlay)] xl:hidden",
            LAYER_CLASS[layer],
          )}
        />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            "spectra-sheet fixed inset-y-0 right-0 flex h-dvh w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden border-l border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[var(--shadow-lg)] outline-none xl:hidden",
            LAYER_CLASS[layer],
            className,
          )}
          {...props}
          {...focusReturn}
        >
          <HostLayer layer={layer}>{children}</HostLayer>
          <DialogPrimitive.Close
            aria-label="Close panel"
            className="absolute right-3 top-3 grid size-8 place-items-center rounded-control text-[var(--text-secondary)] outline-none hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            <X className="size-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);
SheetContent.displayName = "SheetContent";

const SheetTitle = DialogPrimitive.Title;
const SheetDescription = DialogPrimitive.Description;

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
};
