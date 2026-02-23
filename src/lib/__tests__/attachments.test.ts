import { describe, expect, it, vi } from "vitest";
import { gateCapabilities } from "@/lib/attachments/capability-gate";
import { normalizeAttachments } from "@/lib/attachments/normalizer";
import { toOpenRouterMessages } from "@/lib/orchestrator/compose";
import type { ChatMessage } from "@/types";
import { MODEL_CONFIG } from "@/lib/model-config";

describe("attachment capability gate", () => {
  it("passes through when selected model already supports vision", () => {
    const result = gateCapabilities({
      selectedModel: MODEL_CONFIG.multimodal,
      requiresVision: true,
      fallbackModels: [MODEL_CONFIG.tutorFast],
    });

    expect(result.modelSwitched).toBe(false);
    expect(result.requiresPrepass).toBe(false);
    expect(result.finalModel).toBe(MODEL_CONFIG.multimodal);
  });

  it("switches to vision-capable fallback when primary cannot see images", () => {
    const result = gateCapabilities({
      selectedModel: MODEL_CONFIG.marker,
      requiresVision: true,
      fallbackModels: [MODEL_CONFIG.multimodal, MODEL_CONFIG.marker],
    });

    expect(result.modelSwitched).toBe(true);
    expect(result.finalModel).toBe(MODEL_CONFIG.multimodal);
    expect(result.requiresPrepass).toBe(false);
  });

  it("requests prepass when no vision fallback exists", () => {
    const result = gateCapabilities({
      selectedModel: MODEL_CONFIG.marker,
      requiresVision: true,
      fallbackModels: [MODEL_CONFIG.gptOss],
    });

    expect(result.modelSwitched).toBe(false);
    expect(result.requiresPrepass).toBe(true);
    expect(result.prepassModel).toBe(MODEL_CONFIG.multimodal);
  });
});

describe("toOpenRouterMessages", () => {
  const history: ChatMessage[] = [
    {
      _id: "1",
      role: "user",
      content: "Explain this image",
      mode: "tutor",
      citations: [],
      createdAt: Date.now(),
    },
  ];

  it("emits multipart content for last user message when image blocks exist", () => {
    const messages = toOpenRouterMessages(history, [
      { type: "image_url", image_url: { url: "data:image/png;base64,abc", detail: "auto" } },
    ]);

    expect(Array.isArray(messages[0]?.content)).toBe(true);
  });

  it("emits plain text content when no image blocks exist", () => {
    const messages = toOpenRouterMessages(history);
    expect(typeof messages[0]?.content).toBe("string");
  });
});

describe("normalizeAttachments", () => {
  it("normalizes image and document resources", async () => {
    const imageBytes = Buffer.from([137, 80, 78, 71]).buffer;

    const convexQuery = (vi.fn(async (name: string, args: Record<string, unknown>) => {
      void args;
      if (name === "resources:getResourcesByIds") {
        return [
          {
            _id: "res-image",
            filename: "diagram.png",
            mimeType: "image/png",
            size: 300_000,
            scope: "personal",
            status: "processed",
          },
          {
            _id: "res-doc",
            filename: "notes.pdf",
            mimeType: "application/pdf",
            size: 120_000,
            scope: "personal",
            status: "processed",
            quickExtractText: "Newton's second law summary",
          },
        ];
      }

      if (name === "resources:getResourceDownloadUrl") {
        return { url: "https://example.com/file" };
      }

      throw new Error(`Unexpected query ${name}`);
    }) as unknown) as <T>(name: string, args: Record<string, unknown>) => Promise<T>;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(imageBytes, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      ),
    );

    const result = await normalizeAttachments({
      actorClerkId: "test",
      resourceIds: ["res-image", "res-doc"],
      convexQuery,
    });

    expect(result.prepared).toHaveLength(2);
    expect(result.imageContentBlocks).toHaveLength(1);
    expect(result.quickExtractBlock).toContain("ATTACHMENT CONTEXT");
    expect(result.requiresVision).toBe(true);

    vi.unstubAllGlobals();
  });
});
