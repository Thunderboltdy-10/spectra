// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    getThreads: vi.fn(),
    getOverview: vi.fn(),
    getThread: vi.fn(),
    getResultCards: vi.fn(),
    postSpectra: vi.fn(),
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
  toast: { error: vi.fn(), message: vi.fn() },
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
  useSpectraRun: () => ({
    cards: [],
    liveExchange: null,
    submitting: false,
    activeRunId: null,
    run: vi.fn(),
    stop: vi.fn(),
    steer: vi.fn(),
    retry: vi.fn(),
    revise: vi.fn(),
    onCardAction: vi.fn(),
  }),
}));

vi.mock("../components/conversation-surface", () => ({
  ConversationSurface: ({ empty }: { empty: ReactNode }) => (
    <div data-testid="conversation-surface">{empty}</div>
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
});
