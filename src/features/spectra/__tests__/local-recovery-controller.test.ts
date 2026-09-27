// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { encodeDurableFrontier } from "../../../../shared/collaboration-durable-frontier.mjs";
import type { DurableRoomAnchor } from "../../../../shared/collaboration-recovery.mjs";
import { initializeNativeArtifactDocument } from "../../../../scripts/collaboration-native-projection.mjs";
import {
  BoundedYjsLocalPersistence,
  MemoryYjsStore,
  localRecordGeneration,
} from "../realtime/persistence/local-yjs-persistence";
import { useLocalRecoveryController } from "../collaboration/recovery-controller";
import type { ArtifactCollaborationTransport, RecoveryCurrent } from "../collaboration/types";
import { readNativeArtifactYjsDocument } from "../work/models/yjs/native-artifact-model";

const LIVE_META = "spectra:work-v2:live-meta";
afterEach(() => vi.restoreAllMocks());

const anchorFor = (doc: Y.Doc, nextSequence: number): DurableRoomAnchor => ({ roomId: "room", nextSequence,
  frontierHash: createHash("sha256").update(encodeDurableFrontier(Y, doc)!).digest("hex") });

function nativeBase() {
  const base = new Y.Doc(); base.clientID = 5;
  initializeNativeArtifactDocument(base, { title: "Saved", typeKey: "sheets", schemaVersion: 4, tags: [], content: { sheets: [] } });
  return base;
}

async function fixture() {
  const base = nativeBase();
  if (!readNativeArtifactYjsDocument(base, "sheets")) throw new Error("FIXTURE_NOT_NATIVE");
  const store = new MemoryYjsStore();
  const doc = new Y.Doc(); doc.clientID = 6;
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(base));
  const persistence = new BoundedYjsLocalPersistence({ key: "work:1", document: doc, store, modelVersion: 4, debounceMs: 60_000 });
  await persistence.initialize();
  persistence.markRemoteDurable(anchorFor(doc, 2)); await persistence.persistNow();
  doc.transact(() => doc.getMap(LIVE_META).set("title", "Offline title"), { regionId: "metadata:title" });
  await persistence.persistNow();
  persistence.preserveConflict({ regionIds: ["metadata:title"], nativeOperationId: "native-1" });
  await persistence.persistNow();
  const room = new Y.Doc(); room.clientID = 7;
  Y.applyUpdate(room, Y.encodeStateAsUpdate(base));
  room.getMap(LIVE_META).set("title", "Native title");
  let current: RecoveryCurrent = { update: Y.encodeStateAsUpdate(room), anchor: anchorFor(room, 5), level: "modify" };
  const transport = { clientId: "c", document: doc,
    readRecoveryCurrent: vi.fn(async () => current) } as unknown as ArtifactCollaborationTransport;
  return { base, store, doc, persistence, room, transport,
    setCurrent: (next: RecoveryCurrent) => { current = next; },
    current: () => current,
    destroy: async () => { await persistence.destroy(); base.destroy(); doc.destroy(); room.destroy(); } };
}

