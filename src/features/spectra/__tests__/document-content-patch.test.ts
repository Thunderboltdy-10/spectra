import { describe, expect, it } from "vitest";
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
});
