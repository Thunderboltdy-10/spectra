"use client";

import { useRef, type CSSProperties } from "react";
import { Icon } from "@/components/icons";
import type { ClassIdentity } from "../../../../shared/class-identity";
import { aiWorking } from "../artifacts/ai-working";
import type { PresentedWorkType } from "../artifacts/presentation";
import { authoredSummary } from "../artifacts/registry";
import { useWorkPreview, type PreviewSource } from "../artifacts/use-work-previews";
import { WorkCardBody, workCardStyle } from "../components/work-card";
import { nodeIdentity, relativeTime } from "./node-identity";
import type { TreeNode } from "./tree-client";

/*
 * A work on a shelf (LIBRARY.md, "The shelf"): the same index card Home
 * shows, its face the work itself, read once the card nears the screen.
 * Where the shelf spans every place, the card wears the colour of the place
 * it lives in, so a class's work reads as that class's at a glance; inside a
 * place, or in none, it keeps its kind's colour.
 */
export function LibraryNote({
  node,
  place,
  where,
  now,
  onOpen,
  onMenu,
  picked,
}: {
  node: TreeNode;
  /** The place whose colour it wears; null keeps its kind's. */
  place: ClassIdentity | null;
  /** The place named at its foot; left out where the shelf is that place. */
  where?: string;
  now: number;
  onOpen: (node: TreeNode) => void;
  onMenu: (event: React.MouseEvent, node: TreeNode) => void;
  /** While picking work (Select): whether this card is picked. Pressing it then picks rather than opens. */
  picked?: boolean;
}) {
  const picking = picked !== undefined;
  const type = workType(node);
  const card = useRef<HTMLButtonElement>(null);
  const preview = useWorkPreview(previewSource(node), card);
  const shared = sharedLabel(node);
  return (
    <button
      ref={card}
      type="button"
      data-node-row={node.nodeId}
      data-life-launch
      data-work-card={type}
      data-picking={picking || undefined}
      data-picked={picked || undefined}
      aria-pressed={picking ? picked : undefined}
      onClick={() => onOpen(node)}
      onContextMenu={(event) => onMenu(event, node)}
      style={workCardStyle(type, place?.ink)}
      className="work-card w-full text-left"
    >
      <WorkCardBody
        type={type}
        title={node.name}
        preview={preview}
        summary={authoredSummary(node.source?.blueprintKey, node.source?.summary)}
        place={where}
        when={relativeTime(node.activityAt, now)}
        live={aiWorking(node.source)}
        marks={
          shared ? (
            <span className="work-card-shared" title={shared} aria-label={shared}>
              <Icon name="people" size={12} />
            </span>
          ) : null
        }
      />
      {picking ? <PickMark /> : null}
    </button>
  );
}

/** Whether other people can open this work, said the way its mark reads. */
export function sharedLabel(node: TreeNode) {
  if (node.kind !== "work") return null;
  if (node.source && node.source.owned === false) return "Shared with you";
  if (node.source?.shared) return "Shared by you";
  if (node.sharedWithWorkspace) return "Shared with the workspace";
  return null;
}

/** Picking work for Spectra or the tiles (Select): which work is picked, and how to pick or put back one. */
export type WorkPicking = { has: (node: TreeNode) => boolean; toggle: (node: TreeNode) => void };

/** Only work is picked; places still open while picking, so work can be gathered across them. */
export function pickable(node: TreeNode) {
  return node.kind === "work" && Boolean(node.sourceId);
}

/** The mark a picked card wears in its corner: an empty ring while picking, filled once picked. */
export function PickMark() {
  return (
    <span aria-hidden className="work-pick">
      <Icon name="check" size={13} />
    </span>
  );
}

/** What a card reads its face from. */
export function previewSource(node: TreeNode): PreviewSource {
  // A reference (a workspace import adds these for work filed elsewhere) reads the work it points at.
  const sourceId = node.kind === "link" && node.target?.kind === "work" ? node.target.sourceId : node.sourceId;
  return {
    _id: sourceId ?? node.nodeId,
    // Without its source there is nothing to read; a file's face needs no read.
    blueprintKey: sourceId ? workType(node) : "resource",
    updatedAt: node.source?.updatedAt ?? node.updatedAt,
  };
}

/** The card kind a shelf row is: its work's type (a reference's, the work it points at), or a thread. */
export function workType(node: TreeNode): PresentedWorkType {
  if (node.kind === "thread") return "thread_reference";
  if (node.kind === "link" && node.target?.kind === "thread") return "thread_reference";
  const key = node.source?.blueprintKey ?? (node.kind === "link" ? node.target?.typeKey : undefined);
  return (key as PresentedWorkType | undefined) ?? "resource";
}

/** One row of the side list: a place, or loose work, marked in its own colour. */
export function PlaceRow({
  node,
  onOpen,
  onMenu,
  picking,
}: {
  node: TreeNode;
  onOpen: (node: TreeNode) => void;
  onMenu: (event: React.MouseEvent, node: TreeNode) => void;
  picking?: WorkPicking;
}) {
  const pick = picking && pickable(node) ? picking : null;
  const identity = nodeIdentity(node);
  return (
    <button
      type="button"
      data-node-row={node.nodeId}
      data-drop-node={node.kind === "folder" || node.kind === "workspace" ? node.nodeId : undefined}
      data-drop-kind={node.kind === "folder" || node.kind === "workspace" ? "container" : undefined}
      data-life-launch
      data-picking={pick ? true : undefined}
      data-picked={pick?.has(node) || undefined}
      aria-pressed={pick ? pick.has(node) : undefined}
      onClick={() => (pick ? pick.toggle(node) : onOpen(node))}
      onContextMenu={(event) => onMenu(event, node)}
      className="library-loose-item"
      style={{ "--loose-ink": identity.color } as CSSProperties}
    >
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      <span className="shrink-0 text-caption text-[var(--text-tertiary)]">{identity.label}</span>
      {pick ? <PickMark /> : null}
    </button>
  );
}
