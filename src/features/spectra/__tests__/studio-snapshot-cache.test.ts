import { describe, expect, it, vi } from "vitest";
import {
  createReconciliationSnapshotKey,
  incomingReconciliationKey,
  reconciliationSnapshotKey,
} from "../components/artifact-studio-value-utils";

describe("editor-scoped immutable snapshot keys", () => {
  it("serializes each stable snapshot once while keeping the exact comparison string", () => {
    const toJSON = vi.fn(() => ({ blocks: [{ text: "Original text" }] }));
    const snapshot = Object.freeze({ title: "Paper", summary: "", tagDraft: "", content: { toJSON } });
    const keyFor = createReconciliationSnapshotKey();
    const key = keyFor(snapshot);
    expect(keyFor(snapshot)).toBe(key);
    expect(toJSON).toHaveBeenCalledTimes(1);
    expect(key).toBe(reconciliationSnapshotKey(snapshot));
    const provenance = { source: "live" as const, revision: 2, localSync: true };
    const standard = incomingReconciliationKey("paper", snapshot, provenance);
    toJSON.mockClear();
    expect(incomingReconciliationKey("paper", snapshot, provenance, key)).toBe(standard);
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("does not reuse older content, metadata or provenance for shorter/empty authoritative replacements", () => {
    const keyFor = createReconciliationSnapshotKey();
    const original = Object.freeze({ title: "Paper", summary: "", tagDraft: "", content: { text: "A longer paragraph" } });
    const shorter = Object.freeze({ ...original, content: { text: "Short" } });
    const empty = Object.freeze({ ...original, content: { text: "" } });
    const renamed = Object.freeze({ ...empty, title: "Renamed" });
    const snapshots = [original, shorter, empty, renamed];
    expect(new Set(snapshots.map(keyFor)).size).toBe(4);
    for (const snapshot of snapshots) expect(keyFor(snapshot)).toBe(reconciliationSnapshotKey(snapshot));
    expect(incomingReconciliationKey("paper", empty, { source: "provisional", revision: 1, localSync: false }, keyFor(empty)))
      .not.toBe(incomingReconciliationKey("paper", empty, { source: "live", revision: 2, localSync: true }, keyFor(empty)));
  });
});
