import { describe, expect, it } from "vitest";
import { ChatMessageAccumulator } from "@/lib/chat/message-state";

describe("ChatMessageAccumulator", () => {
  it("builds assistant state from streamed events", () => {
    let counter = 0;
    const accumulator = new ChatMessageAccumulator([], () => `m_${++counter}`);

    accumulator.appendUserMessage("Summarize this.");
    accumulator.beginAssistantMessage();
    accumulator.consume({ type: "phase", phase: "routing" });
    accumulator.consume({ type: "route_model", modelUsed: "openai/gpt-5-nano", executionPath: "direct_chat" });
    accumulator.consume({ type: "model_selected", modelUsed: "openai/gpt-5-nano", executionPath: "direct_chat" });
    accumulator.consume({ type: "delta", content: "Here" });
    accumulator.consume({ type: "delta", content: " is a summary." });
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
    expect(accumulator.messages[1]?.thinking).toContain("[Tool] search web...");
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
