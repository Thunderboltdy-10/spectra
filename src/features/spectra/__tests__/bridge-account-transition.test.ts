// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bindAccountStorageScope } from "@/lib/account-storage";
import { authorizedBridgeRequest, enableBridgeDiscovery, loadBridgeSession, persistBridgeSession } from "../bridge/client";
import { probeBridge, resetBridgeProbeForTests } from "../bridge/use-bridge";
import { callWorks, isDeviceWork, newWorkStoreId, publishDeviceState, readDeviceWork } from "../bridge/device-works";
import { backUpNow } from "../bridge/device-backup";
import { createPairing, devicePairing } from "../devices/pairing";

const health = { version: "0.1.0", protocolVersion: "1.0", paired: true };
const privateStatus = { ...health, cloudConnected: true, deviceName: "A's computer", mounts: [{ id: "a", label: "A private folder", state: "active", detail: "Saved" }] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); resetBridgeProbeForTests();
  bindAccountStorageScope("deployment/account-A");
  persistBridgeSession("session-A");
});
afterEach(() => vi.unstubAllGlobals());

it("does not offer or persist an old account's pairing after its cloud response arrives late", async () => {
  const offer = deferred<{ challenge: string; shortCode: string; expiresAt: number }>();
  const request = vi.fn(() => offer.promise);
  const offerNative = vi.fn();
  const pairing = createPairing({ discover: async () => ({ kind: "running", health }), offer: offerNative, status: async () => ({ paired: true, sessionToken: "new-session-A" }), persist: persistBridgeSession, enableDiscovery: enableBridgeDiscovery, platform: () => "windows", origin: () => "http://localhost:3000", now: () => 0, wait: async () => undefined });
  const started = pairing.start(request);
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  bindAccountStorageScope("deployment/account-B");
  offer.resolve({ challenge: "fixture-only", shortCode: "123456", expiresAt: 10_000 });
  await started;
  expect(loadBridgeSession()).toBeNull();
  expect(offerNative).not.toHaveBeenCalled();
});

it("gives the next account its own pairing flow", () => {
  const old = devicePairing(); old.want();
  bindAccountStorageScope("deployment/account-B");
  const next = devicePairing();
  expect(next).not.toBe(old);
  expect(next.takeWanted()).toBe(false);
});

it("never shares a pending old-account status probe with the next account after real storage cleanup", async () => {
  const status = deferred<Response>();
  const fetcher = vi.fn((url: string) => url.endsWith("/v1/health") ? Promise.resolve(Response.json(health)) : status.promise);
  vi.stubGlobal("fetch", fetcher);
  const old = probeBridge();
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  bindAccountStorageScope("deployment/account-B");
  expect(loadBridgeSession()).toBeNull();
  // BridgeDiscoveryMount enables public discovery for the new signed-in user.
  enableBridgeDiscovery();
  const next = probeBridge({ fresh: true });
  status.resolve(Response.json(privateStatus));
  expect((await next).status).toBeNull();
  expect((await old).status).toBeNull();
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/v1/health"))).toHaveLength(2);
});

it("cannot put an old resumed session back into the next account's storage", async () => {
  const resumed = deferred<Response>();
  let reads = 0;
  const fetcher = vi.fn((url: string) => url.endsWith("/v1/session/resume") ? resumed.promise : Promise.resolve(reads++ === 0 ? new Response("Expired", { status: 401 }) : Response.json(privateStatus)));
  vi.stubGlobal("fetch", fetcher);
  const request = authorizedBridgeRequest("/v1/status");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  bindAccountStorageScope("deployment/account-B");
  persistBridgeSession("session-B");
  resumed.resolve(Response.json({ paired: true, sessionToken: "renewed-session-A" }));
  expect(await request).toBeNull();
  expect(loadBridgeSession()).toBe("session-B");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("forgets the previous account's in-memory artifact store and known artifact ids", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ result: { title: "A private artifact" } })));
  publishDeviceState({ storeId: "store-A", storage: "device_only" });
  await readDeviceWork("a-work");
  expect(newWorkStoreId("document")).toBe("store-A");
  expect(isDeviceWork("a-work")).toBe(true);
  bindAccountStorageScope("deployment/account-B");
  expect.soft(newWorkStoreId("document")).toBeUndefined();
  expect.soft(isDeviceWork("a-work")).toBe(false);
});

it("discards an old artifact response when its body finishes after the account changes", async () => {
  const body = deferred<{ result: { title: string } }>();
  const json = vi.fn(() => body.promise);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json }));
  const work = callWorks("get", { artifactId: "a-work" });
  const refused = expect(work).rejects.toThrow(/account|connected|changed/i);
  await vi.waitFor(() => expect(json).toHaveBeenCalledOnce());
  bindAccountStorageScope("deployment/account-B");
  body.resolve({ result: { title: "A private artifact" } });
  await refused;
});

it("does not upload or record an old-account backup after an account change", async () => {
  const url = deferred<string>();
  const uploadUrl = vi.fn(() => url.promise);
  const record = vi.fn().mockResolvedValue({ at: 100 });
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "https://fixture-upload") return Response.json({ storageId: "uploaded" });
    const method = JSON.parse(String(init?.body)).method;
    return Response.json({ result: method === "summary" ? { storeId: "a", works: 1, changedSinceBackup: 1 } : { bundleBase64: "AA==", works: 1, bytes: 1 } });
  });
  vi.stubGlobal("fetch", fetcher);
  const backup = backUpNow({ storage: "device_backup", backupEveryHours: 1, lastBackupAt: null, lastFullBackupAt: null }, { uploadUrl, record }, { force: true });
  const refused = expect(backup).rejects.toThrow(/account|connected|changed/i);
  await vi.waitFor(() => expect(uploadUrl).toHaveBeenCalledOnce());
  bindAccountStorageScope("deployment/account-B");
  url.resolve("https://fixture-upload");
  await refused;
  expect(fetcher.mock.calls.filter(([path]) => path === "https://fixture-upload")).toHaveLength(0);
  expect(record).not.toHaveBeenCalled();
});
