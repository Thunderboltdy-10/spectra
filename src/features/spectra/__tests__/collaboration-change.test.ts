import { describe, expect, it } from "vitest";
import { isLocalCollaborativeDocumentChange } from "../editor/collaboration-change";

describe("isLocalCollaborativeDocumentChange", () => {
  it("accepts a local document-changing transaction", () => {
    expect(
      isLocalCollaborativeDocumentChange({
        docChanged: true,
        getMeta: () => undefined,
      }),
    ).toBe(true);
  });

  it("rejects remote Yjs hydration", () => {
    expect(
      isLocalCollaborativeDocumentChange({
        docChanged: true,
        getMeta: () => ({ isChangeOrigin: true }),
      }),
    ).toBe(false);
  });

  it("rejects selection-only transactions", () => {
    expect(
      isLocalCollaborativeDocumentChange({
        docChanged: false,
        getMeta: () => undefined,
      }),
    ).toBe(false);
  });
});
