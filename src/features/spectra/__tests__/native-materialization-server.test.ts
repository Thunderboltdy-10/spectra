import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { QueueMaterializationArgs } from "../../../../convex/replicaMaterialization";
import { queueHumanNativeMaterialization, retainNativeCandidate } from "@/lib/native-materialization-server";
const io = vi.hoisted(() => ({ query: vi.fn(), store: vi.fn(), bridge: vi.fn(), factory: vi.fn() }));
vi.mock("@/lib/convex-server", () => ({ convexQuery: io.query, storeArtifactContent: io.store }));
vi.mock("@/lib/env", () => ({ getConvexUrl: () => "http://localhost:3210" }));
vi.mock("../../../../scripts/collaboration-gateway-bridge-client.mjs", () => ({
  createCollaborationGatewayBridgeClient: io.factory,
}));
const args = (): QueueMaterializationArgs => ({ workId: "work" as Id<"spectraArtifacts">, payloadRef: "result",
  contentHash: "a".repeat(64), baseRevision: "b".repeat(64), fidelityMap: {}, regionIds: ["body"], partNames: [],
  baseContent: { text: "before" }, projectionContent: { text: "after" } });
beforeEach(() => {
  vi.resetAllMocks(); io.factory.mockReturnValue(io.bridge);
  io.query.mockResolvedValue({ accountId: "authenticated-account" });
  io.store.mockImplementation(async (_id, content) => ({ retained: content }));
  io.bridge.mockResolvedValue({ state: "pending", requestId: "request" });
});
describe("trusted native materialization transport", () => {
  it("derives the human identity and retains both bodies before sending a bounded intent", async () => {
    const input = args();
    const result = await queueHumanNativeMaterialization(input);
    expect(io.query).toHaveBeenCalledWith("nativeMaterialization:head", { workId: "work" });
    expect(io.store).toHaveBeenCalledTimes(2);
    expect(io.bridge).toHaveBeenCalledWith("materializeNative", {
      artifactId: "work", accountId: "authenticated-account", partitionKey: "root",
      candidate: { destination: "bridge", queue: { ...input,
        projectionContent: { retained: { text: "after" } }, baseContent: { retained: { text: "before" } } } },
    });
    expect(result).toEqual({ state: "pending", requestId: "request" });
    expect(input.projectionContent).toEqual({ text: "after" });
  });
  it("rejects revoked authority before retaining or signing anything", async () => {
    io.query.mockRejectedValue(new Error("ARTIFACT_FORBIDDEN"));
    await expect(queueHumanNativeMaterialization(args())).rejects.toThrow("ARTIFACT_FORBIDDEN");
    expect(io.store).not.toHaveBeenCalled(); expect(io.bridge).not.toHaveBeenCalled();
  });
  it("does not sign an incomplete retention attempt", async () => {
    io.store.mockRejectedValue(new Error("PAYLOAD_UNAVAILABLE"));
    await expect(queueHumanNativeMaterialization(args())).rejects.toThrow("PAYLOAD_UNAVAILABLE");
    expect(io.bridge).not.toHaveBeenCalled();
  });
  it("does not serialize undefined optional legacy content", async () => {
    const input = args(); delete input.baseContent; delete input.projectionContent;
    expect(await retainNativeCandidate({ destination: "bridge", queue: input })).toMatchObject({ destination: "bridge" });
    expect(io.store).not.toHaveBeenCalled();
  });
  it("detaches a pending transport request from subsequent caller edits", async () => {
    let release!: (value: { accountId: string }) => void;
    io.query.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const input = args(); const pending = queueHumanNativeMaterialization(input);
    input.projectionContent = { text: "new unrelated draft" };
    release({ accountId: "authenticated-account" }); await pending;
    expect(io.store).toHaveBeenCalledWith("work", { text: "after" });
  });
});
