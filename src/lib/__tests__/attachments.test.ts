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
      modelCatalog: [
        {
          modelId: MODEL_CONFIG.multimodal,
          multimodalRating: "strong",
          tags: ["vision"],
        },
      ],
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
      modelCatalog: [
        {
          modelId: MODEL_CONFIG.marker,
          multimodalRating: "none",
          tags: [],
        },
        {
          modelId: MODEL_CONFIG.multimodal,
          multimodalRating: "strong",
          tags: ["vision"],
        },
      ],
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
    expect(typeof result.prepassModel).toBe("string");
    expect(result.prepassModel?.length).toBeGreaterThan(0);
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

  it("preserves attachment-aware multipart content for historical user messages with attachment ids", () => {
    const messages = toOpenRouterMessages([
      {
        _id: "1",
        role: "user",
        content: "See the attached diagram",
        mode: "tutor",
        citations: [],
        attachmentResourceIds: ["res-1"],
        createdAt: Date.now(),
      },
      {
        _id: "2",
        role: "assistant",
        content: "I reviewed it.",
        mode: "tutor",
        citations: [],
        createdAt: Date.now(),
      },
    ], [
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
            storageId: "storage-image",
          },
          {
            _id: "res-doc",
            filename: "notes.pdf",
            mimeType: "application/pdf",
            size: 120_000,
            scope: "personal",
            status: "processed",
            storageId: "storage-doc",
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
    expect(result.skipped).toHaveLength(0);
    expect(result.imageContentBlocks).toHaveLength(1);
    expect(result.quickExtractBlock).toContain("ATTACHMENT CONTEXT");
    expect(result.requiresVision).toBe(true);

    vi.unstubAllGlobals();
  });

  it("reports failed resources as skipped runtime attachments", async () => {
    const convexQuery = (vi.fn(async (name: string) => {
      if (name === "resources:getResourcesByIds") {
        return [
          {
            _id: "res-failed",
            filename: "broken.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 120_000,
            scope: "personal",
            status: "failed",
            storageId: "storage-doc",
          },
        ];
      }
      throw new Error(`Unexpected query ${name}`);
    }) as unknown) as <T>(name: string, args: Record<string, unknown>) => Promise<T>;

    const result = await normalizeAttachments({
      actorClerkId: "test",
      resourceIds: ["res-failed"],
      convexQuery,
    });

    expect(result.prepared).toHaveLength(0);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        resourceId: "res-failed",
        runtimeStatus: "failed_processing",
        usable: false,
      }),
    ]);
    expect(result.quickExtractBlock).toBe("");
  });
});
