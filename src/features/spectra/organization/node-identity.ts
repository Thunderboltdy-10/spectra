import {
  Folder,
  FolderOpen,
  Link2,
  MessageSquare,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { blueprintMeta } from "../components/artifact-card";
import type { ArtifactCardView } from "../components/artifact-card";
import type { TreeNode } from "./tree-client";

/**
 * What a row looks like and what it is called. Work types keep the identity they
 * already have everywhere else in Spectra — `blueprintMeta` reads its labels
 * from the work registry, so a quiz is called a quiz here too. Only the four
 * things the registry does not own (folder, workspace, thread, reference) are
 * named in this file.
 */

export type NodeIdentity = {
  icon: LucideIcon;
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
  color: "#8b6ff0",
  soft: "color-mix(in oklab, #8b6ff0 10%, var(--bg-elevated))",
  label: "Thread",
};

const WORKSPACE: NodeIdentity = {
  icon: Layers,
  color: "var(--brand-primary)",
  soft: "color-mix(in oklab, var(--brand-primary) 10%, var(--bg-elevated))",
  label: "Workspace",
};

export function nodeIdentity(node: TreeNode, open = false): NodeIdentity {
  if (node.kind === "folder")
    return open ? { ...FOLDER, icon: FolderOpen } : FOLDER;
  if (node.kind === "workspace") {
    const colour = node.workspace?.color;
    return colour
      ? {
          ...WORKSPACE,
          color: colour,
          soft: `color-mix(in oklab, ${colour} 12%, var(--bg-elevated))`,
        }
      : WORKSPACE;
  }
  if (node.kind === "thread") return THREAD;
  if (node.kind === "link") return REFERENCE;
  const key = node.source?.blueprintKey as
    | ArtifactCardView["blueprintKey"]
    | undefined;
  const meta = key ? blueprintMeta[key] : undefined;
  return meta ?? { ...FOLDER, icon: Folder, label: "Work" };
}

/** The set of blueprint keys a type filter can offer, in the order they read. */
export const workTypeFilters = Object.entries(blueprintMeta)
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
