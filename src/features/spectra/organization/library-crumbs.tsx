"use client";

import { ChevronRight, Home } from "@/components/icons/glyph-icons";
import { cn } from "@/lib/utils";
import type { OrganizerLocation } from "./organizer-rail";
import type { TreeNode } from "./tree-client";

/*
 * Where the reader stands in the Library (LIBRARY.md, "The path"): a house
 * for the top, then each place on the way down, the last one the place they
 * are in. A workspace is one of those places, so the path runs through it
 * like any folder. Every step is a way back and a place to drop things.
 */

export type CrumbStep = {
  label: string;
  /** The node the step stands for; null is the top. */
  nodeId: string | null;
  /** How to get there, when it is not a plain folder move (leaving a workspace). */
  onSelect?: () => void;
};

export function LibraryCrumbs({
  steps,
  tail,
  dropNodeId,
  onNavigate,
}: {
  /** The top first, the place the reader is in last. */
  steps: readonly CrumbStep[];
  /** A way of looking rather than a place (Recent, Trash), after the top. */
  tail?: string;
  /** The step a drag is hovering, to ring it. */
  dropNodeId?: string | null;
  onNavigate: (location: OrganizerLocation) => void;
}) {
  return (
    <>
      {steps.map((step, index) => {
        const home = index === 0;
        const active = !tail && index === steps.length - 1;
        const go = step.onSelect ?? (() => onNavigate({ kind: "folder", nodeId: step.nodeId }));
        return (
          <div key={step.nodeId ?? "top"} className={cn("flex min-w-0 items-center", !active && "[flex-shrink:4]", home && "shrink-0")}>
            {home ? null : <ChevronRight aria-hidden className="size-3.5 shrink-0 text-[var(--text-tertiary)]" />}
            <button
              type="button"
              data-drop-node={step.nodeId ?? "root"}
              data-drop-kind="container"
              data-life-receive
              aria-current={active ? "location" : undefined}
              aria-label={home ? step.label : undefined}
              title={home ? step.label : undefined}
              onClick={go}
              className={cn(
                "flex min-w-0 items-center gap-1.5 rounded-chip transition-colors",
                home ? "size-8 justify-center" : "px-1.5 py-1",
                active
                  ? "font-medium text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                dropNodeId !== undefined && dropNodeId === step.nodeId && "ring-2 ring-brand",
              )}
            >
              {home ? <Home className="size-4 shrink-0" strokeWidth={1.9} /> : <span className="truncate">{step.label}</span>}
            </button>
          </div>
        );
      })}
      {tail ? (
        <div className="flex min-w-0 items-center">
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-[var(--text-tertiary)]" />
          <span aria-current="location" className="truncate px-1.5 py-1 font-medium text-[var(--text-primary)]">
            {tail}
          </span>
        </div>
      ) : null}
    </>
  );
}

/** The steps from the top to the open folder: the top, the workspace when one is open, then each folder. */
export function crumbSteps({
  path,
  floor,
  onLeaveFloor,
}: {
  /** The open folder's ancestors and itself, from the top. */
  path: readonly TreeNode[];
  /** The workspace the surface is in, if any. */
  floor: { nodeId: string; label: string } | null;
  /** Steps out of the workspace to the top. */
  onLeaveFloor?: () => void;
}): CrumbStep[] {
  const step = (node: TreeNode): CrumbStep => ({ label: node.name, nodeId: node.nodeId });
  const top: CrumbStep = { label: "Library home", nodeId: null, onSelect: floor ? onLeaveFloor : undefined };
  if (!floor) return [top, ...path.map(step)];
  const below = path.findIndex((node) => node.nodeId === floor.nodeId);
  const inside = [{ label: floor.label, nodeId: floor.nodeId }, ...(below === -1 ? [] : path.slice(below + 1).map(step))];
  // A surface that cannot leave its workspace starts its path there.
  return onLeaveFloor ? [top, ...inside] : inside;
}
