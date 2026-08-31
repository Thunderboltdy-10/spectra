import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  commitAiYjsAfterNativePromotion,
  isNativeContentRegion,
  linkedOfficeKind,
  promoteNativeAiContent,
} from "../ai/native-ai-promotion";

describe("native AI promotion", () => {
  it("refuses Yjs apply when native promotion fails first", async () => {
    const document = new Y.Doc();
    const text = document.getText("body");
    text.insert(0, "human");
    let applied = false;
    await expect(
      commitAiYjsAfterNativePromotion({
        document,
        apply: () => {
          applied = true;
          text.insert(text.length, " P5V1-NATIVE-AI");
        },
        origin: { kind: "spectra-ai-operation" },
        desired: {
          title: "Exercises",
          tags: [],
          content: { blocks: [{ id: "p1", text: "human P5V1-NATIVE-AI" }] },
        },
        changedRegionIds: ["docx:paragraph:unique"],
        beforeCommit: async () => {
          throw new Error(
            "NATIVE_PROMOTION_REFUSED: Recovery exhausted. The native region is not uniquely identifiable.",
          );
        },
      }),
    ).rejects.toThrow(/NATIVE_PROMOTION_REFUSED/);
    expect(applied).toBe(false);
    expect(text.toString()).toBe("human");
  });

  it("applies Yjs exactly once after verified promotion", async () => {
    const document = new Y.Doc();
    const text = document.getText("body");
    text.insert(0, "human");
    let promotions = 0;
    let applies = 0;
    await commitAiYjsAfterNativePromotion({
      document,
      apply: () => {
        applies += 1;
        text.insert(text.length, " P5V1-NATIVE-AI");
      },
      origin: { kind: "spectra-ai-operation" },
      desired: {
        title: "Exercises",
        tags: [],
        content: { blocks: [{ id: "p1", text: "human P5V1-NATIVE-AI" }] },
      },
      changedRegionIds: ["docx:paragraph:unique"],
      beforeCommit: async () => {
        expect(text.toString()).toBe("human");
        promotions += 1;
      },
    });
    expect(promotions).toBe(1);
    expect(applies).toBe(1);
    expect(text.toString()).toBe("human P5V1-NATIVE-AI");
  });

  it("treats only non-metadata regions as native content", () => {
    expect(isNativeContentRegion("docx:paragraph:8ec63636")).toBe(true);
    expect(isNativeContentRegion("xlsx:sheet:1:A1")).toBe(true);
    expect(isNativeContentRegion("metadata:title")).toBe(false);
    expect(linkedOfficeKind("docx")).toBe("docx");
    expect(linkedOfficeKind("xlsx")).toBe("office");
    expect(linkedOfficeKind("pptx")).toBe("office");
    expect(linkedOfficeKind("spectra-native")).toBeNull();
  });

  it("refuses DOCX conflict, unchanged, cloud-only, and protected-pending without success", async () => {
    for (const queued of [
      { state: "conflicted", conflict: { message: "Both copies changed." } },
      { state: "unchanged", hash: "aa" },
      { state: "cloud_saved", hash: "bb" },
      { state: "protected-pending", requestId: "protected-original" },
    ]) {
      await expect(
        promoteNativeAiContent({
          workId: "work-docx",
          blueprintKey: "document",
          nativeFormat: "docx",
          content: { blocks: [] },
          deps: {
            materializeDocx: async () => queued,
            materializeOffice: async () => {
              throw new Error("office materializer must not run for docx");
            },
            query: async () => {
              throw new Error("status must not be polled for a terminal refusal");
            },
            mutate: async () => {
              throw new Error("cancel must not run for a terminal refusal");
            },
          },
        }),
      ).rejects.toThrow(/NATIVE_PROMOTION_/);
    }
  });

  it("waits through DOCX pending until verified", async () => {
    const states = ["pending", "claimed", "verified"] as const;
    let polls = 0;
    const result = await promoteNativeAiContent({
      workId: "work-docx",
      blueprintKey: "document",
      nativeFormat: "docx",
      content: { blocks: [{ id: "p1", text: "ok" }] },
      deps: {
        materializeDocx: async (_workId, _content, options) => {
          expect(options?.promotionMode).toBe("verified-first");
          return { state: "pending", requestId: "req-docx", hash: "cc" };
        },
        materializeOffice: async () => {
          throw new Error("office materializer must not run for docx");
        },
        query: async () => {
          const state = states[Math.min(polls, states.length - 1)]!;
          polls += 1;
          return { requestId: "req-docx", state };
        },
        mutate: async () => ({ cancelled: false, state: "pending" }),
        sleep: async () => undefined,
        now: (() => {
          let t = 0;
          return () => {
            t += 1;
            return t;
          };
        })(),
      },
    });
    expect(result.state).toBe("verified");
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it("waits through Office pending until verified", async () => {
    const result = await promoteNativeAiContent({
      workId: "work-xlsx",
      blueprintKey: "sheets",
      nativeFormat: "xlsx",
      content: { sheets: [] },
      deps: {
        materializeDocx: async () => {
          throw new Error("docx materializer must not run for xlsx");
        },
        materializeOffice: async (_workId, _content, options) => {
          expect(options?.promotionMode).toBe("verified-first");
          return { state: "pending", requestId: "req-xlsx", hash: "dd" };
        },
        query: async () => ({ requestId: "req-xlsx", state: "verified" as const }),
        mutate: async () => ({ cancelled: false, state: "verified" }),
        sleep: async () => undefined,
        now: () => 1,
      },
    });
    expect(result.state).toBe("verified");
  });

  it("cancels a pending request on abort and never treats claimed abort as silent success", async () => {
    const cancelled: string[] = [];
    const signal = AbortSignal.abort(new DOMException("stopped", "AbortError"));
    await expect(
      promoteNativeAiContent({
        workId: "work-docx",
        blueprintKey: "document",
        nativeFormat: "docx",
        content: { blocks: [] },
        signal,
        deps: {
          materializeDocx: async () => ({
            state: "pending",
            requestId: "req-pending",
          }),
          query: async () => ({
            requestId: "req-pending",
            state: "pending" as const,
          }),
          mutate: async (name, args) => {
            cancelled.push(`${name}:${(args as { requestId: string }).requestId}`);
            return { cancelled: true, state: "failed" };
          },
          sleep: async () => undefined,
          now: () => 1,
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toEqual(["replicas:cancelMaterialization:req-pending"]);

    let polls = 0;
    const claimed = await promoteNativeAiContent({
      workId: "work-docx",
      blueprintKey: "document",
      nativeFormat: "docx",
      content: { blocks: [] },
      signal,
      deps: {
        materializeDocx: async () => ({
          state: "pending",
          requestId: "req-claimed",
        }),
        query: async () => {
          polls += 1;
          return {
            requestId: "req-claimed",
            state: (polls === 1 ? "claimed" : "verified") as "claimed" | "verified",
          };
        },
        mutate: async () => {
          throw new Error("claimed writes must not be cancelled");
        },
        sleep: async () => undefined,
        now: (() => {
          let t = 0;
          return () => {
            t += 1;
            return t;
          };
        })(),
      },
    });
    expect(claimed.state).toBe("verified");
  });
});
