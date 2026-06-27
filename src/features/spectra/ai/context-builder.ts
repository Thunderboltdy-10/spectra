export const CONTEXT_LIMITS = {
  packetCharacters: 48_000,
  artifactExcerptCharacters: 3_200,
  selectedArtifactCount: 12,
  workspaceArtifactCount: 14,
  catalogArtifactCount: 18,
  conversationMessages: 24,
  conversationMessageCharacters: 8_000,
} as const;

export type EffectiveFocusMode = "global" | "workspace" | "artifact" | "selection" | "thread";

type ArtifactRecord = Record<string, unknown>;
type WorkspaceRecord = Record<string, unknown>;

function compactText(value: unknown, cap: number) {
  const chunks: string[] = [];
  const visit = (item: unknown, depth: number) => {
    if (chunks.join(" ").length >= cap || depth > 5 || item == null) return;
    if (typeof item === "string") chunks.push(item);
    else if (typeof item === "number" || typeof item === "boolean") chunks.push(String(item));
    else if (Array.isArray(item)) item.slice(0, 40).forEach((child) => visit(child, depth + 1));
    else if (typeof item === "object") Object.entries(item as Record<string, unknown>).slice(0, 60).forEach(([key, child]) => {
      if (!key.toLowerCase().includes("id")) visit(child, depth + 1);
    });
  };
  visit(value, 0);
  return chunks.join(" ").replace(/\s+/g, " ").trim().slice(0, cap);
}

function placements(artifact: ArtifactRecord) {
  return Array.isArray(artifact.placements)
    ? artifact.placements.slice(0, 6).map((value) => {
      const row = value as Record<string, unknown>;
      return { workspaceId: row.workspaceId, workspaceTitle: row.workspaceTitle, workspaceItemId: row.workspaceItemId, pinned: row.pinned === true };
    })
    : [];
}

export function artifactContextSnapshot(artifact: ArtifactRecord, options?: { includeExcerpt?: boolean; relevance?: string; links?: unknown[] }) {
  const createdFrom = artifact.createdFrom && typeof artifact.createdFrom === "object" ? artifact.createdFrom as Record<string, unknown> : null;
  return {
    id: artifact._id,
    title: artifact.title,
    type: artifact.blueprintKey,
    summary: typeof artifact.summary === "string" ? artifact.summary.slice(0, 700) : undefined,
    ...(options?.includeExcerpt ? { excerpt: compactText(artifact.content ?? artifact.textIndex, CONTEXT_LIMITS.artifactExcerptCharacters) } : {}),
    tags: Array.isArray(artifact.tags) ? artifact.tags.slice(0, 12) : [],
    placements: placements(artifact),
    updatedAt: artifact.updatedAt,
    provenance: createdFrom ? {
      source: createdFrom.source,
      runId: createdFrom.runId,
      threadId: createdFrom.threadId,
      workspaceId: createdFrom.workspaceId,
      sourceArtifactIds: Array.isArray(createdFrom.sourceArtifactIds) ? createdFrom.sourceArtifactIds.slice(0, 12) : [],
      contextSummary: createdFrom.contextSummary,
    } : null,
    relevance: options?.relevance,
    links: (options?.links ?? []).slice(0, 8),
  };
}

function relevanceScore(artifact: ArtifactRecord, prompt: string, workspaceId?: string) {
  const words = new Set(prompt.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));
  const haystack = `${artifact.title ?? ""} ${artifact.summary ?? ""} ${artifact.textIndex ?? ""}`.toLowerCase();
  let score = 0;
  for (const word of words) if (haystack.includes(word)) score += 8;
  if (placements(artifact).some((placement) => placement.workspaceId === workspaceId && placement.pinned)) score += 28;
  else if (placements(artifact).some((placement) => placement.workspaceId === workspaceId)) score += 14;
  const updatedAt = typeof artifact.updatedAt === "number" ? artifact.updatedAt : 0;
  score += Math.max(0, 10 - (Date.now() - updatedAt) / 86_400_000 / 7);
  return score;
}

