// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({ status: "loading" as "loading" | "ready" | "error" }));
vi.mock("@clerk/nextjs", () => ({
  ClerkLoading: ({ children }: { children: ReactNode }) => (clerk.status === "loading" ? children : null),
  ClerkLoaded: ({ children }: { children: ReactNode }) => (clerk.status === "ready" ? children : null),
  ClerkFailed: ({ children }: { children: ReactNode }) => (clerk.status === "error" ? children : null),
}));
import {
  ACCOUNT_CONNECTION_NOTICE_MS,
  ACCOUNT_CONNECTION_STALL_MS,
  AccountConnectionState,
  SignInConnectionState,
} from "../account-connection-state";

beforeEach(() => {
  vi.useFakeTimers();
  clerk.status = "loading";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// LV-059: after a web restart the shell waited on sign-in with an empty,
// aria-busy page forever. A wait must be visible and a stall must say so.
describe("account connection state", () => {
  it("stays quiet briefly, then says it is connecting, then offers a retry when sign-in stalls", () => {
    render(<AccountConnectionState />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(ACCOUNT_CONNECTION_NOTICE_MS));
    expect(screen.getByRole("status").textContent).toBe("Connecting to your account…");
    act(() => vi.advanceTimersByTime(ACCOUNT_CONNECTION_STALL_MS));
    expect(screen.getByRole("alert").textContent).toContain("can't reach the sign-in service");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("reports a failed sign-in load at once", () => {
    clerk.status = "error";
    render(<AccountConnectionState />);
    expect(screen.getByRole("alert").textContent).toContain("can't reach the sign-in service");
  });

  it("names the account record when sign-in answered but the account has not", () => {
    clerk.status = "ready";
    render(<AccountConnectionState />);
    act(() => vi.advanceTimersByTime(ACCOUNT_CONNECTION_NOTICE_MS));
    expect(screen.getByRole("status").textContent).toBe("Opening your workspace…");
    act(() => vi.advanceTimersByTime(ACCOUNT_CONNECTION_STALL_MS));
    expect(screen.getByRole("alert").textContent).toContain("can't load your account");
  });

  it("gives the sign-in card a placeholder and a retry instead of an empty form slot", () => {
    render(<SignInConnectionState />);
    act(() => vi.advanceTimersByTime(ACCOUNT_CONNECTION_NOTICE_MS));
    expect(screen.getByRole("status").textContent).toBe("Loading sign-in…");
    act(() => vi.advanceTimersByTime(ACCOUNT_CONNECTION_STALL_MS));
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    cleanup();
    clerk.status = "ready";
    const { container } = render(<SignInConnectionState />);
    expect(container.textContent).toBe("");
  });
});
