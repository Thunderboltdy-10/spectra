import { describe, expect, it } from "vitest";
import {
  toLegacyChatStreamEvent,
  validateAiRunEventContract,
  type AiRun,
  type AiRunEvent,
} from "@/lib/orchestrator/runtime-contract";

describe("Spectra AI runtime event contract", () => {
  it("keeps AiRun events on the runtime contract and validates answer ordering", () => {
    const events: AiRunEvent[] = [
      { type: "model_selected", modelUsed: "openai/gpt-5-nano", executionPath: "direct_chat" },
      { type: "text_delta", content: "Hello" },
      { type: "done", modelUsed: "openai/gpt-5-nano" },
    ];
    const run: AiRun = {
      id: "run_1",
      surface: "chat",
      status: "completed",
      modelUsed: "openai/gpt-5-nano",
      events,
    };

    expect(run.events[0]?.type).toBe("model_selected");
    expect(validateAiRunEventContract(run.events)).toEqual({ ok: true, errors: [] });
  });

  it("rejects answer text before model_selected", () => {
    const result = validateAiRunEventContract([
      { type: "text_delta", content: "Answer first" },
      { type: "model_selected", modelUsed: "openai/gpt-5-nano" },
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("model_selected");
  });

  it("converts runtime text_delta and model_selected to legacy chat stream events only at the boundary", () => {
    expect(toLegacyChatStreamEvent({ type: "text_delta", content: "Hi" })).toMatchObject({
      type: "delta",
      content: "Hi",
    });
    expect(toLegacyChatStreamEvent({ type: "model_selected", modelUsed: "openai/gpt-5-nano" })).toMatchObject({
      type: "route_model",
      modelUsed: "openai/gpt-5-nano",
    });
  });
});
