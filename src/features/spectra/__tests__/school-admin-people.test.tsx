// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getAdministration: vi.fn(),
  mutateAdministration: vi.fn(),
}));
const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@/features/spectra/administration/api", () => api);
vi.mock("sonner", () => ({ toast: toasts }));
const navigation = vi.hoisted(() => ({ replace: vi.fn(), tab: "people" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams("tab=" + navigation.tab),
}));

import { SchoolAdminShell } from "../pages/school-admin-shell";

const overview = {
  school: {
    schoolId: "school-1",
    name: "Colegio Sol",
    slug: "sol",
    timezone: "Europe/Madrid",
    verifiedDomains: ["sol.example"],
    status: "active",
    policyVersion: 1,
  },
  operatorSession: null,
  metrics: { members: 0, active30d: 0, invitations: 0, pendingApprovals: 0, groups: 0, classWorkspaces: 0, feedbackNew: 0 },
  metricStates: {}, usage: { series: [], totals: {} },
  groupWorkspaces: [], feedback: [], recentActivity: [], privacy: "Only school data is shown.",
};

function peopleCalls() {
  return api.getAdministration.mock.calls.filter(([kind]) => kind === "people");
}
function invitationCalls() {
  return api.getAdministration.mock.calls.filter(
    ([kind]) => kind === "invitations",
  );
}

beforeEach(() => {
  navigation.tab = "people";
  api.getAdministration.mockImplementation(async (kind: string) => {
    if (kind === "schoolOverview") return overview;
    if (kind === "people") return { people: [] };
    if (kind === "invitations") return { invitations: [] };
    throw new Error(`unexpected ${kind}`);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

async function openInvite(email: string) {
  render(<SchoolAdminShell />);
  fireEvent.click(await screen.findByRole("button", { name: /Invite member/ }));
  fireEvent.change(await screen.findByPlaceholderText("name@school.example"), {
    target: { value: email },
  });
  fireEvent.submit(document.querySelector("#school-invite-form")!);
}

describe("School admin People", () => {
  it("keeps Overview when the People tab is opened offline", async () => {
    navigation.tab = "overview";
    render(<SchoolAdminShell />);
    const people = await screen.findByRole("button", { name: "People" });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    fireEvent.click(people);
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledExactlyOnceWith("Spectra could not reach the server. Check your connection, then try again.");
    expect(peopleCalls()).toHaveLength(0);
    expect(screen.queryByPlaceholderText("Search verified school members")).toBeNull();
  });

  it("answers a sent invitation with exactly one toast", async () => {
    api.mutateAdministration.mockResolvedValue({
      delivery: { status: "sent" },
    });
    await openInvite("ana@sol.example");
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
    await act(async () => {});
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(toasts.success).toHaveBeenCalledWith(
      "Invitation sent to ana@sol.example.",
    );
    expect(toasts.warning).not.toHaveBeenCalled();
  });

  it("answers a manual-delivery invitation with only the warning", async () => {
    api.mutateAdministration.mockResolvedValue({
      delivery: { status: "failed", reason: "Mail is not configured." },
      manualInvitationUrl: "https://spectra.example/invite/abc",
    });
    await openInvite("ana@sol.example");
    await waitFor(() =>
      expect(toasts.warning).toHaveBeenCalledWith("Mail is not configured."),
    );
    expect(toasts.success).not.toHaveBeenCalled();
    expect(
      await screen.findByText("https://spectra.example/invite/abc"),
    ).toBeTruthy();
  });

  it("reports a refused invitation once, keeps the dialog, and never rejects", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      api.mutateAdministration.mockRejectedValue(
        new Error("That email is outside this school's verified domains."),
      );
      await openInvite("ana@elsewhere.example");
      await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rejections).toEqual([]);
      expect(toasts.success).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText("name@school.example")).toBeTruthy();
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  it("searches once after typing settles, without refetching invitations", async () => {
    render(<SchoolAdminShell />);
    const input = await screen.findByPlaceholderText(
      "Search verified school members",
    );
    await waitFor(() => expect(peopleCalls()).toHaveLength(1));
    expect(invitationCalls()).toHaveLength(1);

    vi.useFakeTimers();
    for (const value of ["a", "an", "ana"]) {
      fireEvent.change(input, { target: { value } });
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
    }
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    vi.useRealTimers();
    await waitFor(() => expect(peopleCalls()).toHaveLength(2));
    expect(peopleCalls()[1]?.[1]).toMatchObject({ search: "ana" });
    expect(invitationCalls()).toHaveLength(1);
    // The table stays on screen while the search runs.
    expect(screen.queryByText("Loading members")).toBeNull();
  });
});
