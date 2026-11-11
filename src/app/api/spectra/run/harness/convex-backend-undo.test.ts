import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunDetail } from "./contract";
import type { PermissionPrefs } from "@/features/spectra/ai/harness/permissions";

const io = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn(), revert: vi.fn(), changed: vi.fn() }));
vi.mock("./io", async (original) => ({ ...await original<typeof import("./io")>(), query: io.query, mutate: io.mutate }));
vi.mock("./revert-run", () => ({ revertRun: io.revert }));
import { ConvexHarnessBackend } from "./convex-backend";
import { appTools } from "@/features/spectra/ai/harness/tools/app";
import { createSession } from "@/features/spectra/ai/harness/tools/shared";

let state: RunDetail;
const backend = (permissions?: PermissionPrefs) => new ConvexHarnessBackend({ actorClerkId: "actor", runId: "current", executionId: "current-exec", timeZone: "UTC", prompt: "Undo that", permissions });
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  state = { run: { status: "completed", userPrompt: "Edit", sourceSurface: "chat", executionId: "previous-exec" }, cards: [], operations: [] };
  io.query.mockImplementation(async (name: string) => name === "spectraRuns:previousForUndo" ? { runId: "previous", executionId: "previous-exec" } : false);
  io.revert.mockImplementation(async (_actor, _run, _execution, authorize) => {
    const refused = await authorize(state, ["work"], false);
    if (refused) return refused;
    io.changed();
    return Response.json({ changed: true, summary: "Undone: restored 1 work.", notes: ["Later human edits stayed."] });
  });
});
const settings = () => state.operations.push({ _id: "op", type: "app.command", status: "executed", requiresConfirmation: true, input: { command: "change_spectra_settings", args: {} } });

describe("conversational previous-run Undo", () => {
  it("uses the saved-state orchestrator without advertising an unsupported redo", async () => {
    const b = backend();
    const result = await b.undoPreviousRun({ approved: false }, signal());
    expect(result).toEqual({ ok: true, content: "Undone: restored 1 work.\nLater human edits stayed." });
    expect(io.revert).toHaveBeenCalledWith("actor", "previous", "previous-exec", expect.any(Function), "current");
    expect(b.executedAny).toBe(true);
    expect(io.mutate).toHaveBeenCalledWith("spectraRunUndo:recordReversal", { runId: "current", executionId: "current-exec", previousRunId: "previous", previousExecutionId: "previous-exec" });
    expect(b.changedWorkspace).toBe(false);
  });
  it("has no caller-selected target and is exclusive", async () => {
    const tool = appTools(createSession({ backend: backend(), prompt: "Undo" })).find((tool) => tool.name === "undo_previous_run")!;
    expect(tool.exclusive).toBe(true);
    expect(() => tool.parse!({ runId: "someone-else" })).toThrow("no arguments");
  });
  it("does not guess a target when there is no predecessor or after new writes", async () => {
    io.query.mockResolvedValue(null);
    const b = backend();
    expect((await b.undoPreviousRun({ approved: false }, signal())).ok).toBe(false);
    b.executedAny = true;
    expect((await b.undoPreviousRun({ approved: false }, signal())).ok).toBe(false);
    expect(io.revert).not.toHaveBeenCalled();
  });
  it("can preflight a shared edit without using the owner-only policy counter", async () => {
    io.query.mockImplementation(async (name: string) => {
      if (name === "spectraRuns:previousForUndo") return { runId: "previous", executionId: "previous-exec" };
      if (name === "replicas:localEffectCount") throw new Error("WORK_NOT_FOUND");
      if (name === "replicas:undoNeedsLocalApproval") return false;
    });
    await expect(backend().undoPreviousRun({ approved: false }, signal())).resolves.toMatchObject({ ok: true });
    expect(io.changed).toHaveBeenCalledOnce();
  });
  it("asks before settings reversal and changes nothing before approval", async () => {
    settings();
    const b = backend();
    const result = await b.undoPreviousRun({ approved: false }, signal());
    expect(result.pause).toMatchObject({ kind: "approval", category: "settings", approvalScope: "previous:previous-exec" });
    expect(io.changed).not.toHaveBeenCalled();
    expect((await b.undoPreviousRun({ approved: true, approvalScope: result.pause?.approvalScope }, signal())).ok).toBe(true);
    expect(io.changed).toHaveBeenCalledOnce();
  });
  it("asks for native replicas even when the earlier edit needed no settings approval", async () => {
    io.query.mockImplementation(async (name: string) => name === "spectraRuns:previousForUndo" ? { runId: "previous", executionId: "previous-exec" } : true);
    expect((await backend().undoPreviousRun({ approved: false }, signal())).pause).toMatchObject({ category: "bridge_files" });
    expect(io.changed).not.toHaveBeenCalled();
  });
  it("preserves Never for every category, including mixed settings/native effects", async () => {
    settings();
    io.query.mockImplementation(async (name: string) => name === "spectraRuns:previousForUndo" ? { runId: "previous", executionId: "previous-exec" } : true);
    const result = await backend({ fullControl: true, allow: [], deny: ["bridge_files"] }).undoPreviousRun({ approved: true, approvalScope: "previous:previous-exec" }, signal());
    expect(result.ok).toBe(false);
    expect(result.content).toContain("Never");
    expect(io.changed).not.toHaveBeenCalled();
  });
  it("rejects approval for a changed prior attempt even after a thread allow was saved", async () => {
    settings();
    const result = await backend({ fullControl: false, allow: ["settings"], deny: [] }).undoPreviousRun({ approved: true, approvalScope: "previous:old-attempt" }, signal());
    expect(result.ok).toBe(false);
    expect(result.content).toContain("changed after approval");
    expect(io.changed).not.toHaveBeenCalled();
  });
  it("fails closed when local effects cannot be determined", async () => {
    io.query.mockImplementation(async (name: string) => { if (name === "spectraRuns:previousForUndo") return { runId: "previous", executionId: "previous-exec" }; throw new Error("Offline"); });
    await expect(backend().undoPreviousRun({ approved: false }, signal())).rejects.toThrow("Offline");
    expect(io.changed).not.toHaveBeenCalled();
  });
  it("does not begin reversal if Stop arrives during the metadata preflight", async () => {
    const controller = new AbortController();
    io.query.mockImplementation(async (name: string) => {
      if (name === "spectraRuns:previousForUndo") return { runId: "previous", executionId: "previous-exec" };
      controller.abort();
      return false;
    });
    await expect(backend().undoPreviousRun({ approved: false }, controller.signal)).rejects.toThrow();
    expect(io.changed).not.toHaveBeenCalled();
  });
});
