import { describe, expect, it } from "vitest";
import {
  buildBoundedContextPacket,
  CONTEXT_LIMITS,
} from "../ai/context-builder";

function artifact(id: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    title: `Artifact ${id}`,
    blueprintKey: "document",
    summary: "Cell biology revision notes",
    content: {
      blocks: [
        {
          text: "Mitochondria release energy through respiration. ".repeat(200),
        },
      ],
    },
    tags: ["biology"],
    placements: [
      {
        workspaceId: "workspace-1",
        workspaceTitle: "Biology",
        nodeId: `item-${id}`,
        pinned: id === "a",
      },
    ],
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("Wave 6 bounded context builder", () => {
  it("prioritises explicit selection and caps excerpts", () => {
    const packet = buildBoundedContextPacket({
      prompt: "Create a quiz about mitochondria",
      focusMode: "selection",
      workspace: {
        _id: "workspace-1",
        title: "Biology",
        description: "IB Biology",
      },
      artifacts: [artifact("a"), artifact("b"), artifact("c")],
      selectedArtifactIds: ["b", "c"],
      currentView: "list",
    });
    expect(packet.selectedObjects.map((item) => item.id)).toEqual(["b", "c"]);
    expect(
      packet.selectedObjects.every(
        (item) =>
          (item.excerpt?.length ?? 0) <=
          CONTEXT_LIMITS.artifactExcerptCharacters,
      ),
    ).toBe(true);
    expect(packet.workspace?.pinned[0]?.id).toBe("a");
  });

  it("does not include full workspace content and remains bounded", () => {
    const packet = buildBoundedContextPacket({
      prompt: "Summarise biology",
      focusMode: "workspace",
      workspace: { _id: "workspace-1", title: "Biology" },
      artifacts: Array.from({ length: 80 }, (_, index) =>
        artifact(String(index)),
      ),
      conversation: Array.from({ length: 50 }, () => ({
        role: "user",
        content: "hello".repeat(4_000),
      })),
    });
    expect(packet.omitted.fullWorkspaceContent).toBe(true);
    expect(packet.workspace?.relevant.length).toBeLessThanOrEqual(10);
    expect(packet.conversation.length).toBeLessThanOrEqual(
      CONTEXT_LIMITS.conversationMessages,
    );
    expect(JSON.stringify(packet).length).toBeLessThanOrEqual(
      CONTEXT_LIMITS.packetCharacters + 2_000,
    );
  });

  it("keeps explicitly added thread context without turning it into continuation", () => {
    const packet = buildBoundedContextPacket({
      prompt: "Use the discussion as supporting context for this edit",
      focusMode: "artifact",
      focusedArtifact: artifact("focused"),
      artifacts: [artifact("focused")],
      threadMap: [
        {
          id: "thread-context",
          title: "Study discussion",
          explicit: true,
          contextExcerpt: [
            { role: "user", content: "Focus on wave equations" },
          ],
        },
      ],
    });
    expect(packet.contextLayers.continuation).toBeNull();
    expect(packet.threadMap).toEqual([
      expect.objectContaining({ id: "thread-context", explicit: true }),
    ]);
  });

  it("uses a compact focused profile for a narrow artifact edit", () => {
    const focused = artifact("focused", {
      blueprintKey: "flashcard_deck",
      content: {
        cards: Array.from({ length: 8 }, (_, index) => ({
          front: `Question ${index + 1}`,
          back: `Answer ${index + 1}`,
          hint: `Hint ${index + 1}`,
          section: "Core",
        })),
      },
    });
    const packet = buildBoundedContextPacket({
      prompt:
        "Improve only the hint on the eighth flashcard and preserve every other field exactly.",
      focusMode: "thread",
      workspace: {
        _id: "workspace-1",
        title: "Biology",
        description: "IB Biology",
      },
      focusedArtifact: focused,
      artifacts: [
        focused,
        ...Array.from({ length: 20 }, (_, index) => artifact(`other-${index}`)),
      ],
      conversation: Array.from({ length: 24 }, (_, index) => ({
        role: index % 2 ? "assistant" : "user",
        content: `Earlier message ${index} `.repeat(80),
      })),
      threadMap: Array.from({ length: 14 }, (_, index) => ({
        id: `thread-${index}`,
        title: `Thread ${index}`,
      })),
      workspaceMap: Array.from({ length: 12 }, (_, index) => ({
        id: `workspace-${index}`,
        title: `Workspace ${index}`,
      })),
      continuationThreadId: "thread-current",
    });
    expect(packet.profile).toBe("focused_mutation");
    expect(packet.conversation.length).toBeLessThanOrEqual(4);
    expect(packet.workspace?.relevant).toEqual([]);
    expect(packet.workspaceMap).toEqual([]);
    expect(packet.threadMap).toEqual([]);
    expect(
      (packet.focusedArtifact as Record<string, unknown> | null)?.structure,
    ).toBeTruthy();
    expect(JSON.stringify(packet).length).toBeLessThan(8_000);
  });

  it("preserves structured thread purpose and origin while compacting recent turns", () => {
    const packet = buildBoundedContextPacket({
      prompt: "Continue the work",
      focusMode: "thread",
      artifacts: [],
      continuationThreadId: "thread-current",
      conversationMemory: {
        title: "Cell respiration study pack",
        summary: "Build a rigorous IB Biology study pack and keep it concise.",
        originInstructions: [
          "Use DeepSeek V4 Pro and create a document, deck, and quiz.",
          "Preserve the teacher's terminology throughout.",
        ],
      },
      conversation: Array.from({ length: 40 }, (_, index) => ({
        role: index % 2 ? "assistant" : "user",
        content: `Recent turn ${index}`,
      })),
    });
    expect(packet.conversationMemory).toEqual({
      title: "Cell respiration study pack",
      summary: "Build a rigorous IB Biology study pack and keep it concise.",
      originInstructions: [
        "Use DeepSeek V4 Pro and create a document, deck, and quiz.",
        "Preserve the teacher's terminology throughout.",
      ],
    });
    expect(packet.conversation.length).toBeLessThanOrEqual(
      CONTEXT_LIMITS.conversationMessages,
    );
  });

  it("binds a selected clarification to its unresolved request", () => {
    const packet = buildBoundedContextPacket({
      prompt: "Agent Loop Quick Note: Use this owned object as the target.",
      focusMode: "thread",
      artifacts: [],
      continuationThreadId: "thread-current",
      conversationMemory: {
        title: "Archive old note",
        originInstructions: ["Archive an older document."],
      },
      activeGoal: {
        request:
          "Create a reliability quiz and add the agent systems tag to the open document.",
        question: "Which document should receive the tag?",
        selectedChoice: "Agent Loop Quick Note",
        intent: { mode: "mixed" },
      },
    });
    expect(packet.activeGoal).toMatchObject({
      request:
        "Create a reliability quiz and add the agent systems tag to the open document.",
      selectedChoice: "Agent Loop Quick Note",
      intent: { mode: "mixed" },
    });
    expect(packet.activeGoal?.rule).toMatch(/authoritative current goal/i);
  });

  it("keeps trailing planted document blocks in focused structure", () => {
    const focused = artifact("focused", {
      content: {
        blocks: [
          ...Array.from({ length: 26 }, (_, index) => ({
            id: `block-${index + 1}`,
            type: index === 25 ? "heading" : "paragraph",
            text:
              index === 25
                ? "Key Takeaways"
                : `Body paragraph ${index + 1}`,
            level: index === 25 ? 2 : undefined,
          })),
          {
            id: "planted",
            type: "paragraph",
            text: "Enzyme A Km = 12.0 (planted claim)",
          },
        ],
      },
    });
    const packet = buildBoundedContextPacket({
      prompt: "Find inconsistencies between my sheet and this document",
      focusMode: "artifact",
      focusedArtifact: focused,
      artifacts: [focused],
    });
    const structure = (
      packet.focusedArtifact as {
        structure?: { blocks?: Array<{ text?: unknown }> };
      } | null
    )?.structure;
    const texts = (structure?.blocks ?? []).map((block) => block.text);
    expect(texts).toContain("Key Takeaways");
    expect(texts).toContain("Enzyme A Km = 12.0 (planted claim)");
  });
});
