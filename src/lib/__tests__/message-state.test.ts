import { describe, expect, it } from "vitest";
import { ChatMessageAccumulator } from "@/lib/chat/message-state";

function minimalRouteTrace() {
  return {
    inputs: {
      routerMode: "auto",
      mode: "general",
      thinkingLevel: "low",
      complexPrompt: false,
      promptCategory: "general",
      needsSearch: false,
      needsRag: false,
      needsVision: false,
      hasAttachments: false,
      attachmentTypes: [],
      promptEnhanced: false,
      messageLength: 0,
      spendingTier: "normal",
    },
    selected: { modelId: "openai/gpt-5-nano", reason: "test" },
    candidates: [],
    toolchain: [],
    fallbacks: [],
    routingDurationMs: 0,
    executionEvents: [],
  };
}

describe("ChatMessageAccumulator", () => {
  it("builds assistant state from streamed events", () => {
    let counter = 0;
    const accumulator = new ChatMessageAccumulator([], () => `m_${++counter}`);

    accumulator.appendUserMessage("Summarize this.");
    accumulator.beginAssistantMessage();
    accumulator.consume({ type: "phase", phase: "routing" });
    accumulator.consume({ type: "route_model", modelUsed: "openai/gpt-5-nano", executionPath: "direct_chat", routeTrace: minimalRouteTrace() });
    accumulator.consume({ type: "model_selected", modelUsed: "openai/gpt-5-nano", executionPath: "direct_chat", routeTrace: minimalRouteTrace() });
    accumulator.consume({ type: "text_delta", content: "Here" });
    accumulator.consume({ type: "text_delta", content: " is a summary." });
    accumulator.consume({ type: "thinking", content: "Considering sources." });
    accumulator.consume({ type: "tool_call", toolName: "search_web" });
    accumulator.consume({
      type: "done",
      citations: [{ url: "https://example.com", title: "Example" }],
    });

    expect(accumulator.phase).toBe("idle");
    expect(accumulator.messages).toHaveLength(2);
    expect(accumulator.messages[1]).toMatchObject({
      role: "assistant",
      content: "Here is a summary.",
      streaming: false,
      modelUsed: "openai/gpt-5-nano",
      activeModel: "openai/gpt-5-nano",
      executionPath: "direct_chat",
      citations: [{ url: "https://example.com", title: "Example" }],
    });
    expect(accumulator.messages[1]?.thinking).toContain("Considering sources.");
    expect(accumulator.messages[1]?.routeTrace?.executionEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tool:search_web",
          kind: "tool",
          label: "Search Web",
          status: "running",
        }),
      ]),
    );
  });

  it("records model selection as metadata without adding fake UI labels", () => {
    let counter = 0;
    const accumulator = new ChatMessageAccumulator([], () => `m_${++counter}`);

    accumulator.appendUserMessage("Hello");
    accumulator.beginAssistantMessage();
    accumulator.consume({ type: "model_selected", modelUsed: "openai/gpt-5-nano", executionPath: "direct_chat" });
    accumulator.consume({ type: "text_delta", content: "Hi there." });

    expect(accumulator.messages[1]).toMatchObject({
      activeModel: "openai/gpt-5-nano",
      content: "Hi there.",
    });
    expect(accumulator.messages[1]?.thinking).toBeUndefined();
  });

  it("records tool calls as structured runtime events instead of prose notes", () => {
    let counter = 0;
    const accumulator = new ChatMessageAccumulator([], () => `m_${++counter}`);

    accumulator.appendUserMessage("Research this.");
    accumulator.beginAssistantMessage();
    accumulator.consume({
      type: "model_selected",
      modelUsed: "openai/gpt-5-nano",
      executionPath: "research_workflow",
      routeTrace: minimalRouteTrace(),
    });
    accumulator.consume({ type: "tool_call", toolName: "search_web", toolCallId: "call_1" });
    accumulator.consume({ type: "tool_result", toolName: "search_web", toolCallId: "call_1", summary: "Found 3 sources." });

    expect(accumulator.messages[1]?.thinking).toBeUndefined();
    expect(accumulator.messages[1]?.routeTrace?.executionEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tool:call_1",
          kind: "tool",
          status: "completed",
          detail: "Found 3 sources.",
        }),
      ]),
    );
  });

  it("records tool results with structured result and error fields", () => {
    let counter = 0;
    const accumulator = new ChatMessageAccumulator([], () => `m_${++counter}`);

    accumulator.appendUserMessage("Use a tool.");
    accumulator.beginAssistantMessage();
    accumulator.consume({
      type: "model_selected",
      modelUsed: "openai/gpt-5-nano",
      routeTrace: minimalRouteTrace(),
    });
    accumulator.consume({ type: "tool_call", toolName: "search_web", toolCallId: "call_1", arguments: "{\"query\":\"exam dates\"}" });
    accumulator.consume({
      type: "tool_result",
      toolName: "search_web",
      toolCallId: "call_1",
      status: "failed",
      summary: "Search failed.",
      result: { sourceCount: 0 },
      error: "Provider timeout",
    });

    expect(accumulator.messages[1]?.thinking).toBeUndefined();
    expect(accumulator.messages[1]?.routeTrace?.executionEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tool:call_1",
          kind: "tool",
          status: "failed",
          detail: "Search failed.",
          inputPreview: "{\"query\":\"exam dates\"}",
          resultPreview: { sourceCount: 0 },
          error: "Provider timeout",
        }),
      ]),
    );
  });

  it("keeps search, memory, and worker events out of thinking prose", () => {
    let counter = 0;
    const accumulator = new ChatMessageAccumulator([], () => `m_${++counter}`);

    accumulator.appendUserMessage("Research this.");
    accumulator.beginAssistantMessage();
    accumulator.consume({
      type: "model_selected",
      modelUsed: "openai/gpt-5-nano",
      routeTrace: minimalRouteTrace(),
    });
    accumulator.consume({ type: "search_status", status: "completed", result: { sourceCount: 2 } });
    accumulator.consume({ type: "memory_read", summary: "Loaded preference." });
    accumulator.consume({ type: "agent_summoned", agent: "researcher", model: "openai/gpt-5-nano", preview: "Checking sources." });

    expect(accumulator.messages[1]?.thinking).toBeUndefined();
    expect(accumulator.messages[1]?.routeTrace?.executionEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "search", label: "Search activity" }),
        expect.objectContaining({ kind: "memory", label: "Read memory", detail: "Loaded preference." }),
        expect.objectContaining({ kind: "worker", id: "worker:researcher" }),
      ]),
    );
  });

  it("preserves live runtime events when final done supplies the route trace", () => {
    let counter = 0;
    const accumulator = new ChatMessageAccumulator([], () => `m_${++counter}`);

    accumulator.appendUserMessage("Update this artifact.");
    accumulator.beginAssistantMessage();
    accumulator.consume({ type: "tool_call", toolName: "patch_artifact", toolCallId: "patch_1" });
    accumulator.consume({
      type: "tool_result",
      toolName: "patch_artifact",
      toolCallId: "patch_1",
      summary: "Updated the artifact body.",
    });
    accumulator.consume({
      type: "done",
      modelUsed: "openai/gpt-5-nano",
      routeTrace: {
        ...minimalRouteTrace(),
        executionEvents: [
          {
            id: "artifact-event",
            kind: "artifact",
            label: "Artifact saved",
            status: "completed",
          },
        ],
      },
    });

    expect(accumulator.messages[1]?.routeTrace?.executionEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "artifact-event",
          kind: "artifact",
          label: "Artifact saved",
        }),
        expect.objectContaining({
          id: "tool:patch_1",
          kind: "tool",
          status: "completed",
          detail: "Updated the artifact body.",
        }),
      ]),
    );
  });

  it("tracks structured thinking segments independently from final done state", () => {
    let counter = 0;
    const accumulator = new ChatMessageAccumulator([], () => `m_${++counter}`);

    accumulator.appendUserMessage("Patch the artifact.");
    accumulator.beginAssistantMessage();
    accumulator.consume({
      type: "thinking_segment",
      segment: { id: "analysis", label: "Analysis", content: "Inspecting artifact state.", status: "running" },
    });
    accumulator.consume({
      type: "thinking_segment",
      segment: { id: "analysis", label: "Analysis", content: "Inspecting artifact state.", status: "completed" },
    });
    accumulator.consume({ type: "done", modelUsed: "openai/gpt-5-mini" });

    expect(accumulator.messages[1]?.thinkingSegments).toEqual([
      {
        id: "analysis",
        label: "Analysis",
        content: "Inspecting artifact state.",
        status: "completed",
      },
    ]);
    expect(accumulator.messages[1]?.streaming).toBe(false);
  });

  it("removes a placeholder assistant message after failure", () => {
    let counter = 0;
    const accumulator = new ChatMessageAccumulator([], () => `m_${++counter}`);

    accumulator.appendUserMessage("Hello");
    const assistantId = accumulator.beginAssistantMessage();
    accumulator.removeMessage(assistantId);

    expect(accumulator.messages).toHaveLength(1);
    expect(accumulator.messages[0]?.role).toBe("user");
  });
});
