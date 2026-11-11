import { Folder, FolderOpen, Link2, MessageSquare, Layers, type GlyphIcon } from "@/components/icons/glyph-icons";
import { workTypeMeta } from "../components/artifact-card";
import { presentWork } from "../artifacts/presentation";
import type { ArtifactCardView } from "../components/artifact-card";
import type { TreeNode } from "./tree-client";

/**
 * What a row looks like and what it is called. Work types keep the identity they
 * already have everywhere else in Spectra — `workTypeMeta` reads its labels
 * from the work registry, so a quiz is called a quiz here too. Only the four
 * things the registry does not own (folder, workspace, thread, reference) are
 * named in this file.
 */

export type NodeIdentity = {
  icon: GlyphIcon;
  /** Line colour for the icon. */
  color: string;
  /** Tinted fill behind the icon. */
  soft: string;
  /** The type word shown in the type column. */
  label: string;
};

const FOLDER: NodeIdentity = {
  icon: Folder,
  color: "var(--text-secondary)",
  soft: "var(--bg-tertiary)",
  label: "Folder",
};

const REFERENCE: NodeIdentity = {
  icon: Link2,
  color: "var(--text-tertiary)",
  soft: "var(--bg-tertiary)",
  label: "Reference",
};

const THREAD: NodeIdentity = {
  icon: MessageSquare,
  color: "var(--brand-primary)",
  soft: "color-mix(in oklab, var(--brand-primary) 10%, var(--bg-elevated))",
  label: "Chat",
};

const WORKSPACE: NodeIdentity = {
  icon: Layers,
  color: "var(--brand-primary)",
  soft: "color-mix(in oklab, var(--brand-primary) 10%, var(--bg-elevated))",
  label: "Workspace",
};

export const WORKSPACE_INKS = [
  ["var(--ink-violet)", "Violet"],
  ["var(--ink-blue)", "Blue"],
  ["var(--ink-green)", "Green"],
  ["var(--ink-orange)", "Orange"],
  ["var(--ink-red)", "Red"],
  ["var(--ink-yellow)", "Yellow"],
] as const;

/** The colour a workspace is drawn in. Workspaces once stored the raw word "cyan". */
export function workspaceInk(color: string | undefined) {
  return !color || color === "cyan" ? WORKSPACE_INKS[0][0] : color;
}

export function nodeIdentity(node: TreeNode, open = false): NodeIdentity {
  if (node.kind === "folder")
    return open ? { ...FOLDER, icon: FolderOpen } : FOLDER;
  if (node.kind === "workspace") {
    const colour = node.workspace ? workspaceInk(node.workspace.color) : undefined;
    return colour
      ? {
          ...WORKSPACE,
          color: colour,
          soft: `color-mix(in oklab, ${colour} 12%, var(--bg-elevated))`,
        }
      : WORKSPACE;
  }
  if (node.kind === "thread") return THREAD;
  if (node.kind === "link")
    return node.target?.kind === "folder" || node.target?.kind === "workspace" ? FOLDER : REFERENCE;
  const key = node.source?.blueprintKey as
    | ArtifactCardView["blueprintKey"]
    | undefined;
  const meta = key && workTypeMeta[key] ? presentWork(key, node.name) : undefined;
  return meta ?? { ...FOLDER, icon: Folder, label: "Artifact" };
}

/** The set of blueprint keys a type filter can offer, in the order they read. */
export const workTypeFilters = Object.entries(workTypeMeta)
  .filter(([key]) => key !== "thread_reference")
  .map(([key, meta]) => ({ key, label: meta.label, icon: meta.icon }));

/** "3 minutes ago", "Tuesday", "12 Mar" — short enough for a 90px column. */
export function relativeTime(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}
