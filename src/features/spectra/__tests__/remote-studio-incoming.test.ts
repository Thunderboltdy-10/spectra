import { describe, expect, it } from "vitest";
import {
  decideRemoteStudioIncoming,
  rebaseCollaborativeSnapshot,
  reconciliationSnapshotKey,
  richTextValuesEquivalent,
  shouldEmitRichTextChange,
  shouldRejectHollowStudioIncoming,
  studioContentLooksHollow,
  studioIncomingSource,
  incomingReconciliationKey,
} from "../components/artifact-studio-value-utils";
import {
  createWhiteboardNode,
  normalizeWhiteboardContent,
  whiteboardNodeText,
} from "../whiteboard/model";
import {
  createDefaultPresentationContent,
  normalizePresentationContent,
  producePresentationContent,
} from "../presentation/model";
import { workYjsAdapter } from "../work/models/yjs/registry";

describe("rich text hydrate echoes", () => {
  it("treats TipTap paragraph wraps of plain prompts as equivalent", () => {
    expect(
      richTextValuesEquivalent(
        "What should this quiz check?",
        "<p>What should this quiz check?</p>",
      ),
    ).toBe(true);
    expect(richTextValuesEquivalent("", "<p></p>")).toBe(true);
    expect(
      richTextValuesEquivalent("What should this quiz check?", "<p>Changed</p>"),
    ).toBe(false);
  });

  it("does not emit hydrate or focus-blur echoes without typing", () => {
    expect(
      shouldEmitRichTextChange({
        committedValue: "What should this quiz check?",
        nextHtml: "<p>What should this quiz check?</p>",
        typedWhileFocused: false,
      }),
    ).toBe(false);
    expect(
      shouldEmitRichTextChange({
        committedValue: "What should this quiz check?",
        nextHtml: "<p>What should this quiz check?</p>",
        typedWhileFocused: true,
      }),
    ).toBe(false);
    expect(
      shouldEmitRichTextChange({
        committedValue: "What should this quiz check?",
        nextHtml: "<p>A clearer question</p>",
        typedWhileFocused: true,
      }),
    ).toBe(true);
  });
});

describe("remote studio incoming decisions", () => {
  const base = {
    incomingKey: "incoming",
    baselineKey: "baseline",
    dismissedRemoteKey: null as string | null,
    isLocalSyncKey: false,
    isCollaborative: true,
    nativeOfficeDocument: false,
        incomingSource: "provisional" as const,
  };

  it("accepts bootstrap echoes when dirty without a human edit", () => {
    expect(
      decideRemoteStudioIncoming({
        ...base,
        dirty: true,
        userHasEdited: false,
      }),
    ).toBe("accept-bootstrap");
  });

  it("treats matching local sync keys as acknowledgements", () => {
    expect(
      decideRemoteStudioIncoming({
        ...base,
        dirty: true,
        userHasEdited: true,
        isLocalSyncKey: true,
      }),
    ).toBe("accept-local-sync");
  });

  it("rebases collaborative human drafts and conflicts otherwise", () => {
    expect(
      decideRemoteStudioIncoming({
        ...base,
        dirty: true,
        userHasEdited: true,
      }),
    ).toBe("rebase");
    expect(
      decideRemoteStudioIncoming({
        ...base,
        dirty: true,
        userHasEdited: true,
        isCollaborative: false,
      }),
    ).toBe("conflict");
  });


  it("ignores hollow incoming snapshots that would wipe populated import text", () => {
    const populated = {
      blocks: [{ id: "b1", type: "paragraph", text: "QA Resource Citizen body" }],
    };
    const hollow = { blocks: [{ id: "intro", type: "paragraph", text: "" }] };
    expect(studioContentLooksHollow(populated)).toBe(false);
    expect(studioContentLooksHollow(hollow)).toBe(true);
    expect(
      shouldRejectHollowStudioIncoming({
        incomingSource: "provisional",
        currentContent: populated,
        incomingContent: hollow,
      }),
    ).toBe(true);
    expect(
      decideRemoteStudioIncoming({
        ...base,
        dirty: true,
        userHasEdited: false,
        currentContent: populated,
        incomingContent: hollow,
      }),
    ).toBe("ignore");
    expect(
      decideRemoteStudioIncoming({
        ...base,
        dirty: false,
        userHasEdited: false,
        currentContent: populated,
        incomingContent: hollow,
      }),
    ).toBe("ignore");
  });

  it("ignores same-key or dismissed incoming snapshots", () => {
    expect(
      decideRemoteStudioIncoming({
        ...base,
        dirty: true,
        userHasEdited: true,
        incomingKey: "baseline",
        baselineKey: "baseline",
      }),
    ).toBe("ignore");
    expect(
      decideRemoteStudioIncoming({
        ...base,
        dirty: true,
        userHasEdited: true,
        dismissedRemoteKey: "incoming",
      }),
    ).toBe("ignore");
  });
});

