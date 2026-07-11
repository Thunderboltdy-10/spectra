export const CONTEXT_LIMITS = {
  packetCharacters: 28_000,
  artifactExcerptCharacters: 2_800,
  selectedArtifactCount: 16,
  workspaceArtifactCount: 8,
  catalogArtifactCount: 10,
  conversationMessages: 16,
  conversationMessageCharacters: 3_000,
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
      if (!/(^id$|^_id$|id$|ids$)/i.test(key)) visit(child, depth + 1);
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

function typedArtifactStructure(artifact: ArtifactRecord) {
  const content = artifact.content && typeof artifact.content === "object" ? artifact.content as Record<string, unknown> : {};
  const text = (value: unknown, cap = 600) => typeof value === "string" ? value.slice(0, cap) : value;
  if (artifact.blueprintKey === "quiz" && Array.isArray(content.questions)) return { questions: content.questions.slice(0, 20).map((value) => { const row = value as Record<string, unknown>; return { prompt: text(row.prompt), type: row.type, options: Array.isArray(row.options) ? row.options.slice(0, 8).map((option) => text(option, 240)) : [], correctAnswer: text(row.correctAnswer, 240), explanation: text(row.explanation) }; }) };
  if (artifact.blueprintKey === "flashcard_deck" && Array.isArray(content.cards)) return { cards: content.cards.slice(0, 30).map((value) => { const row = value as Record<string, unknown>; return { front: text(row.front, 400), back: text(row.back, 600), hint: text(row.hint, 300), section: text(row.section, 160) }; }) };
  if (artifact.blueprintKey === "planner_task") return { description: text(content.description, 1_200), dueAt: content.dueAt, startAt: content.startAt, endAt: content.endAt, status: content.status, priority: content.priority, subtasks: Array.isArray(content.subtasks) ? content.subtasks.slice(0, 20).map((item) => text(item, 300)) : [] };
  if (artifact.blueprintKey === "document" && Array.isArray(content.blocks)) return { blocks: content.blocks.slice(0, 24).map((value) => { const row = value as Record<string, unknown>; return { type: row.type, text: text(row.text, 700), heading: text(row.heading, 240), level: row.level }; }) };
  return undefined;
}

export function artifactContextSnapshot(artifact: ArtifactRecord, options?: { includeExcerpt?: boolean; excerptCharacters?: number; relevance?: string; links?: unknown[] }) {
  const createdFrom = artifact.createdFrom && typeof artifact.createdFrom === "object" ? artifact.createdFrom as Record<string, unknown> : null;
  return {
    id: artifact._id,
    title: artifact.title,
    type: artifact.blueprintKey,
    summary: typeof artifact.summary === "string" ? artifact.summary.slice(0, 700) : undefined,
    ...(options?.includeExcerpt ? { excerpt: compactText(artifact.content ?? artifact.textIndex, options.excerptCharacters ?? CONTEXT_LIMITS.artifactExcerptCharacters) } : {}),
    ...(options?.includeExcerpt ? { structure: typedArtifactStructure(artifact) } : {}),
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
  workspaceMap?: unknown[];
  threadMap?: unknown[];
  inboxMap?: unknown[];
  contextReasons?: Record<string, "explicit" | "selected" | "visible" | "open">;
  continuationThreadId?: string;
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
	  const allWorkspaceArtifacts = ranked.filter(({ artifact }) => placements(artifact).some((placement) => placement.workspaceId === workspaceId));
	  const workspaceArtifacts = allWorkspaceArtifacts.slice(0, CONTEXT_LIMITS.workspaceArtifactCount);
	  const catalog = ranked.slice(0, CONTEXT_LIMITS.catalogArtifactCount);
	  const broadPrompt = /\b(all|everything|search|find|across|compare|related|workspace|library|catalog|inbox)\b/i.test(input.prompt);
	  const includeCatalog = input.focusMode === "global" || broadPrompt;
  const selectedExcerptCap = Math.max(700, Math.min(CONTEXT_LIMITS.artifactExcerptCharacters, Math.floor(30_000 / Math.max(1, selected.length))));
  const selectedSnapshots = selected.map((artifact) => artifactContextSnapshot(artifact, { includeExcerpt: true, excerptCharacters: selectedExcerptCap, relevance: input.contextReasons?.[String(artifact._id)] === "explicit" ? "explicitly added context" : input.contextReasons?.[String(artifact._id)] === "visible" || input.contextReasons?.[String(artifact._id)] === "open" ? "visible working object" : "temporary selection", links: input.linksByArtifact?.[String(artifact._id)] }));
  const focusedSnapshot = input.focusedArtifact ? artifactContextSnapshot(input.focusedArtifact, { includeExcerpt: true, relevance: "visibly open artifact", links: input.linksByArtifact?.[String(input.focusedArtifact._id)] }) : null;
  const packet = {
    version: 2,
    effectiveFocus: input.focusMode,
    rules: "Explicit selection wins. Continued thread supplies conversation history; visible workspace/artifact may remain additional focus. Excerpts are bounded and omissions are intentional.",
    contextLayers: {
      continuation: input.continuationThreadId ? "conversation history is highest priority" : null,
      explicit: selectedSnapshots.filter((item) => item.relevance === "explicitly added context").map((item) => item.title),
      visible: selectedSnapshots.filter((item) => item.relevance === "visible working object").map((item) => item.title),
      selected: selectedSnapshots.filter((item) => item.relevance === "temporary selection").map((item) => item.title),
      workspaceMap: input.workspace ? "bounded active workspace map" : null,
      globalMap: "bounded workspaces, threads, and Inbox map with retrieval available",
    },
    currentView: input.currentView ?? "unknown",
    workspace: input.workspace ? {
      id: input.workspace._id,
      title: input.workspace.title,
      description: input.workspace.description,
      activeArtifactCount: allWorkspaceArtifacts.length,
      pinned: workspaceArtifacts.filter(({ artifact }) => placements(artifact).some((placement) => placement.workspaceId === workspaceId && placement.pinned)).slice(0, 6).map(({ artifact }) => artifactContextSnapshot(artifact)),
      relevant: workspaceArtifacts.slice(0, 10).map(({ artifact }) => artifactContextSnapshot(artifact, { includeExcerpt: true, relevance: "workspace pin, recency, or prompt relevance" })),
      recentActivity: (input.recentActivity ?? []).slice(0, 8),
    } : null,
    workspaceMap: (input.workspaceMap ?? []).filter((item) => input.focusMode === "global" || input.focusMode === "workspace" || Boolean(item && typeof item === "object" && (item as Record<string, unknown>).explicit)).slice(0, 18),
    threadMap: (input.threadMap ?? []).filter((item) => input.focusMode === "global" || input.focusMode === "thread" || Boolean(item && typeof item === "object" && (item as Record<string, unknown>).explicit)).slice(0, 14),
    inboxMap: input.focusMode === "global" ? (input.inboxMap ?? []).slice(0, 12) : [],
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
  const compactPacket = { ...packet, selectedObjects: packet.selectedObjects.map((item) => ({ ...item, excerpt: item.excerpt?.slice(0, 700), links: item.links.slice(0, 3) })), catalog: [], workspaceMap: packet.workspaceMap.slice(0, 16), threadMap: packet.threadMap.slice(0, 12), inboxMap: packet.inboxMap.slice(0, 10), workspace: packet.workspace ? { ...packet.workspace, relevant: packet.workspace.relevant.slice(0, 4).map((item) => ({ ...item, excerpt: item.excerpt?.slice(0, 500) })) } : null, omitted: { ...packet.omitted, hardCharacterCapApplied: true } };
  if (JSON.stringify(compactPacket).length <= CONTEXT_LIMITS.packetCharacters) return compactPacket;
  const compactMapItem = (value: unknown) => {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return { id: item.id ?? item._id, title: typeof item.title === "string" ? item.title.slice(0, 240) : undefined, summary: typeof item.summary === "string" ? item.summary.slice(0, 400) : undefined, description: typeof item.description === "string" ? item.description.slice(0, 400) : undefined, type: item.type ?? item.blueprintKey, workspaceId: item.workspaceId, lastMessageAt: item.lastMessageAt };
  };
  let hardConversationCharacters = 0;
  const hardConversation = compactPacket.conversation.slice(-12).flatMap((message) => {
    if (hardConversationCharacters >= 8_000) return [];
    const content = message.content.slice(0, Math.min(1_200, 8_000 - hardConversationCharacters));
    hardConversationCharacters += content.length;
    return [{ ...message, content }];
  });
  const minimalArtifact = (item: { id: unknown; title: unknown; type: unknown; summary?: unknown; excerpt?: string; relevance?: unknown }, excerptCap = 320) => ({ id: item.id, title: item.title, type: item.type, summary: item.summary, excerpt: item.excerpt?.slice(0, excerptCap), relevance: item.relevance });
  const hardPacket = {
    ...compactPacket,
    selectedObjects: compactPacket.selectedObjects.map((item) => minimalArtifact(item)),
    focusedArtifact: compactPacket.focusedArtifact ? minimalArtifact(compactPacket.focusedArtifact) : null,
    conversation: hardConversation,
    workspaceMap: compactPacket.workspaceMap.slice(0, 8).map(compactMapItem),
    threadMap: compactPacket.threadMap.slice(0, 8).map(compactMapItem),
    inboxMap: compactPacket.inboxMap.slice(0, 6).map(compactMapItem),
    workspace: compactPacket.workspace ? {
      id: compactPacket.workspace.id,
      title: compactPacket.workspace.title,
      description: typeof compactPacket.workspace.description === "string" ? compactPacket.workspace.description.slice(0, 600) : compactPacket.workspace.description,
      activeArtifactCount: compactPacket.workspace.activeArtifactCount,
      pinned: compactPacket.workspace.pinned.slice(0, 4).map((item) => minimalArtifact(item, 0)),
      relevant: compactPacket.workspace.relevant.slice(0, 4).map((item) => minimalArtifact(item, 320)),
      recentActivity: [],
    } : null,
  };
  if (JSON.stringify(hardPacket).length <= CONTEXT_LIMITS.packetCharacters) return hardPacket;
  return {
    ...hardPacket,
    selectedObjects: hardPacket.selectedObjects.slice(0, 12).map((item) => ({ ...item, excerpt: item.excerpt?.slice(0, 160) })),
    focusedArtifact: hardPacket.focusedArtifact ? { ...hardPacket.focusedArtifact, excerpt: hardPacket.focusedArtifact.excerpt?.slice(0, 160) } : null,
    conversation: hardPacket.conversation.slice(-6).map((message) => ({ ...message, content: message.content.slice(0, 500) })),
    workspaceMap: [],
    threadMap: [],
    inboxMap: [],
    workspace: hardPacket.workspace ? { ...hardPacket.workspace, description: typeof hardPacket.workspace.description === "string" ? hardPacket.workspace.description.slice(0, 240) : hardPacket.workspace.description, pinned: hardPacket.workspace.pinned.slice(0, 2), relevant: hardPacket.workspace.relevant.slice(0, 2).map((item) => ({ ...item, excerpt: undefined })) } : null,
  };
}
