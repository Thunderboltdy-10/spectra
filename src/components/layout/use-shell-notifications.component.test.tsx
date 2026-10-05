// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spectraBus } from "@/features/spectra/events";
import { useShellNotifications } from "./use-shell-notifications";

const center = vi.hoisted(() => ({
  planner: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/features/spectra/data/api", () => ({
  getSpectraNotificationCenter: async () => ({ comments: [], planner: center.planner, timetable: [], invitations: [] }),
  markSpectraArtifactCommentNotificationsRead: vi.fn(),
  markSpectraPlannerReminderNotificationsRead: vi.fn(),
  markSpectraTimetableReminderNotificationsRead: vi.fn(),
}));

function reminder(id: string, title: string, readAt?: number) {
  return { _id: id, artifactId: "planner", recipientAccountId: "me", reminderId: id, taskTitle: title, dueAt: 0, scheduledFor: 0, status: "delivered", attempts: 1, createdAt: 1, readAt };
}

afterEach(() => {
  center.planner = [];
});

describe("notifications through the island", () => {
  it("sends only what is new since the first load, never what was already there or read", async () => {
    center.planner = [reminder("old", "Old task")];
    const notified = vi.fn();
    const off = spectraBus.on("island.notify", notified);
    const { result } = renderHook(() => useShellNotifications());
    await act(async () => {
      await Promise.resolve();
    });
    expect(notified).not.toHaveBeenCalled();

    center.planner = [reminder("old", "Old task"), reminder("new", "Essay draft"), reminder("seen", "Read already", 5)];
    await act(async () => {
      await result.current.refresh();
    });
    expect(notified).toHaveBeenCalledTimes(1);
    expect(notified).toHaveBeenCalledWith(expect.objectContaining({ id: "new", title: "Essay draft", tone: "needs" }));
    off();
  });
});
