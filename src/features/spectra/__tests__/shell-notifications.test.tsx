// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildShellNotifications,
  reviewShareInvitations,
  SHARE_INVITATIONS_HREF,
} from "@/components/layout/shell-notifications";
import { spectraBus } from "../events";
import { useShareInvitations } from "../pages/use-share-invitations";

const getInvitations = vi.hoisted(() => vi.fn());
vi.mock("../data/api", () => ({
  getSpectraShareInvitations: getInvitations,
}));

const middayUtc = Date.UTC(2026, 8, 29, 12, 0);

function planner(dueAt: number) {
  return {
    _id: "reminder-1",
    artifactId: "plan-1",
    taskTitle: "Hand in the lab report",
    dueAt,
    createdAt: dueAt - 3_600_000,
  } as Parameters<typeof buildShellNotifications>[0]["planner"][number];
}

describe("notification times", () => {
  it("follow the reader's date conventions instead of forcing US format", () => {
    const [german] = buildShellNotifications(
      { comments: [], planner: [planner(middayUtc)], timetable: [], invitations: [] },
      "de-DE",
    );
    expect(german?.detail).toMatch(/^Due 29\.09\.2026/);

    const [british] = buildShellNotifications(
      { comments: [], planner: [planner(middayUtc)], timetable: [], invitations: [] },
      "en-GB",
    );
    expect(british?.detail).toMatch(/^Due 29 Sept? 2026/);
    expect(british?.detail).not.toMatch(/AM|PM/);
  });
});

describe("Review on a share notification", () => {
  afterEach(() => {
    getInvitations.mockReset();
  });

  it("reopens the collapsed invitations panel even when the URL is unchanged", async () => {
    getInvitations.mockResolvedValue({ invitations: [] });
    const { result } = renderHook(() => useShareInvitations(true));
    expect(result.current.invitationsOpen).toBe(true);

    act(() => result.current.setInvitationsOpen(false));
    expect(result.current.invitationsOpen).toBe(false);

    const push = vi.fn();
    await act(async () => {
      reviewShareInvitations({ push });
      await Promise.resolve();
    });
    expect(push).toHaveBeenCalledWith(SHARE_INVITATIONS_HREF);
    expect(result.current.invitationsOpen).toBe(true);
    expect(getInvitations).toHaveBeenLastCalledWith({ force: true });
  });

  it("stops listening when the Library unmounts", () => {
    getInvitations.mockResolvedValue({ invitations: [] });
    const { unmount } = renderHook(() => useShareInvitations(false));
    unmount();
    getInvitations.mockClear();
    spectraBus.emit("invitations.review", {});
    expect(getInvitations).not.toHaveBeenCalled();
  });
});
