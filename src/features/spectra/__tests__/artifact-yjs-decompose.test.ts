import { describe, expect, it } from "vitest";
import {
  changedArtifactRegionIds,
  decomposeArtifactContent,
  overlayLiveArtifactRecord,
  recomposeArtifactContent,
  snapshotArtifactRegions,
} from "../collaboration/artifact-yjs-model";
import { normalizeArtifactContent } from "../ai/content-normalization";
import { validateArtifactContent } from "../artifacts/registry";

describe("overlayLiveArtifactRecord", () => {
  it("prefers live Yjs title/content/tags over a stale Convex baseline", () => {
    const baseline = {
      _id: "artifact-1",
      blueprintKey: "document",
      title: "Stale title",
      summary: "Stale summary",
      tags: ["old"],
      content: {
        blocks: [
          { id: "b1", type: "heading", text: "Key Takeaways", level: 2 },
        ],
      },
      updatedAt: 1,
    };
    const live = {
      title: "Live title",
      summary: "Live summary",
      tags: ["fresh"],
      content: {
        blocks: [
          { id: "b1", type: "heading", text: "Key Takeaways", level: 2 },
          {
            id: "plant",
            type: "paragraph",
            text: "Enzyme A Km = 12.0 (planted claim)",
          },
        ],
      },
    };
    expect(overlayLiveArtifactRecord(baseline, live)).toEqual({
      ...baseline,
      title: "Live title",
      summary: "Live summary",
      tags: ["fresh"],
      content: live.content,
    });
  });

  it("keeps the Convex baseline when live content is unavailable", () => {
    const baseline = {
      _id: "artifact-1",
      title: "Baseline",
      content: { blocks: [] },
      tags: [],
    };
    expect(overlayLiveArtifactRecord(baseline, null)).toBe(baseline);
    expect(overlayLiveArtifactRecord(baseline, undefined)).toBe(baseline);
  });
});

describe("decomposeArtifactContent", () => {
  it("snapshots optional undefined region values without failing a mutation", () => {
    const content = {
      questions: [
        {
          id: "question-1",
          type: "multiple_choice",
          prompt: "What do plants use for photosynthesis?",
          options: ["Light", "Sound", "Wind", "Soil"],
          correctAnswer: "Light",
        },
      ],
    };
    const regions = [
      ...decomposeArtifactContent("quiz", content).descriptors.keys(),
    ];
    expect(() =>
      snapshotArtifactRegions(
        "quiz",
        { title: "Photosynthesis quiz", tags: [], content },
        regions,
      ),
    ).not.toThrow();
  });

  it("does not treat object-key order as a structural document change", () => {
    const stored = {
      blocks: [{ id: "intro", text: "", type: "paragraph" }],
      outline: [],
      tiptap: {
        content: [{ attrs: { blockId: "intro" }, type: "paragraph" }],
        type: "doc",
      },
    };
    const nativeProjection = {
      tiptap: {
        type: "doc",
        content: [{ type: "paragraph", attrs: { blockId: "intro" } }],
      },
      blocks: [{ id: "intro", type: "paragraph", text: "" }],
      outline: [],
    };

    expect(
      changedArtifactRegionIds("document", stored, nativeProjection),
    ).toEqual([]);
  });

  it("attributes native Tiptap text changes to their stable document block", () => {
    const before = {
      blocks: [{ id: "intro", type: "paragraph", text: "" }],
      outline: [],
      tiptap: {
        type: "doc",
        content: [{ type: "paragraph", attrs: { blockId: "intro" } }],
      },
    };
    const after = {
      blocks: [
        {
          id: "intro",
          type: "paragraph",
          text: "Native collaboration remains mergeable.",
        },
      ],
      outline: [],
      tiptap: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { blockId: "intro" },
            content: [
              {
                type: "text",
                text: "Native collaboration remains mergeable.",
              },
            ],
          },
        ],
      },
    };

    expect(changedArtifactRegionIds("document", before, after)).toEqual([
      "intro",
    ]);
  });

  it("decomposes sheets that omit optional identity maps without throwing", () => {
    // Schema allows missing rowIdentities/columnIdentities, but region paths
    // still address them. Decompose must materialize those parents.
    const content = {
      workbook: { activeSheetId: "sheet-1" },
      sheets: [
        {
          id: "sheet-1",
          name: "Km data",
          rowCount: 20,
          columnCount: 8,
          cells: {
            A1: { value: "Inhibitor" },
            B1: { value: "Km" },
            A2: { value: "None" },
            B2: { value: 1.2 },
          },
        },
      ],
    };

    expect(() => decomposeArtifactContent("sheets", content)).not.toThrow();
    const decomposed = decomposeArtifactContent("sheets", content);
    expect(decomposed.descriptors.size).toBeGreaterThan(3);
    expect(
      [...decomposed.descriptors.values()].some(
        (entry) => entry.kind === "sheet_cell",
      ),
    ).toBe(true);
  });

  it("round-trips sparse sheets through recompose + normalize without Zod string misses", () => {
    const content = {
      workbook: { calculationMode: "automatic" as const },
      activeSheetId: "sheet-1",
      sheets: [
        {
          id: "sheet-1",
          name: "Km data",
          cells: {
            A1: { value: "Inhibitor" },
            B2: { value: 1.2 },
          },
        },
      ],
    };
    const decomposed = decomposeArtifactContent("sheets", content);
    const recomposed = recomposeArtifactContent(
      decomposed.rootTemplate,
      decomposed.regionValues,
    );
    // Live trees often leave identity slots as undefined after expand.
    const sheet0 = (recomposed as { sheets: Array<Record<string, unknown>> })
      .sheets[0]!;
    expect(sheet0.rowIdentities).toBeTruthy();

    const coerced = normalizeArtifactContent("sheets", recomposed);
    const validation = validateArtifactContent("sheets", coerced);
    expect(validation.success).toBe(true);
    if (!validation.success) return;
    const identities =
      (
        validation.data as {
          sheets: Array<{ rowIdentities?: Record<string, string> }>;
        }
      ).sheets[0]!.rowIdentities ?? {};
    expect(
      Object.values(identities).every((id) => typeof id === "string"),
    ).toBe(true);
  });
});
