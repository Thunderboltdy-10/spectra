import type { ArtifactCardView } from "./artifact-card";
import type { SpectraArtifact, SpectraWorkspace, SpectraWorkspaceItem } from "../data/api";

const demoWorkspaceOrder = ["Biology", "Maths EE", "Spectra", "Economics", "English"];

export type DemoRelation = {
  targetKey: string;
  label: string;
  relationType: "source" | "supports" | "generated" | "next";
};

export type DemoMeta = {
  key?: string;
  metrics?: Record<string, string | number>;
  relations?: DemoRelation[];
};

export type WorkspaceAccent = {
  color: string;
  soft: string;
  border: string;
  icon: string;
};

const accents: Record<string, WorkspaceAccent> = {
  green: { color: "#2fa66f", soft: "color-mix(in oklab, #2fa66f 10%, var(--bg-elevated))", border: "color-mix(in oklab, #2fa66f 24%, var(--border-default))", icon: "leaf" },
  purple: { color: "#8b6ff0", soft: "color-mix(in oklab, #8b6ff0 10%, var(--bg-elevated))", border: "color-mix(in oklab, #8b6ff0 24%, var(--border-default))", icon: "plus" },
  blue: { color: "#2f95d8", soft: "color-mix(in oklab, #2f95d8 9%, var(--bg-elevated))", border: "color-mix(in oklab, #2f95d8 22%, var(--border-default))", icon: "spark" },
  orange: { color: "#d88922", soft: "color-mix(in oklab, #d88922 10%, var(--bg-elevated))", border: "color-mix(in oklab, #d88922 24%, var(--border-default))", icon: "bar" },
  coral: { color: "#e2703a", soft: "color-mix(in oklab, #e2703a 10%, var(--bg-elevated))", border: "color-mix(in oklab, #e2703a 24%, var(--border-default))", icon: "book" },
};

export function workspaceAccent(workspace?: Pick<SpectraWorkspace, "color" | "title"> | null, index = 0): WorkspaceAccent {
  const fallbackKeys = ["green", "purple", "blue", "orange", "coral"];
  return accents[workspace?.color ?? ""] ?? accents[fallbackKeys[index % fallbackKeys.length]] ?? accents.green;
}

export function initials(title: string) {
  return title.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "W";
}

export function formatShortDate(value: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

export function formatRelativeTime(value: number) {
  const diff = Date.now() - value;
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function sortSpectraWorkspaces(workspaces: SpectraWorkspace[]) {
  return [...workspaces].sort((a, b) => {
    const aIndex = demoWorkspaceOrder.indexOf(a.title);
    const bIndex = demoWorkspaceOrder.indexOf(b.title);
    if (aIndex !== -1 || bIndex !== -1) {
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    }
    return b.lastActivityAt - a.lastActivityAt;
  });
}

export function workspaceArtifactCount(workspace: SpectraWorkspace, artifacts: SpectraArtifact[]) {
  return artifacts.filter((artifact) => artifactPlacements(artifact).some((placement) => placement.workspaceId === workspace._id)).length;
}

export function workspaceThreadCount(items: SpectraWorkspaceItem[]) {
  return items.filter((item) => item.sourceType === "thread" && item.thread).length;
}

export function workspaceDocumentCount(items: SpectraWorkspaceItem[]) {
  return items.filter((item) => item.artifact?.blueprintKey === "document").length;
}

export function artifactPlacements(artifact?: SpectraArtifact | null): NonNullable<SpectraArtifact["placements"]> {
  return artifact?.placements ?? [];
}

export function artifactPlacementStatus(artifact?: SpectraArtifact | null): "inbox" | "shared" | "workspace" {
  const placements = artifactPlacements(artifact);
  return artifact?.placementStatus ?? (placements.length > 0 ? "workspace" : "inbox");
}

export function demoMeta(artifact?: SpectraArtifact | null): DemoMeta {
  const content = artifact?.content;
  if (!content || typeof content !== "object" || !("spectraDemo" in content)) return {};
  const spectraDemo = (content as { spectraDemo?: unknown }).spectraDemo;
  if (!spectraDemo || typeof spectraDemo !== "object") return {};
  return spectraDemo as DemoMeta;
}

export function artifactToCard(artifact: SpectraArtifact, placement?: "inbox" | "shared" | "workspace"): ArtifactCardView {
  const meta = demoMeta(artifact);
  const placements = artifactPlacements(artifact);
  return {
    id: artifact._id,
    title: artifact.title,
    blueprintKey: artifact.blueprintKey,
    summary: artifact.aiPreview?.effectTitle ?? artifact.summary ?? "No summary yet.",
    meta: placements.length > 0 ? placements.map((item) => item.workspaceTitle).join(", ") : "Created recently",
    placement: placement ?? artifactPlacementStatus(artifact),
    shared: artifact.isShared,
    accessLevel: artifact.accessLevel ?? undefined,
    accessExplanation: artifact.ownership === "shared"
      ? artifact.accessReason === "workspace_inheritance"
        ? `Access through ${placements.map((item) => item.workspaceTitle).join(", ") || "a workspace"}`
        : "Shared directly with you"
      : undefined,
    updatedAt: artifact.updatedAt,
    metrics: meta.metrics,
    aiState: artifact.aiState === "edited" && artifact.aiStateExpiresAt && artifact.aiStateExpiresAt <= Date.now() ? undefined : artifact.aiState,
    aiProgress: artifact.aiProgress,
  };
}

export function workspaceItemToCard(item: SpectraWorkspaceItem): ArtifactCardView | null {
  if (!item.artifact) return null;
  const meta = demoMeta(item.artifact);
  return {
    id: item.artifact._id,
    title: item.viewData.titleOverride ?? item.artifact.title,
    blueprintKey: item.artifact.blueprintKey,
    summary: item.artifact.aiPreview?.effectTitle ?? item.viewData.compactSummary ?? item.artifact.summary ?? "No summary yet.",
    meta: item.viewData.pinned ? "Pinned" : formatRelativeTime(item.updatedAt),
    placement: "workspace",
    shared: item.artifact.isShared,
    accessLevel: item.artifact.accessLevel ?? undefined,
    accessExplanation: item.artifact.ownership === "shared"
      ? item.artifact.accessReason === "workspace_inheritance"
        ? "Access through this workspace"
        : "Shared directly with you"
      : undefined,
    updatedAt: item.updatedAt,
    pinned: item.viewData.pinned,
    variant: item.viewData.cardVariant,
    metrics: meta.metrics,
    aiState: item.artifact.aiState === "edited" && item.artifact.aiStateExpiresAt && item.artifact.aiStateExpiresAt <= Date.now() ? undefined : item.artifact.aiState,
    aiProgress: item.artifact.aiProgress,
  };
}

export function artifactsByDemoKey(artifacts: SpectraArtifact[]) {
  const map = new Map<string, SpectraArtifact>();
  for (const artifact of artifacts) {
    const key = demoMeta(artifact).key;
    if (key) map.set(key, artifact);
  }
  return map;
}

export function linkedArtifacts(source: SpectraArtifact | null | undefined, artifacts: SpectraArtifact[]) {
  const byKey = artifactsByDemoKey(artifacts);
  return (demoMeta(source).relations ?? [])
    .map((relation) => {
      const artifact = byKey.get(relation.targetKey);
      return artifact ? { relation, artifact } : null;
    })
    .filter((item): item is { relation: DemoRelation; artifact: SpectraArtifact } => Boolean(item));
}
