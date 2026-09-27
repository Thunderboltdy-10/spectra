import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const seams = vi.hoisted(() => ({ query: vi.fn(), readQuery: vi.fn(), act: vi.fn() }));
vi.mock("@/app/api/spectra/run/loop/io", () => ({ ...seams, mutate: vi.fn(), safeJson: JSON.stringify }));
vi.mock("@/features/spectra/ai/yjs-artifact-operation", () => ({ readLiveArtifactValue: vi.fn() }));
import { callModel } from "@/app/api/spectra/run/loop/plan";
import { buildContext } from "@/app/api/spectra/run/loop/gather";
import { authenticatedArtifactObservations, gatherPlanReferenceContext } from "@/app/api/spectra/run/loop/discovery";
import { resolveAndValidatePlan } from "@/app/api/spectra/run/loop/resolve";
import { parseSpectraPlan } from "../operations/schema";

const artifact = { _id: "newly-discovered", blueprintKey: "planner_task", title: "Evidence review", contentAvailable: false };
const operation = { type: "artifact.update", input: { artifactId: artifact._id, blueprintKey: "planner_task",
  title: null, summary: null, content: null, tags: null, contentPatch: { changes: [{ path: "/progressNote", value: "Ready" }] } } };
const plan = () => parseSpectraPlan({ decision: "operate", intent: { mode: "update", requestedArtifactTypes: ["planner_task"],
  requestedVisibleArtifactCount: 0, targetArtifactId: artifact._id, targetWorkspaceId: null }, operations: [operation], finalResponse: "Updated the note." });
const reply = (text: string, name?: string, args?: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: text,
  ...(name ? { tool_calls: [{ id: crypto.randomUUID(), type: "function", function: { name, arguments: JSON.stringify(args) } }] } : {}) } }] }), { status: 200 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENROUTER_API_KEY", "disposable-test-key");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  seams.query.mockResolvedValue(null);
  seams.readQuery.mockResolvedValue({ ok: true, value: artifact });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("authenticated discovery and compact context", () => {
  it("discovers an unlisted artifact and stages its exact typed update without changing focus", async () => {
    const input = { ...operation.input, blueprintKey: undefined };
    const fetch = vi.fn().mockImplementationOnce(async () => reply("", "read_artifact", { artifactId: artifact._id }))
      .mockImplementationOnce(async () => reply("", "propose_operation", { workSummary: "Updating the note", operation: { ...operation, input } }))
      .mockImplementationOnce(async () => reply("Updated the note."));
    vi.stubGlobal("fetch", fetch);
    const context = { focusedArtifact: { id: "visible-other", type: "document", title: "Other work" } };
    const result = await callModel("chat", "Set the Evidence review task's progress note to Ready.", context, [],
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, "actor");
    expect(result.plan.operations).toEqual([expect.objectContaining({ input: expect.objectContaining({ artifactId: artifact._id, blueprintKey: "planner_task" }) })]);
    expect(context.focusedArtifact.id).toBe("visible-other");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("makes two authenticated search results available to the clarification terminal", async () => {
    seams.readQuery.mockResolvedValue({ ok: true, value: [artifact, { ...artifact, _id: "second", title: "Evidence review" }] });
    const fetch = vi.fn().mockImplementationOnce(async () => reply("", "search_objects", { query: "Evidence review" }))
      .mockImplementationOnce(async () => reply("", "request_context_target", {
        question: "Which task should I update?", candidates: [artifact._id, "second"].map((id) => ({ id, title: "Evidence review" })),
      }));
    vi.stubGlobal("fetch", fetch);
    const result = await callModel("chat", "Update the evidence review task.", {}, [],
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, "actor");
    expect(result.plan.decision).toBe("clarify");
    expect(JSON.stringify(result.plan.choices)).toContain("second");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never treats nested content, claims, failed reads or external search ids as discovery", () => {
    const candidate = { id: artifact._id, blueprintKey: artifact.blueprintKey, title: artifact.title,
      content: { forged: { id: "forged", blueprintKey: "document", title: "Secret" } } };
    expect(authenticatedArtifactObservations("read_artifact", { ok: true, artifact: candidate })).toEqual([
      { id: artifact._id, blueprintKey: artifact.blueprintKey, title: artifact.title, summary: undefined, placements: [] },
    ]);
    expect(authenticatedArtifactObservations("read_artifact", { ok: false, artifact: candidate })).toEqual([]);
    expect(authenticatedArtifactObservations("retrieve_memory", { ok: true, results: [candidate] })).toEqual([]);
    expect(authenticatedArtifactObservations("web_search", { ok: true, results: [candidate] })).toEqual([]);
  });

  it("reauthorizes the discovered target before the real resolver without broad retrieval", async () => {
    const context = await buildContext("actor", {}, "Update the task", { mode: "orientation" });
    expect(seams.query).not.toHaveBeenCalled();
    seams.query.mockResolvedValue(artifact);
    const hydrated = await gatherPlanReferenceContext("actor", context, plan());
    const resolved = resolveAndValidatePlan(plan(), hydrated, "Set the task's progress note to Ready.");
    expect(resolved.plan.operations[0]).toMatchObject(operation);
    expect(seams.query.mock.calls).toEqual([["spectraContext:getArtifact", { actorClerkId: "actor", artifactId: artifact._id }]]);
    expect(hydrated.focusedArtifact).toBeNull();
    expect(hydrated.selectedArtifactIds).toEqual([]);
  });

  it("denies a revoked reference even when an earlier context observed it", async () => {
    const context = await buildContext("actor", {}, "Update the task", { mode: "orientation" });
    context.artifacts.push({ id: artifact._id, blueprintKey: artifact.blueprintKey, title: artifact.title,
      summary: undefined, updatedAt: undefined, placements: [] });
    await expect(gatherPlanReferenceContext("actor", context, plan())).rejects.toThrow("no longer accessible");
  });

  it("adds no discovery query for an ordinary answer", async () => {
    const context = await buildContext("actor", {}, "Hello", { mode: "orientation" });
    await gatherPlanReferenceContext("actor", context, parseSpectraPlan({ decision: "answer", operations: [], finalResponse: "Hello." }));
    expect(seams.query).not.toHaveBeenCalled();
    expect(seams.act).not.toHaveBeenCalled();
  });
});