describe("whiteboard sticky reconcile stability", () => {
  const emptyBoard = {
    viewport: { pageId: "page-1", x: 0, y: 0, zoom: 1 },
    pages: [{ id: "page-1", name: "Page 1" }],
    nodes: [] as unknown[],
    edges: [] as unknown[],
    layers: [
      {
        id: "layer-1",
        name: "Canvas",
        pageId: "page-1",
        visible: true,
        locked: false,
      },
    ],
  };

  it("keeps zOrder on normalize so bootstrap hydrate matches Yjs", () => {
    const normalized = normalizeWhiteboardContent(emptyBoard);
    expect(normalized.zOrder).toEqual([]);
    const projected = workYjsAdapter("whiteboard").project(
      workYjsAdapter("whiteboard").createDocument(emptyBoard),
    );
    expect(projected).toEqual(normalized);
  });

  it("preserves sticky text through Yjs round-trip and does not raise zOrder conflict", () => {
    const sticky = createWhiteboardNode("note", "page-1", "layer-1", 40, 60, 1);
    sticky.content = { text: "Demo marker" };
    const localBoard = normalizeWhiteboardContent({
      ...emptyBoard,
      nodes: [sticky],
    });
    expect(localBoard.zOrder).toEqual([sticky.id]);
    expect(whiteboardNodeText(localBoard.nodes[0]!)).toBe("Demo marker");

    const projected = workYjsAdapter("whiteboard").project(
      workYjsAdapter("whiteboard").createDocument(localBoard),
    ) as typeof localBoard;
    expect(projected).toEqual(localBoard);
    expect(whiteboardNodeText(projected.nodes[0]!)).toBe("Demo marker");

    const baseline = {
      title: "Board",
      summary: "",
      tagDraft: "",
      content: normalizeWhiteboardContent(emptyBoard),
    };
    const local = {
      title: "Board",
      summary: "",
      tagDraft: "",
      content: localBoard,
    };
    const incoming = {
      title: "Board",
      summary: "",
      tagDraft: "",
      content: projected,
    };
    const rebased = rebaseCollaborativeSnapshot(baseline, local, incoming);
    expect(rebased.conflicts).toEqual([]);
    expect(
      whiteboardNodeText(
        (rebased.snapshot.content as typeof localBoard).nodes[0]!,
      ),
    ).toBe("Demo marker");

    // Matching projection keys behave as local sync acknowledgements.
    expect(reconciliationSnapshotKey(local)).toBe(
      reconciliationSnapshotKey(incoming),
    );
    expect(
      decideRemoteStudioIncoming({
        dirty: true,
        userHasEdited: true,
        incomingKey: reconciliationSnapshotKey(incoming),
        baselineKey: reconciliationSnapshotKey(baseline),
        dismissedRemoteKey: null,
        isLocalSyncKey: true,
        isCollaborative: true,
        nativeOfficeDocument: false,
        incomingSource: "provisional",
      }),
    ).toBe("accept-local-sync");
  });

  it("accepts whiteboard bootstrap hydrate when dirty without a human edit", () => {
    const baseline = {
      title: "Board",
      summary: "",
      tagDraft: "",
      content: emptyBoard,
    };
    const incoming = {
      title: "Board",
      summary: "",
      tagDraft: "",
      content: normalizeWhiteboardContent(emptyBoard),
    };
    expect(
      decideRemoteStudioIncoming({
        dirty: true,
        userHasEdited: false,
        incomingKey: reconciliationSnapshotKey(incoming),
        baselineKey: reconciliationSnapshotKey(baseline),
        dismissedRemoteKey: null,
        isLocalSyncKey: false,
        isCollaborative: true,
        nativeOfficeDocument: false,
        incomingSource: "provisional",
      }),
    ).toBe("accept-bootstrap");
  });
});

