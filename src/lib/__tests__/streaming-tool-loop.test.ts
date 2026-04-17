import { describe, expect, it, vi } from "vitest";
import * as openrouter from "@/lib/openrouter";
import { runAssistantStreaming } from "@/lib/orchestrator/streaming";

describe("runAssistantStreaming tool loop", () => {
  it("executes tool calls and then returns a final answer", async () => {
    const completionSpy = vi.spyOn(openrouter, "openRouterChatCompletion")
      .mockResolvedValueOnce({
        model: "test-model",
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "tool-1",
              function: {
                name: "search_web",
                arguments: JSON.stringify({ query: "latest biology syllabus" }),
              },
            }],
          },
        }],
      } as never)
      .mockResolvedValueOnce({
        model: "test-model",
        usage: { prompt_tokens: 8, completion_tokens: 12 },
        choices: [{
          message: {
            content: "Here is the grounded answer.",
            tool_calls: [],
          },
        }],
      } as never);

    const sent: Array<Record<string, unknown>> = [];
    const result = await runAssistantStreaming({
      shouldVerify: false,
      primaryModel: "test-model",
      fallbackModels: [],
      messages: [{ role: "user", content: "Search the web for the latest biology syllabus." }],
      tools: [{
        type: "function",
        function: {
          name: "search_web",
          description: "search",
          parameters: { type: "object", properties: {} },
        },
      }],
      executeTool: async () => ({
        name: "search_web",
        summary: "Found 2 sources",
        modelPayload: { sources: [{ title: "source" }] },
        eventPayload: { sources: [{ title: "source" }] },
      }),
      send: async (payload) => {
        sent.push(payload);
      },
    });

    expect(completionSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(sent.some((event) => event.type === "tool_call")).toBe(true);
    expect(sent.some((event) => event.type === "tool_result")).toBe(true);
    expect(result.responseText).toContain("grounded answer");
  });

  it("auto-enters the tool loop for artifact-saving workspace prompts", async () => {
    const completionSpy = vi.spyOn(openrouter, "openRouterChatCompletion")
      .mockResolvedValueOnce({
        model: "test-model",
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "tool-1",
              function: {
                name: "create_note",
                arguments: JSON.stringify({ title: "Revision handout" }),
              },
            }],
          },
        }],
      } as never)
      .mockResolvedValueOnce({
        model: "test-model",
        usage: { prompt_tokens: 8, completion_tokens: 12 },
        choices: [{
          message: {
            content: "Saved the revision handout and summarized it.",
            tool_calls: [],
          },
        }],
      } as never);

    const sent: Array<Record<string, unknown>> = [];
    const result = await runAssistantStreaming({
      shouldVerify: false,
      primaryModel: "test-model",
      fallbackModels: [],
      messages: [{ role: "user", content: "Create and save a revision handout in this workspace." }],
      tools: [{
        type: "function",
        function: {
          name: "create_note",
          description: "create note",
          parameters: { type: "object", properties: {} },
        },
      }],
      executeTool: async () => ({
        name: "create_note",
        summary: "Saved note",
        modelPayload: { saved: true },
        eventPayload: { saved: true },
      }),
      send: async (payload) => {
        sent.push(payload);
      },
    });

    expect(completionSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(sent.some((event) => event.type === "tool_call")).toBe(true);
    expect(result.responseText).toContain("Saved the revision handout");
  });
});
