import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createHash } from "node:crypto";
import { planNativeArtifactYjsMutation, readNativeArtifactYjsDocument } from "@/features/spectra/work/models/yjs/native-artifact-model";

const calls = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), store: vi.fn(), bridge: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./convex-server", () => ({ convexQuery: calls.query, convexMutation: calls.mutation, storeArtifactContent: calls.store }));
vi.mock("./env", () => ({ getConvexUrl: () => "http://native-fixture.invalid" }));
vi.mock("../../scripts/collaboration-gateway-bridge-client.mjs", () => ({ createCollaborationGatewayBridgeClient: () => calls.bridge }));
import { reconcileNativeRevision } from "./native-reconciliation-server";
import type { Id } from "../../convex/_generated/dataModel";

const content = (native: string, human: string) => ({ blocks: [
  { id: "native", type: "paragraph", text: native }, { id: "human", type: "paragraph", text: human },
] });
const actor = { clientId: "native-fixture", kind: "human" as const };
const identity = { workId: "artifact" as Id<"spectraArtifacts">, localReplicaId: "local" as Id<"workReplicas">,
  localPayloadRef: "payload", localRevision: "native-new" };
const receipt = { versionId: "version", roomId: "room", sequence: 3, localRevision: "native-new" };
function seed() {
  const document = new Y.Doc();
  const plan = planNativeArtifactYjsMutation(document, "document", { title: "Fixture", tags: [], content: content("before", "before") }, actor);
  document.transact(plan.apply);
  return document;
}
function stored(document: Y.Doc, nextSequence: number) {
  return { roomId: "room", nextSequence,
    liveStateVectorHash: createHash("sha256").update(Y.encodeStateVector(document)).digest("base64url"),
    updates: [{ sequence: 1, update: Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64") }] };
}
function setup(document: Y.Doc) {
  calls.query.mockImplementation(async (name: string) => name === "spectraArtifacts:get" ? { schemaVersion: 2 } : {
    accountId: "owner", roomId: "room", nextSequence: calls.bridge.mock.calls.filter(call => call[0] === "nativeReconcile").length + 2,
    policyVersion: 0, schemaVersion: 2, operationId: "operation", receipt: null,
    artifact: { ...readNativeArtifactYjsDocument(document, "document"), blueprintKey: "document", schemaVersion: 2,
      updatedAt: 1, contentHash: "canonical", currentVersionId: "prior" }, nativeBaseRevision: "native-base", cloudRevision: "native-base",
  });
  calls.store.mockImplementation(async (_artifactId: string, value: unknown) => value);
  calls.mutation.mockResolvedValue({});
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("native server durable-state reconstruction", () => {
  it("repeats the semantic merge against the actual newer durable document after a stale commit", async () => {
    const document = seed();
    setup(document);
    const observedHuman: string[] = [];
    let commits = 0;
    calls.bridge.mockImplementation(async (operation: string) => {
      if (operation === "load") return stored(document, commits + 2);
      if (operation !== "nativeReconcile") throw new Error(`Unexpected ${operation}`);
      if (commits++ === 0) {
        document.transact(planNativeArtifactYjsMutation(document, "document", {
          title: "Fixture", tags: [], content: content("before", "concurrent human"),
        }, actor).apply);
        throw new Error("NATIVE_RECONCILIATION_STALE");
      }
      return { state: "applied", receipt };
    });
    try {
      const result = await reconcileNativeRevision(identity, {
        typeKey: "document", fidelityMap: {}, partNames: [], nativeBaseRevision: "native-base", nativeBasePayloadHash: "base-hash",
        merge(current) {
          const blocks = (current as ReturnType<typeof content>).blocks;
          const human = blocks.find(block => block.id === "human")!.text;
          observedHuman.push(human);
          return { content: content("native edit", human), regionIds: ["native"], conflictRegionIds: [] };
        },
      });
      expect(observedHuman).toEqual(["before", "concurrent human"]);
      expect((result.content as ReturnType<typeof content>).blocks.find(block => block.id === "human")?.text).toBe("concurrent human");
      const requests = calls.bridge.mock.calls.filter(call => call[0] === "nativeReconcile").map(call => call[1]);
      expect(requests.map(request => request.append.expectedNextSequence)).toEqual([2, 3]);
      expect(requests[0].append.baseStateVectorHash).not.toBe(requests[1].append.baseStateVectorHash);
      expect(requests[0].append.idempotencyKey).toBe(requests[1].append.idempotencyKey);
    } finally { document.destroy(); }
  });

  it("does not rebase an explicit conflict choice onto unseen concurrent edits", async () => {
    const document = seed();
    setup(document);
    let commits = 0;
    calls.bridge.mockImplementation(async (operation: string) => {
      if (operation === "load") return stored(document, commits + 2);
      commits += 1;
      document.transact(planNativeArtifactYjsMutation(document, "document", {
        title: "Fixture", tags: [], content: content("before", "new unseen edit"),
      }, actor).apply);
      throw new Error("NATIVE_RECONCILIATION_STALE");
    });
    try {
      await expect(reconcileNativeRevision(identity, { typeKey: "document", fidelityMap: {}, partNames: [],
        nativeBaseRevision: "native-base", nativeBasePayloadHash: "base-hash", resolution: "local",
        merge: () => ({ content: content("keep Office", "before"), regionIds: ["native"], conflictRegionIds: [] }),
      })).rejects.toThrow("EXTERNAL_RESOLUTION_STALE");
      expect(commits).toBe(1);
    } finally { document.destroy(); }
  });

  it("returns a completed receipt without a room load or another mutation", async () => {
    calls.query.mockResolvedValue({ accountId: "owner", operationId: "operation", receipt,
      artifact: { blueprintKey: "document" } });
    const merge = vi.fn();
    const result = await reconcileNativeRevision(identity, { typeKey: "document", fidelityMap: {}, partNames: [],
      nativeBaseRevision: "native-base", nativeBasePayloadHash: "base-hash", merge });
    expect(result).toMatchObject({ state: "applied", duplicate: true, receipt });
    expect(result.content).toBeUndefined();
    expect(merge).not.toHaveBeenCalled();
    expect(calls.bridge).not.toHaveBeenCalled();
    expect(calls.mutation).not.toHaveBeenCalled();
    expect(calls.store).not.toHaveBeenCalled();
  });

  it("accepts the original receipt on the last stale retry without returning the newer candidate", async () => {
    const document = seed();
    setup(document);
    let commits = 0;
    calls.bridge.mockImplementation(async (operation: string) => {
      if (operation === "load") return stored(document, commits + 2);
      if (++commits < 4) throw new Error("NATIVE_RECONCILIATION_STALE");
      return { state: "applied", duplicate: true, receipt };
    });
    try {
      const result = await reconcileNativeRevision(identity, { typeKey: "document", fidelityMap: {}, partNames: [],
        nativeBaseRevision: "native-base", nativeBasePayloadHash: "base-hash",
        merge: () => ({ content: content("candidate", "before"), regionIds: ["native"], conflictRegionIds: [] }),
      });
      expect(commits).toBe(4);
      expect(result).toMatchObject({ duplicate: true, receipt });
      expect(result.content).toBeUndefined();
    } finally { document.destroy(); }
  });

  it("spills a large native delta and immutable projections before the bounded effect envelope", async () => {
    const document = seed();
    setup(document);
    calls.bridge.mockImplementation(async (operation: string, payload: Record<string, unknown>) => {
      if (operation === "load") return stored(document, 2);
      if (operation === "storeDurablePayload") return { payloadRef: `blob-${payload.kind}`, dependencies: payload.dependencies };
      if (operation === "nativeReconcile") return { state: "applied", receipt };
      throw new Error(`Unexpected ${operation}`);
    });
    try {
      const largeText = '"\\large native text '.repeat(55_000);
      await reconcileNativeRevision(identity, { typeKey: "document", fidelityMap: {}, partNames: [],
        nativeBaseRevision: "native-base", nativeBasePayloadHash: "base-hash",
        merge: () => ({ content: content(largeText, "before"), regionIds: ["native"], conflictRegionIds: [] }),
      });
      const request = calls.bridge.mock.calls.find(call => call[0] === "nativeReconcile")![1];
      expect(request.append.update).toBe("");
      expect(request.append.payloadRef).toBe("blob-yjs-update");
      expect(JSON.parse(request.append.projectionJson).content.spectraContentRef.payloadRef).toBe("blob-projection");
      expect(Buffer.byteLength(JSON.stringify({ payloadJson: JSON.stringify(request) }))).toBeLessThan(1400 * 1024);
    } finally { document.destroy(); }
  });
});
