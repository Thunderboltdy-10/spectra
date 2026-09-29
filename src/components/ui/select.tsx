"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { LAYER_CLASS, type SpectraLayer } from "./layers";
import { useFloatingLayer } from "./layer-context";

/**
 * Spectra's one Select. Replaces every native `<select>`: an OS dropdown cannot
 * match the product's menu grammar, hover, focus ring or radius scale.
 *
 * Prefer `SelectField` — it is a 1:1 mechanical replacement for a native
 * `<select>` plus its `<option>` list. The parts below are exported for the
 * rare case that needs groups, separators or custom item rendering.
 */

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

/** Trigger heights match the three real densities in the product. */
const triggerSizes = {
  sm: "h-8 px-2.5 text-micro",
  md: "h-9 px-3 text-caption",
  lg: "h-10 px-3 text-ui",
} as const;

export type SelectSize = keyof typeof triggerSizes;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & {
    size?: SelectSize;
  }
>(({ className, children, size = "md", ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex min-w-0 items-center justify-between gap-2 rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] font-medium text-[var(--text-primary)] outline-none transition-colors",
      // SelectValue must stay a direct child of Trigger. An extra span around
      // it makes Radix ItemText re-render until the tree blows the update cap
      // (sheet/slide pickers in a tight tab workbar were the first to hit it).
      "[&>[data-radix-select-value]]:min-w-0 [&>[data-radix-select-value]]:truncate [&>[data-radix-select-value]]:text-left",
      "hover:bg-[var(--bg-hover)]",
      "focus-visible:border-[color-mix(in_oklab,var(--brand-primary)_45%,var(--border-default))] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]",
      // `--text-placeholder` and `--text-tertiary` both fail WCAG AA against
      // the page surface; placeholder text uses `--text-secondary` (4.9:1).
      "data-[placeholder]:font-normal data-[placeholder]:text-[var(--text-secondary)]",
      "disabled:cursor-not-allowed disabled:opacity-45",
      triggerSizes[size],
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown
        aria-hidden="true"
        className="size-3.5 shrink-0 text-[var(--text-secondary)]"
      />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content> & {
    /** Stacking layer. Defaults to the host dialog/sheet's layer, else dropdown. */
    layer?: SpectraLayer;
  }
>(
  (
    {
      className,
      children,
      position = "popper",
      style,
      layer: explicitLayer,
      ...props
    },
    ref,
  ) => {
    const layer = useFloatingLayer(explicitLayer);
    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          ref={ref}
          position={position}
          sideOffset={4}
          className={cn(
            "relative max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[var(--shadow-lg)] spectra-float origin-[var(--radix-select-content-transform-origin)]",
            LAYER_CLASS[layer],
            className,
          )}
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: "var(--border-default)",
            ...style,
          }}
          {...props}
        >
          {/* The viewport must size to its content and scroll. Pinning it to
          `--radix-select-trigger-height` clamps the list to one row. */}
          <SelectPrimitive.Viewport className="max-h-72 overflow-y-auto p-1.5">
            {children}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    );
  },
);
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center rounded-chip py-2 pl-8 pr-3 text-ui outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-[var(--bg-hover)] data-[highlighted]:text-[var(--text-primary)] data-[disabled]:opacity-40",
      className,
    )}
    {...props}
  >
    {/* Selection is text-primary, matching the product's one active-state
        treatment. A green check would read as a health signal. */}
    <span className="absolute left-2.5 flex size-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-3.5 text-[var(--text-primary)]" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-micro font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]",
      className,
    )}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("my-1 h-px bg-[var(--border-subtle)]", className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

/**
 * The drop-in replacement for a native `<select>`.
 *
 * `<select value={v} onChange={(e) => set(e.target.value)}>` plus its options
 * becomes `<SelectField value={v} onChange={set} options={[…]} />`.
 *
 * Either `label` (rendered above the control) or `ariaLabel` is required, so a
 * converted control can never lose its accessible name.
 */
export function SelectField({
  label,
  ariaLabel,
  value,
  onChange,
  options,
  placeholder,
  size = "md",
  disabled,
  id,
  className,
  triggerClassName,
  contentClassName,
  layer,
}: {
  label?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  size?: SelectSize;
  disabled?: boolean;
  id?: string;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  /** Stacking layer for the opened list; "modal" when the field sits in one. */
  layer?: SpectraLayer;
}) {
  const uid = React.useId();
  const labelId = label ? `${uid}-label` : undefined;
  // Empty is a real state, and it belongs to the primitive rather than to each
  // call site: with nothing to choose, the control says so and cannot be
  // opened onto an empty menu.
  const empty = options.length === 0;
  const matched = options.some((option) => option.value === value);
  const resolvedValue = empty || !matched ? undefined : value;

  const trigger = (
    <SelectTrigger
      id={id}
      size={size}
      disabled={disabled || empty}
      aria-labelledby={labelId}
      aria-label={labelId ? undefined : (ariaLabel ?? placeholder)}
      className={cn(label ? "w-full" : undefined, triggerClassName)}
    >
      <SelectValue
        placeholder={
          placeholder ?? (empty ? "Nothing to choose yet" : "Select")
        }
      />
    </SelectTrigger>
  );

  const control = (
    <Select
      value={resolvedValue}
      onValueChange={onChange}
      disabled={disabled || empty}
    >
      {trigger}
      <SelectContent className={contentClassName} layer={layer}>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (!label)
    return className ? <div className={className}>{control}</div> : control;

  return (
    <div className={cn("block min-w-0", className)}>
      <span
        id={labelId}
        className="mb-1.5 block text-caption font-medium text-[var(--text-secondary)]"
      >
        {label}
      </span>
      {control}
    </div>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