export function buildBoundedContextPacket(input: {
  prompt: string;
  focusMode: EffectiveFocusMode;
  workspace?: WorkspaceRecord | null;
  artifacts: ArtifactRecord[];
  focusedArtifact?: ArtifactRecord | null;
  selectedArtifactIds?: string[];
  conversation?: Array<{ role: unknown; content: unknown }>;
  currentView?: string;
  linksByArtifact?: Record<string, unknown[]>;
  recentActivity?: unknown[];
}) {
  let conversationCharacters = 0;
  const boundedConversation = (input.conversation ?? []).slice(-CONTEXT_LIMITS.conversationMessages).reverse().flatMap((message) => {
    if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string" || conversationCharacters >= 16_000) return [];
    const content = message.content.slice(0, Math.min(CONTEXT_LIMITS.conversationMessageCharacters, 16_000 - conversationCharacters));
    conversationCharacters += content.length;
    return [{ role: message.role, content }];
  }).reverse();
  const selectedIds = new Set((input.selectedArtifactIds ?? []).slice(0, CONTEXT_LIMITS.selectedArtifactCount));
  const selected = input.artifacts.filter((artifact) => selectedIds.has(String(artifact._id))).slice(0, CONTEXT_LIMITS.selectedArtifactCount);
  const workspaceId = typeof input.workspace?._id === "string" ? input.workspace._id : undefined;
  const ranked = input.artifacts
    .filter((artifact) => !selectedIds.has(String(artifact._id)) && artifact._id !== input.focusedArtifact?._id)
    .map((artifact) => ({ artifact, score: relevanceScore(artifact, input.prompt, workspaceId) }))
    .sort((a, b) => b.score - a.score);
	  const workspaceArtifacts = ranked.filter(({ artifact }) => placements(artifact).some((placement) => placement.workspaceId === workspaceId)).slice(0, CONTEXT_LIMITS.workspaceArtifactCount);
	  const catalog = ranked.slice(0, CONTEXT_LIMITS.catalogArtifactCount);
	  const broadPrompt = /\b(all|everything|search|find|across|compare|related|workspace|library|catalog|inbox)\b/i.test(input.prompt);
	  const includeCatalog = input.focusMode === "global" || broadPrompt;
	  const selectedSnapshots = selected.map((artifact) => artifactContextSnapshot(artifact, { includeExcerpt: true, relevance: "explicitly selected", links: input.linksByArtifact?.[String(artifact._id)] }));
  const focusedSnapshot = input.focusedArtifact ? artifactContextSnapshot(input.focusedArtifact, { includeExcerpt: true, relevance: "visibly open artifact", links: input.linksByArtifact?.[String(input.focusedArtifact._id)] }) : null;
  const packet = {
    version: 1,
    effectiveFocus: input.focusMode,
    rules: "Explicit selection wins. Continued thread supplies conversation history; visible workspace/artifact may remain additional focus. Excerpts are bounded and omissions are intentional.",
    currentView: input.currentView ?? "unknown",
    workspace: input.workspace ? {
      id: input.workspace._id,
      title: input.workspace.title,
      description: input.workspace.description,
      activeArtifactCount: workspaceArtifacts.length,
      pinned: workspaceArtifacts.filter(({ artifact }) => placements(artifact).some((placement) => placement.workspaceId === workspaceId && placement.pinned)).slice(0, 6).map(({ artifact }) => artifactContextSnapshot(artifact)),
      relevant: workspaceArtifacts.slice(0, 10).map(({ artifact }) => artifactContextSnapshot(artifact, { includeExcerpt: true, relevance: "workspace pin, recency, or prompt relevance" })),
      recentActivity: (input.recentActivity ?? []).slice(0, 8),
    } : null,
    focusedArtifact: focusedSnapshot,
    selectedObjects: selectedSnapshots,
	    catalog: includeCatalog ? (input.focusMode === "global" ? catalog : catalog.slice(0, 8)).map(({ artifact }) => artifactContextSnapshot(artifact)) : [],
    conversation: boundedConversation,
    omitted: {
      fullWorkspaceContent: true,
      totalAvailableArtifacts: input.artifacts.length,
      selectedCount: selectedSnapshots.length,
    },
  };
  const serialized = JSON.stringify(packet);
  if (serialized.length <= CONTEXT_LIMITS.packetCharacters) return packet;
  return { ...packet, catalog: [], workspace: packet.workspace ? { ...packet.workspace, relevant: packet.workspace.relevant.slice(0, 5) } : null, omitted: { ...packet.omitted, hardCharacterCapApplied: true } };
}
