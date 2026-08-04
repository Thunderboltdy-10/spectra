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
import { cn } from "@/lib/utils";

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

type NotificationBellProps = {
  buttonClassName?: string;
  contentClassName?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  onOpenChange?: (open: boolean) => void;
};

export function NotificationBell({
  buttonClassName,
  contentClassName,
  align = "end",
  side = "bottom",
  sideOffset = 6,
  onOpenChange,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);

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
      return payload;
    } catch {
      // Keep bell non-blocking when notifications are unavailable.
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    void (async () => {
      await refreshNotifications();
    })();
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshNotifications({ silent: true });
    }, 180_000);
    return () => { window.clearInterval(interval); };
  }, [refreshNotifications]);

  useEffect(() => {
    const openBell = () => {
      setOpen(true);
      void refreshNotifications({ silent: true });
    };
    const closeBell = () => setOpen(false);
    window.addEventListener("ai-school:open-notifications", openBell);
    window.addEventListener("ai-school:close-notifications", closeBell);
    return () => {
      window.removeEventListener("ai-school:open-notifications", openBell);
      window.removeEventListener("ai-school:close-notifications", closeBell);
    };
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

  if (!mounted) return null;

  return (
    <DropdownMenu open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
      if (nextOpen) {
        void refreshNotifications({ silent: true });
      }
    }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("relative", buttonClassName)}
          aria-label="Open notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-[var(--danger)] px-1 text-micro font-semibold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} sideOffset={sideOffset} className={cn("w-[360px] p-0", contentClassName)}>
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

        <div className="max-h-[60vh] overflow-y-auto p-2">
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
                <div
                  key={notification._id}
                  role="button"
                  tabIndex={0}
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
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
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
                    <div className="flex items-center gap-1">
                      {!notification.read ? (
                        <button
                          type="button"
                          className="inline-flex rounded-full border border-[var(--border-default)] px-1.5 py-0.5 text-micro text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
                          onClick={(event) => {
                            event.stopPropagation();
                            void markRead(notification._id);
                          }}
                        >
                          Mark read
                        </button>
                      ) : null}
                      {!notification.read ? (
                        <span className="mt-1 inline-flex h-2 w-2 shrink-0 rounded-full bg-[var(--accent-cyan)]" />
                      ) : null}
                    </div>
                  </div>
                  <p
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpandedById((prev) => ({ ...prev, [notification._id]: !prev[notification._id] }));
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      setExpandedById((prev) => ({ ...prev, [notification._id]: !prev[notification._id] }));
                    }}
                    className={`mt-1 w-full text-left text-xs text-[var(--text-secondary)] ${expandedById[notification._id] ? "" : "line-clamp-2"}`}
                  >
                    {notification.body}
                  </p>
                  <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)]">
                    {formatDistanceToNow(notification.createdAt, { addSuffix: true })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