describe("presentation default reconcile stability", () => {
  it("keeps settings/speakerNotes on normalize so bootstrap hydrate matches Yjs", () => {
    const sparse = {
      theme: { id: "spectra-default" },
      slides: [{ id: "slide-1", title: "Untitled presentation", objects: [] }],
    };
    const normalized = normalizePresentationContent(sparse);
    expect(normalized.settings?.showSlideNumbers).toBe(true);
    expect(normalized.slides[0]?.speakerNotes).toBe("");
    const projected = workYjsAdapter("presentation").project(
      workYjsAdapter("presentation").createDocument(sparse),
    );
    expect(projected).toEqual(normalized);
  });

  it("does not raise field-drift conflicts when a title edit echoes through Yjs", () => {
    const baselineContent = createDefaultPresentationContent();
    const localContent = producePresentationContent(baselineContent, (draft) => {
      draft.slides[0]!.objects[0]!.content = { text: "Demo title" };
    });
    const projected = workYjsAdapter("presentation").project(
      workYjsAdapter("presentation").createDocument(localContent),
    ) as typeof localContent;
    expect(projected).toEqual(normalizePresentationContent(localContent));

    const baseline = {
      title: "Deck",
      summary: "",
      tagDraft: "",
      content: baselineContent,
    };
    const local = {
      title: "Deck",
      summary: "",
      tagDraft: "",
      content: localContent,
    };
    const incoming = {
      title: "Deck",
      summary: "",
      tagDraft: "",
      content: projected,
    };
    const rebased = rebaseCollaborativeSnapshot(baseline, local, incoming);
    expect(rebased.conflicts).toEqual([]);
    expect(
      decideRemoteStudioIncoming({
        dirty: true,
        userHasEdited: true,
        incomingKey: reconciliationSnapshotKey(incoming),
        baselineKey: reconciliationSnapshotKey(baseline),
        dismissedRemoteKey: null,
        isLocalSyncKey: true,
        isCollaborative: true,
        nativeOfficeDocument: false,
        incomingSource: "provisional",
      }),
    ).toBe("accept-local-sync");
  });

  it("accepts presentation bootstrap hydrate when dirty without a human edit", () => {
    const sparse = {
      theme: { id: "spectra-default" },
      slides: [{ id: "slide-1", title: "Untitled presentation", objects: [] }],
    };
    expect(
      decideRemoteStudioIncoming({
        dirty: true,
        userHasEdited: false,
        incomingKey: reconciliationSnapshotKey({
          title: "Deck",
          summary: "",
          tagDraft: "",
          content: normalizePresentationContent(sparse),
        }),
        baselineKey: reconciliationSnapshotKey({
          title: "Deck",
          summary: "",
          tagDraft: "",
          content: sparse,
        }),
        dismissedRemoteKey: null,
        isLocalSyncKey: false,
        isCollaborative: true,
        nativeOfficeDocument: false,
        incomingSource: "provisional",
      }),
    ).toBe("accept-bootstrap");
  });
});

