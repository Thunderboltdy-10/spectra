import { describe, expect, it } from "vitest";
import { documentYjsAdapter } from "../work/models/yjs/document-adapter";
import { resolveArtifactWriteInput } from "../operations/artifact-write-content";
import {
  applyResolvedContentPatch,
  findDocumentSectionRange,
  readResolvedContentPointer,
  remapDocumentSectionRewriteChanges,
  resolveDocumentPatchPath,
} from "../ai/document-content-patch";

/** Minimal Enzyme Inhibitors–style outline that reproduces the E-03 corruption. */
function enzymeInhibitorsNotes() {
  return {
    blocks: [
      {
        id: "title",
        type: "heading",
        text: "Enzyme Inhibitors — Study Notes",
        attrs: { level: 1 },
      },
      {
        id: "intro",
        type: "paragraph",
        text: "Inhibitors reduce enzyme activity by several mechanisms.",
      },
      {
        id: "s1",
        type: "heading",
        text: "1. Reversible Inhibition",
        attrs: { level: 2 },
      },
      {
        id: "s1-body",
        type: "paragraph",
        text: "Reversible inhibitors bind non-covalently.",
      },
      {
        id: "s1-3",
        type: "heading",
        text: "1.3 Uncompetitive Inhibition",
        attrs: { level: 3 },
      },
      {
        id: "s1-3-body",
        type: "paragraph",
        text: "Uncompetitive inhibitors bind only the enzyme–substrate complex.",
      },
      {
        id: "s1-3-list",
        type: "list",
        text: "Km decreases\nVmax decreases\nExamples: lithium, glyphosate",
      },
      {
        id: "s2",
        type: "heading",
        text: "2. Irreversible Inhibition",
        attrs: { level: 2 },
      },
      {
        id: "s2-body",
        type: "paragraph",
        text: "Irreversible inhibitors form covalent bonds with the enzyme, permanently disabling catalytic activity. They often target active-site residues and cannot be displaced by raising substrate concentration. Classic examples include aspirin (COX), nerve agents, and penicillin.",
      },
      {
        id: "s3",
        type: "heading",
        text: "3. Clinical Relevance",
        attrs: { level: 2 },
      },
      {
        id: "s3-body",
        type: "paragraph",
        text: "Many drugs exploit inhibition mechanisms.",
      },
    ],
  };
}

describe("document contentPatch section rewrite", () => {
  it("finds section 2 by numbered heading without including section 3", () => {
    const content = enzymeInhibitorsNotes();
    const range = findDocumentSectionRange(content, 2);
    expect(range).toMatchObject({
      headingIndex: 7,
      bodyStart: 8,
      bodyEnd: 9,
      headingId: "s2",
    });
  });

  it("resolves id-based block paths to numeric indices", () => {
    const content = enzymeInhibitorsNotes();
    expect(resolveDocumentPatchPath(content, "/blocks/id:s1-3/text")).toBe(
      "/blocks/4/text",
    );
    expect(resolveDocumentPatchPath(content, "/blocks/byId/s2-body/text")).toBe(
      "/blocks/8/text",
    );
  });

  it("reads the saved value through the same stable-id path used on apply", () => {
    const content = enzymeInhibitorsNotes();
    const next = applyResolvedContentPatch(content, {
      changes: [
        {
          path: "/blocks/id:s1-3-body/text",
          value: "A precise collaborative edit.",
        },
      ],
    });

    expect(
      readResolvedContentPointer(next, "/blocks/id:s1-3-body/text"),
    ).toBe("A precise collaborative edit.");
  });

  it("remaps a mis-aimed section-2 rewrite so heading 1.3 survives", () => {
    const content = enzymeInhibitorsNotes();
    const irreversibleProse =
      "Irreversible inhibitors covalently disable enzymes and cannot be outcompeted by substrate; examples include aspirin and penicillin.";
    const concise =
      "Irreversible inhibitors covalently disable enzymes (e.g. aspirin, penicillin).";

    // Model mistakenly writes the new body onto 1.3's heading and also patches
    // section 2 — the historical E-03 Alarming shape ("updated 2 regions").
    const rawChanges = [
      { path: "/blocks/4/text", value: irreversibleProse },
      { path: "/blocks/8/text", value: concise },
    ];

    const remapped = remapDocumentSectionRewriteChanges(
      content,
      "rewrite section 2 more concisely",
      rawChanges,
    );

    expect(remapped.every((change) => !change.path.startsWith("/blocks/4"))).toBe(
      true,
    );
    expect(remapped.some((change) => change.path === "/blocks/8/text")).toBe(
      true,
    );

    const next = applyResolvedContentPatch(content, { changes: remapped }) as {
      blocks: Array<{ id: string; type: string; text: string }>;
    };

    expect(next.blocks[4]).toMatchObject({
      id: "s1-3",
      type: "heading",
      text: "1.3 Uncompetitive Inhibition",
    });
    expect(next.blocks[5]).toMatchObject({
      id: "s1-3-body",
      text: "Uncompetitive inhibitors bind only the enzyme–substrate complex.",
    });
    expect(next.blocks[6]).toMatchObject({
      id: "s1-3-list",
      text: "Km decreases\nVmax decreases\nExamples: lithium, glyphosate",
    });
    expect(next.blocks[7]).toMatchObject({
      id: "s2",
      type: "heading",
      text: "2. Irreversible Inhibition",
    });
    expect(next.blocks[8]?.text).toBe(concise);
    expect(
      next.blocks.filter((block) =>
        /irreversible inhibitors covalently/i.test(block.text),
      ),
    ).toHaveLength(1);
  });

  it("prefers heading-id paths when rewriting only section 2 body", () => {
    const content = enzymeInhibitorsNotes();
    const concise =
      "Irreversible inhibitors covalently bind and permanently disable enzymes.";
    const remapped = remapDocumentSectionRewriteChanges(
      content,
      "rewrite section 2 more concisely",
      [{ path: "/blocks/id:s2-body/text", value: concise }],
    );
    const next = applyResolvedContentPatch(content, {
      changes: remapped,
    }) as { blocks: Array<{ id: string; text: string }> };

    expect(next.blocks.find((block) => block.id === "s1-3")?.text).toBe(
      "1.3 Uncompetitive Inhibition",
    );
    expect(next.blocks.find((block) => block.id === "s2-body")?.text).toBe(
      concise,
    );
  });

  it("appends with JSON Pointer '-' for deck/quiz list growth", () => {
    const content = {
      cards: [
        { id: "c1", front: "Q1", back: "A1" },
        { id: "c2", front: "Q2", back: "A2" },
      ],
    };
    const next = applyResolvedContentPatch(content, {
      changes: [
        {
          path: "/cards/-",
          value: {
            id: "c3",
            front: "Lineweaver-Burk competitive pattern?",
            back: "Lines intersect on the y-axis.",
          },
        },
      ],
    }) as { cards: Array<{ id: string }> };
    expect(next.cards).toHaveLength(3);
    expect(next.cards[2]?.id).toBe("c3");
  });

  it("appends a final document block with JSON Pointer '-'", () => {
    const content = {
      blocks: [{ id: "intro", type: "paragraph", text: "Existing" }],
    };
    const next = applyResolvedContentPatch(content, {
      changes: [
        {
          path: "/blocks/-",
          value: { id: "tail", type: "paragraph", text: "N8 note" },
        },
      ],
    }) as { blocks: Array<{ id: string; text: string }> };
    expect(next.blocks).toHaveLength(2);
    expect(next.blocks[1]).toEqual({
      id: "tail",
      type: "paragraph",
      text: "N8 note",
    });
  });
});

