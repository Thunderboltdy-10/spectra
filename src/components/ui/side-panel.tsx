"use client";

import * as React from "react";
import { Icon, type IconName } from "@/components/icons";
import { spectraBus } from "@/features/spectra/events";
import { useLifeLanding } from "@/features/spectra/life/use-life";
import { cn } from "@/lib/utils";
import { AdaptiveBar, type BarCommand, type CollapseStep } from "./adaptive-bar";
import { OverflowMenu } from "./dropdown-menu";
import { IconButton } from "./icon-button";
import { Tooltip } from "./tooltip";

/*
 * Panels (SHELL.md, "Two kinds of panel"). Both kinds look the same: one
 * PanelHeader, no background of their own, a resize handle on the inner edge.
 *
 * - Collapsible: a structural part of a page (Details, Plans, the companion).
 *   Its chevron folds it to a slim edge tab; it remembers open and width per
 *   page. When a closable panel takes the Side, or the stage runs short of
 *   its minimum, it tucks into the tab and comes back on its own after.
 * - Closable: transient work the user opened. Its × removes it.
 */

const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 340;
const TAB_WIDTH = 40;

type Stored = { open: boolean; width: number };

function readStored(id: string, fallback: Stored): Stored {
  try {
    const raw = window.localStorage.getItem(`spectra.panel.${id}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return {
      open: typeof parsed.open === "boolean" ? parsed.open : fallback.open,
      width: typeof parsed.width === "number" && Number.isFinite(parsed.width) ? parsed.width : fallback.width,
    };
  } catch {
    return fallback;
  }
}

function writeStored(id: string, value: Stored) {
  try {
    window.localStorage.setItem(`spectra.panel.${id}`, JSON.stringify(value));
  } catch {
    /* A remembered panel is a convenience. */
  }
}

const subscribeSide = (listener: () => void) => spectraBus.subscribe("side.open", listener);
const sideOpen = () => Boolean(spectraBus.getQuery("side.open"));
const noSide = () => false;

/** True while a closable panel (work, a conversation) holds the app's Side. */
export function useSideHeld() {
  return React.useSyncExternalStore(subscribeSide, sideOpen, noSide);
}

export function PanelHeader({
  title,
  icon,
  commands = [],
  plan,
  control,
  children,
  className,
}: {
  title: React.ReactNode;
  icon?: IconName;
  commands?: readonly BarCommand[];
  plan?: readonly CollapseStep[];
  /** The collapse chevron or the close ×, always last. */
  control?: React.ReactNode;
  /** Under the title line: the panel's tabs. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("shrink-0 px-3 pt-2", className)}>
      <div className="flex min-h-10 min-w-0 items-center gap-2">
        {icon ? (
          <span aria-hidden className="grid size-5 shrink-0 place-items-center text-[var(--text-secondary)]">
            <Icon name={icon} size={16} />
          </span>
        ) : null}
        <h2 data-panel-title className="min-w-0 shrink truncate text-ui font-semibold text-[var(--text-primary)]">
          {title}
        </h2>
        {commands.length ? (
          <AdaptiveBar commands={commands} plan={plan} label={typeof title === "string" ? `${title} commands` : "Panel commands"} className="min-w-0" />
        ) : (
          <span className="flex-1" />
        )}
        {control}
      </div>
      {children}
    </div>
  );
}

export type PanelTab = { id: string; label: string; icon: IconName; count?: number };

/**
 * A panel's or a page's tabs. With room each shows its name; in a narrow
 * panel the others become icons with tooltips and only the current one keeps
 * its name. With `primaryCount`, tabs past it wait in a More menu that
 * overlays (it never wraps the row or pushes the surface), and the current
 * tab always trades places into the row, so it is never hidden.
 */
export function PanelTabs({
  tabs,
  value,
  onChange,
  label,
  primaryCount,
  className,
}: {
  tabs: readonly PanelTab[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** How many tabs stay in the row; the rest go to the More menu. All, when unset. */
  primaryCount?: number;
  className?: string;
}) {
  const refs = React.useRef(new Map<string, HTMLButtonElement>());
  const keep = primaryCount && primaryCount > 0 && primaryCount < tabs.length ? primaryCount : tabs.length;
  const ordered = [...tabs];
  const current = ordered.findIndex((tab) => tab.id === value);
  if (current >= keep) ordered.splice(keep - 1, 0, ...ordered.splice(current, 1));
  const shown = ordered.slice(0, keep);
  const more = ordered.slice(keep);
  function move(from: number, by: number) {
    const next = shown[(from + by + shown.length) % shown.length];
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  }
  return (
    <div role="tablist" aria-label={label} className={cn("@container/tabs mt-1 flex min-w-0 items-center gap-0.5 border-b border-[var(--border-subtle)] pb-1.5", className)}>
      {shown.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <Tooltip key={tab.id} label={tab.label} disabled={selected}>
          <button
            ref={(node) => {
              if (node) refs.current.set(tab.id, node);
              else refs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={`panel-tab-${tab.id}`}
            aria-selected={selected}
            aria-label={tab.label}
            tabIndex={selected ? 0 : -1}
            data-icon-host
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") move(index, 1);
              else if (event.key === "ArrowLeft") move(index, -1);
              else return;
              event.preventDefault();
            }}
            className={cn(
              "inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-control px-2 text-caption font-medium outline-none transition-colors duration-[var(--motion-fast)]",
              "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]",
              selected
                ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
            )}
          >
            <Icon name={tab.icon} size={16} />
            <span className={cn(selected ? "inline" : "hidden @min-[420px]/tabs:inline")}>{tab.label}</span>
            {tab.count ? <span className="text-micro text-[var(--text-tertiary)]">{tab.count}</span> : null}
          </button>
          </Tooltip>
        );
      })}
      {more.length ? (
        <span className="ml-auto shrink-0">
          <OverflowMenu
            label={`More ${label}`}
            size={32}
            items={more.map((tab) => ({ key: tab.id, label: tab.label, icon: tab.icon, hint: tab.count ? String(tab.count) : undefined }))}
            onSelect={onChange}
          />
        </span>
      ) : null}
    </div>
  );
}

/**
 * A page's collapsible panel. Place it last in a `relative flex` row beside
 * the page's own content: it measures that row to keep the stage at its
 * minimum.
 */
export function SidePanel({
  id,
  title,
  icon,
  label,
  defaultOpen = true,
  defaultWidth = DEFAULT_WIDTH,
  minWidth = MIN_WIDTH,
  stageMin = 560,
  commands,
  plan,
  header,
  children,
  className,
  onOpenChange,
  revealKey,
}: {
  /** Remembers open and width under this key, per page. */
  id: string;
  title: string;
  icon: IconName;
  /** The aside's accessible name; defaults to the title. */
  label?: string;
  defaultOpen?: boolean;
  defaultWidth?: number;
  minWidth?: number;
  /** The page's stage minimum: below it the panel tucks into its tab. */
  stageMin?: number;
  commands?: readonly BarCommand[];
  plan?: readonly CollapseStep[];
  /** Under the header line, e.g. PanelTabs. */
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  onOpenChange?: (open: boolean) => void;
  /** Each new value opens the panel, as if its tab were pressed: the page chose something to show in it. */
  revealKey?: string | number | null;
}) {
  const [stored, setStored] = React.useState<Stored>({ open: defaultOpen, width: defaultWidth });
  const [rowWidth, setRowWidth] = React.useState(0);
  const [override, setOverride] = React.useState(false);
  const [landing, setLanding] = React.useState(0);
  const held = useSideHeld();
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLElement>(null);
  const tabRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setStored(readStored(id, { open: defaultOpen, width: defaultWidth }));
  }, [defaultOpen, defaultWidth, id]);

  // The row the panel shares with the page's content.
  React.useLayoutEffect(() => {
    const row = anchorRef.current?.parentElement;
    if (!row || typeof ResizeObserver === "undefined") return;
    const measure = () => setRowWidth(row.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  const maxWidth = Math.max(minWidth, rowWidth ? Math.round(rowWidth * 0.5) : 720);
  const width = Math.min(Math.max(stored.width, minWidth), maxWidth);
  const short = rowWidth > 0 && rowWidth - width < stageMin;
  // Tucked by the shell, not by the user: it comes back on its own.
  const tucked = held || short;
  React.useEffect(() => setOverride(false), [tucked]);
  const shown = stored.open && (!tucked || override);
  const floating = shown && short;

  React.useEffect(() => onOpenChange?.(shown), [onOpenChange, shown]);

  // A tab ↔ a panel is a morph (LIFE.md): each lands from the other's press.
  useLifeLanding(panelRef, shown && landing ? `${id}:open:${landing}` : null);
  useLifeLanding(tabRef, !shown && landing ? `${id}:tab:${landing}` : null);

  function setOpen(open: boolean) {
    setLanding((value) => value + 1);
    if (open && tucked) {
      setOverride(true);
      if (stored.open) return;
    }
    const next = { ...stored, open };
    setStored(next);
    writeStored(id, next);
  }

  const setOpenRef = React.useRef(setOpen);
  React.useLayoutEffect(() => {
    setOpenRef.current = setOpen;
  });
  const revealed = React.useRef(revealKey);
  React.useEffect(() => {
    if (revealKey == null || revealKey === revealed.current) return;
    revealed.current = revealKey;
    setOpenRef.current(true);
  }, [revealKey]);

  function resizeTo(next: number) {
    const clamped = Math.round(Math.min(Math.max(next, minWidth), maxWidth));
    setStored((current) => ({ ...current, width: clamped }));
    return clamped;
  }

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    let last = startWidth;
    const move = (moveEvent: PointerEvent) => {
      last = resizeTo(startWidth + (startX - moveEvent.clientX));
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      writeStored(id, { open: stored.open, width: last });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  if (!shown) {
    return (
      <>
        <div ref={anchorRef} hidden />
        <div ref={tabRef} data-panel-tab={id} className="flex w-10 shrink-0 flex-col items-center border-l border-[var(--border-subtle)] pt-3" style={{ width: TAB_WIDTH }}>
          <span data-life-launch className="inline-flex">
            <IconButton icon={icon} label={`Show ${title.toLowerCase()}`} tooltipSide="top" onClick={() => setOpen(true)} />
          </span>
        </div>
      </>
    );
  }

  return (
    <>
      <div ref={anchorRef} hidden />
      <aside
        ref={panelRef}
        aria-label={label ?? title}
        data-side-panel={id}
        style={{ width }}
        className={cn(
          "relative flex h-full min-h-0 shrink-0 flex-col border-l border-[var(--border-subtle)]",
          floating && "absolute inset-y-0 right-0 z-panel bg-[var(--bg-primary)] shadow-[var(--shadow-lg)]",
          className,
        )}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${title.toLowerCase()}`}
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(event) => {
            const by = event.key === "ArrowLeft" ? 16 : event.key === "ArrowRight" ? -16 : 0;
            if (!by) return;
            event.preventDefault();
            writeStored(id, { open: stored.open, width: resizeTo(width + by) });
          }}
          className="absolute inset-y-0 -left-1 z-chrome w-2 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-[3px] after:w-px after:bg-transparent after:transition-colors hover:after:bg-[var(--border-default)] focus-visible:after:bg-[var(--focus-ring-color)]"
        />
        <PanelHeader
          title={title}
          icon={icon}
          commands={commands}
          plan={plan}
          control={
            <span data-life-launch className="inline-flex">
              <IconButton icon="collapse" label={`Hide ${title.toLowerCase()}`} size="compact" onClick={() => setOpen(false)} />
            </span>
          }
        >
          {header}
        </PanelHeader>
        <div className="spectra-thin-scrollbar spectra-page-scroll min-h-0 flex-1 overflow-y-auto px-3 pt-3">{children}</div>
      </aside>
    </>
  );
}
