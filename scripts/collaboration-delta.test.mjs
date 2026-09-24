import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { canonicalDurableUpdate } from "./collaboration-update-envelope.mjs";

describe("canonical incremental persistence", () => {
  it("reduces a large handshake and processes a tiny edit without serializing the room", () => {
    const canonical = new Y.Doc();
    const peer = new Y.Doc();
    canonical.getText("body").insert(0, "x".repeat(2_000_000));
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(canonical));
    const updates = [];
    peer.on("update", update => updates.push(update));
    peer.getText("body").insert(1_000_000, "new");
    const boundedY = { ...Y, encodeStateAsUpdate: () => { throw new Error("full room serialization"); } };
    const delta = canonicalDurableUpdate(boundedY, canonical, updates[0]);
    const handshakeDelta = canonicalDurableUpdate(boundedY, canonical, Y.encodeStateAsUpdate(peer));
    expect(delta.byteLength).toBeLessThan(100);
    expect(handshakeDelta.byteLength).toBeLessThan(100);
    Y.applyUpdate(canonical, delta);
    expect(Y.encodeStateAsUpdate(canonical)).toEqual(Y.encodeStateAsUpdate(peer));
    expect(canonicalDurableUpdate(boundedY, canonical, updates[0])).toBeNull();
    canonical.destroy(); peer.destroy();
  });

  it("keeps a clear when deleted endpoints surround a still-live range", () => {
    const canonical = new Y.Doc({ gc: false });
    const peer = new Y.Doc({ gc: false });
    canonical.getText("body").insert(0, "abcdef");
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(canonical));
    canonical.getText("body").delete(5, 1);
    canonical.getText("body").delete(0, 1);
    peer.getText("body").delete(0, 6);
    const clear = Y.encodeStateAsUpdate(peer, Y.encodeStateVector(canonical));
    const delta = canonicalDurableUpdate(Y, canonical, clear);
    expect(delta).not.toBeNull();
    Y.applyUpdate(canonical, delta);
    expect(canonical.getText("body").toString()).toBe("");
    expect(canonicalDurableUpdate(Y, canonical, clear)).toBeNull();
    canonical.destroy(); peer.destroy();
  });

  it.each([true, false])("retains out-of-order structs and deletes through replay (gc=%s)", gc => {
    const writer = new Y.Doc({ gc });
    const canonical = new Y.Doc({ gc });
    const replay = new Y.Doc({ gc });
    const updates = [];
    writer.on("update", update => updates.push(update));
    writer.getText("body").insert(0, "first");
    writer.getText("body").insert(5, " second");
    writer.getText("body").delete(0, 5);
    for (const index of [2, 1, 1, 0, 2]) {
      const delta = canonicalDurableUpdate(Y, canonical, updates[index]);
      if (delta) { Y.applyUpdate(canonical, delta); Y.applyUpdate(replay, delta); }
    }
    expect(canonical.getText("body").toString()).toBe(" second");
    expect(Y.encodeStateAsUpdate(replay)).toEqual(Y.encodeStateAsUpdate(writer));
    writer.destroy(); canonical.destroy(); replay.destroy();
  });

  it("converges concurrent replacements, clears and duplicate deliveries across repeated replays", () => {
    let seed = 0x51a0c;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let round = 0; round < 40; round++) {
      const base = new Y.Doc();
      base.getMap("cells").set("shared", "baseline");
      const peers = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
      const updates = [];
      for (const [index, peer] of peers.entries()) {
        Y.applyUpdate(peer, Y.encodeStateAsUpdate(base));
        peer.on("update", update => updates.push(update));
        peer.getMap("cells").set(`cell-${index}`, round);
        peer.getMap("cells").set("shared", `${round}:${index}`);
        peer.getMap("cells").delete("shared");
      }
      const reference = new Y.Doc();
      const replay = new Y.Doc();
      Y.applyUpdate(reference, Y.encodeStateAsUpdate(base));
      Y.applyUpdate(replay, Y.encodeStateAsUpdate(base));
      const delivery = [...updates];
      for (let index = delivery.length - 1; index > 0; index--) {
        const other = Math.floor(random() * (index + 1));
        [delivery[index], delivery[other]] = [delivery[other], delivery[index]];
      }
      for (const update of [...delivery, ...delivery]) {
        Y.applyUpdate(reference, update);
        const delta = canonicalDurableUpdate(Y, base, update);
        if (delta) { Y.applyUpdate(base, delta); Y.applyUpdate(replay, delta); }
      }
      expect(Y.encodeStateAsUpdate(replay)).toEqual(Y.encodeStateAsUpdate(reference));
      expect(base.getMap("cells").toJSON()).toEqual({ "cell-0": round, "cell-1": round, "cell-2": round });
      for (const doc of [base, reference, replay, ...peers]) doc.destroy();
    }
  });
});