describe("canonical document tree patches", () => {
  const initial = () => {
    const doc = documentYjsAdapter.createDocument({ blocks: [
      { id: "heading", type: "heading", text: "Original heading", attrs: { level: 2 } },
      { id: "body", type: "paragraph", text: "Original paragraph" },
    ], customMetadata: { keep: true } });
    try { return documentYjsAdapter.project(doc); } finally { doc.destroy(); }
  };

  it("saves a whole-document rewrite made through TipTap text pointers", () => {
    const before = initial();
    const changes = [
      { path: "/tiptap/content/0/content/0/text", value: "Simpler heading" },
      { path: "/tiptap/content/1/content/0/text", value: "Simpler explanation for the reader." },
    ];
    const { content } = resolveArtifactWriteInput("document", before, { contentPatch: { changes } }, "Rewrite the document.");
    for (const change of changes) expect(readResolvedContentPointer(content, change.path)).toBe(change.value);
    expect(readResolvedContentPointer(content, "/blocks/1/text")).toBe(changes[1]!.value);
    expect(readResolvedContentPointer(content, "/outline/0/title")).toBe("Simpler heading");
    expect(before.blocks?.[1]?.text).toBe("Original paragraph");
  });

  it.each([true, false])("applies mixed block/tree pointers in their submitted order (%s)", (treeFirst) => {
    const tree = { path: "/tiptap/content/1/content/0/text", value: "Tree edit" };
    const block = { path: "/blocks/id:body/text", value: "Block edit" };
    const changes = treeFirst ? [tree, block] : [block, tree];
    const { content } = resolveArtifactWriteInput("document", initial(), { contentPatch: { changes } }, "Edit the paragraph.");
    expect(readResolvedContentPointer(content, "/blocks/1/text")).toBe(changes[1]!.value);
    expect(readResolvedContentPointer(content, "/tiptap/content/1/content/0/text")).toBe(changes[1]!.value);
  });

  it("keeps a replaced rich subtree and its marks through a Yjs reload", () => {
    const before = initial();
    const node = { type: "paragraph", attrs: { blockId: "body" }, content: [
      { type: "text", text: "Rewritten and bold", marks: [{ type: "bold" }] },
    ] };
    const { content } = resolveArtifactWriteInput("document", before, {
      contentPatch: { changes: [{ path: "/tiptap/content/1", value: node }] },
    }, "Rewrite and format the paragraph.");
    const doc = documentYjsAdapter.createDocument(content as ReturnType<typeof initial>);
    try {
      const saved = documentYjsAdapter.project(doc);
      expect(readResolvedContentPointer(saved, "/tiptap/content/1")).toMatchObject(node);
      expect(readResolvedContentPointer(saved, "/blocks/1/text")).toBe("Rewritten and bold");
      expect(saved.customMetadata).toEqual({ keep: true });
    } finally { doc.destroy(); }
  });

  it("refreshes block identities and outline after a whole tree replacement", () => {
    const before = initial();
    const tree = { type: "doc", content: [{ type: "heading", attrs: { blockId: "new-heading", level: 1 },
      content: [{ type: "text", text: "New structure" }] }] };
    const { content } = resolveArtifactWriteInput("document", before, {
      contentPatch: { changes: [{ path: "/tiptap", value: tree }] },
    }, "Rewrite the whole document.");
    expect(readResolvedContentPointer(content, "/blocks/0/id")).toBe("new-heading");
    expect(readResolvedContentPointer(content, "/outline/0/id")).toBe("new-heading");
    expect(readResolvedContentPointer(content, "/blocks")).toHaveLength(1);
  });
});
