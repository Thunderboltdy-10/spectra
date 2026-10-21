import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Spectra's one action treatment, the same as the page bars' commands: words
 * and a glyph on the page itself, no fill and no outline, one height and one
 * size of type everywhere around the app. What a button is says itself in its
 * tone, not a block of colour:
 *
 *   primary      the step the place is for, in the reading ink and set firmer
 *   secondary    any other action, in the reading ink
 *   ghost        a quiet action, in the secondary ink until pointed at
 *   destructive  a confirmation that removes something, in rose
 *
 * One hover/focus/active treatment for every variant: the hover wash that
 * bar commands use, a press that settles back (MOTION.md, Controls), and a
 * 2px `--focus-ring-color` ring. Disabled is 45% opacity with no pointer.
 *
 * `whitespace-nowrap` is part of the contract, not decoration: a label must
 * never wrap. If a label does not fit, shorten the label. Works keep their own
 * controls (workbars, sheet chips); this is for the app around them.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control bg-transparent text-ui",
    "[&_svg]:size-[18px] [&_svg]:shrink-0",
    "outline-none transition-[color,background-color,opacity,transform]",
    "[transition-timing-function:var(--ease-standard),var(--ease-standard),var(--ease-standard),var(--ease-spring)] [transition-duration:var(--motion-fast),var(--motion-fast),var(--motion-fast),var(--motion-spring)]",
    "active:scale-[0.97] active:[transition-duration:90ms]",
    "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]",
    // `disabled:pointer-events-none` means hover can never fire while disabled,
    // so the press needs no `enabled:` guard (which would also skip anchors
    // rendered through `asChild`).
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: "font-semibold [color:var(--text-primary)] hover:bg-[var(--bg-hover)]",
        secondary: "font-medium [color:var(--text-primary)] hover:bg-[var(--bg-hover)]",
        ghost: "font-medium [color:var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:[color:var(--text-primary)]",
        /** Destructive confirmation only. Rose stays a local discontinuity. */
        destructive:
          "font-semibold [color:color-mix(in_oklab,var(--danger)_85%,var(--text-primary))] hover:bg-[color-mix(in_oklab,var(--danger)_9%,transparent)]",
      },
      /* Every size is the bar's size: the names stay so callers need not
         change, and a place never mixes two sizes of button. */
      size: {
        sm: "min-h-9 px-3",
        md: "min-h-9 px-3",
        lg: "min-h-9 px-3",
        icon: "size-9 px-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        type={asChild ? type : (type ?? "button")}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
