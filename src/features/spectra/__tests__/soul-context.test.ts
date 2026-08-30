import { describe, expect, it } from "vitest";
import {
  CONTEXT_LIMITS,
  buildBoundedContextPacket,
} from "@/features/spectra/ai/context-builder";
import {
  SOUL_CHARACTER_CAP,
  SOUL_TOKEN_CAP,
} from "@/features/spectra/memory/soul-policy";
import {
  buildAgentOrientation,
  fastConversationalPlan,
} from "@/app/api/spectra/run/loop/plan";

describe("soul context", () => {
  it("is first, survives packet compaction, and is capped again at injection", () => {
    const packet = buildBoundedContextPacket({
      prompt: "hello",
      soul: { text: "z".repeat(4_000), userEdited: true },
      focusMode: "global",
      artifacts: Array.from({ length: 80 }, (_, index) => ({
        _id: `artifact-${index}`,
        title: `Artifact ${index} ${"x".repeat(200)}`,
        blueprintKey: "document",
        summary: "y".repeat(500),
        updatedAt: index,
      })),
    });
    const keys = Object.keys(packet);
    expect(keys[0]).toBe("soul");
    expect(keys.indexOf("soul")).toBeLessThan(keys.indexOf("workspaceIndex"));
    expect(keys.indexOf("soul")).toBeLessThan(keys.indexOf("longTermMemory"));
    expect(packet.soul.text).toHaveLength(SOUL_CHARACTER_CAP);
    expect(packet.soul.tokenCount).toBe(SOUL_TOKEN_CAP);
    expect(JSON.stringify(packet).length).toBeLessThanOrEqual(
      CONTEXT_LIMITS.packetCharacters,
    );

    const orientation = buildAgentOrientation(packet, "hello");
    expect(Object.keys(orientation)[0]).toBe("soul");
    expect(orientation.soul).toEqual(packet.soul);
  });

  it("lets the deterministic greeting use the bounded soul", () => {
    const plan = fastConversationalPlan(
      "hello",
      "My name is Pablo. I prefer direct explanations.",
    );
    expect(plan?.finalResponse).toContain("Hi, Pablo!");
  });
});