describe("hydrate hollow protection across studios", () => {
  const base = {
    incomingKey: "incoming",
    baselineKey: "baseline",
    dismissedRemoteKey: null as string | null,
    isLocalSyncKey: false,
    isCollaborative: true,
    nativeOfficeDocument: false,
        incomingSource: "provisional" as const,
  };

  it("rejects hollow quiz bootstrap that would wipe populated questions", () => {
    const populated = {
      questions: [{ id: "q1", prompt: "What is photosynthesis?", type: "short" }],
    };
    const hollow = {
      questions: [{ id: "q1", prompt: "", type: "short" }],
    };
    expect(studioContentLooksHollow(populated)).toBe(false);
    expect(studioContentLooksHollow(hollow)).toBe(true);
    expect(
      decideRemoteStudioIncoming({
        ...base,
        dirty: false,
        userHasEdited: false,
        currentContent: populated,
        incomingContent: hollow,
      }),
    ).toBe("ignore");
  });

  it("rejects empty-cell sheet shells that would wipe filled workbooks", () => {
    const populated = {
      sheets: [
        {
          id: "sheet-a",
          name: "Data",
          cells: { A1: { value: "Filled" } },
        },
      ],
    };
    const hollow = {
      sheets: [{ id: "sheet-a", name: "Data", cells: {} }],
    };
    expect(studioContentLooksHollow(populated)).toBe(false);
    expect(studioContentLooksHollow(hollow)).toBe(true);
    expect(
      shouldRejectHollowStudioIncoming({
        incomingSource: "provisional",
        currentContent: populated,
        incomingContent: hollow,
      }),
    ).toBe(true);
  });

  it("treats placeholder-only presentation shells as hollow", () => {
    const hollow = {
      slides: [
        {
          id: "slide-1",
          objects: [{ id: "obj-1", content: { text: "Title" } }],
        },
      ],
    };
    const populated = {
      slides: [
        {
          id: "slide-1",
          objects: [{ id: "obj-1", content: { text: "Mitosis overview" } }],
        },
      ],
    };
    expect(studioContentLooksHollow(hollow)).toBe(true);
    expect(studioContentLooksHollow(populated)).toBe(false);
  });

  it("treats empty-object bootstraps as hollow so they cannot wipe populated studios", () => {
    const populated = {
      blocks: [{ id: "b1", type: "paragraph", text: "Imported body text" }],
    };
    expect(studioContentLooksHollow({})).toBe(true);
    expect(studioContentLooksHollow(populated)).toBe(false);
    expect(
      shouldRejectHollowStudioIncoming({
        incomingSource: "provisional",
        currentContent: populated,
        incomingContent: {},
      }),
    ).toBe(true);
    expect(
      decideRemoteStudioIncoming({
        ...base,
        dirty: false,
        userHasEdited: false,
        currentContent: populated,
        incomingContent: {},
      }),
    ).toBe("ignore");
  });

  it("rejects hollow deck / whiteboard / timetable / code / agent / planner shells", () => {
    const cases: Array<{ populated: unknown; hollow: unknown }> = [
      {
        populated: { cards: [{ id: "c1", front: "Q", back: "A" }] },
        hollow: { cards: [{ id: "c1", front: "", back: "" }] },
      },
      {
        populated: { nodes: [{ id: "n1", type: "note", text: "Idea" }] },
        hollow: { nodes: [] },
      },
      {
        populated: { events: [{ id: "e1", title: "Bio", start: "09:00" }] },
        hollow: { events: [] },
      },
      {
        populated: {
          files: [{ id: "f1", path: "index.html", source: "<main>Hello class</main>" }],
        },
        hollow: {
          files: [{ id: "f1", path: "index.html", source: "<main></main>" }],
        },
      },
      {
        populated: {
          instructions: {
            regionId: "agent-instructions",
            text: "You help students revise biology with concrete examples.",
          },
        },
        hollow: { instructions: { regionId: "agent-instructions", text: "" } },
      },
      {
        populated: { description: "Finish lab report", subtasks: [] },
        hollow: { description: "", subtasks: [] },
      },
    ];
    for (const row of cases) {
      expect(studioContentLooksHollow(row.populated)).toBe(false);
      expect(studioContentLooksHollow(row.hollow)).toBe(true);
      expect(
        shouldRejectHollowStudioIncoming({
        incomingSource: "provisional",
          currentContent: row.populated,
          incomingContent: row.hollow,
        }),
      ).toBe(true);
    }
  });
});

