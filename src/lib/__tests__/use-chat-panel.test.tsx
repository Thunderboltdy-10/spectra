// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
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
    const latestRef: { current: ReturnType<typeof useChatPanel> | null } = { current: null };

    function Harness() {
      const panel = useChatPanel({
        mode: "tutor",
        thinkingLevel: "low",
        routerMode: "auto",
      });
      useEffect(() => {
        latestRef.current = panel;
      }, [panel]);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });

    expect(latestRef.current).not.toBeNull();

    await act(async () => {
      await latestRef.current?.sendMessage("Hello from the panel");
    });

    expect(latestRef.current?.streaming).toBe(false);
    expect(latestRef.current?.messages).toEqual([]);
    expect(latestRef.current?.error).toBe("Failed to create chat");
    expect(createChatStream).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
