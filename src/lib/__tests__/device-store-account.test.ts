import { afterEach, beforeEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ query: vi.fn(), fetch: vi.fn(), sockets: [] as string[] }));
vi.mock("@/lib/convex-server", () => ({ convexQuery: io.query }));
vi.mock("@/lib/env", () => ({ getConvexUrl: () => "http://fixture-convex" }));
vi.mock("node:fs", () => ({ readFileSync: () => "dummy-relay-token" }));
vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  return { default: class extends EventEmitter {
    constructor(url: string) { super(); io.sockets.push(url); queueMicrotask(() => this.emit("open")); }
    send() { this.emit("message", JSON.stringify({ result: { names: ["other-account-folder"] } })); }
    close() {}
  } };
});
import { deviceRoomEndpoint, deviceStoreCall } from "../device-store";

beforeEach(() => {
  io.query.mockReset(); io.fetch.mockReset(); io.sockets.length = 0;
  vi.stubEnv("SPECTRA_AGENT_HUB_URL", undefined);
  vi.stubGlobal("fetch", io.fetch);
  io.fetch.mockResolvedValue({ ok: true, json: async () => ({ deviceId: "paired-device", generation: "pairing-1", accountId: "actor", deployment: "http://fixture-convex/" }) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("rejects the other account before opening a local store socket", async () => {
  io.query.mockResolvedValue(null);
  await expect(deviceStoreCall("actor", "computerNames")).rejects.toThrow(/DEVICE_STORE_UNAVAILABLE/);
  expect(io.sockets).toEqual([]);
});

it("rejects the other account before exposing a local room endpoint", async () => {
  io.query.mockResolvedValue("paired-owner");
  await expect(Promise.resolve().then(() => deviceRoomEndpoint("actor"))).rejects.toThrow(/DEVICE_STORE_UNAVAILABLE/);
});

it("fails closed when an old Bridge cannot prove its pairing", async () => {
  io.fetch.mockResolvedValue({ ok: false, status: 404 });
  await expect(deviceStoreCall("actor", "computerNames")).rejects.toThrow(/DEVICE_STORE_UNAVAILABLE/);
  expect(io.query).not.toHaveBeenCalled();
  expect(io.sockets).toEqual([]);
});

it.each([
  { deviceId: "paired-device", generation: "pairing-1" },
  { deviceId: "paired-device", generation: "pairing-1", accountId: "actor", deployment: "http://another-deployment" },
  { deviceId: "paired-device", generation: "pairing-1", accountId: "different-account", deployment: "http://fixture-convex" },
])("refuses a missing or mismatched native account/deployment proof: %j", async (identity) => {
  io.fetch.mockResolvedValue({ ok: true, json: async () => identity });
  io.query.mockResolvedValue("actor");
  await expect(deviceStoreCall("actor", "summary")).rejects.toThrow(/DEVICE_STORE_UNAVAILABLE/);
  expect(io.sockets).toEqual([]);
});

it("binds the correct account's local store to the exact device and pairing", async () => {
  io.query.mockResolvedValue("actor");
  await deviceStoreCall("actor", "summary");
  expect(io.query).toHaveBeenCalledWith("bridge:localRelayAccount", { deviceId: "paired-device" });
  expect(io.sockets).toEqual(["ws://127.0.0.1:47615/v1/store?deviceId=paired-device&generation=pairing-1"]);
});

it("keeps the operation timeout across a stalled ownership preflight", async () => {
  vi.useFakeTimers();
  let resolve!: (owner: string) => void;
  io.query.mockReturnValue(new Promise(value => { resolve = value; }));
  const stopped = expect(deviceStoreCall("actor", "summary", {}, 50)).rejects.toThrow(/DEVICE_STORE_UNAVAILABLE/);
  await vi.advanceTimersByTimeAsync(51);
  await stopped;
  resolve("actor");
  await vi.runAllTimersAsync();
  expect(io.sockets).toEqual([]);
});

it("preserves the hosted account-ticket path without local preflight", async () => {
  vi.stubEnv("SPECTRA_AGENT_HUB_URL", "ws://fixture-hub");
  vi.stubEnv("SPECTRA_COLLAB_TOKEN_SECRET", "dummy-test-secret");
  await deviceStoreCall("actor", "summary");
  expect(io.sockets).toEqual(["ws://fixture-hub/_spectra/agent-hub/server?provider=store"]);
  expect(await deviceRoomEndpoint("actor")).toMatchObject({ url: "ws://fixture-hub/_spectra/agent-hub/server?provider=rooms", token: "hub" });
  expect(io.query).not.toHaveBeenCalled();
  expect(io.fetch).not.toHaveBeenCalled();
});