describe("two-user keyed collaborative rebase", () => {
  it("keeps a local question edit while accepting a peer insert", () => {
    const baseline = {
      title: "Quiz",
      summary: "",
      tagDraft: "",
      content: {
        questions: [
          { id: "q1", prompt: "Original", type: "short" },
          { id: "q2", prompt: "Keep me", type: "short" },
        ],
      },
    };
    const local = {
      ...baseline,
      content: {
        questions: [
          { id: "q1", prompt: "Local edit", type: "short" },
          { id: "q2", prompt: "Keep me", type: "short" },
        ],
      },
    };
    const incoming = {
      ...baseline,
      content: {
        questions: [
          { id: "q1", prompt: "Original", type: "short" },
          { id: "q2", prompt: "Keep me", type: "short" },
          { id: "q3", prompt: "Peer insert", type: "short" },
        ],
      },
    };
    const rebased = rebaseCollaborativeSnapshot(baseline, local, incoming);
    expect(rebased.conflicts).toEqual([]);
    expect(rebased.snapshot.content).toEqual({
      questions: [
        { id: "q1", prompt: "Local edit", type: "short" },
        { id: "q2", prompt: "Keep me", type: "short" },
        { id: "q3", prompt: "Peer insert", type: "short" },
      ],
    });
  });

  it("merges disjoint field edits on the same keyed block", () => {
    const baseline = {
      title: "Doc",
      summary: "",
      tagDraft: "",
      content: {
        blocks: [{ id: "b1", type: "paragraph", text: "Base", note: "" }],
      },
    };
    const local = {
      ...baseline,
      content: {
        blocks: [{ id: "b1", type: "paragraph", text: "Local text", note: "" }],
      },
    };
    const incoming = {
      ...baseline,
      content: {
        blocks: [{ id: "b1", type: "paragraph", text: "Base", note: "Peer note" }],
      },
    };
    const rebased = rebaseCollaborativeSnapshot(baseline, local, incoming);
    expect(rebased.conflicts).toEqual([]);
    expect(rebased.snapshot.content).toEqual({
      blocks: [
        { id: "b1", type: "paragraph", text: "Local text", note: "Peer note" },
      ],
    });
  });

  it("reports same-leaf collisions instead of dropping either side silently", () => {
    const baseline = {
      title: "Doc",
      summary: "",
      tagDraft: "",
      content: {
        blocks: [{ id: "b1", type: "paragraph", text: "Base" }],
      },
    };
    const local = {
      ...baseline,
      content: {
        blocks: [{ id: "b1", type: "paragraph", text: "Local" }],
      },
    };
    const incoming = {
      ...baseline,
      content: {
        blocks: [{ id: "b1", type: "paragraph", text: "Remote" }],
      },
    };
    const rebased = rebaseCollaborativeSnapshot(baseline, local, incoming);
    expect(rebased.conflicts).toEqual(["/content/blocks/b1/text"]);
    expect(rebased.snapshot.content).toEqual({
      blocks: [{ id: "b1", type: "paragraph", text: "Local" }],
    });
  });

  it("merges disjoint sheet cell edits without false conflict", () => {
    const baseline = {
      title: "Sheet",
      summary: "",
      tagDraft: "",
      content: {
        sheets: [
          {
            id: "sheet-a",
            name: "Data",
            cells: { A1: { value: "Base" }, B1: { value: "Keep" } },
          },
        ],
      },
    };
    const local = {
      ...baseline,
      content: {
        sheets: [
          {
            id: "sheet-a",
            name: "Data",
            cells: { A1: { value: "Local" }, B1: { value: "Keep" } },
          },
        ],
      },
    };
    const incoming = {
      ...baseline,
      content: {
        sheets: [
          {
            id: "sheet-a",
            name: "Data",
            cells: {
              A1: { value: "Base" },
              B1: { value: "Keep" },
              C1: { value: "Peer" },
            },
          },
        ],
      },
    };
    const rebased = rebaseCollaborativeSnapshot(baseline, local, incoming);
    expect(rebased.conflicts).toEqual([]);
    expect(rebased.snapshot.content).toEqual({
      sheets: [
        {
          id: "sheet-a",
          name: "Data",
          cells: {
            A1: { value: "Local" },
            B1: { value: "Keep" },
            C1: { value: "Peer" },
          },
        },
      ],
    });
  });

  it("keeps a local slide-object edit while accepting a peer object insert", () => {
    const baseline = {
      title: "Deck",
      summary: "",
      tagDraft: "",
      content: {
        slides: [
          {
            id: "slide-1",
            objects: [
              { id: "obj-1", content: { text: "Original title text" } },
            ],
          },
        ],
      },
    };
    const local = {
      ...baseline,
      content: {
        slides: [
          {
            id: "slide-1",
            objects: [
              { id: "obj-1", content: { text: "Local title rewrite" } },
            ],
          },
        ],
      },
    };
    const incoming = {
      ...baseline,
      content: {
        slides: [
          {
            id: "slide-1",
            objects: [
              { id: "obj-1", content: { text: "Original title text" } },
              { id: "obj-2", content: { text: "Peer bullet point" } },
            ],
          },
        ],
      },
    };
    const rebased = rebaseCollaborativeSnapshot(baseline, local, incoming);
    expect(rebased.conflicts).toEqual([]);
    expect(rebased.snapshot.content).toEqual({
      slides: [
        {
          id: "slide-1",
          objects: [
            { id: "obj-1", content: { text: "Local title rewrite" } },
            { id: "obj-2", content: { text: "Peer bullet point" } },
          ],
        },
      ],
    });
  });
});


