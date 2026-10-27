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

// The header bar and the context panel measure themselves.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

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
  fireEvent.click(await screen.findByRole("button", { name: "Invite people" }));
  fireEvent.change(await screen.findByLabelText("School email addresses"), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Invite as / }));
}

describe("School admin People", () => {
  it("shows authoritative sync review and freshness instead of saying nothing needs attention", async () => {
    navigation.tab = "overview";
    api.getAdministration.mockResolvedValue({ ...overview, integration: { status: "connected", hasOpenConflicts: true, syncFreshness: "current" } });
    render(<SchoolAdminShell />);
    expect(await screen.findByText("ManageBac: needs review")).toBeTruthy();
    expect(screen.queryByText(/Nothing needs you right now/)).toBeNull();
    expect(screen.getByRole("link", { name: "Review ManageBac" }).getAttribute("href")).toBe("/managebac");
    cleanup();
    api.getAdministration.mockResolvedValue({ ...overview, integration: { status: "connected", hasOpenConflicts: false, syncFreshness: "stale" } });
    render(<SchoolAdminShell />);
    expect(await screen.findByText("ManageBac: updates overdue")).toBeTruthy();
  });

  it("loads attachment URLs only for the opened feedback report", async () => {
    navigation.tab = "feedback";
    api.getAdministration.mockImplementation(async (kind: string) => {
      if (kind === "schoolOverview") return overview;
      if (kind === "feedbackInbox") return { feedback: [{ feedbackId: "report-1", subject: "Broken page", message: "Please see my image", category: "issue", status: "new", createdAt: Date.now() }] };
      if (kind === "feedbackEvidence") return { feedbackId: "report-1", pagePath: "/library", screenshotUrl: "https://evidence.example/screenshot.png", attachments: [{ name: "recording.mp4", mediaType: "video/mp4", url: "https://evidence.example/recording.mp4", bytes: 100 }] };
      throw new Error(kind);
    });
    render(<SchoolAdminShell />);
    const report = await screen.findByRole("button", { name: /Broken page/ });
    expect(api.getAdministration.mock.calls.filter(([kind]) => kind === "feedbackEvidence")).toHaveLength(0);
    fireEvent.click(report);
    expect(await screen.findByRole("link", { name: "Open the reporter’s screenshot" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "recording.mp4" }).getAttribute("href")).toBe("https://evidence.example/recording.mp4");
    expect(api.getAdministration.mock.calls.filter(([kind]) => kind === "feedbackEvidence")).toHaveLength(1);
  });

  it("titles the page on one line and opens People from Overview", async () => {
    navigation.tab = "overview";
    render(<SchoolAdminShell />);
    expect(await screen.findByRole("heading", { level: 1, name: "School admin" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^People$/ }));
    expect(navigation.replace).toHaveBeenCalledWith(expect.stringContaining("tab=people"), { scroll: false });
  });

  it("keeps Overview when the People tab is opened offline", async () => {
    navigation.tab = "overview";
    render(<SchoolAdminShell />);
    const people = await screen.findByRole("tab", { name: "People" });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    fireEvent.click(people);
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledExactlyOnceWith("Spectra could not reach the server. Check your connection, then try again.");
    expect(peopleCalls()).toHaveLength(0);
    expect(screen.queryByPlaceholderText("Find someone by name or email")).toBeNull();
  });

  it("answers a sent invitation in the dialog, without a toast", async () => {
    api.mutateAdministration.mockResolvedValue({
      delivery: { status: "sent" },
    });
    await openInvite("ana@sol.example");
    expect(await screen.findByText("Invitation emailed.")).toBeTruthy();
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.warning).not.toHaveBeenCalled();
  });

  it("hands over the link when the invitation email could not go out", async () => {
    api.mutateAdministration.mockResolvedValue({
      delivery: { status: "failed", reason: "Mail is not configured." },
      manualInvitationUrl: "https://spectra.example/invite/abc",
    });
    await openInvite("ana@sol.example");
    const link = (await screen.findByLabelText("Invitation link for ana@sol.example")) as HTMLInputElement;
    expect(link.value).toBe("https://spectra.example/invite/abc");
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("reports a refused invitation beside its address, keeps the dialog, and never rejects", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      api.mutateAdministration.mockRejectedValue(
        new Error("That email is outside this school's verified domains."),
      );
      await openInvite("ana@elsewhere.example");
      expect(await screen.findByText("ana@elsewhere.example")).toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rejections).toEqual([]);
      expect(toasts.success).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeTruthy();
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  it("searches once after typing settles, without refetching invitations", async () => {
    render(<SchoolAdminShell />);
    const input = await screen.findByPlaceholderText(
      "Find someone by name or email",
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

describe("School admin refresh", () => {
  it("keeps a list on screen while it refreshes, instead of flashing a placeholder", async () => {
    navigation.tab = "audit";
    let auditLoads = 0;
    api.getAdministration.mockImplementation(async (kind: string) => {
      if (kind === "schoolOverview") return overview;
      if (kind === "audit") {
        auditLoads += 1;
        if (auditLoads > 1) return new Promise(() => {});
        return { events: [{ eventId: "e1", action: "membership.invite", targetType: "membership", createdAt: Date.now() }] };
      }
      return {};
    });
    render(<SchoolAdminShell />);
    expect(await screen.findByText("Member")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(auditLoads).toBe(2));
    expect(screen.getByText("Member")).toBeTruthy();
    expect(screen.queryByText("Loading audit events")).toBeNull();
  });
});
