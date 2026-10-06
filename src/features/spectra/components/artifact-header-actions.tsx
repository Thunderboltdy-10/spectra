"use client";

import { type GlyphIcon } from "@/components/icons/glyph-icons";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { planLayout, type BarCommand, type CollapseStep } from "@/components/ui/adaptive-bar";
import { IconButton } from "@/components/ui/icon-button";
import { WorkbarMenuAction, WorkbarMore } from "./artifact-workbar";

/*
 * The right end of an artifact header, on AdaptiveBar's plan engine. The
 * status control and the people here are pinned: they never collapse. The
 * header's own commands (Comments, Chats, Open full) step into the header's
 * More when the title needs the room, so the header never grows a second
 * overflow button beside the one it has.
 */

export type HeaderCommand = {
  id: string;
  label: string;
  icon: GlyphIcon;
  onSelect: () => void;
};

/** What the work's name keeps before a header command gives way. */
export const HEADER_IDENTITY_MIN = 168;
const COMMAND_WIDTH = 32;
const GAP = 4;

/** Commands leave from the end of the row: the last one is the least needed. */
function planOf(commands: readonly HeaderCommand[]): CollapseStep[] {
  return [...commands].reverse().map((command) => ({ toMenu: command.id }));
}

/** Which header commands step into More at this width. Pure, for tests. */
export function shedHeaderCommands({
  commands,
  rowWidth,
  fixedWidth,
}: {
  commands: readonly HeaderCommand[];
  /** The whole header row. */
  rowWidth: number;
  /** The pinned controls, More and Close. */
  fixedWidth: number;
}): Set<string> {
  const bar: BarCommand[] = commands.map((command) => ({
    id: command.id,
    icon: null,
    label: command.label,
    labelPolicy: "never",
  }));
  const widths = Object.fromEntries(commands.map((command) => [command.id, { full: COMMAND_WIDTH, icon: COMMAND_WIDTH }]));
  const available = rowWidth - HEADER_IDENTITY_MIN - fixedWidth - GAP;
  // The header's More is always there (it is in `fixedWidth`), so shedding
  // never adds a button: cancel the gap the engine keeps for one.
  const layout = planLayout({ commands: bar, plan: planOf(commands), widths, available, gap: GAP, more: -GAP });
  return new Set(layout.inMenu);
}

export function ArtifactHeaderActions({
  presence,
  status,
  commands,
  moreLabel,
  more,
  close,
}: {
  /** The people here: never collapses. */
  presence: ReactNode;
  /** The status control: never collapses, and sits just before More. */
  status: ReactNode;
  commands: readonly HeaderCommand[];
  moreLabel: string;
  /** The More menu's own entries. */
  more: ReactNode;
  close: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef<HTMLSpanElement>(null);
  const tailRef = useRef<HTMLSpanElement>(null);
  const [shed, setShed] = useState<ReadonlySet<string>>(() => new Set());
  const signature = commands.map((command) => command.id).join("|");

  useLayoutEffect(() => {
    const host = hostRef.current;
    const row = host?.parentElement;
    if (!host || !row) return;
    const fit = () => {
      const rowWidth = row.clientWidth;
      // Not laid out yet (tests, a hidden panel): keep everything in the row.
      if (rowWidth < 40) return;
      const fixedWidth =
        (pinnedRef.current?.getBoundingClientRect().width ?? 0) +
        (tailRef.current?.getBoundingClientRect().width ?? 0) +
        GAP * 2;
      const next = shedHeaderCommands({ commands, rowWidth, fixedWidth });
      setShed((current) => (sameSet(current, next) ? current : next));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    if (pinnedRef.current) observer.observe(pinnedRef.current);
    // The status words come and go: the tail's width moves with them.
    if (tailRef.current) observer.observe(tailRef.current);
    return () => observer.disconnect();
    // `signature` stands for the commands: their handlers change every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const visible = commands.filter((command) => !shed.has(command.id));
  const folded = commands.filter((command) => shed.has(command.id));

  return (
    <div ref={hostRef} className="spectra-artifact-header-actions flex shrink-0 items-center gap-1">
      <span ref={pinnedRef} className="inline-flex items-center gap-1" data-header-pinned>
        {presence}
      </span>
      {visible.map((command) => {
        const Glyph = command.icon;
        return <IconButton key={command.id} label={command.label} onClick={command.onSelect} icon={<Glyph className="size-4" />} />;
      })}
      <span ref={tailRef} className="inline-flex items-center gap-1">
        {status}
        <WorkbarMore label={moreLabel}>
          {folded.map((command) => {
            const Glyph = command.icon;
            return (
              <WorkbarMenuAction key={command.id} onSelect={command.onSelect}>
                <Glyph className="h-4 w-4" /> {command.label}
              </WorkbarMenuAction>
            );
          })}
          {more}
        </WorkbarMore>
        {close}
      </span>
    </div>
  );
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
