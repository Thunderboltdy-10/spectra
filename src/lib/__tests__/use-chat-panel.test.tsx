// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const { createChatStream } = vi.hoisted(() => ({
  createChatStream: vi.fn(),
}));

vi.mock("@/lib/chat/streaming", () => ({
  createChatStream,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("useChatPanel", () => {
  it("rolls back optimistic messages when chat creation fails before a thread exists", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/chats" && init?.method === "POST") {
        return new Response("Failed to create chat", { status: 500 });
      }
      throw new Error(`Unexpected fetch call: ${String(input)}`);
    }));

    const { useChatPanel } = await import("@/hooks/use-chat-panel");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    let latest: ReturnType<typeof useChatPanel> | null = null;

    function Harness() {
      latest = useChatPanel({
        mode: "tutor",
        thinkingLevel: "low",
        routerMode: "auto",
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });

    expect(latest).not.toBeNull();

    await act(async () => {
      await latest?.sendMessage("Hello from the panel");
    });

    expect(latest?.streaming).toBe(false);
    expect(latest?.messages).toEqual([]);
    expect(latest?.error).toBe("Failed to create chat");
    expect(createChatStream).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
