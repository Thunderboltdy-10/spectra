"use client";

import { type GlyphIcon } from "@/components/icons/glyph-icons";
import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/utils";
import { clearOfIsland, LAYER_CLASS, type SpectraLayer } from "./layers";
import { useFloatingLayer } from "./layer-context";

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
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & {
    /** Stacking layer. Defaults to the host dialog/sheet's layer, else dropdown. */
    layer?: SpectraLayer;
  }
>(
  (
    {
      className,
      style,
      sideOffset = 6,
      collisionPadding = 12,
      layer: explicitLayer,
      ...props
    },
    ref,
  ) => {
    const layer = useFloatingLayer(explicitLayer);
    // Usable at once; its rows gather from what opened it.
    return (
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          ref={ref}
          sideOffset={sideOffset}
          collisionPadding={typeof collisionPadding === "number" ? clearOfIsland(layer, collisionPadding) : collisionPadding}
          className={cn(
            "max-h-[min(70dvh,32rem)] min-w-[11rem] overflow-y-auto rounded-card border border-[var(--border-default)] p-1.5 text-[var(--text-primary)] shadow-[var(--shadow-lg)]",
            LAYER_CLASS[layer],
            "spectra-float origin-[var(--radix-dropdown-menu-content-transform-origin)]",
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
    );
  },
);
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
      <Icon name="check" size={14} className="text-[var(--text-primary)]" />
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
      "px-2 py-1.5 text-micro font-semibold text-[var(--text-secondary)]",
      className,
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

/**
 * A long group of options folded into one row, which says what is chosen and
 * opens them in place. Menus stay short; nothing moves to another page.
 *
 * As a `heading` the row names what its options have in common (Codex, Claude
 * Code) and is set apart from them: smaller and quieter, with what it holds
 * hung from a line under it. Given `open` and `onOpenChange`, the menu decides,
 * so that opening one group can close the others.
 */
function DropdownMenuDisclosure({
  label,
  hint,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  heading = false,
  children,
}: {
  label: React.ReactNode;
  /** What is chosen inside, shown while folded. */
  hint?: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  heading?: boolean;
  children: React.ReactNode;
}) {
  const [openState, setOpenState] = React.useState(defaultOpen);
  const open = openProp ?? openState;
  return (
    <>
      <DropdownMenuItem
        aria-expanded={open}
        data-menu-heading={heading || undefined}
        className={heading ? "min-h-7 py-1 text-micro font-semibold text-[var(--text-tertiary)] data-[highlighted]:text-[var(--text-primary)]" : undefined}
        onSelect={(event) => {
          event.preventDefault();
          if (openProp === undefined) setOpenState(!open);
          onOpenChange?.(!open);
        }}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {hint && !open ? <span className="max-w-[9rem] truncate text-micro font-normal text-[var(--text-tertiary)]">{hint}</span> : null}
        <Icon name="chevronDown" size={heading ? 12 : 14} className={cn("shrink-0 text-[var(--text-tertiary)] transition-transform duration-[var(--motion-fast)]", open && "rotate-180")} />
      </DropdownMenuItem>
      <div className="grid transition-[grid-template-rows] duration-[var(--motion-base)] ease-standard" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
        <div className="min-h-0 overflow-hidden">
          {open ? (heading ? <div className="ml-2.5 border-l border-[var(--border-default)] pl-1">{children}</div> : children) : null}
        </div>
      </div>
    </>
  );
}

/** A row that opens related options beside it, to the right where there is room. */
/*
 * A submenu is a second page of the same menu, set beside it: the same width,
 * at least the same height, and level with its top, so the two read as one
 * pair rather than a small list hanging off one row. The trigger measures its
 * menu just before the submenu opens.
 */
type SubFrame = { width: number; height: number; alignOffset: number; sideOffset: number };
const SubFrameContext = React.createContext<{ frame: SubFrame | null; measure: (trigger: HTMLElement) => void } | null>(null);

function DropdownMenuSub(props: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  const [frame, setFrame] = React.useState<SubFrame | null>(null);
  const value = React.useMemo(
    () => ({
      frame,
      measure: (trigger: HTMLElement) => {
        const menu = trigger.closest<HTMLElement>("[role=menu]");
        if (!menu) return;
        const outer = menu.getBoundingClientRect();
        const row = trigger.getBoundingClientRect();
        setFrame({
          width: outer.width,
          height: outer.height,
          alignOffset: outer.top - row.top,
          sideOffset: outer.right - row.right + 4,
        });
      },
    }),
    [frame],
  );
  return (
    <SubFrameContext.Provider value={value}>
      <DropdownMenuPrimitive.Sub {...props} />
    </SubFrameContext.Provider>
  );
}

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, children, onPointerEnter, onFocus, ...props }, ref) => {
  const sub = React.useContext(SubFrameContext);
  return (
    <DropdownMenuPrimitive.SubTrigger
      ref={ref}
      className={cn(itemBase, "pr-1.5 data-[state=open]:bg-[var(--bg-hover)]", className)}
      onPointerEnter={(event) => {
        sub?.measure(event.currentTarget);
        onPointerEnter?.(event);
      }}
      onFocus={(event) => {
        sub?.measure(event.currentTarget);
        onFocus?.(event);
      }}
      {...props}
    >
      {children}
      <Icon name="chevronRight" size={14} className="ml-auto shrink-0 text-[var(--text-tertiary)]" />
    </DropdownMenuPrimitive.SubTrigger>
  );
});
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent> & { layer?: SpectraLayer }
>(({ className, style, sideOffset, alignOffset, collisionPadding = 12, layer: explicitLayer, ...props }, ref) => {
  const layer = useFloatingLayer(explicitLayer);
  const frame = React.useContext(SubFrameContext)?.frame;
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        ref={ref}
        sideOffset={sideOffset ?? frame?.sideOffset ?? 4}
        alignOffset={alignOffset ?? frame?.alignOffset}
        collisionPadding={typeof collisionPadding === "number" ? clearOfIsland(layer, collisionPadding) : collisionPadding}
        className={cn(
          "max-h-[min(70dvh,32rem)] min-w-[12rem] overflow-y-auto rounded-card border border-[var(--border-default)] p-1.5 text-[var(--text-primary)] shadow-[var(--shadow-lg)]",
          LAYER_CLASS[layer],
          "spectra-float origin-[var(--radix-dropdown-menu-content-transform-origin)]",
          className,
        )}
        style={{
          backgroundColor: "var(--bg-elevated)",
          borderColor: "var(--border-default)",
          ...(frame ? { width: frame.width, minWidth: frame.width, maxWidth: frame.width, minHeight: frame.height } : null),
          ...style,
        }}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName;

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
  icon?: GlyphIcon | IconName;
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
  side = "bottom",
  layer,
  avoidCollisions = true,
  active = false,
  size = 36,
  icon: TriggerIcon = "more",
  triggerClassName,
  contentClassName,
  followSafe = false,
  modal = true,
}: {
  /** Accessible name for the trigger, e.g. "More School sections". */
  label: string;
  items: readonly OverflowItem<T>[];
  value?: T | "";
  onSelect: (key: T) => void;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
  /** Stacking layer. Dock overflow must beat the composer dock. */
  layer?: SpectraLayer;
  avoidCollisions?: boolean;
  /** Renders the trigger in the active tone when the shown item is in here. */
  active?: boolean;
  /** Trigger edge length in px, so it can match the row it sits in. */
  size?: number;
  /** Three dots by default. Override only when the menu has a settled glyph
      of its own, e.g. a bell for notification delivery. */
  icon?: GlyphIcon | IconName;
  triggerClassName?: string;
  contentClassName?: string;
  /** Menu items count as Follow controls so choosing Follow AI does not
      immediately cancel the mode. */
  followSafe?: boolean;
  /** False inside an editor's own node views: a modal menu hides the page
      around it, which the editor reads as a change to its document. */
  modal?: boolean;
}) {
  if (!items.length) return null;

  const body = items.map((item) => {
    const ItemIcon = item.icon;
    const content = (
      <>
        {/* Fixed icon column: the label edge is identical with or without an
            icon, so a mixed list never reads ragged. */}
        <span className="grid size-4 shrink-0 place-items-center text-[var(--text-secondary)]">
          {typeof ItemIcon === "string" ? <Icon name={ItemIcon} size={14} /> : ItemIcon ? <ItemIcon className="size-3.5" /> : null}
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
    <DropdownMenu modal={modal}>
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
        {typeof TriggerIcon === "string" ? (
          <Icon name={TriggerIcon} size={size < 32 ? 16 : 18} aria-hidden="true" className="pointer-events-none" />
        ) : (
          <TriggerIcon aria-hidden="true" className={cn("pointer-events-none", size < 32 ? "size-4" : "size-[18px]")} />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side={side}
        layer={layer}
        avoidCollisions={avoidCollisions}
        className={contentClassName}
        data-spectra-follow-control={followSafe ? "" : undefined}
      >
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
  DropdownMenuDisclosure,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
};
