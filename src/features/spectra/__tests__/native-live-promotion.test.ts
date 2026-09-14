import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  nativeLiveContentKey,
  nativeLiveNeedsPromotion,
} from "../lenses/native-live-promotion";

describe("native live promotion", () => {
  it("keys a document by authored block text, not checkpoint identity", () => {
    expect(
      nativeLiveContentKey({
        blocks: [
          { id: "intro", text: "UNIQUE-A UNIQUE-B" },
          { id: "tail", text: "UNIQUE-AFTER-DOWN" },
        ],
      }),
    ).toBe("intro\tUNIQUE-A UNIQUE-B\ntail\tUNIQUE-AFTER-DOWN");
    expect(
      nativeLiveContentKey({
        nativeBinding: { semanticDigest: "stale" },
        sheets: [{ cells: { A1: { value: "1" } } }],
      }),
    ).toBe("");
  });

  it("promotes Yjs-ahead text after Bridge recovery when no write is in flight", () => {
    expect(
      nativeLiveNeedsPromotion({
        initialized: true,
        dirty: false,
        nativeActivity: false,
        unsynchronized: false,
        localReplicaPending: false,
        contentKey: "intro\tUNIQUE-AFTER-DOWN",
      }),
    ).toBe(true);
    expect(
      nativeLiveNeedsPromotion({
        initialized: true,
        dirty: false,
        nativeActivity: false,
        unsynchronized: false,
        localReplicaPending: false,
        contentKey: "intro\tUNIQUE-AFTER-DOWN",
        lastAttemptedKey: "intro\tUNIQUE-AFTER-DOWN",
      }),
    ).toBe(false);
  });

  it("does not enqueue a second write while dirty, unsynchronized, or already queued", () => {
    const ahead = {
      initialized: true,
      contentKey: "intro\tUNIQUE-AFTER-DOWN",
    };
    expect(
      nativeLiveNeedsPromotion({
        ...ahead,
        dirty: true,
        nativeActivity: false,
        unsynchronized: false,
        localReplicaPending: false,
      }),
    ).toBe(false);
    expect(
      nativeLiveNeedsPromotion({
        ...ahead,
        dirty: false,
        nativeActivity: true,
        unsynchronized: false,
        localReplicaPending: false,
      }),
    ).toBe(false);
    expect(
      nativeLiveNeedsPromotion({
        ...ahead,
        dirty: false,
        nativeActivity: false,
        unsynchronized: true,
        localReplicaPending: false,
      }),
    ).toBe(false);
    expect(
      nativeLiveNeedsPromotion({
        ...ahead,
        dirty: false,
        nativeActivity: false,
        unsynchronized: false,
        localReplicaPending: true,
      }),
    ).toBe(false);
    expect(
      nativeLiveNeedsPromotion({
        ...ahead,
        dirty: false,
        nativeActivity: false,
        unsynchronized: false,
        localReplicaPending: false,
        operations: [{ direction: "cloud-to-local", state: "pending" }],
      }),
    ).toBe(false);
    expect(
      nativeLiveNeedsPromotion({
        ...ahead,
        dirty: false,
        nativeActivity: false,
        unsynchronized: false,
        localReplicaPending: false,
        bridgeAvailable: false,
      }),
    ).toBe(false);
    expect(
      nativeLiveNeedsPromotion({
        ...ahead,
        dirty: false,
        nativeActivity: false,
        unsynchronized: false,
        localReplicaPending: false,
        lastFailedKey: ahead.contentKey,
      }),
    ).toBe(false);
    expect(
      nativeLiveNeedsPromotion({
        ...ahead,
        dirty: false,
        nativeActivity: false,
        unsynchronized: false,
        localReplicaPending: false,
        protectedOriginal: true,
      }),
    ).toBe(false);
  });

  it("retries the same Yjs-ahead key after Bridge reconnects", () => {
    expect(
      nativeLiveNeedsPromotion({
        initialized: true,
        dirty: false,
        nativeActivity: false,
        unsynchronized: false,
        localReplicaPending: false,
        contentKey: "intro\tUNIQUE-AFTER-DOWN",
        lastFailedKey: "intro\tUNIQUE-AFTER-DOWN",
        bridgeAvailable: true,
      }),
    ).toBe(false);
    expect(
      nativeLiveNeedsPromotion({
        initialized: true,
        dirty: false,
        nativeActivity: false,
        unsynchronized: false,
        localReplicaPending: false,
        contentKey: "intro\tUNIQUE-AFTER-DOWN",
        bridgeAvailable: true,
      }),
    ).toBe(true);
  });

  it("is wired into native save flush and reopen promotion", () => {
    const studio = readFileSync(
      "src/features/spectra/components/artifact-studio.tsx",
      "utf8",
    );
    const sync = readFileSync(
      "src/features/spectra/components/artifact-native-sync.ts",
      "utf8",
    );
    const model = readFileSync(
      "src/features/spectra/work/models/yjs/native-artifact-model.ts",
      "utf8",
    );
    expect(studio).toContain("live.flushSnapshot?.()");
    expect(sync).toContain("nativeLiveNeedsPromotion");
    expect(sync).toContain("queueNativeMaterialization(liveValue)");
    expect(sync).toContain('result?.state === "deferred_native"');
    expect(sync).toContain('result?.state === "cloud_saved"');
    expect(sync).toContain("bridgeAvailable");
    expect(sync).toContain("lastFailedPromotionKeyRef");
    expect(sync).toContain("protectedOriginal: nativeLocalReplica.protectedOriginal === true");
    expect(studio).toContain("bridgeAvailable:");
    expect(model).toContain("this.rebuildSnapshotImmediately()");
    expect(model).toContain("flushSnapshot()");
  });
});
