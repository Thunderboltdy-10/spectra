export type WorkbenchInspectorTab = "overview" | "comments" | "history";

export type InspectorOverview = {
  description?: string;
  type: string;
  status: string;
  owner?: string;
  collaborators: string[];
  access: "Read-only" | "Edit";
  workspacePlacements: string[];
  sharing: string;
  references: string[];
  backlinks: string[];
  sources: Array<{ title: string; status: "current" | "stale" | "partial" | "unavailable" }>;
  recentActivity: string[];
  placementHint?: string;
};

export type InspectorComment = {
  id: string;
  body: string;
  status: "open" | "resolved" | "orphaned";
  anchorLabel: string;
};

export type InspectorHistoryEntry = {
  id: string;
  category: "change" | "ai" | "access" | "source" | "import" | "restore";
  summary: string;
  createdAt: number;
};

export function filterInspectorHistory(
  rows: readonly InspectorHistoryEntry[],
  filter: "all" | "changes" | "ai" | "access",
) {
  if (filter === "all") return [...rows];
  if (filter === "changes") return rows.filter((row) => ["change", "import", "restore", "source"].includes(row.category));
  return rows.filter((row) => row.category === filter);
}

export function revealCommentTarget(comment: InspectorComment) {
  return comment.status === "orphaned"
    ? { kind: "reanchor_required" as const, commentId: comment.id }
    : { kind: "reveal" as const, commentId: comment.id, anchorLabel: comment.anchorLabel };
}
