import { describe, expect, it } from "vitest";
import { ChatMessageAccumulator } from "@/lib/chat/message-state";

describe("ChatMessageAccumulator", () => {
  it("builds assistant state from streamed events", () => {
    let counter = 0;
    const accumulator = new ChatMessageAccumulator([], () => `m_${++counter}`);

    accumulator.appendUserMessage("Summarize this.");
    accumulator.beginAssistantMessage();
    accumulator.consume({ type: "phase", phase: "routing" });
    accumulator.consume({ type: "route_model", modelUsed: "openai/gpt-5-nano" });
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
      citations: [{ url: "https://example.com", title: "Example" }],
    });
    expect(accumulator.messages[1]?.thinking).toContain("Considering sources.");
    expect(accumulator.messages[1]?.thinking).toContain("[Tool] search web...");
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
