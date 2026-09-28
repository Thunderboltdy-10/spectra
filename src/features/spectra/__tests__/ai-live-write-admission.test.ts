import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { initializeNativeArtifactDocument } from "../../../../scripts/collaboration-native-projection.mjs";
import { stateVectorHash } from "../../../../scripts/collaboration-canonical-room.mjs";
import type { AdmittedAiCommit } from "../ai/admitted-ai-update";

vi.mock("server-only", () => ({}));

const seams = vi.hoisted(() => ({
  query: vi.fn(), mutation: vi.fn(), commit: vi.fn(), bridge: vi.fn(),
  authored: [] as Uint8Array[], stored: null as null | { roomId: string; nextSequence: number;
    liveStateVectorHash: string; updates: { sequence: number; update: string }[] },
}));

vi.mock("@/lib/convex-server", () => ({ convexQuery: seams.query, convexMutation: seams.mutation }));
vi.mock("@/lib/native-ai-commit-server", () => ({ commitPreparedNativeAiRequest: seams.commit }));
vi.mock("@/lib/env", () => ({ getConvexUrl: () => "https://convex.invalid" }));
vi.mock("@/lib/collaboration-token", () => ({
  collaborationDocumentName: () => "artifact:root", collaborationProtocolVersion: () => 1,
  signCollaborationSession: async () => "token",
}));
vi.mock("../../../../scripts/collaboration-gateway-bridge-client.mjs", () => ({
  createCollaborationGatewayBridgeClient: () => seams.bridge,
}));
vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    synced = true;
    isAuthenticated = true;
    hasUnsyncedChanges = false;
    document: Y.Doc;
    private user: unknown;
    private readonly options: { document: Y.Doc; onStateless?: (event: { payload: string }) => void };
    awareness = {
      getLocalState: () => (this.user === undefined ? null : { user: this.user }),
      getStates: () => new Map<unknown, { user?: unknown }>(),
      on: () => undefined,
      off: () => undefined,
    };
    constructor(options: { document: Y.Doc; onStateless?: (event: { payload: string }) => void }) {
      this.options = options;
      this.document = options.document;
      for (const row of seams.stored!.updates) Y.applyUpdate(this.document, Buffer.from(row.update, "base64"), this);
      // Anything the worker authors on its own socket is a live write the
      // gateway would append outside the admission transaction.
      this.document.on("update", (update: Uint8Array, origin: unknown) => {
        if (origin !== this) seams.authored.push(update);
      });
    }
    setAwarenessField(field: string, value: unknown) { if (field === "user") this.user = value; }
    flushPendingUpdates() {
      const documentHash = createHash("sha256").update(Y.encodeStateAsUpdate(this.document)).digest("hex");
      queueMicrotask(() => this.options.onStateless?.({ payload: JSON.stringify({ type: "spectra.durable_ack", documentHash }) }));
    }
    sendStateless() {}
    destroy() {}
  },
}));

const before = { title: "Work", tags: [] as string[], content: { blocks: [{ id: "p", type: "paragraph", text: "First paragraph" }] } };
const edited = { blocks: [{ id: "p", type: "paragraph", text: "Edited paragraph" }] };

