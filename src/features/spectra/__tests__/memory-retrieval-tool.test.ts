import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeAgentReadTool } from "@/app/api/spectra/run/loop/plan";

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  mutation: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@/lib/convex-server", () => ({
  convexAction: mocks.action,
  convexMutation: mocks.mutation,
  convexQuery: mocks.query,
}));

beforeEach(() => {
  mocks.action.mockReset();
  mocks.mutation.mockReset();
  mocks.query.mockReset();
  mocks.action.mockResolvedValue({
    enabled: true,
    tier: "deep",
    text: "[M1] Use the corrected workflow.",
    claims: [
      {
        citation: "M1",
        claimId: "claim-1",
        proposition: "Use the corrected workflow.",
      },
    ],
    selectedClaimIds: ["claim-1"],
    candidateClaimIds: ["claim-1", "claim-audit-only"],
    exclusions: {
      scope: 0,
      permission: 0,
      stale: 0,
      disputed: 0,
      budget: 1,
    },
    estimatedTokens: 120,
    actualTokens: 148,
    targetTokens: 4_000,
  });
  mocks.mutation.mockResolvedValue("retrieval-event-1");
});

describe("retrieve_memory tool", () => {
  it("persists deep retrieval spend before returning and hides audit-only ids", async () => {
    const result = await executeAgentReadTool("actor-1", {
      name: "retrieve_memory",
      arguments: JSON.stringify({ query: "corrected workflow", depth: "deep" }),
    });

    expect(mocks.action).toHaveBeenCalledWith("memory:contextForRun", {
      actorClerkId: "actor-1",
      queryText: "corrected workflow",
      workspaceId: undefined,
      artifactId: undefined,
      tier: "deep",
    });
    expect(mocks.mutation).toHaveBeenCalledWith(
      "memory:recordRetrieval",
      expect.objectContaining({
        actorClerkId: "actor-1",
        tier: "deep",
        candidateClaimIds: ["claim-1", "claim-audit-only"],
        selectedClaimIds: ["claim-1"],
        estimatedTokens: 120,
        actualTokens: 148,
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        memory: {
          tier: "deep",
          text: "[M1] Use the corrected workflow.",
          estimatedTokens: 120,
          actualTokens: 148,
          targetTokens: 4_000,
        },
      },
    });
    const memory = (result as unknown as { data: { memory: object } }).data
      .memory;
    expect(memory).not.toHaveProperty("candidateClaimIds");
    expect(memory).not.toHaveProperty("selectedClaimIds");
  });

  it("does not return a deep result when its required audit write fails", async () => {
    mocks.mutation.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(
      executeAgentReadTool("actor-1", {
        name: "retrieve_memory",
        arguments: JSON.stringify({
          query: "corrected workflow",
          depth: "deep",
        }),
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "tool_failed",
      message: "audit unavailable",
    });
  });
});
