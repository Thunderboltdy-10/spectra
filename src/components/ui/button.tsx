import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Spectra's one action treatment.
 *
 * `primary` is filled near-black on the page surface, not violet. Spectra violet
 * is an actor identity colour (`--ownership-ai`, `--presence-1`) and the Designer
 * charter reserves the actor colours for where actors act — if every primary CTA
 * were violet, violet would stop meaning "Spectra did this". Near-black also
 * matches `.spectra-workbar-primary`, so the editor workbar and the routes agree.
 *
 * One hover/focus/active treatment for every variant:
 *   hover         a 1px lift, slightly softened
 *   active        settles back to 0 (a real push)
 *   focus-visible a 2px `--focus-ring-color` ring, offset from the surface
 *   disabled      muted fill (primary) or 45% opacity (other variants), not-allowed cursor, no lift
 *
 * `whitespace-nowrap` is part of the contract, not decoration: a primary CTA
 * label must never wrap. If a label does not fit, shorten the label.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control font-semibold",
    "outline-none transition-[color,background-color,border-color,opacity,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
    "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]",
    // `disabled:pointer-events-none` below means hover can never fire while
    // disabled, so the lift needs no `enabled:` guard (which would also skip
    // anchors rendered through `asChild`).
    "hover:-translate-y-px active:translate-y-0",
    "disabled:pointer-events-none disabled:cursor-not-allowed",
  ].join(" "),
  {
    variants: {
      variant: {
        /** The one primary. 15.7:1 against its own fill. */
        primary:
          "border border-[var(--text-primary)] bg-[var(--text-primary)] [color:var(--bg-primary)] hover:opacity-90 disabled:border-transparent disabled:bg-[color-mix(in_oklab,var(--text-primary)_72%,var(--bg-elevated))] disabled:[color:var(--bg-primary)]",
        secondary:
          "border border-[var(--border-default)] bg-[var(--bg-elevated)] [color:var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-45",
        ghost:
          "border border-transparent bg-transparent [color:var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:[color:var(--text-primary)] disabled:opacity-45",
        /** Destructive confirmation only. Rose stays a local discontinuity. */
        destructive:
          "border border-[color-mix(in_oklab,var(--danger)_34%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_10%,var(--bg-secondary))] [color:color-mix(in_oklab,var(--danger)_80%,var(--text-primary))] hover:bg-[color-mix(in_oklab,var(--danger)_16%,var(--bg-secondary))] disabled:opacity-45",
      },
      size: {
        sm: "min-h-8 px-2.5 text-micro",
        md: "min-h-9 px-3 text-caption",
        lg: "min-h-10 px-4 text-ui",
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