describe("authoritative shorter, empty and nontext edits (R1)", () => {
  const changes: [unknown, unknown][] = [
    [{description: "Read chapter 5"}, {description: "Read"}],
    [{questions: [{id: "q", question: "Why?"}]}, {questions: []}],
    [{slides: [{id: "s", elements: [{type: "text", text: "Explanation"}]}]},
      {slides: [{id: "s", elements: [{type: "chart", chart: {data: [{x: 1, y: 2}]}}]}]}],
    [{sheets: [{id: "s", cells: {A1: {value: 1}}}]}, {sheets: [{id: "s", cells: {}}]}],
  ];
  it.each(changes)("accepts committed/live content and acknowledges local clears", (currentContent, incomingContent) => {
    const args = {currentContent, incomingContent, dirty: false, userHasEdited: false,
      incomingKey: "new", baselineKey: "old", dismissedRemoteKey: null,
      isLocalSyncKey: false, isCollaborative: true, nativeOfficeDocument: false};
    for (const incomingSource of ["persisted", "live"] as const) {
      expect(shouldRejectHollowStudioIncoming({...args, incomingSource})).toBe(false);
      expect(decideRemoteStudioIncoming({...args, incomingSource})).toBe("accept-bootstrap");
      expect(decideRemoteStudioIncoming({...args, incomingSource, dirty: true, userHasEdited: true})).toBe("rebase");
    }
    expect(decideRemoteStudioIncoming({...args, incomingSource: "provisional", isLocalSyncKey: true})).toBe("accept-local-sync");
    expect(decideRemoteStudioIncoming({...args, incomingSource: "stale"})).toBe("ignore");
  });
  it("uses revision and hydration provenance, including equal-content transitions", () => {
    const origin = {initialRevision: 10, latestRevision: 10, hasAcceptedLiveValue: false};
    expect(studioIncomingSource({...origin, revision: 10, liveValueSource: "persisted"})).toBe("provisional");
    expect(studioIncomingSource({...origin, revision: 11, liveValueSource: "persisted"})).toBe("persisted");
    expect(studioIncomingSource({...origin, revision: 10, liveValueSource: "live"})).toBe("live");
    expect(studioIncomingSource({...origin, hasAcceptedLiveValue: true, revision: 10, liveValueSource: "persisted"})).toBe("stale");
    const snapshot = {title: "Quiz", summary: "", tagDraft: "", content: {questions: []}};
    const key = (source: "provisional" | "live") => incomingReconciliationKey("a", snapshot, {source, revision: 10, localSync: false});
    expect(key("provisional")).not.toBe(key("live"));
    expect(key("live")).toBe(key("live"));
  });
});
