import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("editor ai-edit route integration", () => {
  it("stores artifact edit interactions in the artifact thread and returns thread metadata", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_edit" });
    const convexQuery = vi.fn()
      .mockResolvedValueOnce({ _id: "artifact_1", workstreamId: "ws_1", title: "Essay draft" })
      .mockResolvedValueOnce({ tier: "normal" })
      .mockResolvedValueOnce([]);
    const convexMutation = vi.fn()
      .mockResolvedValueOnce({ chatId: "chat_artifact_1", created: true })
      .mockResolvedValueOnce({ messageId: "msg_user_1" })
      .mockResolvedValueOnce({ messageId: "msg_assistant_1" });
    const getLiveCatalogSnapshot = vi.fn().mockResolvedValue({ models: [] });
    const pickModelAndFallbacks = vi.fn().mockReturnValue({
      selected: { modelId: "openai/gpt-5-nano" },
      fallbacks: [],
    });
    const inferRoutingLane = vi.fn().mockReturnValue("deep_reasoning");
    const openRouterChatCompletion = vi.fn().mockResolvedValue({
      model: "openai/gpt-5-nano",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      choices: [
        {
          message: {
            content: JSON.stringify({
              ops: [{ type: "replace", from: 0, to: 4, content: "Revised", reason: "clarity" }],
              summary: "Improved the opening sentence.",
            }),
          },
        },
      ],
    });
    const recordOpenRouterUsage = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));
    vi.doMock("@/lib/openrouter-catalog-cache", () => ({ getLiveCatalogSnapshot }));
    vi.doMock("@/lib/model-selection", () => ({ pickModelAndFallbacks, inferRoutingLane }));
    vi.doMock("@/lib/openrouter", () => ({ openRouterChatCompletion }));
    vi.doMock("@/lib/usage-tracking", () => ({ recordOpenRouterUsage }));

    const route = await import("@/app/api/editor/ai-edit/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/editor/ai-edit", {
        method: "POST",
        body: JSON.stringify({
          instruction: "Improve the opening sentence.",
          document: { type: "doc", content: [] },
          documentText: "Test draft",
          artifactId: "artifact_1",
        }),
      }),
    );

    const payload = (await response.json()) as {
      summary: string;
      threadChatId: string;
      assistantMessageId: string;
      ops: Array<{ type: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.summary).toBe("Improved the opening sentence.");
    expect(payload.threadChatId).toBe("chat_artifact_1");
    expect(payload.assistantMessageId).toBe("msg_assistant_1");

    expect(convexMutation).toHaveBeenNthCalledWith(1, "chats:getOrCreateArtifactThread", {
      actorClerkId: "user_edit",
      artifactId: "artifact_1",
      mode: "document",
      thinkingLevel: "low",
      routerMode: "auto",
      usePersonalResources: true,
      title: "Essay draft edits",
    });
    expect(convexMutation).toHaveBeenNthCalledWith(2, "chats:appendMessage", expect.objectContaining({
      actorClerkId: "user_edit",
      chatId: "chat_artifact_1",
      role: "user",
      content: "Improve the opening sentence.",
    }));
    expect(convexMutation).toHaveBeenNthCalledWith(3, "chats:appendMessage", expect.objectContaining({
      actorClerkId: "user_edit",
      chatId: "chat_artifact_1",
      role: "assistant",
      content: "Improved the opening sentence.",
      parentMessageId: "msg_user_1",
    }));
  });

  it("accepts blank documents and sanitizes invalid model ops", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_edit" });
    const convexQuery = vi.fn()
      .mockResolvedValueOnce({ tier: "normal" })
      .mockResolvedValueOnce([]);
    const convexMutation = vi.fn();
    const getLiveCatalogSnapshot = vi.fn().mockResolvedValue({ models: [] });
    const pickModelAndFallbacks = vi.fn().mockReturnValue({
      selected: { modelId: "openai/gpt-5-nano" },
      fallbacks: [],
    });
    const inferRoutingLane = vi.fn().mockReturnValue("deep_reasoning");
    const openRouterChatCompletion = vi.fn().mockResolvedValue({
      model: "openai/gpt-5-nano",
      usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
      choices: [
        {
          message: {
            content: JSON.stringify({
              ops: [
                { type: "insert", from: -10, to: 99, content: "Intro", reason: "" },
                { type: "replace", from: 3.7, to: 1, content: "Ignored?" },
                { type: "unknown", from: 0, to: 1, content: "bad" },
              ],
              summary: "   ",
            }),
          },
        },
      ],
    });
    const recordOpenRouterUsage = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));
    vi.doMock("@/lib/openrouter-catalog-cache", () => ({ getLiveCatalogSnapshot }));
    vi.doMock("@/lib/model-selection", () => ({ pickModelAndFallbacks, inferRoutingLane }));
    vi.doMock("@/lib/openrouter", () => ({ openRouterChatCompletion }));
    vi.doMock("@/lib/usage-tracking", () => ({ recordOpenRouterUsage }));

    const route = await import("@/app/api/editor/ai-edit/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/editor/ai-edit", {
        method: "POST",
        body: JSON.stringify({
          instruction: "Start the document.",
          document: { type: "doc", content: [] },
          documentText: "",
        }),
      }),
    );

    const payload = (await response.json()) as {
      summary: string;
      ops: Array<{ type: string; from: number; to: number; reason: string }>;
      threadChatId?: string;
      assistantMessageId?: string;
    };

    expect(response.status).toBe(200);
    expect(payload.summary).toBe("Applied AI edit suggestions.");
    expect(payload.ops).toEqual([
      { type: "insert", from: 0, to: 0, content: "Intro", reason: "AI edit" },
      { type: "replace", from: 0, to: 0, content: "Ignored?", reason: "AI edit" },
    ]);
    expect(payload.threadChatId).toBeUndefined();
    expect(payload.assistantMessageId).toBeUndefined();
    expect(convexMutation).not.toHaveBeenCalled();
  });
});
