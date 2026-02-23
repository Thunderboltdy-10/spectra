"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import { CheckCircle2, Clock3, Filter, MessageSquareWarning, ShipWheel, ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

type FeedbackStatus = "new" | "in_progress" | "shipped";
type FeedbackCategory = "bug" | "confusing" | "feature" | "safety";

type FeedbackItem = {
  _id: string;
  userId?: string;
  orgId?: string;
  category: FeedbackCategory;
  message: string;
  screenshotStorageId?: string;
  screenshotUrl?: string | null;
  context: {
    mode?: string;
    page?: string;
    device?: string;
    traceId?: string;
  };
  status: FeedbackStatus;
  adminReply?: string;
  createdAt: number;
  updatedAt?: number;
};

const STATUS_OPTIONS: Array<{ value: FeedbackStatus; label: string }> = [
  { value: "new", label: "New" },
  { value: "in_progress", label: "In progress" },
  { value: "shipped", label: "Shipped" },
];

const CATEGORY_OPTIONS: Array<{ value: FeedbackCategory; label: string }> = [
  { value: "bug", label: "Bug" },
  { value: "confusing", label: "Confusing" },
  { value: "feature", label: "Feature" },
  { value: "safety", label: "Safety" },
];

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusTone(status: FeedbackStatus) {
  if (status === "new") return "text-[var(--accent-coral)] bg-[color-mix(in_oklab,var(--accent-coral)_14%,transparent)]";
  if (status === "in_progress") return "text-[var(--warning)] bg-[color-mix(in_oklab,var(--warning)_16%,transparent)]";
  return "text-[var(--success)] bg-[color-mix(in_oklab,var(--success)_16%,transparent)]";
}

function categoryTone(category: FeedbackCategory) {
  if (category === "bug") return "text-[#b91c1c] bg-[color-mix(in_oklab,#b91c1c_15%,transparent)]";
  if (category === "confusing") return "text-[#6b21a8] bg-[color-mix(in_oklab,#6b21a8_15%,transparent)]";
  if (category === "feature") return "text-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_16%,transparent)]";
  return "text-[var(--warning)] bg-[color-mix(in_oklab,var(--warning)_16%,transparent)]";
}

export default function SuperAdminFeedbackInboxPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeStatuses, setActiveStatuses] = useState<Set<FeedbackStatus>>(new Set());
  const [activeCategories, setActiveCategories] = useState<Set<FeedbackCategory>>(new Set());
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [busyStatusId, setBusyStatusId] = useState<string | null>(null);
  const [busyReplyId, setBusyReplyId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/super-admin/feedback?limit=200");
        if (!response.ok) throw new Error(await response.text());
        const payload = (await response.json()) as { feedback: FeedbackItem[] };
        setItems((payload.feedback ?? []).sort((a, b) => b.createdAt - a.createdAt));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load feedback inbox");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const statusOk = activeStatuses.size === 0 || activeStatuses.has(item.status);
      const categoryOk = activeCategories.size === 0 || activeCategories.has(item.category);
      return statusOk && categoryOk;
    });
  }, [activeCategories, activeStatuses, items]);

  async function updateStatus(feedbackId: string, status: FeedbackStatus) {
    setBusyStatusId(feedbackId);
    try {
      const response = await fetch("/api/super-admin/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedbackId, status }),
      });
      if (!response.ok) throw new Error(await response.text());
      setItems((prev) => prev.map((item) => (item._id === feedbackId ? { ...item, status } : item)));
      toast.success("Feedback status updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update status");
    } finally {
      setBusyStatusId(null);
    }
  }

  async function sendReply(feedbackId: string) {
    const reply = replyDrafts[feedbackId]?.trim();
    if (!reply) {
      toast.error("Reply cannot be empty.");
      return;
    }

    setBusyReplyId(feedbackId);
    try {
      const response = await fetch("/api/super-admin/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedbackId, adminReply: reply }),
      });
      if (!response.ok) throw new Error(await response.text());

      setItems((prev) =>
        prev.map((item) =>
          item._id === feedbackId
            ? {
                ...item,
                adminReply: reply,
                status: item.status === "new" ? "in_progress" : item.status,
              }
            : item,
        ),
      );
      setReplyDrafts((prev) => ({ ...prev, [feedbackId]: "" }));
      toast.success("Reply sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send reply");
    } finally {
      setBusyReplyId(null);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Link
                href="/super-admin"
                className="text-xs text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
              >
                Super Admin
              </Link>
              <span className="text-xs text-[var(--text-secondary)]">/</span>
              <span className="text-xs text-[var(--text-primary)]">Feedback</span>
            </div>
            <h1 className="font-display text-3xl text-[var(--text-primary)]">Feedback Inbox</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Review incoming feedback, triage status, and reply to users.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3 text-sm text-[var(--text-secondary)]">
            {loading ? "Loading..." : `${filteredItems.length} items`}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-card)]">
          <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            <Filter className="h-3.5 w-3.5" />
            Filters
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-[var(--text-secondary)]">Status</p>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((status) => {
                  const active = activeStatuses.has(status.value);
                  return (
                    <button
                      key={status.value}
                      type="button"
                      onClick={() =>
                        setActiveStatuses((prev) => {
                          const next = new Set(prev);
                          if (next.has(status.value)) next.delete(status.value);
                          else next.add(status.value);
                          return next;
                        })
                      }
                      className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition ${
                        active
                          ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] text-[var(--text-primary)]"
                          : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {status.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-[var(--text-secondary)]">Category</p>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_OPTIONS.map((category) => {
                  const active = activeCategories.has(category.value);
                  return (
                    <button
                      key={category.value}
                      type="button"
                      onClick={() =>
                        setActiveCategories((prev) => {
                          const next = new Set(prev);
                          if (next.has(category.value)) next.delete(category.value);
                          else next.add(category.value);
                          return next;
                        })
                      }
                      className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition ${
                        active
                          ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] text-[var(--text-primary)]"
                          : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {category.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 text-sm text-[var(--text-secondary)]">
              Loading feedback...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-10 text-center">
              <MessageSquareWarning className="mx-auto mb-3 h-8 w-8 text-[var(--text-secondary)]" />
              <p className="text-sm text-[var(--text-secondary)]">No feedback items match the current filters.</p>
            </div>
          ) : (
            filteredItems.map((item) => {
              const expanded = expandedId === item._id;
              const statusLabel = STATUS_OPTIONS.find((s) => s.value === item.status)?.label ?? item.status;
              const categoryLabel = CATEGORY_OPTIONS.find((c) => c.value === item.category)?.label ?? item.category;

              return (
                <article key={item._id} className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-card)]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${categoryTone(item.category)}`}>
                          {categoryLabel}
                        </span>
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusTone(item.status)}`}>
                          {statusLabel}
                        </span>
                        <span className="text-xs text-[var(--text-secondary)]">{formatDate(item.createdAt)}</span>
                      </div>
                      <p className={`text-sm text-[var(--text-primary)] ${expanded ? "" : "line-clamp-2"}`}>
                        {item.message}
                      </p>
                    </div>

                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setExpandedId((prev) => (prev === item._id ? null : item._id))}
                      className="cursor-pointer"
                    >
                      {expanded ? "Hide" : "View"}
                    </Button>
                  </div>

                  {expanded ? (
                    <div className="mt-4 space-y-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                      <div className="grid gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
                        <p>
                          <span className="font-semibold text-[var(--text-primary)]">Page:</span>{" "}
                          {item.context.page ?? "—"}
                        </p>
                        <p>
                          <span className="font-semibold text-[var(--text-primary)]">Mode:</span>{" "}
                          {item.context.mode ?? "—"}
                        </p>
                        <p>
                          <span className="font-semibold text-[var(--text-primary)]">Trace ID:</span>{" "}
                          {item.context.traceId ?? "—"}
                        </p>
                        <p className="truncate">
                          <span className="font-semibold text-[var(--text-primary)]">Device:</span>{" "}
                          {item.context.device ?? "—"}
                        </p>
                      </div>

                      {item.screenshotUrl ? (
                        <a href={item.screenshotUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-[var(--border-default)]">
                          <Image
                            src={item.screenshotUrl}
                            alt="Feedback screenshot"
                            width={900}
                            height={520}
                            className="max-h-[260px] w-full object-cover"
                            unoptimized
                          />
                        </a>
                      ) : null}

                      <div>
                        <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                          <Clock3 className="h-3.5 w-3.5" />
                          Triage
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={item.status === "in_progress" ? "default" : "secondary"}
                            className="cursor-pointer gap-1.5"
                            disabled={busyStatusId === item._id}
                            onClick={() => void updateStatus(item._id, "in_progress")}
                          >
                            <ShieldAlert className="h-3.5 w-3.5" />
                            Mark In Progress
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={item.status === "shipped" ? "default" : "secondary"}
                            className="cursor-pointer gap-1.5"
                            disabled={busyStatusId === item._id}
                            onClick={() => void updateStatus(item._id, "shipped")}
                          >
                            <ShipWheel className="h-3.5 w-3.5" />
                            Mark Shipped
                          </Button>
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Reply
                        </p>
                        <textarea
                          value={replyDrafts[item._id] ?? item.adminReply ?? ""}
                          onChange={(event) =>
                            setReplyDrafts((prev) => ({
                              ...prev,
                              [item._id]: event.target.value,
                            }))
                          }
                          placeholder="Write a reply..."
                          className="min-h-[88px] w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                        />
                        <div className="mt-2 flex justify-end">
                          <Button
                            type="button"
                            size="sm"
                            disabled={busyReplyId === item._id}
                            className="cursor-pointer"
                            onClick={() => void sendReply(item._id)}
                          >
                            {busyReplyId === item._id ? "Sending..." : "Send reply"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </div>
    </AppShell>
  );
}
