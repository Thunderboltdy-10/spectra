// @vitest-environment jsdom

import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatShell } from "../pages/chat-shell";

const mocks = vi.hoisted(() => {
  const router = { push: vi.fn(), replace: vi.fn() };
  const store = {
    openObjects: [],
    closePresentation: vi.fn(),
  };
  const useStore = Object.assign(
    (selector: (state: typeof store) => unknown) => selector(store),
    { getState: () => store },
  );
  return {
    router,
    searchParams: new URLSearchParams(),
    useStore,
    runOptions: {
      current: null as {
        onDataChanged?: () => Promise<unknown> | unknown;
      } | null,
    },
    getThreads: vi.fn(),
    getOverview: vi.fn(),
    getThread: vi.fn(),
    getResultCards: vi.fn(),
    postSpectra: vi.fn(),
    run: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    trash: vi.fn(),
    restore: vi.fn(),
    placement: { current: null as { node: { nodeId: string } } | null },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
    message: vi.fn(),
  },
}));

vi.mock("@/stores/spectra-context-store", () => ({
  useSpectraContextStore: mocks.useStore,
}));

vi.mock("../events", () => ({
  spectraBus: {
    emit: vi.fn(),
    on: vi.fn(() => () => {}),
    handle: vi.fn(() => () => {}),
  },
}));

vi.mock("../data/api", () => ({
  getSpectraThreads: mocks.getThreads,
  getSpectraOverview: mocks.getOverview,
  getSpectraThread: mocks.getThread,
  getSpectraResultCards: mocks.getResultCards,
  getSpectraArtifact: vi.fn(),
  getSpectraRunDetail: vi.fn(),
  postSpectra: mocks.postSpectra,
}));

vi.mock("../organization/tree-client", () => ({
  useTreePlacement: () => mocks.placement.current,
  useTreeActions: () => ({ trash: mocks.trash, restore: mocks.restore }),
}));

vi.mock("../settings/preference-store", () => ({
  useSpectraPreferences: () => ({ preferences: {}, replace: vi.fn() }),
}));

vi.mock("../commands/application-dispatcher", () => ({
  createApplicationCommandDispatcher: () => vi.fn(),
}));

vi.mock("../hooks/use-spectra-context", () => ({
  useSpectraContext: () => ({
    composerThread: null,
    setComposerThread: vi.fn(),
    explicitContextIds: new Set<string>(),
    contextArtifactIds: [],
    explicitContextObjects: [],
    clearExplicitContext: vi.fn(),
    toggleExplicitArtifact: vi.fn(),
    setVisibleArtifactIds: vi.fn(),
    setActiveWorkspaceContext: vi.fn(),
  }),
}));

vi.mock("../ai/use-spectra-run", () => ({
  useSpectraRun: (options: {
    onDataChanged?: () => Promise<unknown> | unknown;
  }) => {
    mocks.runOptions.current = options;
    return {
      cards: [],
      liveExchange: null,
      submitting: false,
      activeRunId: null,
      run: mocks.run,
      stop: vi.fn(),
      steer: vi.fn(),
      retry: vi.fn(),
      revise: vi.fn(),
      onCardAction: vi.fn(),
    };
  },
}));

