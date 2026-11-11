import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn(), apply: vi.fn(), device: vi.fn(), restore: vi.fn() }));
vi.mock("./io", () => ({ query: io.query, mutate: io.mutate }));
vi.mock("@/features/spectra/ai/yjs-artifact-operation", () => ({ applyAiArtifactMutation: io.apply }));
vi.mock("@/lib/device-restore-server", () => ({ deviceUndoPlan: io.device, restoreDeviceVersion: io.restore }));
import { revertRun } from "./revert-run";

const before = { title: "Quiz", content: { questions: [{ id: "q3", prompt: "Original", answer: 4 }] }, tags: ["waves"] };
beforeEach(() => {
  vi.resetAllMocks();
  io.query.mockResolvedValue({ run: { status: "completed", executionId: "exec-1" }, cards: [{ _id: "card-1", actions: [{ key: "open", targetId: "quiz" }, { key: "revert" }] }], operations: [] });
  io.device.mockResolvedValue({ restore: [], keep: [], notes: [] });
  io.mutate.mockImplementation(async (name: string) => {
    if (name === "changeGroups:revertPlanForRun") return { restored: [{ artifactId: "quiz", snapshot: before }], blocked: [] };
    if (name === "spectraRunUndo:reverseWrites") return { counts: {}, left: [], kept: [], trashedWorks: [] };
  });
});

describe("the shared run reversal", () => {
  it("restores the saved snapshot exactly and updates the existing result card", async () => {
    const response = await revertRun("actor", "run-1", "exec-1");
    expect(response.status).toBe(200);
    const request = io.apply.mock.calls[0]![0];
    expect(request.resolveDesired({ title: "Changed", content: { questions: [] }, summary: "Current", tags: [] })).toEqual({ ...before, summary: "Current" });
    expect(request).toMatchObject({ artifactId: "quiz", runId: "run-1", executionId: "exec-1", operationId: "restore:run-1:quiz", claimActorKind: "human" });
    expect(io.mutate).toHaveBeenCalledWith("spectraRuns:patchResultCard", expect.objectContaining({ actions: [{ key: "open", targetId: "quiz" }, { key: "undone", label: "Undone" }] }));
  });

  it("preserves a later human edit instead of approximating an inverse", async () => {
    io.mutate.mockImplementation(async (name: string) => name === "changeGroups:revertPlanForRun" ? { restored: [], blocked: [{ artifactId: "quiz", reason: "Edited later" }] } : { counts: {}, left: [], kept: [], trashedWorks: [] });
    const response = await revertRun("actor", "run-1", "exec-1");
    expect(response.status).toBe(409);
    expect(io.apply).not.toHaveBeenCalled();
  });

  it("does not restore content into a newly created artifact that reversal trashed", async () => {
    io.mutate.mockImplementation(async (name: string) => name === "changeGroups:revertPlanForRun" ? { restored: [{ artifactId: "quiz", snapshot: before }], blocked: [] } : { counts: { works: 1 }, left: [], kept: [], trashedWorks: ["quiz"] });
    expect((await revertRun("actor", "run-1", "exec-1")).status).toBe(200);
    expect(io.apply).not.toHaveBeenCalled();
  });

  it("uses the existing device version fence and keeps unavailable device artifact", async () => {
    io.device.mockResolvedValue({ restore: [{ artifactId: "device-work", versionId: 42 }], keep: ["offline-work"], notes: [] });
    await revertRun("actor", "run-1", "exec-1");
    expect(io.mutate).toHaveBeenCalledWith("spectraRunUndo:reverseWrites", { runId: "run-1", executionId: "exec-1", keepWorks: ["offline-work"] });
    expect(io.restore).toHaveBeenCalledWith({ artifactId: "device-work", versionId: "device:42", requestId: "undo:run-1:device-work" });
  });

  it("discovers affected native artifacts beyond the result card's display limit", async () => {
    const affected = Array.from({ length: 30 }, (_,i) => ({ type: "artifact", id: `work-${i}` }));
    io.query.mockResolvedValue({ run: { status: "completed", executionId: "exec-1" }, cards: [], operations: [{ type: "artifact.update", status: "executed", affected }] });
    await revertRun("actor", "run-1", "exec-1");
    expect(io.device.mock.calls[0]![0]).toEqual(expect.arrayContaining(affected.map(item => item.id)));
  });

  it("rejects a stale attempt before any reversal writes", async () => {
    expect((await revertRun("actor", "run-1", "old-attempt")).status).toBe(409);
    expect(io.mutate).not.toHaveBeenCalled();
    expect(io.apply).not.toHaveBeenCalled();
  });

  it("does not replay an already completed Undo over later work", async () => {
    io.query.mockResolvedValue({ run: { status: "completed", executionId: "exec-1" }, cards: [{ actions: [{ key: "undone" }] }] });
    expect((await revertRun("actor", "run-1", "exec-1")).status).toBe(409);
    expect(io.mutate).not.toHaveBeenCalled();
    expect(io.apply).not.toHaveBeenCalled();
  });

  it("recovers the same requesting run's receipt without repeating reversal writes", async () => {
    io.query.mockResolvedValue({ run: { status: "completed", executionId: "exec-1" }, cards: [{ summary: "Undone: restored 1 artifact.", actions: [{ key: "undone" }], provenance: { undoneByRunId: "requester" } }] });
    const response = await revertRun("actor", "run-1", "exec-1", undefined, "requester");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ changed: true, summary: "Undone: restored 1 artifact." });
    expect((await revertRun("actor", "run-1", "exec-1", undefined, "another-requester")).status).toBe(409);
    expect(io.mutate).not.toHaveBeenCalled();
    expect(io.apply).not.toHaveBeenCalled();
  });
});
