"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BookmarkCheck, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

type BookmarkedMessage = {
  _id: string;
  chatId: string;
  messageId: string;
  note?: string;
  createdAt: number;
  chatTitle: string;
  message: {
    _id: string;
    role: "user" | "assistant" | "system";
    content: string;
    createdAt?: number;
  } | null;
};

type BookmarkGroup = {
  chatId: string;
  chatTitle: string;
  latestAt: number;
  items: BookmarkedMessage[];
};

function compactText(value?: string) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function clip(value: string, max = 280) {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}...`;
}

export default function BookmarksPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [removingMessageId, setRemovingMessageId] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkedMessage[]>([]);
  const [query, setQuery] = useState("");

  async function loadBookmarks(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await fetch("/api/bookmarks");
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { bookmarks?: BookmarkedMessage[] };
      setBookmarks(payload.bookmarks ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load bookmarks");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadBookmarks();
  }, []);

  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean) return bookmarks;
    return bookmarks.filter((item) => {
      const haystack = `${item.chatTitle} ${item.message?.content ?? ""}`.toLowerCase();
      return haystack.includes(clean);
    });
  }, [bookmarks, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, BookmarkGroup>();
    for (const item of filtered) {
      const existing = map.get(item.chatId);
      if (existing) {
        existing.items.push(item);
        existing.latestAt = Math.max(existing.latestAt, item.createdAt);
        continue;
      }
      map.set(item.chatId, {
        chatId: item.chatId,
        chatTitle: item.chatTitle || "Untitled chat",
        latestAt: item.createdAt,
        items: [item],
      });
    }

    return [...map.values()]
      .map((group) => ({
        ...group,
        items: [...group.items].sort((a, b) => b.createdAt - a.createdAt),
      }))
      .sort((a, b) => b.latestAt - a.latestAt);
  }, [filtered]);

  async function removeBookmark(item: BookmarkedMessage) {
    if (removingMessageId) return;
    setRemovingMessageId(item.messageId);
    try {
      const response = await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: item.chatId,
          messageId: item.messageId,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      setBookmarks((prev) => prev.filter((entry) => entry.messageId !== item.messageId));
      toast.success("Bookmark removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove bookmark");
    } finally {
      setRemovingMessageId(null);
    }
  }

  return (
    <Suspense fallback={<div className="p-10 text-center text-sm text-[var(--text-secondary)]">Loading...</div>}>
      <AppShell fullBleed contentClassName="2xl:px-14">
      <section className="space-y-6">
        <div data-tour="bookmarks-header" className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl">Bookmarks</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {bookmarks.length} saved message{bookmarks.length === 1 ? "" : "s"} · Save key explanations to revisit later.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search bookmarks"
              className="h-9 w-full max-w-sm rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm outline-none transition focus:ring-2 focus:ring-[var(--accent-cyan)]/40"
            />
            <Button type="button" variant="secondary" onClick={() => void loadBookmarks({ silent: true })} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-40 animate-pulse rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]" />
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 text-center">
            <BookmarkCheck className="mx-auto h-8 w-8 text-[var(--text-secondary)]" />
            <h2 className="mt-3 text-lg font-semibold">No bookmarks yet</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Save assistant messages from chat to build your personal study highlight reel.
            </p>
            <Link
              href="/chat"
              className="mt-4 inline-flex items-center rounded-full border border-[var(--border-default)] px-4 py-2 text-sm transition hover:bg-[var(--bg-hover)]"
            >
              Open chat
            </Link>
          </div>
        ) : (
          <div data-tour="bookmarks-list" className="divide-y divide-[var(--border-default)] border-t border-[var(--border-default)]">
            {grouped.map((group) => (
              <article key={group.chatId} className="py-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">{group.chatTitle}</h2>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {group.items.length} bookmark{group.items.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Link
                    href={`/chat?chatId=${encodeURIComponent(group.chatId)}`}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] px-3 py-1.5 text-xs transition hover:bg-[var(--bg-hover)]"
                  >
                    Open chat
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>

                <div className="space-y-3">
                  {group.items.map((item) => {
                    const text = clip(compactText(item.message?.content) || "Message unavailable.");
                    return (
                      <div
                        key={item._id}
                        className="border-l-2 border-[var(--accent-cyan)] pl-3"
                      >
                        <p className="text-sm leading-relaxed text-[var(--text-primary)]">{text}</p>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
                          <span>Saved {new Date(item.createdAt).toLocaleString()}</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 text-[var(--danger)]"
                            onClick={() => void removeBookmark(item)}
                            disabled={removingMessageId === item.messageId}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {removingMessageId === item.messageId ? "Removing..." : "Remove"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
    </Suspense>
  );
}
