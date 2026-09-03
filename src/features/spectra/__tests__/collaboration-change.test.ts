import { describe, expect, it } from "vitest";
import {
  isLocalCollaborativeDocumentChange,
  isYjsOriginDocumentTransaction,
  NATIVE_PROJECTION_TRANSACTION_META,
} from "../editor/collaboration-change";

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

  it("rejects history-less plugin transactions so save echoes cannot re-dirty", () => {
    expect(
      isLocalCollaborativeDocumentChange({
        docChanged: true,
        getMeta: (key) => (key === "addToHistory" ? false : undefined),
      }),
    ).toBe(false);
  });
});

describe("isYjsOriginDocumentTransaction", () => {
  it("allows Keep Word hydrations marked as Yjs origin", () => {
    expect(
      isYjsOriginDocumentTransaction({
        getMeta: () => ({ isChangeOrigin: true }),
      }),
    ).toBe(true);
  });

  it("allows native-projection canvas adoption without treating it as typing", () => {
    expect(
      isYjsOriginDocumentTransaction({
        getMeta: (key) =>
          key === NATIVE_PROJECTION_TRANSACTION_META ? true : undefined,
      }),
    ).toBe(true);
    expect(
      isLocalCollaborativeDocumentChange({
        docChanged: true,
        getMeta: (key) =>
          key === NATIVE_PROJECTION_TRANSACTION_META ? true : undefined,
      }),
    ).toBe(true);
  });

  it("does not treat ordinary local typing as a Yjs hydration", () => {
    expect(
      isYjsOriginDocumentTransaction({
        getMeta: () => undefined,
      }),
    ).toBe(false);
  });
});
