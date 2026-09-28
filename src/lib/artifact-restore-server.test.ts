import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { planNativeArtifactYjsMutation, readNativeArtifactYjsDocument } from "../features/spectra/work/models/yjs/native-artifact-model";
import type { Id } from "../../convex/_generated/dataModel";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";

const calls = vi.hoisted(() => ({ query: vi.fn(), store: vi.fn(), bridge: vi.fn(), mutation: vi.fn(), whole: vi.fn(), partial: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./convex-server", () => ({ convexQuery: calls.query, convexMutation: calls.mutation, storeArtifactContent: calls.store }));
vi.mock("./auth-server", () => ({ requireActor: async () => ({ accountId: "owner" }), isAuthNoSchool: () => false }));
vi.mock("../features/spectra/lenses/native-restore-preparation", () => ({
  prepareWholeNativeHistoryRestore: calls.whole, preparePartialNativeHistoryRestore: calls.partial,
}));
vi.mock("./env", () => ({ getConvexUrl: () => "http://restore-fixture.invalid" }));
vi.mock("../../scripts/collaboration-gateway-bridge-client.mjs", () => ({ createCollaborationGatewayBridgeClient: () => calls.bridge }));
import { admitArtifactRestore, type RestoreRequest } from "./artifact-restore-server";
import { prepareNativeArtifactRestore } from "./artifact-restore-native";
import { POST } from "../app/api/spectra/route";

const request: RestoreRequest = { artifactId: "artifact" as Id<"spectraArtifacts">,
  sourceVersionId: "source" as Id<"spectraArtifactVersions">, requestId: "restore-one", clientId: "client" };
const actor = { clientId: "client", kind: "human" as const };
const committed = { state: "committed", duplicate: false, receipt: { roomId: "room", sequence: 2, versionId: "restored" },
  admitted: { encoding: "replay", roomId: "room", throughSequence: 2 } };

function fixture() {
  const document = new Y.Doc();
  const current = { title: "Current", summary: "Current summary", tags: [], content: { nodes: [], edges: [] } };
  document.transact(planNativeArtifactYjsMutation(document, "whiteboard", current, actor).apply);
  const live = readNativeArtifactYjsDocument(document, "whiteboard")!;
  calls.query.mockResolvedValue({ committed: null, accountId: "owner", artifact: { ...live, blueprintKey: "whiteboard" },
    room: { _id: "room", nextSequence: 2, policyVersion: 0, schemaVersion: 1 }, headHash: "expected-head",
    nativeRequired: false, whole: true, nativeSource: null, replicas: [], source: { ...live, title: "Historical" } });
  calls.store.mockImplementation(async (_id, value) => value);
  const stored = { roomId: "room", nextSequence: 2,
    updates: [{ sequence: 1, update: Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64") }] };
  return { document, stored };
}
beforeEach(() => vi.clearAllMocks());

describe("server history restore admission", () => {
  it("leaves the actual document unchanged until the prepared delta is admitted", async () => {
    const f = fixture();
    const before = Y.encodeStateAsUpdate(f.document);
    let admit!: () => void;
    const pending = new Promise<void>(resolve => { admit = resolve; });
    calls.bridge.mockImplementation(async (operation: string) => {
      if (operation === "load") return f.stored;
      if (operation !== "historyRestore") throw new Error(`Unexpected ${operation}`);
      await pending;
      return committed;
    });
    try {
      const restore = admitArtifactRestore(request, vi.fn());
      await vi.waitFor(() => expect(calls.bridge.mock.calls.some(call => call[0] === "historyRestore")).toBe(true));
      expect(Y.encodeStateAsUpdate(f.document)).toEqual(before);
      const wire = calls.bridge.mock.calls.find(call => call[0] === "historyRestore")![1];
      expect(wire).toMatchObject({ request, expectedHeadHash: "expected-head", append: { actorKind: "human",
        expectedRoomId: "room", expectedNextSequence: 2, idempotencyKey: "restore:restore-one" } });
      admit();
      expect(await restore).toEqual(committed);
      Y.applyUpdate(f.document, Buffer.from(wire.append.update, "base64"));
      expect(readNativeArtifactYjsDocument(f.document, "whiteboard")?.title).toBe("Historical");
    } finally { f.document.destroy(); }
  });

  it("does not retry a stale restore against unseen newer edits", async () => {
    const f = fixture();
    calls.bridge.mockImplementation(async (operation: string) => {
      if (operation === "load") return f.stored;
      f.document.getMap("spectra:work-v2:live-meta").set("title", "New collaborator edit");
      throw new Error("ARTIFACT_RESTORE_STALE");
    });
    try {
      await expect(admitArtifactRestore(request, vi.fn())).rejects.toThrow("ARTIFACT_RESTORE_STALE");
      expect(calls.bridge.mock.calls.filter(call => call[0] === "historyRestore")).toHaveLength(1);
      expect(readNativeArtifactYjsDocument(f.document, "whiteboard")?.title).toBe("New collaborator edit");
    } finally { f.document.destroy(); }
  });

  it("returns the original receipt after a lost response without preparing another delta", async () => {
    calls.query.mockResolvedValue({ committed: { ...committed, duplicate: true } });
    const native = vi.fn();
    expect(await admitArtifactRestore(request, native)).toEqual({ ...committed, duplicate: true });
    expect(calls.bridge).not.toHaveBeenCalled();
    expect(calls.store).not.toHaveBeenCalled();
    expect(native).not.toHaveBeenCalled();
  });

  it("keeps the native source body separate from newer canonical edits", async () => {
    const f = fixture();
    const head = await calls.query();
    calls.query.mockResolvedValue({ ...head, nativeRequired: true, whole: false });
    calls.bridge.mockImplementation(async (operation: string) => operation === "load" ? f.stored : committed);
    const nativeBase = { nativeOnly: "older package projection" };
    const projectionContent = readNativeArtifactYjsDocument(f.document, "whiteboard")!.content;
    try {
      await admitArtifactRestore({ ...request, regionIds: ["metadata:title"] }, vi.fn().mockResolvedValue({
        projectionContent, nativeSource: { hash: "a".repeat(64) }, nativeCandidate: { destination: "bridge",
          queue: { baseContent: nativeBase, baseContentHash: "b".repeat(64), projectionContent, projectionContentHash: "c".repeat(64) } },
      }));
      const wire = calls.bridge.mock.calls.find(call => call[0] === "historyRestore")![1];
      expect(wire.nativeCandidate.queue).toMatchObject({ baseContent: nativeBase, baseContentHash: "b".repeat(64), projectionContent });
      expect(wire.nativeCandidate.queue.baseContent).not.toEqual(JSON.parse(wire.beforeProjectionJson).content);
    } finally { f.document.destroy(); }
  });

  it("wires the HTTP restore action to admission and forwards exact region selection", async () => {
    calls.query.mockResolvedValue({ committed: { ...committed, duplicate: true } });
    const response = await POST(new NextRequest("https://spectra.test/api/spectra", { method: "POST",
      body: JSON.stringify({ action: "commitArtifactRestore", ...request, regionIds: ["metadata:title"] }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "committed", duplicate: true });
    expect(calls.query).toHaveBeenCalledWith("artifactRestore:head", { request: { ...request, regionIds: ["metadata:title"] } });
    expect(calls.mutation).not.toHaveBeenCalled();
  });

  it.each([
    ["ARTIFACT_RESTORE_NATIVE_BASE_LIMIT", /too many computers.*hasn't changed/],
    ["ARTIFACT_RESTORE_NATIVE_SOURCE_UNAVAILABLE", /no longer available.*hasn't changed/],
    ["ARTIFACT_RESTORE_NATIVE_SOURCE_INVALID", /no longer available.*hasn't changed/],
    ["ARTIFACT_RESTORE_NATIVE_BASE_STALE", /New changes arrived/],
    ["ARTIFACT_RESTORE_STALE: New changes arrived.", /New changes arrived/],
  ])("tells the student in plain words why restore %s refused", async (code, copy) => {
    calls.query.mockRejectedValue(new Error(`[Request ID: abc] Server Error Uncaught Error: ${code}`));
    const response = await POST(new NextRequest("https://spectra.test/api/spectra", { method: "POST",
      body: JSON.stringify({ action: "commitArtifactRestore", ...request }) }));
    expect(response.status).toBe(409);
    const text = JSON.stringify(await response.json());
    expect(text).toMatch(copy);
    expect(text).not.toMatch(/ARTIFACT_RESTORE|connection/);
  });

  it("rejects malformed restore regions before preparing or admitting content", async () => {
    const response = await POST(new NextRequest("https://spectra.test/api/spectra", { method: "POST",
      body: JSON.stringify({ action: "commitArtifactRestore", ...request, regionIds: [12] }) }));
    expect(response.status).toBe(400);
    expect(calls.query).not.toHaveBeenCalled();
    expect(calls.bridge).not.toHaveBeenCalled();
  });

  it("uses the exact retained descriptor and verified bytes for whole native restore", async () => {
    const bytes = new TextEncoder().encode("retained native package fixture");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const historicalSource = { sourceVersionId: request.sourceVersionId, payloadRef: "retained-ref", sourcePayloadHash: hash,
      bytes: bytes.length, mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", url: "https://payload.test/exact" };
    const desired = { title: "Historical", tags: [], content: {} };
    const prepared = { state: "prepared", nativeSource: { payloadRef: "current-ref" }, nativeCandidate: { destination: "none" }, projectionContent: { exact: true } };
    calls.whole.mockResolvedValue(prepared);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes));
    try {
      expect(await prepareNativeArtifactRestore({ artifactId: request.artifactId, current: desired, desired, historicalSource }))
        .toMatchObject({ projectionContent: { exact: true }, nativeSource: { payloadRef: "current-ref" } });
      expect(fetch).toHaveBeenCalledWith(historicalSource.url, { cache: "no-store" });
      expect(calls.whole).toHaveBeenCalledWith(request.artifactId, { ...historicalSource, nativeFormat: "docx" }, bytes);
      expect(calls.partial).not.toHaveBeenCalled();
      calls.whole.mockClear();
      fetch.mockResolvedValue(new Response("different bytes"));
      await expect(prepareNativeArtifactRestore({ artifactId: request.artifactId, current: desired, desired, historicalSource }))
        .rejects.toThrow("ARTIFACT_RESTORE_NATIVE_SOURCE_INVALID");
      expect(calls.whole).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });

  it("prepares selected native restore content against the current package", async () => {
    const desired = { title: "Selected", tags: [], content: { merged: true } };
    calls.partial.mockResolvedValue({ state: "prepared", nativeSource: { payloadRef: "current-ref" },
      nativeCandidate: { destination: "none" }, projectionContent: desired.content });
    await prepareNativeArtifactRestore({ artifactId: request.artifactId, current: desired, desired, historicalSource: null,
      regionIds: ["block:one"], nativeFormat: "docx" });
    expect(calls.partial).toHaveBeenCalledWith(request.artifactId, "docx", desired.content);
    expect(calls.whole).not.toHaveBeenCalled();
  });
});
