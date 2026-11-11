"use client";

import * as React from "react";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";
import { IconButton } from "./icon-button";
import type { SpectraLayer } from "./layers";

/*
 * AdaptiveBar (LANGUAGE.md, "Adaptive commands"): a row of commands that fits
 * its own container by an authored collapse plan, never by wrapping, clipping
 * or squeezing. It measures every command with and without its label once,
 * then works out which steps of the plan the current width needs.
 */

export type LabelPolicy = "always" | "never" | "whenRoom";

export type BarCommand = {
  id: string;
  icon: IconName | React.ReactElement | null;
  label: string;
  shortcut?: string;
  /** `always`: words carry the meaning. `never`: a universal symbol. Default `whenRoom`. */
  labelPolicy?: LabelPolicy;
  /** Never collapses: state the user must always see, such as an artifact's status control. */
  pinned?: boolean;
  /** Commands that move into the menu together, with `toMenu("group:<name>")`. */
  group?: string;
  disabled?: boolean;
  active?: boolean;
  onSelect?: () => void;
  /** A custom control (a SplitButton, the status control). It never loses its label. */
  render?: (mode: "full" | "icon") => React.ReactNode;
};

/** One step of a collapse plan: `{ hideLabel: "share" }`, `{ toMenu: "export" }`, `{ toMenu: "group:sort" }`. */
export type CollapseStep = { hideLabel: string } | { toMenu: string };

export type BarLayout = { labelHidden: ReadonlySet<string>; inMenu: ReadonlySet<string> };

type Widths = Record<string, { full: number; icon: number }>;

/**
 * Which labels to hide and which commands to move into the menu so the bar
 * fits `available` px. Steps run in order until it fits. Steps never touch
 * pinned commands, and `always` labels are never hidden (the command moves
 * into the menu instead, when the plan says so). If the plan runs out, the
 * remaining unpinned commands move into the menu from the end.
 */
export function planLayout({
  commands,
  plan,
  widths,
  available,
  gap,
  more,
}: {
  commands: readonly BarCommand[];
  plan: readonly CollapseStep[];
  widths: Widths;
  available: number;
  gap: number;
  more: number;
}): BarLayout {
  const labelHidden = new Set<string>();
  const inMenu = new Set<string>();
  const byId = new Map(commands.map((command) => [command.id, command]));
  const width = () => {
    let total = 0;
    let shown = 0;
    for (const command of commands) {
      if (inMenu.has(command.id)) continue;
      const w = widths[command.id];
      if (!w) continue;
      const iconOnly = command.labelPolicy === "never" || labelHidden.has(command.id);
      total += iconOnly ? w.icon : w.full;
      shown += 1;
    }
    if (inMenu.size) {
      total += more;
      shown += 1;
    }
    return total + Math.max(0, shown - 1) * gap;
  };
  const fits = () => width() <= available + 0.5;
  if (fits()) return { labelHidden, inMenu };

  for (const step of plan) {
    if ("hideLabel" in step) {
      const command = byId.get(step.hideLabel);
      if (!command || command.pinned || command.render || command.labelPolicy === "always" || command.labelPolicy === "never") continue;
      labelHidden.add(command.id);
    } else {
      const ids = step.toMenu.startsWith("group:")
        ? commands.filter((command) => command.group === step.toMenu.slice(6)).map((command) => command.id)
        : [step.toMenu];
      for (const id of ids) if (byId.get(id) && !byId.get(id)!.pinned) inMenu.add(id);
    }
    if (fits()) return { labelHidden, inMenu };
  }
  for (let index = commands.length - 1; index >= 0 && !fits(); index -= 1) {
    const command = commands[index];
    if (!command.pinned) inMenu.add(command.id);
  }
  return { labelHidden, inMenu };
}

const GAP = 4;
const MORE = 32;

function glyphOf(icon: BarCommand["icon"], size = 16) {
  return typeof icon === "string" ? <Icon name={icon as IconName} size={size} /> : icon;
}

