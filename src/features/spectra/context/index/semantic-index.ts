import type { SemanticAnchor } from "../../anchors";

export type PermissionScope = { accountIds?: string[]; workspaceIds?: string[]; public?: boolean };
export type SemanticIndexEntry = {
  semanticId: string;
  entityType:
    | "work" | "document_block" | "slide_element" | "sheet_range" | "sheet_chart"
    | "board_frame" | "board_object" | "code_file" | "code_symbol" | "quiz_question"
    | "card" | "agent_skill" | "agent_evidence" | "plan_task" | "school"
    | "thread" | "message" | "source" | "reference";
  workId?: string;
  anchor?: SemanticAnchor;
  workspaceIds: string[];
  permissionScope: PermissionScope;
  text: string;
  embeddingRef?: string;
  updatedAt: number;
  provenance: { provider: string; sourceId?: string };
};

export type SemanticIndexActor = { accountId: string; workspaceIds: string[] };
export type SemanticIndexPurpose = "kbar" | "library" | "context" | "agent_routing" | "reference_suggestion" | "memory" | "school";

export function canReadIndexEntry(entry: SemanticIndexEntry, actor: SemanticIndexActor) {
  if (entry.permissionScope.public) return true;
  if (entry.permissionScope.accountIds?.includes(actor.accountId)) return true;
  const allowedWorkspaces = entry.permissionScope.workspaceIds ?? entry.workspaceIds;
  return allowedWorkspaces.some((id) => actor.workspaceIds.includes(id));
}

export class PermissionAwareSemanticIndex {
  private entries = new Map<string, SemanticIndexEntry>();
  upsert(entry: SemanticIndexEntry) { this.entries.set(entry.semanticId, entry); }
  remove(semanticId: string) { this.entries.delete(semanticId); }
  search(query: string, actor: SemanticIndexActor, limit = 40, _purpose: SemanticIndexPurpose = "context") {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return [...this.entries.values()]
      .filter((entry) => canReadIndexEntry(entry, actor))
      .map((entry) => ({ entry, score: terms.reduce((score, term) => score + (entry.text.toLowerCase().includes(term) ? 1 : 0), 0) }))
      .filter((row) => terms.length === 0 || row.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt)
      .slice(0, limit)
      .map((row) => row.entry);
  }
}

export function semanticEntriesForWork(input: { workId: string; workspaceIds: string[]; title: string; regions: Array<{ regionId: string; label: string; text: string; anchor: SemanticAnchor }>; permissionScope: PermissionScope; updatedAt: number }): SemanticIndexEntry[] {
  return [
    { semanticId: `work:${input.workId}`, entityType: "work", workId: input.workId, workspaceIds: input.workspaceIds, permissionScope: input.permissionScope, text: input.title, updatedAt: input.updatedAt, provenance: { provider: "spectra" } },
    ...input.regions.map((region) => ({ semanticId: `work:${input.workId}:region:${region.regionId}`, entityType: entityTypeForAnchor(region.anchor), workId: input.workId, anchor: region.anchor, workspaceIds: input.workspaceIds, permissionScope: input.permissionScope, text: `${region.label}\n${region.text}`, updatedAt: input.updatedAt, provenance: { provider: "spectra" } })),
  ];
}

export function entityTypeForAnchor(anchor: SemanticAnchor): SemanticIndexEntry["entityType"] {
  if (anchor.workType === "document") return "document_block";
  if (anchor.workType === "presentation") return "slide_element";
  if (anchor.workType === "sheets") return /chart/i.test(anchor.kind) ? "sheet_chart" : "sheet_range";
  if (anchor.workType === "whiteboard") return /frame/i.test(anchor.kind) ? "board_frame" : "board_object";
  if (anchor.workType === "code") return /symbol|range/i.test(anchor.kind) ? "code_symbol" : "code_file";
  if (anchor.workType === "quiz") return "quiz_question";
  if (anchor.workType === "flashcard_deck") return "card";
  if (anchor.workType === "agent") return /evidence/i.test(anchor.kind) ? "agent_evidence" : "agent_skill";
  if (anchor.workType === "planner_task") return "plan_task";
  return "work";
}

export function createSemanticIndexEntry(input: SemanticIndexEntry) {
  if (!input.semanticId.trim() || !input.text.trim()) throw new Error("SEMANTIC_INDEX_ENTRY_REQUIRED");
  return { ...input, workspaceIds: [...new Set(input.workspaceIds)] };
}
