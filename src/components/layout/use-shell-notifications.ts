"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getSpectraNotificationCenter,
  markSpectraArtifactCommentNotificationsRead,
  markSpectraPlannerReminderNotificationsRead,
  markSpectraTimetableReminderNotificationsRead,
  type SpectraArtifactCommentNotification,
  type SpectraPlannerReminderNotification,
  type SpectraShareInvitation,
  type SpectraTimetableReminderNotification,
} from "@/features/spectra/data/api";
import { spectraBus } from "@/features/spectra/events";
import { buildShellNotifications, type ShellNotification } from "./shell-notifications";

const TONE: Record<ShellNotification["kind"], "needs" | "info"> = { share: "info", comment: "info", planner: "needs", timetable: "needs" };

/**
 * The account's notifications: shares, comments, planner and timetable
 * reminders. Push events and focus cover the interactive path; the fallback
 * poll is sparse and never fetches in a hidden tab.
 */
export function useShellNotifications() {
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<SpectraArtifactCommentNotification[]>([]);
  const [planner, setPlanner] = useState<SpectraPlannerReminderNotification[]>([]);
  const [timetable, setTimetable] = useState<SpectraTimetableReminderNotification[]>([]);
  const [invitations, setInvitations] = useState<SpectraShareInvitation[]>([]);
  // What the user already knew of; anything new after the first load reaches them through the island.
  const known = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const center = await getSpectraNotificationCenter(false, 30);
      setComments(center.comments);
      setPlanner(center.planner);
      setTimetable(center.timetable);
      setInvitations(center.invitations);
      const fresh = buildShellNotifications(center);
      const before = known.current;
      if (before) {
        // Oldest first, so the newest is the one left showing.
        for (const item of [...fresh].reverse()) {
          if (before.has(item.id) || item.readAt) continue;
          spectraBus.emit("island.notify", { id: item.id, title: item.title, detail: item.detail, tone: TONE[item.kind] });
        }
      }
      known.current = new Set(fresh.map((item) => item.id));
    } catch {
      // Navigation stays fully usable when the notification service is unavailable.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 180_000);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", refreshVisible);
    const removeChanged = spectraBus.on("notifications.changed", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      removeChanged();
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh]);

  const items = useMemo(
    () => buildShellNotifications({ comments, planner, timetable, invitations }),
    [comments, invitations, planner, timetable],
  );
  // Pending share invitations are outstanding actions, not clearable unread
  // notifications: they stay listed with their Review link but never count.
  const unreadCount = items.filter((item) => !item.readAt && item.kind !== "share").length;

  const markAllRead = useCallback(async () => {
    const unread = <T extends { _id: string; readAt?: number }>(rows: T[]) => rows.filter((item) => !item.readAt).map((item) => item._id);
    const [commentIds, plannerIds, timetableIds] = [unread(comments), unread(planner), unread(timetable)];
    await Promise.all([
      commentIds.length ? markSpectraArtifactCommentNotificationsRead(commentIds) : Promise.resolve(),
      plannerIds.length ? markSpectraPlannerReminderNotificationsRead(plannerIds) : Promise.resolve(),
      timetableIds.length ? markSpectraTimetableReminderNotificationsRead(timetableIds) : Promise.resolve(),
    ]);
    await refresh();
  }, [comments, planner, refresh, timetable]);

  const markRead = useCallback(
    async (item: ShellNotification) => {
      if (item.readAt || item.kind === "share") return;
      if (item.kind === "comment") await markSpectraArtifactCommentNotificationsRead([item.id]);
      else if (item.kind === "planner") await markSpectraPlannerReminderNotificationsRead([item.id]);
      else await markSpectraTimetableReminderNotificationsRead([item.id]);
      await refresh();
    },
    [refresh],
  );

  return { items, unreadCount, loading, refresh, markAllRead, markRead };
}
