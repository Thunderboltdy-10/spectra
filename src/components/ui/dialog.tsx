"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LAYERS, LAYER_CLASS, type SpectraLayer } from "./layers";

/**
 * Spectra's one dialog (CANON R16, ARCHITECTURE-PLATFORM §3).
 *
 * Three hand-rolled properties end here:
 *
 * 1. **One overlay.** Every modal surface wears the same ink veil
 *    (`--bg-overlay`); dialogs no longer negotiate their own scrim tint or
 *    blur the page beneath them.
 * 2. **One layer contract.** `layer` is the only way a floating surface
 *    takes a z-index, and it names one of the seven layers wired into
 *    `spectra-tokens.css` (`base < chrome < dropdown < panel < modal <
 *    composer-dock < toast`). Numeric z-index in feature code is lint-banned.
 * 3. **One accessibility floor.** Radix supplies the focus trap, Escape
 *    handling and portal; the close button always carries an accessible name
 *    (DS-4: unnamed icon buttons are the product's widest a11y hole).
 *
 * `modal` is the default layer. `composer-dock` is for capture surfaces that
 * must stay above the dock (the viewport context picker); `panel` for sheets.
 * Nothing else takes a new layer without editing the contract itself.
 */
export { LAYERS };
export type DialogLayer = SpectraLayer;

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & {
    layer?: DialogLayer;
  }
>(({ className, layer = "modal", ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "spectra-veil fixed inset-0 bg-[var(--bg-overlay)]",
      LAYER_CLASS[layer],
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    layer?: DialogLayer;
    hideCloseButton?: boolean;
    overlayClassName?: string;
  }
>(
  (
    {
      className,
      children,
      layer = "modal",
      hideCloseButton = false,
      overlayClassName,
      ...props
    },
    ref,
  ) => (
    <DialogPortal>
      <DialogOverlay layer={layer} className={overlayClassName} />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "spectra-float fixed left-1/2 top-1/2 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-surface border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 text-[var(--text-primary)] shadow-[var(--shadow-lg)]",
          LAYER_CLASS[layer],
          className,
        )}
        {...props}
      >
        {children}
        {hideCloseButton ? null : (
          <DialogPrimitive.Close
            aria-label="Close dialog"
            className="absolute right-4 top-4 grid size-8 place-items-center rounded-control text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            <X aria-hidden="true" className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  ),
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex justify-end gap-2", className)} {...props} />;
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn(
        "text-heading font-semibold leading-tight text-[var(--text-primary)]",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn(
        "text-ui leading-5 text-[var(--text-secondary)]",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
