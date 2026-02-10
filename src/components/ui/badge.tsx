import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-[var(--radius-pill)] border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default:
          "border-[color-mix(in_oklab,var(--accent)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent)_10%,var(--bg-secondary))] text-[var(--text-primary)]",
        secondary: "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]",
        success:
          "border-[color-mix(in_oklab,var(--success)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_12%,var(--bg-secondary))] text-[color-mix(in_oklab,var(--success)_80%,var(--text-primary))]",
        warning:
          "border-[color-mix(in_oklab,var(--warning)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_14%,var(--bg-secondary))] text-[color-mix(in_oklab,var(--warning)_80%,var(--text-primary))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