function Command({ command, iconOnly }: { command: BarCommand; iconOnly: boolean }) {
  if (command.render) return <>{command.render(iconOnly ? "icon" : "full")}</>;
  if (iconOnly) {
    return <IconButton icon={command.icon} label={command.label} shortcut={command.shortcut} disabled={command.disabled} pressed={command.active} onClick={command.onSelect} />;
  }
  return (
    <button
      type="button"
      onClick={command.onSelect}
      disabled={command.disabled}
      aria-pressed={command.active}
      aria-keyshortcuts={command.shortcut}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-control px-3 text-ui font-medium text-[var(--text-secondary)] outline-none",
        "transition-[color,background-color] duration-[var(--motion-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
        "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] disabled:pointer-events-none disabled:opacity-45",
        command.active && "bg-[var(--bg-hover)] text-[var(--text-primary)]",
      )}
    >
      {glyphOf(command.icon, 18)}
      {command.label}
    </button>
  );
}

export function AdaptiveBar({
  commands,
  plan = [],
  label,
  align = "end",
  layer,
  className,
}: {
  commands: readonly BarCommand[];
  /** The authored collapse plan, in the order the steps apply. */
  plan?: readonly CollapseStep[];
  /** Accessible name of the toolbar, e.g. "Document commands". */
  label: string;
  align?: "start" | "end";
  layer?: SpectraLayer;
  className?: string;
}) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const measureRef = React.useRef<HTMLDivElement>(null);
  const [layout, setLayout] = React.useState<BarLayout>({ labelHidden: new Set(), inMenu: new Set() });

  React.useLayoutEffect(() => {
    const host = hostRef.current;
    const measure = measureRef.current;
    if (!host || !measure) return;
    const fit = () => {
      const widths: Widths = {};
      for (const element of measure.querySelectorAll<HTMLElement>("[data-measure]")) {
        const [id, mode] = element.dataset.measure!.split("\u0000");
        widths[id] ??= { full: 0, icon: 0 };
        widths[id][mode as "full" | "icon"] = element.getBoundingClientRect().width;
      }
      const next = planLayout({ commands, plan, widths, available: roomFor(host), gap: GAP, more: MORE });
      setLayout((current) =>
        sameSet(current.labelHidden, next.labelHidden) && sameSet(current.inMenu, next.inMenu) ? current : next,
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    observer.observe(measure);
    if (host.parentElement) observer.observe(host.parentElement);
    return () => observer.disconnect();
  }, [commands, plan]);

  const visible = commands.filter((command) => !layout.inMenu.has(command.id));
  const menu = commands.filter((command) => layout.inMenu.has(command.id));

  return (
    <div ref={hostRef} role="toolbar" aria-label={label} className={cn("relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden", align === "end" ? "justify-end" : "justify-start", className)}>
      {/* The measuring row: every command at both sizes, invisible. */}
      <div ref={measureRef} aria-hidden inert className="pointer-events-none invisible absolute left-0 top-0 flex w-max gap-1">
        {commands.map((command) => (
          <React.Fragment key={command.id}>
            <span data-measure={`${command.id}\u0000full`} className="inline-flex">
              <Command command={command} iconOnly={command.labelPolicy === "never"} />
            </span>
            <span data-measure={`${command.id}\u0000icon`} className="inline-flex">
              <Command command={command} iconOnly />
            </span>
          </React.Fragment>
        ))}
      </div>
      {visible.map((command) => (
        <Command key={command.id} command={command} iconOnly={command.labelPolicy === "never" || layout.labelHidden.has(command.id)} />
      ))}
      {menu.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`More ${label.toLowerCase()}`} className="grid size-8 shrink-0 place-items-center rounded-control text-[var(--text-secondary)] outline-none hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] data-[state=open]:bg-[var(--bg-hover)]">
            <Icon name="more" size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" layer={layer}>
            {menu.map((command) => (
              <DropdownMenuItem key={command.id} disabled={command.disabled} onSelect={() => command.onSelect?.()}>
                <span className="grid size-4 shrink-0 place-items-center text-[var(--text-secondary)]">{glyphOf(command.icon, 16)}</span>
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                {command.shortcut ? <kbd className="shrink-0 font-sans text-micro text-[var(--text-tertiary)]">{command.shortcut}</kbd> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function roomFor(host: HTMLElement) {
  const style = window.getComputedStyle(host);
  if (style.flexGrow !== "0") return host.clientWidth;
  const parent = host.parentElement?.clientWidth ?? host.clientWidth;
  if (style.maxWidth.endsWith("%")) return (parent * parseFloat(style.maxWidth)) / 100;
  const fixed = parseFloat(style.maxWidth);
  return Number.isFinite(fixed) ? Math.min(fixed, parent) : parent;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
