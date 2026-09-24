import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  commitAiYjsAfterNativeQueue,
  isNativeContentRegion,
  linkedOfficeKind,
  promoteNativeAiContent,
  type NativePromotionDeps,
} from "../ai/native-ai-promotion";

describe("native AI promotion", () => {
  it("does not apply the collaborative edit when durable queue registration fails", async () => {
    const document = new Y.Doc();
    const text = document.getText("body");
    text.insert(0, "base");
    let applied = false;

    await expect(
      commitAiYjsAfterNativeQueue({
        document,
        apply: () => {
          applied = true;
          text.insert(text.length, " + edit");
        },
        origin: { kind: "spectra-ai-operation" },
        desired: {
          title: "Exercises",
          tags: [],
          content: { blocks: [{ id: "p1", text: "base + edit" }] },
        },
        changedRegionIds: ["docx:paragraph:p1"],
        beforeCommit: async () => {
          throw new Error("NATIVE_PROMOTION_REFUSED: queue unavailable");
        },
      }),
    ).rejects.toThrow(/NATIVE_PROMOTION_REFUSED/);

    expect(applied).toBe(false);
    expect(text.toString()).toBe("base");
  });

  it("commits Yjs after a durable Office-locked write is queued", async () => {
    const document = new Y.Doc();
    const text = document.getText("body");
    text.insert(0, "base");
    const order: string[] = [];

    await commitAiYjsAfterNativeQueue({
      document,
      apply: () => {
        order.push("yjs");
        text.insert(text.length, " + accepted");
      },
      origin: { kind: "spectra-ai-operation" },
      desired: {
        title: "Exercises",
        tags: [],
        content: { blocks: [{ id: "p1", text: "base + accepted" }] },
      },
      changedRegionIds: ["docx:paragraph:p1"],
      beforeCommit: async () => {
        const queued = await promoteNativeAiContent({
          workId: "work-docx",
          blueprintKey: "document",
          nativeFormat: "docx",
          content: { blocks: [{ id: "p1", text: "base + accepted" }] },
          deps: {
            materializeDocx: async (_workId, _content, options) => {
              expect(options?.promotionMode).toBe("immediate-projection");
              order.push("durable-queue");
              return {
                state: "pending",
                requestId: "req-office-locked",
                status: "Waiting for Office",
              };
            },
            materializeOffice: async () => {
              throw new Error("office materializer must not run for docx");
            },
          },
        });
        expect(queued.state).toBe("pending");
      },
    });

    expect(order).toEqual(["durable-queue", "yjs"]);
    expect(text.toString()).toBe("base + accepted");
  });

  it("applies the materializer's canonical native projection to Yjs", async () => {
    const desired = {
      title: "Exercises",
      tags: [],
      content: { blocks: [{ id: "p1", text: "draft" }] },
    };
    let committed: unknown;

    await commitAiYjsAfterNativeQueue({
      document: new Y.Doc(),
      apply: () => {
        committed = desired.content;
      },
      origin: { kind: "spectra-ai-operation" },
      desired,
      changedRegionIds: ["docx:paragraph:p1"],
      beforeCommit: async ({ desired: target }) => {
        target.content = { blocks: [{ id: "p1", text: "native readback" }] };
      },
    });

    expect(committed).toEqual({
      blocks: [{ id: "p1", text: "native readback" }],
    });
  });

  it("returns immediately for pending work without browser polling or cancellation", async () => {
    let finished = false;
    const deps: NativePromotionDeps = {
      materializeDocx: async () => {
        finished = true;
        return {
          state: "pending",
          requestId: "req-after-refresh",
          status: "Retry scheduled",
        };
      },
    };

    const result = await promoteNativeAiContent({
      workId: "work-docx",
      blueprintKey: "document",
      nativeFormat: "docx",
      content: { blocks: [] },
      deps,
    });

    expect(finished).toBe(true);
    expect(result).toMatchObject({
      state: "pending",
      requestId: "req-after-refresh",
    });
  });

  it("accepts cloud-saved or deferred native projections as Spectra commits", async () => {
    for (const state of ["cloud_saved", "deferred_native"]) {
      const result = await promoteNativeAiContent({
        workId: "work-docx",
        blueprintKey: "document",
        nativeFormat: "docx",
        content: { blocks: [] },
        deps: {
          materializeDocx: async () => ({ state }),
        },
      });
      expect(result.state).toBe(state);
    }
  });

  it("requires verified canonical content before accepting an unchanged native file", async () => {
    await expect(
      promoteNativeAiContent({
        workId: "work-docx",
        blueprintKey: "document",
        nativeFormat: "docx",
        content: { blocks: [] },
        deps: { materializeDocx: async () => ({ state: "unchanged" }) },
      }),
    ).rejects.toThrow(/NATIVE_PROMOTION_UNCHANGED/);

    await expect(
      promoteNativeAiContent({
        workId: "work-docx",
        blueprintKey: "document",
        nativeFormat: "docx",
        content: { blocks: [] },
        deps: {
          materializeDocx: async () => ({
            state: "unchanged",
            projectionContent: { blocks: [] },
          }),
        },
      }),
    ).resolves.toMatchObject({
      state: "unchanged",
      projectionContent: { blocks: [] },
    });
  });

  it("rejects conflicted, failed, and protected native writes", async () => {
    for (const queued of [
      { state: "conflicted", conflict: { message: "Both copies changed." } },
      { state: "failed", status: "The target rejected the write." },
      { state: "protected-pending", requestId: "protected-original" },
    ]) {
      await expect(
        promoteNativeAiContent({
          workId: "work-docx",
          blueprintKey: "document",
          nativeFormat: "docx",
          content: { blocks: [] },
          deps: { materializeDocx: async () => queued },
        }),
      ).rejects.toThrow(/NATIVE_PROMOTION_/);
    }
  });

  it("uses the Office materializer for workbooks and presentations", async () => {
    for (const nativeFormat of ["xlsx", "pptx"]) {
      const result = await promoteNativeAiContent({
        workId: "work-office",
        blueprintKey: nativeFormat === "xlsx" ? "sheets" : "presentation",
        nativeFormat,
        content: {},
        deps: {
          materializeDocx: async () => {
            throw new Error("DOCX materializer must not run for Office formats");
          },
          materializeOffice: async (_workId, _content, options) => {
            expect(options?.promotionMode).toBe("immediate-projection");
            return { state: "pending", requestId: `req-${nativeFormat}` };
          },
        },
      });
      expect(result.state).toBe("pending");
    }
  });

  it("classifies native content and supported Office formats", () => {
    expect(isNativeContentRegion("docx:paragraph:8ec63636")).toBe(true);
    expect(isNativeContentRegion("xlsx:sheet:1:A1")).toBe(true);
    expect(isNativeContentRegion("metadata:title")).toBe(false);
    expect(linkedOfficeKind("docx")).toBe("docx");
    expect(linkedOfficeKind("xlsx")).toBe("office");
    expect(linkedOfficeKind("pptx")).toBe("office");
    expect(linkedOfficeKind("spectra-native")).toBeNull();
  });
});
