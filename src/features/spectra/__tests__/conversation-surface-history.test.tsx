// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationSurface, ThreadConversation } from "../components/conversation-surface";
import type { SpectraRun, SpectraThreadDetail } from "../data/api";

const mocks = vi.hoisted(() => ({
  activeExecution: undefined as unknown,
  getMessages: vi.fn(),
  getTrace: vi.fn(),
  postSpectra: vi.fn(),
  useQuery: vi.fn(),
  getThread: vi.fn(),
  workspaceCatalog: { items: [] as Array<{ _id: string; title: string }>, status: "loading", isDone: false, error: null, more: vi.fn(), refresh: vi.fn() },
}));
vi.mock("../data/use-catalog-pages", () => ({ useWorkspaceCatalog: () => mocks.workspaceCatalog }));

vi.mock("convex/react", () => ({ useQuery: mocks.useQuery }));
vi.mock("../data/use-authed-args", () => ({
  useAuthedArgs: (value: unknown) => value,
}));
vi.mock("../data/api", () => ({
  clearSpectraRunAgent: vi.fn(),
  getSpectraOperationConflict: vi.fn(),
  getSpectraThread: mocks.getThread,
  getSpectraThreadMessages: mocks.getMessages,
  getSpectraThreadRunTrace: mocks.getTrace,
  postSpectra: mocks.postSpectra,
  resolveSpectraOperationConflict: vi.fn(),
  submitSpectraAgentFeedback: vi.fn(),
}));
vi.mock("../events", () => ({ spectraBus: { emit: vi.fn(), on: vi.fn(() => () => {}) } }));
vi.mock("../ai/use-spectra-run", () => ({ useSpectraRun: () => ({
  liveExchange: null, cards: [], submitting: false,
  run: vi.fn(), retry: vi.fn(), steer: vi.fn(), stop: vi.fn(), onCardAction: vi.fn(),
}) }));
vi.mock("../collaboration/run-ledger", () => ({
  operationCounts: () => ({ proposed: 0, active: 0, completed: 0, failed: 0 }),
  useRunLedger: () => undefined,
}));
vi.mock("../runs/live-dock", () => ({
  publicSpectraFailureText: () => "Saved run failed",
}));
vi.mock("@/components/spectra-mark", () => ({
  SpectraMark: () => <span aria-hidden="true" />,
}));
vi.mock("@/components/spectra-prism-optic", () => ({
  PrismLoader: () => <span aria-hidden="true" />,
}));
vi.mock("@/lib/utils", () => ({ cn: (...values: unknown[]) => values.filter(Boolean).join(" ") }));
vi.mock("../components/spectra-rich-content", () => ({
  SpectraRichContent: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("../components/progress-trace", () => ({
  ProgressTrace: ({ steps, summary }: {
    steps: Array<{ id: string; title: string }>;
    summary?: string;
  }) => <div data-testid="progress-trace">
    {steps.map(step => <span key={step.id}>{step.title}</span>)}
    {summary ? <p>{summary}</p> : null}
  </div>,
}));
vi.mock("../components/artifact-embed-host", () => ({ ArtifactEmbedList: () => null }));
vi.mock("../components/result-card", () => ({
  ResultCardStack: ({ cards }: { cards: Array<{ title: string }> }) => (
    <div data-testid="result-cards">{cards.map((card) => card.title).join(", ")}</div>
  ),
}));
vi.mock("@/components/ui/select", () => ({ SelectField: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const run: SpectraRun = {
  _id: "run-1",
  sourceSurface: "chat",
  threadId: "thread-a",
  status: "completed",
  userPrompt: "show results",
  executionId: "execution-1",
  createdAt: 1,
  updatedAt: 1,
};

const detail = (
  threadId: string,
  content: string,
  hasOlder = false,
): SpectraThreadDetail => ({
  thread: {
    _id: threadId,
    title: threadId,
    origin: "chat",
    status: "active",
    createdAt: 1,
    updatedAt: 1,
  },
  messages: [
    {
      _id: `${threadId}-message`,
      threadId,
      role: "assistant" as const,
      content,
      runId: "run-1",
      createdAt: 1,
    },
  ],
  traces: [],
  messagePage: hasOlder
    ? { hasOlder: true, olderBefore: `${threadId}-cursor` }
    : { hasOlder: false },
});

beforeEach(() => {
  mocks.getThread.mockReset();
  mocks.workspaceCatalog.items = [];
  mocks.workspaceCatalog.status = "loading";
  mocks.workspaceCatalog.isDone = false;
  mocks.workspaceCatalog.more.mockReset();
  mocks.activeExecution = undefined;
  mocks.getMessages.mockReset();
  mocks.getTrace.mockReset();
  mocks.postSpectra.mockReset();
  mocks.postSpectra.mockResolvedValue({ ok: true });
  mocks.useQuery.mockReset();
  mocks.useQuery.mockReturnValue(undefined);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ConversationSurface history and saved results", () => {
  it("restores the latest unanswered run's saved failure and Retry after reload", async () => {
    mocks.useQuery.mockReturnValue(null);
    const source = detail("thread-a", "Create a document");
    source.thread.lastRunId = run._id;
    source.messages[0].role = "user";
    source.activeExecution = null;
    mocks.getTrace.mockResolvedValue({ run: { ...run, status: "failed", retryable: true }, operations: [], cards: [], events: [], artifacts: [] });
    const retry = vi.fn();
    render(<ConversationSurface detail={source} threadId="thread-a" onRetryRun={retry} />);
    expect(await screen.findByText("Spectra paused this run")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledWith(run._id);
    expect(mocks.getTrace).toHaveBeenCalledTimes(3);
  });
  it.each([false, true])("discards a cached interruption after Retry completes (observed active: %s)", async (observeActive) => {
    mocks.useQuery.mockReturnValue(null);
    const source = detail("thread-a", "Hi");
    source.thread.lastRunId = run._id;
    source.messages[0].role = "user";
    source.activeExecution = null;
    const failed = { run: { ...run, status: "failed", retryable: true }, operations: [], cards: [], events: [], artifacts: [] };
    mocks.getTrace.mockResolvedValue(failed);
    const view = render(<ConversationSurface detail={source} threadId="thread-a" onRetryRun={vi.fn()} />);
    expect(await screen.findByText("Spectra paused this run")).toBeTruthy();
    expect(mocks.getTrace).toHaveBeenCalledTimes(3);
    if (observeActive) {
      mocks.useQuery.mockReturnValue({ run: { ...run, executionId: "retry", status: "running" } });
      view.rerender(<ConversationSurface detail={source} threadId="thread-a" onRetryRun={vi.fn()} />);
      expect(screen.queryByText("Spectra paused this run")).toBeNull();
    }
    mocks.useQuery.mockReturnValue(null);
    const completed = { ...source, messages: [...source.messages, { _id: "retry-answer", threadId: "thread-a", runId: run._id, role: "assistant" as const, content: "Hi! What would you like help with?", createdAt: 3 }] };
    view.rerender(<ConversationSurface detail={completed} threadId="thread-a" onRetryRun={vi.fn()} />);
    expect(screen.getByText("Hi! What would you like help with?")).toBeTruthy();
    expect(screen.queryByText("Spectra paused this run")).toBeNull();
    expect(mocks.getTrace).toHaveBeenCalledTimes(3);
    mocks.getTrace.mockResolvedValue({ ...failed, run: { ...run, executionId: "retry", status: "completed" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Show details" })[0]);
    await waitFor(() => expect(mocks.getTrace).toHaveBeenCalledTimes(6));
    expect(screen.queryByText("Spectra paused this run")).toBeNull();
  });

  it("reloads a new failed attempt instead of restoring the earlier failure cache", async () => {
    mocks.useQuery.mockReturnValue(null);
    const source = detail("thread-a", "Create a deck");
    source.thread.lastRunId = run._id;
    source.messages[0].role = "user";
    source.activeExecution = null;
    mocks.getTrace.mockResolvedValue({ run: { ...run, status: "failed", retryable: true }, operations: [], cards: [], events: [], artifacts: [] });
    const view = render(<ConversationSurface detail={source} threadId="thread-a" onRetryRun={vi.fn()} />);
    expect(await screen.findByText("Spectra paused this run")).toBeTruthy();
    mocks.useQuery.mockReturnValue({ run: { ...run, executionId: "retry", status: "running" } });
    view.rerender(<ConversationSurface detail={source} threadId="thread-a" onRetryRun={vi.fn()} />);
    expect(screen.queryByText("Spectra paused this run")).toBeNull();
    mocks.getTrace.mockResolvedValue({ run: { ...run, executionId: "retry", status: "failed", retryable: false }, operations: [], cards: [{ _id: "retry-card", runId: run._id, status: "failed", title: "Current attempt recovery", variant: "status", actions: [], updatedAt: 3 }], events: [], artifacts: [] });
    mocks.useQuery.mockReturnValue(null);
    view.rerender(<ConversationSurface detail={source} threadId="thread-a" onRetryRun={vi.fn()} />);
    expect(await screen.findByText("Spectra could not complete this request")).toBeTruthy();
    expect(mocks.getTrace).toHaveBeenCalledTimes(6);
    expect(screen.queryByText("Spectra paused this run")).toBeNull();
  });

  it("rejects an in-flight old failure trace after a retry answer arrives", async () => {
    mocks.useQuery.mockReturnValue(null);
    const source = detail("thread-a", "Hi");
    source.thread.lastRunId = run._id;
    source.messages[0].role = "user";
    source.activeExecution = null;
    const pending: Array<(value: unknown) => void> = [];
    mocks.getTrace.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const view = render(<ConversationSurface detail={source} threadId="thread-a" onRetryRun={vi.fn()} />);
    await waitFor(() => expect(pending).toHaveLength(3));
    const completed = { ...source, messages: [...source.messages, { _id: "retry-answer", threadId: "thread-a", runId: run._id, role: "assistant" as const, content: "Retry succeeded", createdAt: 3 }] };
    view.rerender(<ConversationSurface detail={completed} threadId="thread-a" onRetryRun={vi.fn()} />);
    await act(async () => { for (const resolve of pending) resolve({ run: { ...run, status: "failed", retryable: true }, operations: [], cards: [], events: [], artifacts: [] }); });
    expect(screen.getByText("Retry succeeded")).toBeTruthy();
    expect(screen.queryByText("Spectra paused this run")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Show details" }).length).toBeGreaterThan(0);
  });

  it("reveals recovery when the selected unanswered run settles, without loading active history", async () => {
    const source = detail("thread-a", "Create a document");
    source.thread.lastRunId = run._id;
    source.messages[0].role = "user";
    mocks.useQuery.mockReturnValue({ run: { ...run, status: "running" } });
    mocks.getTrace.mockResolvedValue({ run: { ...run, status: "failed", retryable: true }, operations: [], cards: [], events: [], artifacts: [] });
    const view = render(<ConversationSurface detail={source} threadId="thread-a" onRetryRun={vi.fn()} />);
    expect(mocks.getTrace).not.toHaveBeenCalled();
    mocks.useQuery.mockReturnValue(null);
    view.rerender(<ConversationSurface detail={source} threadId="thread-a" onRetryRun={vi.fn()} />);
    expect(await screen.findByText("Spectra paused this run")).toBeTruthy();
    expect(mocks.getTrace).toHaveBeenCalledTimes(3);
  });

  it("keeps a failed recovery read retryable without an automatic request loop", async () => {
    const source = detail("thread-a", "Create a document");
    source.thread.lastRunId = run._id;
    source.messages[0].role = "user";
    mocks.useQuery.mockReturnValue(null);
    mocks.getTrace.mockRejectedValue(new Error("Saved outcome temporarily unavailable"));
    const view = render(<ConversationSurface detail={source} threadId="thread-a" onRetryRun={vi.fn()} />);
    expect(await screen.findByText("Saved outcome temporarily unavailable")).toBeTruthy();
    view.rerender(<ConversationSurface detail={{ ...source }} threadId="thread-a" onRetryRun={vi.fn()} />);
    expect(mocks.getTrace).toHaveBeenCalledTimes(3);
    mocks.getTrace.mockResolvedValue({ run: { ...run, status: "failed", retryable: true }, operations: [], cards: [], events: [], artifacts: [] });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Spectra paused this run")).toBeTruthy();
    expect(mocks.getTrace).toHaveBeenCalledTimes(6);
  });
  it("renders the thread without waiting for workspace discovery", async () => {
    mocks.getThread.mockResolvedValue(detail("thread-a", "The thread is ready"));
    render(<ThreadConversation threadId="thread-a" showComposer={false} />);
    expect(await screen.findByText("The thread is ready")).toBeTruthy();
    expect(mocks.workspaceCatalog.status).toBe("loading");
  });

  it("keeps the real result picker incomplete until its remaining workspace pages load", async () => {
    const source = detail("thread-a", "Saved guide");
    source.traces = [{ run, operations: [], cards: [], events: [], artifacts: [{ _id: "guide", title: "Guide", blueprintKey: "document",
      tags: [], status: "active", createdAt: 1, updatedAt: 1 }] }];
    const view = render(<ConversationSurface detail={source} threadId="thread-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Add to workspace" }));
    expect(screen.getByText("Loading workspaces…")).toBeTruthy();
    expect(screen.queryByText("Create a workspace first.")).toBeNull();
    mocks.workspaceCatalog.items = [{ _id: "first", title: "First workspace" }];
    mocks.workspaceCatalog.status = "ready";
    view.rerender(<ConversationSurface detail={source} threadId="thread-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Load more workspaces" }));
    expect(mocks.workspaceCatalog.more).toHaveBeenCalledTimes(1);
  });
  it("ignores an older-page response after switching to another thread", async () => {
    let resolveOlder!: (value: { messages: never[]; hasOlder: boolean }) => void;
    mocks.getMessages.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOlder = resolve;
      }),
    );
    const first = render(
      <ConversationSurface detail={detail("thread-a", "Thread A", true)} threadId="thread-a" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));
    first.rerender(<ConversationSurface detail={detail("thread-b", "Thread B")} threadId="thread-b" />);
    await screen.findByText("Thread B");

    await act(async () => resolveOlder({ messages: [], hasOlder: false }));
    expect(screen.queryByText("Thread A older")).toBeNull();
    expect(screen.getByText("Thread B")).toBeTruthy();
  });

  it("ignores a stale trace response after switching A to B and back to A", async () => {
    const pending: Array<(value: unknown) => void> = [];
    mocks.getTrace.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const tracePage = (title: string) => ({
      run: { ...run, status: "completed" as const },
      operations: [],
      cards: [],
      events: [
        {
          _id: `event-${title}`,
          runId: run._id,
          executionId: run.executionId,
          sequence: 1,
          type: "progress",
          payload: { title },
          createdAt: 1,
        },
      ],
      artifacts: [],
    });
    const first = render(
      <ConversationSurface detail={detail("thread-a", "Thread A")} threadId="thread-a" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    await waitFor(() => expect(pending).toHaveLength(3));

    first.rerender(<ConversationSurface detail={detail("thread-b", "Thread B")} threadId="thread-b" />);
    await screen.findByText("Thread B");
    first.rerender(
      <ConversationSurface detail={detail("thread-a", "Thread A")} threadId="thread-a" />,
    );
    await screen.findByText("Thread A");
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    await waitFor(() => expect(pending).toHaveLength(6));

    await act(async () => {
      for (const resolve of pending.splice(0, 3)) resolve(tracePage("STALE"));
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Loading…" })).toBeTruthy();

    await act(async () => {
      for (const resolve of pending.splice(0, 3)) resolve(tracePage("FRESH"));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Loading…" })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Show details" })).toBeNull();
  });

  it("shows live execution changes and saved result cards without reloading history", async () => {
    const activeRun: SpectraRun = { ...run, status: "running" };
    mocks.useQuery.mockReturnValue({ run: activeRun });
    mocks.getTrace.mockImplementation(async (
      _threadId: string,
      _runId: string,
      options: {
        family?: string;
        eventsCursor?: string;
        operationsBefore?: string;
        cardsBefore?: string;
      },
    ) => ({
      run,
      operations: options.family === "operations"
        ? [{ _id: options.operationsBefore ? "operation-2" : "operation-1", runId: "run-1", type: "artifact.create", status: "executed", input: { title: "Study guide" }, affected: [] }]
        : [],
      cards: options.family === "cards"
        ? options.cardsBefore
          ? []
          : [{ _id: "card-1", runId: "run-1", status: "completed", variant: "artifact", title: "Saved result", actions: [], updatedAt: 1 }]
        : [],
      events: [],
      artifacts: [],
      operationPage: options.family === "operations"
        ? { hasMore: !options.operationsBefore, before: options.operationsBefore ? null : "operations-next" }
        : undefined,
      cardPage: options.family === "cards"
        ? { hasMore: !options.cardsBefore, before: options.cardsBefore ? null : "cards-next" }
        : undefined,
      eventPage: options.family === "events"
        ? { hasMore: !options.eventsCursor, after: 0, nextCursor: options.eventsCursor ? null : "events-next" }
        : undefined,
    }));
    const first = render(
      <ConversationSurface detail={detail("thread-a", "Saved answer")} threadId="thread-a" />,
    );
    expect(await screen.findByText("Still running")).toBeTruthy();

    mocks.useQuery.mockReturnValue(null);
    first.rerender(<ConversationSurface detail={detail("thread-a", "Saved answer")} threadId="thread-a" />);
    expect(await screen.findByText("Saved progress and results")).toBeTruthy();
    expect(mocks.getMessages).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect((await screen.findByTestId("result-cards")).textContent).toContain("Saved result");
    fireEvent.click(screen.getByRole("button", { name: /1 action/ }));
    expect(screen.getByText("Created Study guide")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more run history" }));
    await waitFor(() => expect(mocks.getTrace).toHaveBeenCalledTimes(6));
  });

  it("keeps a clarification choice attached to its originating message and attempt", async () => {
    const source = detail("thread-a", "Choose the destination.");
    const clarificationDetail: SpectraThreadDetail = {
      ...source,
      messages: [
        {
          _id: "clarification-message",
          threadId: "thread-a",
          role: "assistant",
          content: "Choose the destination.",
          runId: "run-1",
          createdAt: 2,
          metadata: {
            choices: {
              question: "Where should the new guide go?",
              options: [
                { key: "workspace-a", title: "Workspace A" },
                { key: "workspace-b", title: "Workspace B" },
              ],
            },
            clarification: {
              id: "clarification-1",
              executionId: "execution-1",
            },
          },
        },
      ],
    };
    const onChoice = vi.fn();
    render(
      <ConversationSurface
        detail={clarificationDetail}
        threadId="thread-a"
        onChoice={onChoice}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Workspace B" }));

    await waitFor(() =>
      expect(mocks.postSpectra).toHaveBeenCalledWith({
        action: "selectMessageChoice",
        messageId: "clarification-message",
        clarificationId: "clarification-1",
        executionId: "execution-1",
        choiceMessageId: "clarification-message",
        choiceKey: "workspace-b",
        choiceTitle: "Workspace B",
      }),
    );
    expect(onChoice).toHaveBeenCalledWith({
      title: "Workspace B",
      key: "workspace-b",
      choiceMessageId: "clarification-message",
      clarificationId: "clarification-1",
      executionId: "execution-1",
    });
  });
});

describe("conversation answer ownership", () => {
  it.each([false, true])("shows a saved answer once after expanding details (compact=%s)", async (compact) => {
    const answer = "The document could not be saved. Here is the prepared draft.";
    mocks.getTrace.mockResolvedValue({
      run: { ...run, finalSummary: answer }, operations: [], cards: [], artifacts: [],
      events: [{
        _id: "validation-progress", runId: run._id, executionId: run.executionId,
        sequence: 1, type: "progress", payload: { title: "Checked the document" }, createdAt: 1,
      }],
    });
    render(<ConversationSurface detail={detail("thread-a", answer)} threadId="thread-a" compact={compact} />);
    expect(screen.getAllByText(answer)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    await screen.findByText("Checked the document");
    expect(screen.getAllByText(answer)).toHaveLength(1);
  });

  it.each([false, true])("shows a live failure answer once beside its trace (compact=%s)", (compact) => {
    const answer = "The document could not be saved. Here is the prepared draft.";
    render(<ConversationSurface detail={null} compact={compact} liveExchange={{
      id: "live-failure", prompt: "Create a document", content: answer,
      status: "failed", startedAt: 1,
      steps: [{ id: "validation", title: "Checked the document", status: "error", createdAt: 1 }],
    }} />);
    expect(screen.getByText("Checked the document")).toBeTruthy();
    expect(screen.getAllByText(answer)).toHaveLength(1);
  });
});
