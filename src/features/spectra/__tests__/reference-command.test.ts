import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const seams = vi.hoisted(() => ({ mutate: vi.fn(), query: vi.fn(), apply: vi.fn() }));
vi.mock("@/app/api/spectra/run/loop/io", () => ({ mutate: seams.mutate, query: seams.query }));
vi.mock("../ai/yjs-artifact-operation", () => ({ applyAiArtifactMutation: seams.apply }));
import { executeReferenceInsertion } from "@/app/api/spectra/run/loop/reference-command";

const input = { actorClerkId: "actor", runId: "run", executionId: "attempt", operationId: "operation", hostWorkId: "host", targetWorkId: "source" };
const receipt = { phase: "canonical_write", operationId: "operation", embedId: "embed", versionId: "version" };

describe("reference durable acknowledgement", () => {
  let saved: boolean;
  beforeEach(() => {
    vi.clearAllMocks();
    saved = false;
    seams.mutate.mockResolvedValue({ embedId: "embed" });
    seams.query.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "artifactEmbeds:getPlacementReceipt") return saved ? receipt : null;
      return { blueprintKey: "document", title: args.artifactId === "host" ? "Host" : "Source", compatibilityProfile: "enhanced" };
    });
    seams.apply.mockImplementation(async (params: { beforeCommit: () => Promise<void> }) => {
      await params.beforeCommit();
      saved = true;
      return { artifactId: "host", changedRegionIds: ["reference-region"] };
    });
  });

  it("awaits a canonical receipt with no mounted editor dependency", async () => {
    const result = await executeReferenceInsertion(input);
    expect(result).toMatchObject({ status: "canonical_write", receipt, replayed: false });
    expect(seams.apply).toHaveBeenCalledWith(expect.objectContaining({ runId: "run", executionId: "attempt", operationId: "operation", artifactId: "host" }));
    expect(seams.mutate).toHaveBeenCalledWith("artifactEmbeds:create", expect.objectContaining({ placementOperationId: "operation", sourceArtifactId: "source" }));
  });

  it("reconciles persistence followed by a lost acknowledgement without a second insertion", async () => {
    seams.apply.mockImplementationOnce(async () => { saved = true; throw new Error("lost acknowledgement"); });
    await expect(executeReferenceInsertion(input)).rejects.toThrow("lost acknowledgement");
    expect(await executeReferenceInsertion({ ...input, executionId: "restarted-attempt" })).toMatchObject({ replayed: true, receipt });
    expect(seams.apply).toHaveBeenCalledTimes(1);
    const placements = seams.mutate.mock.calls.map((call) => call[1]);
    expect(placements[0]).toEqual(placements[1]);
  });

  it("does not start or commit an insertion after an explicit Stop", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Stopped"));
    await expect(executeReferenceInsertion({ ...input, signal: controller.signal })).rejects.toThrow();
    expect(seams.mutate).not.toHaveBeenCalled();
    const during = new AbortController();
    seams.apply.mockImplementationOnce(async (params) => { during.abort(new Error("Stopped")); await params.beforeCommit(); saved = true; });
    await expect(executeReferenceInsertion({ ...input, signal: during.signal })).rejects.toThrow();
    expect(saved).toBe(false);
  });

  it("retains the strict-native limitation before creating a provisional embed", async () => {
    seams.query.mockResolvedValueOnce({ blueprintKey: "document", compatibilityProfile: "strict-native" });
    await expect(executeReferenceInsertion(input)).rejects.toThrow("Enhanced");
    expect(seams.mutate).not.toHaveBeenCalled();
  });
});
