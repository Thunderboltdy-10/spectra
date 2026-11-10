import { beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn(), act: vi.fn(), execute: vi.fn() }));
vi.mock("./io", async original => ({ ...await original<typeof import("./io")>(), query: io.query, mutate: io.mutate, act: io.act }));
vi.mock("./effects", async original => ({ ...await original<typeof import("./effects")>(), executeOperation: io.execute }));
import { ConvexHarnessBackend } from "./convex-backend";

const input = { id: "native-work", type: "document" as const, content: { blocks: [{ id: "p", type: "paragraph", text: "A summary" }] }, toolCallId: "edit", approved: false };
const backend = (permissions = { fullControl: false, allow: [], deny: [] }) => new ConvexHarnessBackend({ actorClerkId: "actor", runId: "run", executionId: "attempt", prompt: "Add a summary", timeZone: "UTC", permissions });
beforeEach(() => {
  vi.resetAllMocks();
  io.mutate.mockImplementation(async name => {
    if (name === "spectraOperations:recordPlan") return { operationIds: ["operation"] };
    if (name === "spectraHarness:ensureApproved") throw new Error("AI_PERMISSION_REQUIRED: Ask the user first.");
  });
  io.act.mockResolvedValue({ approvalReasons: ["This also changes a file on your computer through Spectra Bridge. Go ahead?"], approvalCategories: ["bridge_files"] });
  io.execute.mockResolvedValue({ affected: [{ type: "artifact", id: "native-work" }] });
});
describe("native artifact edit approvals", () => {
  it("returns a durable Bridge approval before any native edit executes", async () => {
    const b = backend();
    expect(await b.updateArtifact(input, new AbortController().signal)).toMatchObject({ ok: false, pause: { kind: "approval", category: "bridge_files" } });
    expect(io.execute).not.toHaveBeenCalled();
    expect(b.executedAny).toBe(false);
  });
  it("executes a native edit when the server verifies Always allow", async () => {
    io.mutate.mockImplementation(async name => name === "spectraOperations:recordPlan" ? { operationIds: ["operation"] } : null);
    const b = backend();
    await b.updateArtifact(input, new AbortController().signal);
    expect(io.mutate).toHaveBeenCalledWith("spectraHarness:ensureApproved", expect.objectContaining({ toolCallId: "edit" }));
    expect(io.execute).toHaveBeenCalledOnce();
  });
  it("does not execute when Stop arrives during preparation", async () => {
    const controller = new AbortController();
    io.act.mockImplementation(async () => { controller.abort(); return { approvalReasons: ["Desktop file"], approvalCategories: ["bridge_files"] }; });
    await expect(backend().updateArtifact(input, controller.signal)).rejects.toThrow();
    expect(io.execute).not.toHaveBeenCalled();
    expect(io.mutate).not.toHaveBeenCalledWith("spectraHarness:ensureApproved", expect.anything());
  });
});
