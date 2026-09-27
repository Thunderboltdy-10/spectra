import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { getBlueprint } from "../artifacts/blueprint-catalog";
import type { ArtifactTypeKey } from "../artifacts/types";
import {
  ARTIFACT_YJS_META_MAP,
  planArtifactYjsMutation,
  planArtifactYjsRestore,
  readArtifactYjsDocument,
} from "../collaboration/artifact-yjs-model";
import {
  NATIVE_WORK_LIVE_META_MAP,
  planNativeArtifactYjsMutation,
  planNativeArtifactYjsRestore,
  readNativeArtifactYjsDocument,
} from "../work/models/yjs/native-artifact-model";

const actor = { kind: "human" as const, clientId: "restore-preparation", accountId: "owner" };

describe("history restore preparation", () => {
  it.each(["document", "sheets", "presentation", "whiteboard"] as ArtifactTypeKey[])(
    "prepares native %s without effects and preserves later unselected metadata",
    typeKey => {
      const document = new Y.Doc();
      try {
        const current = { title: "Current", summary: "Current summary", tags: ["current"],
          content: structuredClone(getBlueprint(typeKey)!.defaultContent) };
        document.transact(planNativeArtifactYjsMutation(document, typeKey, current, actor).apply);
        const before = Y.encodeStateAsUpdate(document);
        const plan = planNativeArtifactYjsRestore(document, typeKey,
          { ...current, title: "Historical", summary: "Historical summary", tags: ["historical"] }, actor, ["metadata:title"]);
        expect(Y.encodeStateAsUpdate(document)).toEqual(before);
        document.getMap(NATIVE_WORK_LIVE_META_MAP).set("summary", "Later collaborator summary");
        document.transact(plan.apply);
        expect(readNativeArtifactYjsDocument(document, typeKey)).toMatchObject({
          title: "Historical", summary: "Later collaborator summary", tags: ["current"],
        });
        const committed = Y.encodeStateAsUpdate(document);
        expect(() => planNativeArtifactYjsRestore(document, typeKey, current, actor, ["metadata:unknown"]))
          .toThrow("NATIVE_PARTIAL_RESTORE_STRUCTURE_CHANGED");
        expect(Y.encodeStateAsUpdate(document)).toEqual(committed);
      } finally { document.destroy(); }
    },
  );

  it("prepares a legacy selection without effects or overwriting later unselected metadata", () => {
    const document = new Y.Doc();
    try {
      const current = { title: "Current", summary: "Current summary", tags: ["current"],
        content: structuredClone(getBlueprint("whiteboard")!.defaultContent) };
      document.transact(planArtifactYjsMutation(document, "whiteboard", current).apply);
      const before = Y.encodeStateAsUpdate(document);
      const plan = planArtifactYjsRestore(document, "whiteboard", { ...current, title: "Historical" }, ["metadata:title"]);
      expect(Y.encodeStateAsUpdate(document)).toEqual(before);
      document.getMap(ARTIFACT_YJS_META_MAP).set("summary", "Later collaborator summary");
      document.transact(plan.apply);
      expect(readArtifactYjsDocument(document, "whiteboard")).toMatchObject({
        title: "Historical", summary: "Later collaborator summary", tags: ["current"],
      });
      const committed = Y.encodeStateAsUpdate(document);
      expect(() => planArtifactYjsRestore(document, "whiteboard", current, ["metadata:unknown"]))
        .toThrow("ARTIFACT_PARTIAL_RESTORE_STRUCTURE_CHANGED");
      expect(Y.encodeStateAsUpdate(document)).toEqual(committed);
    } finally { document.destroy(); }
  });
});
