import { beforeEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ query: vi.fn(), store: vi.fn() }));
vi.mock("@/lib/convex-server", () => ({ convexQuery: io.query }));
vi.mock("@/lib/device-store", () => ({ deviceStoreCall: io.store }));
vi.mock("@/features/spectra/ai/yjs-artifact-operation", () => ({ applyAiArtifactMutation: vi.fn() }));
import { deviceUndoPlan } from "../device-restore-server";

beforeEach(() => vi.clearAllMocks());

it("discovers every native Undo target across the bounded homes lookup", async () => {
  io.query.mockImplementation(async (_name, args) => ({ accountId: "owner", onDevice: args.artifactIds.slice(0, 24) }));
  io.store.mockImplementation(async (_account, method) => method === "versions"
    ? [{ id: 2, source: "ai", runId: "run" }, { id: 1, source: "before_ai", runId: "run" }]
    : { content: { text: "after" } });
  const ids = Array.from({ length: 30 }, (_,i) => `work-${i}`);
  const plan = await deviceUndoPlan(ids, "run");
  expect(plan.restore.map(item => item.artifactId)).toEqual(ids);
  expect(io.query.mock.calls.every(([,args]) => args.artifactIds.length <= 24)).toBe(true);
});

it("keeps a later manual rename even when the native content has not changed", async () => {
  io.query.mockResolvedValue({ accountId: "owner", onDevice: ["work"] });
  io.store.mockImplementation(async (_account, method) => method === "versions"
    ? [{ id: 2, source: "ai", runId: "run" }, { id: 1, source: "before_ai", runId: "run" }]
    : { title: method === "get" ? "My later title" : "AI title", content: { text: "after" } });
  const plan = await deviceUndoPlan(["work"], "run");
  expect(plan.restore).toEqual([]);
  expect(plan.keep).toEqual(["work"]);
});

it.each([60, 200])("finds the earliest before snapshot among %i native version rows", async (count) => {
  io.query.mockResolvedValue({ accountId: "owner", onDevice: ["work"] });
  const versions = Array.from({ length: count }, (_, index) => ({
    id: count - index, source: index % 2 ? "before_ai" : "ai", runId: "run",
  }));
  // A preceding run's row proves the requested run's boundary when the list is full.
  if (count === 200) versions[count - 1].runId = "earlier-run";
  io.store.mockImplementation(async (_account, method, args) => method === "versions"
    ? versions.slice(0, args.limit) : { content: { text: "after" } });
  const plan = await deviceUndoPlan(["work"], "run");
  expect(plan.restore).toEqual([{ artifactId: "work", versionId: count === 200 ? 3 : 1 }]);
  expect(io.store.mock.calls[0][2].limit).toBeLessThanOrEqual(200);
});

it("keeps the native artifact when retention may have pruned the run's original snapshot", async () => {
  io.query.mockResolvedValue({ accountId: "owner", onDevice: ["work"] });
  const versions = Array.from({ length: 200 }, (_, index) => ({
    id: 201 - index, source: index % 2 ? "before_ai" : "ai", runId: "run",
  }));
  io.store.mockImplementation(async (_account, method, args) => method === "versions"
    ? versions.slice(0, args.limit) : { content: { text: "after" } });
  const plan = await deviceUndoPlan(["work"], "run");
  expect(plan.restore).toEqual([]);
  expect(plan.keep).toEqual(["work"]);
  expect(plan.notes[0]).toMatch(/history/i);
});
