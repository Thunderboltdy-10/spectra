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
  it("forwards global scopeLevel when no workspace or artifact scope is active", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    createChatStream.mockClear();
    createChatStream.mockImplementation(async function* () {
      yield { type: "phase", phase: "answering" };
      yield { type: "delta", content: "General answer" };
      yield { type: "done", modelUsed: "openai/gpt-5-nano" };
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/chats" && init?.method === "POST") {
        return new Response(JSON.stringify({ chatId: "chat_scope_global" }), { status: 200 });
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

    await act(async () => {
      await latestRef.current?.sendMessage("Give me a broad study strategy");
    });

    expect(createChatStream).toHaveBeenCalled();
    const lastCall = createChatStream.mock.calls[createChatStream.mock.calls.length - 1];
    const callArgs = lastCall[0] as Record<string, unknown>;
    expect(callArgs.scopeLevel ?? "global").toBe("global");
    expect(callArgs.workstreamId).toBeUndefined();
    expect(callArgs.artifactId).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
    container.remove();
    createChatStream.mockClear();
  });

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
    createChatStream.mockClear();
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

  it("reuses a single in-flight chat creation request for concurrent sends", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let resolveChatCreation: ((value: Response) => void) | null = null;
    createChatStream.mockImplementation(async function* () {
      yield { type: "phase", phase: "answering" };
      yield { type: "delta", content: "Done" };
      yield { type: "done", modelUsed: "openai/gpt-5-nano" };
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/chats" && init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolveChatCreation = resolve;
        });
      }
      if (String(input) === "/api/chats/chat_1/messages/stream" && init?.method === "POST") {
        return Promise.resolve(new Response("unused", { status: 200 }));
      }
      throw new Error(`Unexpected fetch call: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useChatPanel } = await import("@/hooks/use-chat-panel");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const latestRef: { current: ReturnType<typeof useChatPanel> | null } = { current: null };

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
      const firstSend = latestRef.current?.sendMessage("First message");
      const secondSend = latestRef.current?.sendMessage("Second message");

      expect(fetchMock).toHaveBeenCalledTimes(1);

      if (!resolveChatCreation) {
        throw new Error("Chat creation resolver was not captured");
      }
      resolveChatCreation(new Response(JSON.stringify({ chatId: "chat_1" }), { status: 200 }));

      await Promise.all([firstSend, secondSend]);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createChatStream.mock.calls.length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("forwards scope metadata (workstreamId, artifactId, scopeLevel) to createChatStream", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    createChatStream.mockClear();
    createChatStream.mockImplementation(async function* () {
      yield { type: "phase", phase: "answering" };
      yield { type: "delta", content: "Edited" };
      yield { type: "done", modelUsed: "openai/gpt-5-nano" };
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/chats" && init?.method === "POST") {
        return new Response(JSON.stringify({ chatId: "chat_scope_1" }), { status: 200 });
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
        workstreamId: "ws_scope",
        artifactId: "artifact_7",
        scopeLevel: "artifact",
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
      await latestRef.current?.sendMessage("Fix this paragraph");
    });

    expect(createChatStream).toHaveBeenCalled();
    const lastCall = createChatStream.mock.calls[createChatStream.mock.calls.length - 1];
    const callArgs = lastCall[0] as Record<string, unknown>;
    expect(callArgs.workstreamId).toBe("ws_scope");
    expect(callArgs.artifactId).toBe("artifact_7");
    expect(callArgs.scopeLevel).toBe("artifact");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("infers artifact scopeLevel from artifactId when scopeLevel is not provided", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    createChatStream.mockClear();
    createChatStream.mockImplementation(async function* () {
      yield { type: "phase", phase: "answering" };
      yield { type: "delta", content: "Updated" };
      yield { type: "done", modelUsed: "openai/gpt-5-nano" };
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/chats" && init?.method === "POST") {
        return new Response(JSON.stringify({ chatId: "chat_scope_2" }), { status: 200 });
      }
      throw new Error(`Unexpected fetch call: ${String(input)}`);
    }));

    const { useChatPanel } = await import("@/hooks/use-chat-panel");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const latestRef: { current: ReturnType<typeof useChatPanel> | null } = { current: null };

    function Harness() {
      // No explicit scopeLevel — should infer "artifact" from artifactId
      const panel = useChatPanel({
        workstreamId: "ws_scope",
        artifactId: "artifact_7",
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
      await latestRef.current?.sendMessage("Improve this");
    });

    expect(createChatStream).toHaveBeenCalled();
    const lastCall = createChatStream.mock.calls[createChatStream.mock.calls.length - 1];
    const callArgs = lastCall[0] as Record<string, unknown>;
    expect(callArgs.scopeLevel).toBe("artifact");
    expect(callArgs.artifactId).toBe("artifact_7");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});