function seedRoom() {
  const document = new Y.Doc();
  initializeNativeArtifactDocument(document, { ...before, typeKey: "document", schemaVersion: 4 });
  seams.stored = { roomId: "room", nextSequence: 2, liveStateVectorHash: stateVectorHash(document),
    updates: [{ sequence: 1, update: Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64") }] };
  document.destroy();
}

function head(committedResult: AdmittedAiCommit | null = null) {
  return { accountId: "account", artifact: { _id: "artifact", blueprintKey: "document", schemaVersion: 4,
    updatedAt: 100, contentHash: "physical" }, operationDigest: "operation-digest", prompt: "Edit the paragraph",
  operation: { id: "operation", type: "artifact.update", input: { artifactId: "artifact", content: edited } },
  sourceContentIdentity: "source", room: { _id: "room", nextSequence: 2, policyVersion: 3 }, committedResult };
}

let currentHead: ReturnType<typeof head> | Error;

beforeEach(() => {
  vi.clearAllMocks();
  seams.authored = [];
  seedRoom();
  currentHead = head();
  seams.bridge.mockImplementation(async (operation: string) => {
    if (operation === "load") return seams.stored;
    throw new Error(`unexpected bridge ${operation}`);
  });
  seams.query.mockImplementation(async (name: string) => {
    if (name === "identity:me") return { accountId: "account", schoolId: "school", name: "Owner" };
    if (name === "spectraArtifacts:get") return { _id: "artifact", blueprintKey: "document", schemaVersion: 4,
      title: before.title, tags: before.tags, content: before.content };
    if (name === "authority:access") return { allowed: true, level: "modify" };
    if (name === "replicas:forWork") return { replicas: [] };
    if (name === "nativeAiCommit:head") {
      if (currentHead instanceof Error) throw currentHead;
      return currentHead;
    }
    throw new Error(`unexpected query ${name}`);
  });
  seams.mutation.mockImplementation(async (name: string) => {
    if (name === "collaboration:ensureRoom") return { roomId: "room", policyVersion: 3, schemaVersion: 4 };
    if (name === "regionClaims:acquire") return { claimId: "claim", status: "active", leaseExpiresAt: Date.now() + 60_000 };
    return {};
  });
  seams.commit.mockImplementation(async (request: { append: { update: string } }) => {
    const bytes = Buffer.from(request.append.update, "base64");
    return { state: "committed", duplicate: false,
      receipt: { roomId: "room", sequence: 2, updateDigest: createHash("sha256").update(bytes).digest("hex"), nativeResult: null },
      admitted: { encoding: "inline", updateBase64: bytes.toString("base64") } } satisfies AdmittedAiCommit;
  });
});

async function apply(extra: Record<string, unknown> = {}) {
  const { applyAiArtifactMutation } = await import("../ai/yjs-artifact-operation");
  return applyAiArtifactMutation({ artifactId: "artifact", runId: "run", executionId: "attempt", operationId: "operation",
    prompt: "Edit the paragraph", resolveDesired: (current) => ({ ...current, content: edited }), ...extra });
}

describe("AI writes to live artifacts without a native binding", () => {
  it("are admitted once through the signed sink and never authored on the live socket", async () => {
    const result = await apply();
    expect(seams.commit).toHaveBeenCalledTimes(1);
    const request = seams.commit.mock.calls[0]![0] as Record<string, unknown> & { append: { actorKind: string } };
    expect(request).toMatchObject({ aiOperation: { runId: "run", executionId: "attempt", operationId: "operation" },
      append: { actorKind: "ai", expectedNextSequence: 2 } });
    expect(request.nativeCandidate).toBeUndefined();
    expect(seams.authored).toEqual([]);
    expect(seams.mutation.mock.calls.map(call => call[0])).not.toContain("changeGroups:checkpointBeforeAi");
    expect(result).toMatchObject({ changedRegionIds: expect.any(Array), acceptedFrontier: { sequence: 2 } });
    expect(JSON.stringify("acceptedFrontier" in result ? result.acceptedFrontier?.after.content : null)).toContain("Edited paragraph");
  });

  it("replays an acknowledged save's receipt on retry instead of writing again", async () => {
    const document = new Y.Doc();
    for (const row of seams.stored!.updates) Y.applyUpdate(document, Buffer.from(row.update, "base64"));
    const vector = Y.encodeStateVector(document);
    initializeNativeArtifactDocument(document, { ...before, content: edited, typeKey: "document", schemaVersion: 4 });
    const bytes = Y.encodeStateAsUpdate(document, vector);
    document.destroy();
    currentHead = head({ state: "committed", duplicate: true,
      receipt: { roomId: "room", sequence: 2, updateDigest: createHash("sha256").update(bytes).digest("hex"), nativeResult: null },
      admitted: { encoding: "inline", updateBase64: Buffer.from(bytes).toString("base64") } });
    const result = await apply();
    expect(result).toMatchObject({ duplicate: true, changedRegionIds: [] });
    expect(seams.commit).not.toHaveBeenCalled();
    expect(seams.authored).toEqual([]);
    expect(seams.mutation.mock.calls.map(call => call[0])).not.toContain("regionClaims:acquire");
  });

  it("keep a live reference placement on its own receipt instead of the artifact-write head", async () => {
    // The head is scoped to artifact create/update operations; an application
    // command's operation is refused there exactly like production.
    currentHead = new Error("AI_ARTIFACT_OPERATION_NOT_OWNED");
    const guard = vi.fn(async () => undefined);
    await apply({ beforeCommit: guard, receipt: "placement" });
    expect(guard).toHaveBeenCalledTimes(1);
    expect(seams.query.mock.calls.map(call => call[0])).not.toContain("nativeAiCommit:head");
    expect(seams.commit).not.toHaveBeenCalled();
    expect(seams.authored.length).toBeGreaterThan(0);
  });
});

