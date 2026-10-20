// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UniversalKBar } from "../components/universal-kbar";

const push = vi.fn();
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

vi.mock("../semantic/use-semantic", () => ({
  useSemanticSearch: () => ({ status: "idle", results: [], mode: null, degraded: null, error: null, tookMs: null, answered: null, refresh: () => {} }),
}));

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
      fireEvent.click(screen.getByRole("button", { name: "Start a new thread" }));
      await Promise.resolve();
    });
    expect(push).toHaveBeenCalledWith("/home");
    expect(screen.queryByRole("dialog", { name: "Spectra command bar" })).toBeNull();
  });

  it("tells the reader a setting changed after the bar closes", async () => {
    render(<UniversalKBar />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(
      screen.getByPlaceholderText("Search commands, work, workspaces, conversations…"),
      { target: { value: "continuation" } },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Turn on conversation continuation" }));
      await Promise.resolve();
    });
    expect(screen.queryByRole("dialog", { name: "Spectra command bar" })).toBeNull();
    expect(toastSuccess).toHaveBeenCalledWith(
      "New messages will continue the current conversation.",
    );
  });

  it("puts the cursor in the field a command asks for", async () => {
    render(<UniversalKBar />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(
      screen.getByPlaceholderText("Search commands, work, workspaces, conversations…"),
      { target: { value: "memory" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Update memory" }));
    const field = await screen.findByLabelText("Memory");
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(document.activeElement).toBe(field);
    // Escape steps back to the list instead of closing the bar.
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Spectra command bar" })).toBeTruthy();
    expect(screen.queryByLabelText("Memory")).toBeNull();
  });
});
