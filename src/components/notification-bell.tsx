"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NotificationItem = {
  _id: string;
  type: string;
  title: string;
  body: string;
  actionUrl?: string;
  read: boolean;
  createdAt: number;
};

type NotificationsPayload = {
  notifications: NotificationItem[];
  unreadCount: number;
  nextCursor?: string;
  totalCount: number;
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshNotifications = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const response = await fetch("/api/notifications?limit=20");
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as NotificationsPayload;
      setNotifications(payload.notifications ?? []);
      setUnreadCount(payload.unreadCount ?? 0);
    } catch {
      // Keep bell non-blocking when notifications are unavailable.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshNotifications();
    const interval = window.setInterval(() => {
      void refreshNotifications({ silent: true });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [refreshNotifications]);

  async function markRead(notificationId: string) {
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(notificationId)}`, {
        method: "PATCH",
      });
      if (!response.ok) throw new Error(await response.text());

      setNotifications((prev) =>
        prev.map((item) => (item._id === notificationId ? { ...item, read: true } : item)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // Ignore individual read failures in dropdown interactions.
    }
  }

  async function markAllRead() {
    if (markingAllRead || unreadCount <= 0) return;
    setMarkingAllRead(true);
    try {
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "mark_all_read" }),
      });
      if (!response.ok) throw new Error(await response.text());
      setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
      setUnreadCount(0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to mark notifications as read");
    } finally {
      setMarkingAllRead(false);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (nextOpen) {
        void refreshNotifications({ silent: true });
      }
    }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="relative"
          aria-label="Open notifications"
          title="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold">Notifications</p>
            <p className="text-xs text-[var(--text-secondary)]">
              {unreadCount} unread
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => void markAllRead()}
            disabled={markingAllRead || unreadCount <= 0}
          >
            {markingAllRead ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
            Mark all
          </Button>
        </div>

        <div className="max-h-[340px] overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-[var(--text-secondary)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : notifications.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--text-secondary)]">
              No notifications yet.
            </div>
          ) : (
            <div className="space-y-1.5">
              {notifications.map((notification) => (
                <button
                  key={notification._id}
                  type="button"
                  className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                    notification.read
                      ? "border-[var(--border-default)] bg-[var(--bg-elevated)]"
                      : "border-[color-mix(in_oklab,var(--accent-cyan)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-elevated))]"
                  }`}
                  onClick={() => {
                    if (!notification.read) {
                      void markRead(notification._id);
                    }
                    if (notification.actionUrl) {
                      window.location.href = notification.actionUrl;
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-tight">{notification.title}</p>
                    {!notification.read ? (
                      <span className="mt-1 inline-flex h-2 w-2 shrink-0 rounded-full bg-[var(--accent-cyan)]" />
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">{notification.body}</p>
                  <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)]">
                    {formatDistanceToNow(notification.createdAt, { addSuffix: true })}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