vi.mock("../components/conversation-surface", () => ({
  ConversationSurface: ({
    empty,
    loadError,
    detail,
    loading,
    onChoice,
  }: {
    empty: ReactNode;
    loadError?: ReactNode;
    detail?: { messages?: Array<{ _id: string; content: string }> } | null;
    loading?: boolean;
    onChoice?: (choice: {
      title: string;
      key: string;
      clarificationId: string;
      choiceMessageId: string;
      executionId: string;
    }) => void;
  }) => (
    <div data-testid="conversation-surface">
      {loading ? <div>Loading conversation</div> : null}
      {!loading && loadError ? loadError : null}
      {!loading && !detail ? empty : null}
      {detail?.messages?.map((message) => (
        <p key={message._id}>{message.content}</p>
      ))}
      {onChoice ? (
        <button
          type="button"
          onClick={() =>
            onChoice({
              title: "Student",
              key: "student",
              clarificationId: "clarification-1",
              choiceMessageId: "message-1",
              executionId: "run-1",
            })
          }
        >
          Answer saved question
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("../components/command-bar", () => ({
  CommandBar: () => <div data-testid="command-bar" />,
}));

vi.mock("../components/context-controls", () => ({
  ContextFocusControl: () => null,
  GlobalSearch: () => <button type="button">Search work</button>,
}));

vi.mock("../components/composer-artifact-dock", () => ({
  ComposerArtifactDock: () => null,
}));

vi.mock("../components/shell-activity-field", () => ({
  ShellActivityField: () => null,
}));

vi.mock("../components/artifact-studio-shell", () => ({
  StudioSplitPlaceholder: () => null,
  useArtifactStudioState: () => ({
    activeArtifact: null,
    activeArtifactId: null,
    dirtyIds: new Set<string>(),
    isOpen: false,
    mode: "split",
    tabs: [],
    closeStudio: vi.fn(),
    openSplit: vi.fn(),
    openTab: vi.fn(),
    activateTab: vi.fn(),
    closeTab: vi.fn(),
    setDirty: vi.fn(),
  }),
}));

vi.mock("../collaboration/follow", () => ({
  disengageFollow: vi.fn(),
  isProgrammaticFollowOpen: () => false,
}));

vi.mock("../collaboration/follow-ai", () => ({
  disengageFollowAi: vi.fn(),
  isProgrammaticOpen: () => false,
}));

vi.mock("../motion", () => ({
  CrossfadeText: ({ value }: { value: string }) => <span>{value}</span>,
}));

beforeEach(() => {
  mocks.searchParams = new URLSearchParams();
  mocks.getThreads.mockReset();
  mocks.getOverview.mockReset();
  mocks.getThread.mockReset();
  mocks.getResultCards.mockResolvedValue({ resultCards: [] });
  mocks.getThreads.mockResolvedValue({ threads: [] });
  mocks.getOverview.mockResolvedValue({ workspaces: [], artifacts: [] });
  mocks.run.mockReset();
  mocks.toastError.mockReset();
  mocks.runOptions.current = null;
  mocks.placement.current = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChatShell load states", () => {
  it("does not turn an initial chat read failure into a welcome state", async () => {
    mocks.getThreads.mockRejectedValueOnce(new Error("gateway unavailable"));
    render(<ChatShell />);

    expect(await screen.findByText("Chat could not load")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText(/Bring a half-formed question/)).toBeNull();
  });

  it("keeps an old-thread read failure retryable and separate from a missing thread", async () => {
    mocks.searchParams = new URLSearchParams("threadId=old-thread");
    mocks.getThread.mockRejectedValueOnce(new Error("gateway unavailable"));
    render(<ChatShell />);

    expect(
      await screen.findByText("This conversation could not load"),
    ).toBeTruthy();
    expect(mocks.router.replace).not.toHaveBeenCalledWith("/chat?new=1");
  });

  it("answers a clarification in its existing conversation", async () => {
    mocks.searchParams = new URLSearchParams("threadId=saved-thread");
    mocks.getThread.mockResolvedValueOnce({
      thread: { _id: "saved-thread", title: "Saved conversation" },
      messages: [],
      traces: [],
    });
    render(<ChatShell />);

    fireEvent.click(await screen.findByRole("button", { name: "Answer saved question" }));

    await waitFor(() =>
      expect(mocks.run).toHaveBeenCalledWith(
        "Student",
        [],
        expect.objectContaining({
          threadId: "saved-thread",
          clarificationId: "clarification-1",
          choiceMessageId: "message-1",
          executionId: "run-1",
        }),
      ),
    );
    expect(mocks.router.replace).not.toHaveBeenCalledWith("/chat?new=1");
  });

  it("does not start a new chat when a clarification has lost its thread", async () => {
    render(<ChatShell />);

    fireEvent.click(await screen.findByRole("button", { name: "Answer saved question" }));

    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringContaining("no longer linked to a conversation"),
    );
  });

  it("redirects a confirmed missing thread through the normal new-chat route", async () => {
    mocks.searchParams = new URLSearchParams("threadId=deleted-thread");
    mocks.getThread.mockResolvedValueOnce(null);
    render(<ChatShell />);

    await waitFor(() =>
      expect(mocks.router.replace).toHaveBeenCalledWith("/chat?new=1"),
    );
    expect(screen.queryByText("Chat could not load")).toBeNull();
  });

  it("keeps the last loaded messages visible when a background refresh fails", async () => {
    mocks.searchParams = new URLSearchParams("threadId=old-thread");
    mocks.getThread.mockResolvedValue({
      thread: { _id: "old-thread", title: "Saved conversation" },
      messages: [{ _id: "message-1", content: "Keep this message visible." }],
      traces: [],
    });
    render(<ChatShell />);

    expect(await screen.findByText("Keep this message visible.")).toBeTruthy();
    mocks.getThreads.mockRejectedValueOnce(new Error("gateway unavailable"));

    await act(async () => {
      await mocks.runOptions.current?.onDataChanged?.();
    });

    expect(
      await screen.findByText("This conversation could not refresh"),
    ).toBeTruthy();
    expect(screen.getByText("Keep this message visible.")).toBeTruthy();
    expect(screen.queryByText(/New conversation/)).toBeNull();
  });

  it("restores focus to the runs trigger after closing history", async () => {
    render(<ChatShell />);
    const trigger = screen.getByRole("button", { name: "Open runs" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(await screen.findByRole("heading", { name: "Runs & chats" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close runs" }));

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("does not let an older route load overwrite a newer conversation", async () => {
    const oldLoad = deferred<{
      thread: { _id: string; title: string };
      messages: Array<{ _id: string; content: string }>;
      traces: [];
    }>();
    const newLoad = deferred<{
      thread: { _id: string; title: string };
      messages: Array<{ _id: string; content: string }>;
      traces: [];
    }>();
    mocks.searchParams = new URLSearchParams("threadId=old-thread");
    mocks.getThread.mockImplementation((id: string) =>
      id === "old-thread" ? oldLoad.promise : newLoad.promise,
    );
    const view = render(<ChatShell />);
    await waitFor(() =>
      expect(mocks.getThread).toHaveBeenCalledWith("old-thread"),
    );

    mocks.searchParams = new URLSearchParams("threadId=new-thread");
    await act(async () => {
      view.rerender(<ChatShell />);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(mocks.getThread).toHaveBeenCalledWith("new-thread"),
    );

    await act(async () => {
      newLoad.resolve({
        thread: { _id: "new-thread", title: "New conversation" },
        messages: [{ _id: "new-message", content: "New route wins." }],
        traces: [],
      });
      await newLoad.promise;
    });
    expect(await screen.findByText("New route wins.")).toBeTruthy();

    await act(async () => {
      oldLoad.resolve({
        thread: { _id: "old-thread", title: "Old conversation" },
        messages: [{ _id: "old-message", content: "Stale route loses." }],
        traces: [],
      });
      await oldLoad.promise;
    });
    await waitFor(() => expect(screen.getByText("New route wins.")).toBeTruthy());
    expect(screen.queryByText("Stale route loses.")).toBeNull();
  });
});

describe("ChatShell chat actions", () => {
  function openSavedChat() {
    mocks.searchParams = new URLSearchParams("threadId=saved-thread");
    mocks.getThread.mockResolvedValue({
      thread: { _id: "saved-thread", title: "Saved conversation" },
      messages: [{ _id: "message-1", content: "Hello" }],
      traces: [],
    });
    return render(<ChatShell />);
  }

  it("keeps the rename open and says so when saving the name fails", async () => {
    openSavedChat();
    fireEvent.click(await screen.findByRole("button", { name: "Rename chat" }));
    const field = screen.getByRole("textbox", { name: "Chat name" });
    fireEvent.change(field, { target: { value: "Exam prep" } });
    mocks.postSpectra.mockRejectedValueOnce(new Error("network down"));
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not rename this chat. Try again.",
      ),
    );
    expect(screen.getByRole("textbox", { name: "Chat name" })).toBeTruthy();
  });

  it("does not save an empty chat name", async () => {
    openSavedChat();
    fireEvent.click(await screen.findByRole("button", { name: "Rename chat" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Chat name" }), {
      target: { value: "   " },
    });
    const save = screen.getByRole("button", { name: "Save title" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(save);
    expect(mocks.postSpectra).not.toHaveBeenCalled();
  });

  it("reports a pin that did not save", async () => {
    openSavedChat();
    mocks.postSpectra.mockRejectedValueOnce(new Error("network down"));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Pin chat" }));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not pin this chat. Try again.",
      ),
    );
  });

  it("moves the open chat to the Trash, starts a new chat, and can undo", async () => {
    mocks.placement.current = { node: { nodeId: "node-1" } };
    mocks.trash.mockResolvedValue({ trashed: [] });
    mocks.restore.mockResolvedValue({ restored: [] });
    openSavedChat();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Delete chat" }));
      await Promise.resolve();
    });

    expect(mocks.trash).toHaveBeenCalledWith(["node-1"]);
    await waitFor(() =>
      expect(mocks.router.replace).toHaveBeenCalledWith("/chat?new=1"),
    );
    const [message, options] = mocks.toastSuccess.mock.calls.at(-1)!;
    expect(message).toBe("Chat moved to Trash.");
    await act(async () => {
      options.action.onClick();
      await Promise.resolve();
    });
    expect(mocks.restore).toHaveBeenCalledWith(["node-1"]);
    await waitFor(() =>
      expect(mocks.router.replace).toHaveBeenCalledWith(
        "/chat?threadId=saved-thread",
      ),
    );
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
