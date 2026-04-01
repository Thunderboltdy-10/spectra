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

  it("emits workspace refresh events after a successful workstream message", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    createChatStream.mockImplementation(async function* () {
      yield { type: "phase", phase: "answering" };
      yield { type: "delta", content: "Resolved" };
      yield { type: "done", modelUsed: "openai/gpt-5-nano" };
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/chats" && init?.method === "POST") {
        return new Response(JSON.stringify({ chatId: "chat_1" }), { status: 200 });
      }
      throw new Error(`Unexpected fetch call: ${String(input)}`);
    }));

    const { useChatPanel } = await import("@/hooks/use-chat-panel");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const latestRef: { current: ReturnType<typeof useChatPanel> | null } = { current: null };
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    function Harness() {
      const panel = useChatPanel({
        workstreamId: "ws_1",
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

    await act(async () => {
      await latestRef.current?.sendMessage("Update the workstream");
    });

    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    const payloads = dispatchSpy.mock.calls
      .map(([event]) => event)
      .filter((event): event is CustomEvent<{ workstreamId?: string; refreshHub?: boolean }> => (
        event instanceof CustomEvent && event.type === "workspace:content-mutated"
      ))
      .map((event) => event.detail);
    expect(payloads).toEqual([
      { workstreamId: "ws_1", refreshHub: true, refreshWorkstreams: true },
      { workstreamId: "ws_1", refreshHub: true },
    ]);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
