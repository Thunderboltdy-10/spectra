"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, Ellipsis, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Spectra's one menu. Every overflow, "more actions" and three-dot control uses
 * this: it portals to the body, so opening it can never change the height of
 * the bar it sits in, introduce `overflow-y`, push a sibling control onto
 * another row, or make the surface jump.
 *
 * Menu items are left-aligned over a fixed icon column. A centre-aligned menu
 * with a ragged icon column is the anti-pattern (D16).
 */

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, style, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-[340] max-h-[min(70dvh,32rem)] min-w-[11rem] overflow-y-auto rounded-card border border-[var(--border-default)] p-1.5 text-[var(--text-primary)] shadow-[var(--shadow-lg)]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className,
      )}
      style={{
        backgroundColor: "var(--bg-elevated)",
        borderColor: "var(--border-default)",
        ...style,
      }}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const itemBase =
  "relative flex w-full cursor-pointer select-none items-center gap-2.5 rounded-chip px-2 py-1.5 text-ui outline-none transition-colors data-[highlighted]:bg-[var(--bg-hover)] data-[highlighted]:text-[var(--text-primary)] data-[disabled]:pointer-events-none data-[disabled]:opacity-40";

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(itemBase, className)}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

/** Selection inside a menu. Marked with text-primary, never a green check. */
const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(itemBase, "pr-7", className)}
    {...props}
  >
    {children}
    <DropdownMenuPrimitive.ItemIndicator className="absolute right-2 flex size-3.5 items-center justify-center">
      <Check className="size-3.5 text-[var(--text-primary)]" />
    </DropdownMenuPrimitive.ItemIndicator>
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-micro font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]",
      className,
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("my-1 h-px bg-[var(--border-subtle)]", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

export type OverflowItem<T extends string = string> = {
  key: T;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  /** Shown right-aligned: a count, a shortcut, or a state word. */
  hint?: string;
};

/**
 * The genuine three-dot overflow. Use this wherever controls do not fit —
 * never a native `<select>` layered under an icon, and never by deleting
 * labels.
 *
 * When `value` is supplied the menu carries radio semantics, so the item the
 * surface is currently showing is marked. Without it, items are plain actions.
 */
export function OverflowMenu<T extends string>({
  label,
  items,
  value,
  onSelect,
  align = "end",
  active = false,
  size = 40,
  icon: TriggerIcon = Ellipsis,
  triggerClassName,
  contentClassName,
}: {
  /** Accessible name for the trigger, e.g. "More School sections". */
  label: string;
  items: readonly OverflowItem<T>[];
  value?: T | "";
  onSelect: (key: T) => void;
  align?: "start" | "center" | "end";
  /** Renders the trigger in the active tone when the shown item is in here. */
  active?: boolean;
  /** Trigger edge length in px, so it can match the row it sits in. */
  size?: number;
  /** Three dots by default. Override only when the menu has a settled glyph
      of its own, e.g. a bell for notification delivery. */
  icon?: LucideIcon;
  triggerClassName?: string;
  contentClassName?: string;
}) {
  if (!items.length) return null;

  const body = items.map((item) => {
    const Icon = item.icon;
    const content = (
      <>
        {/* Fixed icon column: the label edge is identical with or without an
            icon, so a mixed list never reads ragged. */}
        <span className="grid size-4 shrink-0 place-items-center text-[var(--text-secondary)]">
          {Icon ? <Icon className="size-3.5" /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.hint ? (
          <span className="shrink-0 text-micro text-[var(--text-secondary)]">
            {item.hint}
          </span>
        ) : null}
      </>
    );
    return value === undefined ? (
      <DropdownMenuItem
        key={item.key}
        disabled={item.disabled}
        onSelect={() => onSelect(item.key)}
      >
        {content}
      </DropdownMenuItem>
    ) : (
      <DropdownMenuRadioItem
        key={item.key}
        value={item.key}
        disabled={item.disabled}
      >
        {content}
      </DropdownMenuRadioItem>
    );
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        title={label}
        className={cn(
          "grid shrink-0 place-items-center rounded-control outline-none transition-colors",
          "hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]",
          "data-[state=open]:bg-[var(--bg-hover)]",
          active
            ? "text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
          triggerClassName,
        )}
        style={{ width: size, height: size }}
      >
        <TriggerIcon aria-hidden="true" className="pointer-events-none size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={contentClassName}>
        {value === undefined ? (
          body
        ) : (
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => onSelect(next as T)}
          >
            {body}
          </DropdownMenuRadioGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
};
