import { describe, expect, it } from "vitest";
import {
  buildBoundedContextPacket,
  CONTEXT_LIMITS,
  typedArtifactStructure,
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
      CONTEXT_LIMITS.packetCharacters,
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

  it("keeps canonical Library node ids available for organization requests", () => {
    const libraryMap = [
      {
        id: "physics-node",
        title: "Physics",
        type: "folder",
        parentId: null,
      },
      {
        id: "arduino-node",
        title: "Arduino_IA",
        type: "folder",
        parentId: "physics-node",
      },
      {
        id: "pendulum-node",
        title: "Pendulum_Experiment_Results.xlsx",
        type: "work",
        sourceId: "pendulum-artifact",
        parentId: "physics-node",
      },
    ];
    const packet = buildBoundedContextPacket({
      prompt:
        "Create a Sources folder in Arduino_IA and move Pendulum_Experiment_Results.xlsx there.",
      focusMode: "workspace",
      artifacts: [],
      libraryMap,
    });
    expect(packet.libraryMap).toEqual(libraryMap);
    expect(packet.contextLayers.libraryMap).toMatch(/currently visible/i);
  });

  it("keeps the exact current Library location separate from the bounded node window", () => {
    const location = {
      id: "physics-node",
      title: "Physics",
      type: "folder",
      parentId: "general-node",
      path: [
        { id: "general-node", title: "General", type: "folder" },
        { id: "physics-node", title: "Physics", type: "folder" },
      ],
    };
    const packet = buildBoundedContextPacket({
      prompt: "Create a folder here",
      focusMode: "workspace",
      artifacts: [],
      libraryMap: [
        {
          id: "other-physics",
          title: "Physics",
          type: "folder",
          parentId: null,
        },
      ],
      currentLibraryLocation: location,
    });
    expect(packet.currentLibraryLocation).toEqual(location);
    expect(packet.currentLibraryLocation?.id).toBe("physics-node");
    expect(packet.contextLayers.currentLibraryLocation).toMatch(
      /exact Library folder/i,
    );
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
    expect(packet.workspaceIndex).toHaveLength(21);
    expect(packet.workspaceIndex).toContainEqual(
      expect.objectContaining({
        id: "focused",
        title: "Artifact focused",
        type: "flashcard_deck",
        priors: expect.objectContaining({ visible: true }),
      }),
    );
    expect(
      packet.workspaceIndex.every(
        (item) => !("content" in item) && !("excerpt" in item),
      ),
    ).toBe(true);
    expect(packet.threadMap).toHaveLength(14);
    expect(
      (packet.focusedArtifact as Record<string, unknown> | null)?.structure,
    ).toBeTruthy();
    expect(JSON.stringify(packet).length).toBeLessThanOrEqual(
      CONTEXT_LIMITS.packetCharacters,
    );
  });

  it("indexes Agent work shallowly without leaking its instructions", () => {
    const document = artifact("document");
    const agent = artifact("agent", {
      title: "Biology Tutor",
      blueprintKey: "agent",
      content: {
        instructions: { text: "PRIVATE ROUTING INSTRUCTIONS" },
      },
    });
    const packet = buildBoundedContextPacket({
      prompt: "Find my Biology Tutor",
      focusMode: "global",
      artifacts: [document],
      workspaceIndexArtifacts: [document, agent],
      focusedArtifact: null,
    });
    expect(packet.workspaceIndex).toContainEqual(
      expect.objectContaining({
        id: "agent",
        title: "Biology Tutor",
        type: "agent",
      }),
    );
    expect(JSON.stringify(packet.workspaceIndex)).not.toContain(
      "PRIVATE ROUTING INSTRUCTIONS",
    );
    expect(packet.catalog).not.toContainEqual(
      expect.objectContaining({ id: "agent" }),
    );
  });

  it("serializes a bounded typed structure for every artifact blueprint", () => {
    const contents = {
      document: { blocks: [{ id: "b1", type: "heading", text: "Purpose" }] },
      flashcard_deck: {
        cards: [
          { id: "c1", front: "ATP", back: "Energy carrier", hint: "Adenosine" },
        ],
      },
      quiz: {
        questions: [
          {
            id: "q1",
            prompt: "What is ATP?",
            options: ["A"],
            correctAnswer: "A",
          },
        ],
      },
      planner_task: {
        description: "Review",
        subtasks: [{ id: "s1", title: "Read" }],
      },
      agent: {
        profile: { purpose: "Tutor", outcomes: ["Explain"] },
        instructions: { text: "Use evidence." },
        skills: [],
        tools: [],
        resources: [],
      },
      timetable: {
        timezone: "Europe/Madrid",
        layers: [{ id: "l1", name: "Classes" }],
        events: [{ id: "e1", layerId: "l1", title: "Physics" }],
      },
      sheets: {
        sheets: [{ id: "sh1", name: "Data", cells: { A1: { value: 12 } } }],
      },
      presentation: {
        theme: { id: "theme-1", name: "Classroom" },
        slides: [
          {
            id: "slide-1",
            title: "Respiration",
            speakerNotes: "Explain the equation.",
            objects: [
              {
                id: "object-1",
                type: "text",
                content: "Glucose releases energy",
                x: 10,
                y: 20,
                width: 400,
                height: 100,
              },
            ],
          },
        ],
      },
      code: {
        runtime: "python",
        entryFileId: "file-1",
        files: [{ id: "file-1", path: "main.py", source: "print('ATP')" }],
      },
      whiteboard: {
        pages: [{ id: "page-1", name: "Main" }],
        nodes: [{ id: "node-1", type: "note", content: { text: "ATP" } }],
        edges: [],
      },
    } as const;
    for (const [blueprintKey, content] of Object.entries(contents)) {
      const structure = typedArtifactStructure(
        artifact(blueprintKey, { blueprintKey, content }),
      );
      expect(structure, blueprintKey).toBeTruthy();
      expect(JSON.stringify(structure).length, blueprintKey).toBeLessThan(
        12_000,
      );
    }
    expect(
      typedArtifactStructure(
        artifact("presentation", {
          blueprintKey: "presentation",
          content: contents.presentation,
        }),
      ),
    ).toMatchObject({
      slides: [
        expect.objectContaining({
          title: "Respiration",
          speakerNotes: "Explain the equation.",
          objects: [expect.objectContaining({ id: "object-1", x: 10 })],
        }),
      ],
    });
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
              index === 25 ? "Key Takeaways" : `Body paragraph ${index + 1}`,
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