describe("local recovery controller", () => {
  it("reviews an active conflicted draft against the exact current room", async () => {
    const f = await fixture();
    const { result } = renderHook(() => useLocalRecoveryController({ typeKey: "sheets", transport: f.transport,
      persistence: f.persistence, durability: f.persistence.getSnapshot(), level: "modify", syncState: "synchronized",
      sessionReady: true, reopen: vi.fn(), restoreRegions: vi.fn() }));
    await waitFor(() => expect(result.current.recovery.state).toBe("review_required"));
    expect(result.current.recovery.activeBranchId).toBe("work:1");
    const inspection = await act(() => result.current.inspectLocalRecovery("work:1"));
    expect(inspection.branch).toMatchObject({ id: "work:1", reason: "native_overlap", regionIds: ["metadata:title"],
      canReadCurrent: true, canReapply: true, currentAnchor: f.current().anchor });
    expect(inspection.previews).toEqual([{ regionId: "metadata:title", label: "Title", draft: "Offline title", current: "Native title" }]);
    // Inspection never writes into the live, quarantined document.
    expect(f.doc.getMap(LIVE_META).get("title")).toBe("Offline title");
    await f.destroy();
  });

  it("refuses a stale current witness and adopts only after the replacement session is ready", async () => {
    const f = await fixture();
    const reopen = vi.fn();
    const props = { transport: f.transport, sessionReady: true };
    const { result, rerender } = renderHook(({ transport, sessionReady }) => useLocalRecoveryController({ typeKey: "sheets",
      transport, persistence: f.persistence, durability: f.persistence.getSnapshot(), level: "modify",
      syncState: "synchronized", sessionReady, reopen, restoreRegions: vi.fn() }), { initialProps: props });
    await waitFor(() => expect(result.current.recovery.branches).toHaveLength(1));
    const branch = result.current.recovery.branches[0]!;
    const reviewed = f.current().anchor;
    const newer = new Y.Doc(); Y.applyUpdate(newer, f.current().update); newer.getMap(LIVE_META).set("summary", "later");
    f.setCurrent({ update: Y.encodeStateAsUpdate(newer), anchor: anchorFor(newer, 6), level: "modify" });
    await expect(result.current.archiveAndAdoptCurrent({ branchId: branch.id, expectedGeneration: branch.generation,
      expectedCurrentAnchor: reviewed })).rejects.toThrow("LOCAL_RECOVERY_CURRENT_CHANGED");
    expect(reopen).not.toHaveBeenCalled();
    let settled = false;
    const adoption = result.current.archiveAndAdoptCurrent({ branchId: branch.id, expectedGeneration: branch.generation,
      expectedCurrentAnchor: f.current().anchor }).then(value => { settled = true; return value; });
    await waitFor(() => expect(reopen).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    const replacement = { ...f.transport } as ArtifactCollaborationTransport;
    rerender({ transport: replacement, sessionReady: true });
    const adopted = await adoption;
    expect(adopted.archivedBranchId.startsWith("work:1:recovery:")).toBe(true);
    await waitFor(() => expect(result.current.recovery.adoptionId).toBe(adopted.adoptionId));
    const head = await f.store.get("work:1");
    expect(head).toMatchObject({ pendingRemoteSync: false, recoveryAnchor: f.current().anchor });
    const archived = await f.store.get(adopted.archivedBranchId);
    expect(localRecordGeneration(archived!)).toBeTruthy();
    newer.destroy(); await f.destroy();
  });

  it("reapplies only authored regions of a retained draft through the normal region path", async () => {
    const f = await fixture();
    const restoreRegions = vi.fn(async () => ({ applied: true }));
    const current = f.current();
    const { archivedBranchId } = await f.persistence.archiveAndAdopt({ branchKey: "work:1",
      expectedGeneration: localRecordGeneration((await f.store.get("work:1"))!), update: current.update, anchor: current.anchor });
    const cleanDoc = new Y.Doc();
    const clean = new BoundedYjsLocalPersistence({ key: "work:1", document: cleanDoc, store: f.store, modelVersion: 4 });
    await clean.initialize();
    const { result } = renderHook(() => useLocalRecoveryController({ typeKey: "sheets", transport: f.transport,
      persistence: clean, durability: clean.getSnapshot(), level: "modify", syncState: "synchronized",
      sessionReady: true, reopen: vi.fn(), restoreRegions }));
    await waitFor(() => expect(result.current.recovery.branches.map(branch => branch.id)).toEqual([archivedBranchId]));
    const branch = result.current.recovery.branches[0]!;
    await expect(result.current.reapplyLocalRecovery({ branchId: branch.id, expectedGeneration: branch.generation,
      expectedCurrentAnchor: current.anchor, regionIds: ["metadata:summary"] })).rejects.toThrow("LOCAL_RECOVERY_REGION_NOT_AUTHORED");
    await act(() => result.current.reapplyLocalRecovery({ branchId: branch.id, expectedGeneration: branch.generation,
      expectedCurrentAnchor: current.anchor, regionIds: ["metadata:title"] }));
    expect(restoreRegions).toHaveBeenCalledWith(expect.objectContaining({ title: "Offline title" }), ["metadata:title"]);
    // The retained branch stays inspectable after reapply; discard removes it explicitly.
    expect(await f.store.get(archivedBranchId)).not.toBeNull();
    await act(() => result.current.discardLocalRecovery({ branchId: branch.id, expectedGeneration: branch.generation }));
    await waitFor(() => expect(result.current.recovery.branches).toHaveLength(0));
    await clean.destroy(); cleanDoc.destroy(); await f.destroy();
  });
});
