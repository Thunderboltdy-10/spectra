import { describe, expect, it } from "vitest";
import { parseAiClientId, stableAiActorId } from "../collaboration/ai-actor-id";

describe("stable AI actor identity", () => {
  it("keys Follow to the run, not the per-operation client id", () => {
    expect(parseAiClientId("ai:run-9:op-3:preview")).toBe("run-9");
    expect(
      stableAiActorId({
        clientId: "ai:run-9:op-4:preview",
        runId: "run-9",
      }),
    ).toBe("run-9");
  });

  it("prefers an explicit runId over a transport client id", () => {
    expect(
      stableAiActorId({
        clientId: "ai:other:op-1",
        runId: "run-explicit",
      }),
    ).toBe("run-explicit");
  });

  it("returns a bare id unchanged", () => {
    expect(stableAiActorId("run-plain")).toBe("run-plain");
    expect(stableAiActorId(null)).toBeNull();
  });
});
