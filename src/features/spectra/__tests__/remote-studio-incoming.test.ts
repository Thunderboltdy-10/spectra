import { describe, expect, it } from "vitest";
import {
  decideRemoteStudioIncoming,
  rebaseCollaborativeSnapshot,
  reconciliationSnapshotKey,
  richTextValuesEquivalent,
  shouldEmitRichTextChange,
  shouldRejectHollowStudioIncoming,
  studioContentLooksHollow,
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
      }),
    ).toBe("accept-bootstrap");
  });
});
