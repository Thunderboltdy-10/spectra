// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JoinSchoolPage from "../page";

const navigation = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
const clerk = vi.hoisted(() => ({ signOut: vi.fn(async () => {}) }));
vi.mock("@clerk/nextjs", () => ({ useClerk: () => clerk, useUser: () => ({ user: null }) }));
// The page sits in the landing window, which measures itself.
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

function routeResult(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function routeFailure(code: string, message: string, status: number) {
  return {
    ok: false,
    status,
    json: async () => ({ ok: false, error: { code, message, status } }),
  };
}

beforeEach(() => {
  navigation.search = "";
  document.cookie = "spectra_join_token=; Path=/; Max-Age=0";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clerk.signOut.mockClear();
});

describe("join page", () => {
  it("explains where the invitation comes from instead of a Join button that can never enable", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<JoinSchoolPage />);
    expect(
      screen.getByRole("heading", { name: "Open your invitation link" }),
    ).toBeTruthy();
    expect(screen.getByText(/invitation link your school emailed you/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Join school" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "How to get an invitation" }).getAttribute("href"),
    ).toBe("/request-access");
  });

  it("treats an expired invitation as a final answer: no retry, no machine code", async () => {
    navigation.search = "token=expired-token";
    const fetchMock = vi.fn().mockResolvedValue(
      routeResult({
        outcome: "unavailable",
        reason: "expired",
        message: "This invitation has expired.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<JoinSchoolPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This invitation has expired.");
    expect(alert.textContent).not.toContain("INVITATION_EXPIRED");
    expect(screen.queryByRole("button", { name: "Check the invitation again" })).toBeNull();
    expect(document.cookie).not.toContain("expired-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows an unknown link as unavailable from a successful check", async () => {
    navigation.search = "token=unknown-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        routeResult({
          outcome: "unavailable",
          reason: "invalid",
          message: "This invitation is unavailable.",
        }),
      ),
    );
    render(<JoinSchoolPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This invitation is unavailable.");
    expect(screen.queryByRole("button", { name: "Check the invitation again" })).toBeNull();
    // A link that can never work offers no Join at all, only the way back.
    expect(screen.getByRole("heading", { name: "This invitation can’t be used" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Join/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Open Spectra" }).getAttribute("href")).toBe("/workspace");
    expect(document.cookie).not.toContain("unknown-token");
  });

  it("still offers a retry when the check failed for a transient reason", async () => {
    navigation.search = "token=live-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        routeFailure(
          "INTERNAL_ERROR",
          "Spectra could not finish this request. Check your connection, then try again.",
          500,
        ),
      ),
    );
    render(<JoinSchoolPage />);
    expect(
      await screen.findByRole("button", { name: "Check the invitation again" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Use a different account" }),
    );
    expect(clerk.signOut).toHaveBeenCalledWith({
      redirectUrl: "/sign-in?redirect_url=%2Fjoin%3Ftoken%3Dlive-token",
    });
  });

  it("lets someone signed in with another email switch to the invited one", async () => {
    navigation.search = "token=mismatch-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          outcome: "available",
          schoolName: "Riverside School",
          role: "student",
          emailMatches: false,
          alreadyMember: false,
        }),
      }),
    );
    render(<JoinSchoolPage />);
    await screen.findByRole("heading", { name: "Join Riverside School" });
    expect(
      (screen.getByRole("button", { name: "Join as a student" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Use a different account" }),
    );
    expect(clerk.signOut).toHaveBeenCalledWith({
      redirectUrl: "/sign-in?redirect_url=%2Fjoin%3Ftoken%3Dmismatch-token",
    });
  });
});
