import { describe, expect, it } from "vitest";
import {
  ensureUniqueRecordIds,
  normalizeDocumentContent,
} from "../ai/content-normalization";
import { enumerateArtifactRegions } from "../artifacts/registry";

describe("document region uniqueness", () => {
  it("rewrites duplicate block ids before region enumeration", () => {
    const normalized = normalizeDocumentContent({
      blocks: [
        { id: "b6", type: "paragraph", text: "First" },
        { id: "b6", type: "paragraph", text: "Second" },
        { id: "b7", type: "paragraph", text: "Third" },
      ],
    });
    const ids = (normalized.blocks as Array<{ id: string }>).map(
      (block) => block.id,
    );
    expect(ids).toEqual(["b6", "b6~2", "b7"]);
    expect(() => enumerateArtifactRegions("document", normalized)).not.toThrow();
  });

  it("ensureUniqueRecordIds keeps the first occurrence", () => {
    expect(
      ensureUniqueRecordIds(
        [
          { id: "x", label: "a" },
          { id: "x", label: "b" },
        ],
        "id",
        "row",
      ),
    ).toEqual([
      { id: "x", label: "a" },
      { id: "x~2", label: "b" },
    ]);
  });
});
