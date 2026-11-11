// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bindAccountStorageScope } from "@/lib/account-storage";
import { persistBridgeSession } from "../bridge/client";
import { enterDeviceRoom } from "../bridge/device-works";
import { deviceProblem } from "../bridge/status";

/*
 * Seeding makes a new work. A work that reached this computer once and is no
 * longer in its store is lost here, and must never open as an empty one.
 */

const seed = { typeKey: "document", title: "Essay", tags: [], schemaVersion: 4, content: { blocks: [] } };

function bridge(held: boolean) {
  const methods: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
    if (body.method) methods.push(body.method);
    const result =
      body.method === "summary"
        ? { storeId: "store-A", works: held ? 1 : 0, changedSinceBackup: 0, bytes: 0, lastBackupAt: null }
        : body.method === "get"
          ? held ? { artifactId: "w1", title: "Essay" } : null
          : { ok: true };
    return { ok: true, status: 200, json: async () => ({ result }) };
  }));
  return methods;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  bindAccountStorageScope("deployment/account-A");
  persistBridgeSession("session-A");
});
afterEach(() => vi.unstubAllGlobals());

it("never seeds an empty room for a seeded artifact the store has lost", async () => {
  const methods = bridge(false);
  await expect(enterDeviceRoom("w-lost", { token: "", device: { storeId: "store-A", storageSeeded: true, seed } }))
    .rejects.toThrow(/^COLLABORATION_DEVICE_MISSING: This artifact isn't on this computer\. Bring it back from your backup\.$/);
  expect(methods).toContain("get");
  expect(methods).not.toContain("seed");
});

it("seeds a new artifact that never reached the store", async () => {
  const methods = bridge(false);
  await enterDeviceRoom("w-new", { token: "", device: { storeId: "store-A", storageSeeded: false, seed } });
  expect(methods).toContain("seed");
});

it("opens a held work without seeding it again", async () => {
  const methods = bridge(true);
  await enterDeviceRoom("w-held", { token: "", device: { storeId: "store-A", storageSeeded: true, seed } });
  expect(methods).not.toContain("seed");
});

it("says why an artifact kept on a computer can't open, with the way back", () => {
  const missing = deviceProblem("COLLABORATION_DEVICE_MISSING: This artifact isn't on this computer. Bring it back from your backup.");
  expect(missing).toMatchObject({ key: "device", label: "Not on this computer", action: { label: "Bring it back" } });
  expect(missing?.detail).toBe("This artifact isn't on this computer. Bring it back from your backup.");
  expect(deviceProblem("COLLABORATION_DEVICE_ELSEWHERE: Open it there.")?.label).toBe("On another computer");
  expect(deviceProblem("COLLABORATION_CONNECT_TIMEOUT")).toBeNull();
});
