// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JoinSchoolPage from "../page";

const navigation = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("@/features/spectra/field/surface-field", () => ({
  SurfaceField: () => null,
}));
const clerk = vi.hoisted(() => ({ signOut: vi.fn(async () => {}) }));
vi.mock("@clerk/nextjs", () => ({ useClerk: () => clerk }));

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

  it("does not offer a retry for an expired invitation and never shows the machine code", async () => {
    navigation.search = "token=expired-token";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        routeFailure("INVITATION_EXPIRED", "This invitation has expired.", 410),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<JoinSchoolPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This invitation has expired.");
    expect(alert.textContent).not.toContain("INVITATION_EXPIRED");
    expect(screen.queryByRole("button", { name: "Retry invitation check" })).toBeNull();
    expect(document.cookie).not.toContain("expired-token");
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
      await screen.findByRole("button", { name: "Retry invitation check" }),
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
      (screen.getByRole("button", { name: "Join school" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Use a different account" }),
    );
    expect(clerk.signOut).toHaveBeenCalledWith({
      redirectUrl: "/sign-in?redirect_url=%2Fjoin%3Ftoken%3Dmismatch-token",
    });
  });
});
