import { describe, expect, it } from "vitest";
import { buildBoundedContextPacket, CONTEXT_LIMITS } from "../ai/context-builder";

function artifact(id: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    title: `Artifact ${id}`,
    blueprintKey: "document",
    summary: "Cell biology revision notes",
    content: { blocks: [{ text: "Mitochondria release energy through respiration. ".repeat(200) }] },
    tags: ["biology"],
    placements: [{ workspaceId: "workspace-1", workspaceTitle: "Biology", workspaceItemId: `item-${id}`, pinned: id === "a" }],
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("Wave 6 bounded context builder", () => {
  it("prioritises explicit selection and caps excerpts", () => {
    const packet = buildBoundedContextPacket({
      prompt: "Create a quiz about mitochondria",
      focusMode: "selection",
      workspace: { _id: "workspace-1", title: "Biology", description: "IB Biology" },
      artifacts: [artifact("a"), artifact("b"), artifact("c")],
      selectedArtifactIds: ["b", "c"],
      currentView: "list",
    });
    expect(packet.selectedObjects.map((item) => item.id)).toEqual(["b", "c"]);
    expect(packet.selectedObjects.every((item) => (item.excerpt?.length ?? 0) <= CONTEXT_LIMITS.artifactExcerptCharacters)).toBe(true);
    expect(packet.workspace?.pinned[0]?.id).toBe("a");
  });

  it("does not include full workspace content and remains bounded", () => {
    const packet = buildBoundedContextPacket({
      prompt: "Summarise biology",
      focusMode: "workspace",
      workspace: { _id: "workspace-1", title: "Biology" },
      artifacts: Array.from({ length: 80 }, (_, index) => artifact(String(index))),
      conversation: Array.from({ length: 50 }, () => ({ role: "user", content: "hello".repeat(4_000) })),
    });
    expect(packet.omitted.fullWorkspaceContent).toBe(true);
    expect(packet.workspace?.relevant.length).toBeLessThanOrEqual(10);
    expect(packet.conversation.length).toBeLessThanOrEqual(CONTEXT_LIMITS.conversationMessages);
    expect(JSON.stringify(packet).length).toBeLessThanOrEqual(CONTEXT_LIMITS.packetCharacters + 2_000);
  });

  it("keeps explicitly added thread context without turning it into continuation", () => {
    const packet = buildBoundedContextPacket({
      prompt: "Use the discussion as supporting context for this edit",
      focusMode: "artifact",
      focusedArtifact: artifact("focused"),
      artifacts: [artifact("focused")],
      threadMap: [{ id: "thread-context", title: "Study discussion", explicit: true, contextExcerpt: [{ role: "user", content: "Focus on wave equations" }] }],
    });
    expect(packet.contextLayers.continuation).toBeNull();
    expect(packet.threadMap).toEqual([expect.objectContaining({ id: "thread-context", explicit: true })]);
  });
});
