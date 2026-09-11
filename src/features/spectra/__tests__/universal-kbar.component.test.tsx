// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UniversalKBar } from "../components/universal-kbar";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace",
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../settings/preference-store", () => ({
  useSpectraPreferences: () => ({
    preferences: { ai: { continueCurrentConversation: false } },
    replace: vi.fn(),
  }),
}));

vi.mock("../viewport-readiness", () => ({
  requestViewportAction: async ({ navigate }: { navigate: () => void | Promise<void> }) => {
    await navigate();
    return {
      actionId: "test-action",
      targetId: "chat",
      view: "conversation",
      routeGeneration: 1,
      status: "ready",
    };
  },
}));

describe("UniversalKBar", () => {
  afterEach(() => {
    cleanup();
    push.mockReset();
  });

  it("opens with the command shortcut, supports query selection, and routes through the host", async () => {
    render(<UniversalKBar />);
    fireEvent.keyDown(window, { key: "k" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Spectra command bar" })).toBeTruthy();

    const input = screen.getByPlaceholderText("Search commands, work, workspaces, conversations…");
    fireEvent.change(input, { target: { value: "new conversation" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start a new conversation" }));
      await Promise.resolve();
    });
    expect(push).toHaveBeenCalledWith("/chat?new=1");
  });
});
