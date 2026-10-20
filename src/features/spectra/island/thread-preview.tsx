"use client";

import { useEffect, useState } from "react";
import { GhostLines } from "@/components/ui/skeleton";
import { SpectraRichContent } from "../components/spectra-rich-content";
import { formatRelativeTime } from "../components/spectra-view-model";
import { getSpectraThreadMessages, type SpectraThread } from "../data/api";

/*
 * A thread seen from Threads before it is opened (ISLAND.md, "Threads"): its
 * last exchange, what was asked and what Spectra answered, on a sheet beside
 * the list. Pointing along the list turns the sheet; pressing opens the
 * thread.
 */

type Exchange = { asked: string; answer: string };

/** The last few messages hold the last exchange. */
const RECENT_MESSAGES = 6;
/** Exchanges already read stay at hand, so pointing back is instant. */
const read = new Map<string, Exchange>();

function useLastExchange(threadId: string) {
  const [exchange, setExchange] = useState<{ threadId: string; value: Exchange } | null>(null);
  useEffect(() => {
    if (read.has(threadId)) return;
    let current = true;
    getSpectraThreadMessages(threadId, undefined, RECENT_MESSAGES)
      .then(({ messages }) => {
        const lastAsked = messages.findLastIndex((message) => message.role === "user");
        const value = {
          asked: lastAsked >= 0 ? messages[lastAsked].content.trim() : "",
          answer: messages
            .slice(lastAsked + 1)
            .filter((message) => message.role === "assistant")
            .map((message) => message.content.trim())
            .filter(Boolean)
            .join("\n\n"),
        };
        read.set(threadId, value);
        if (current) setExchange({ threadId, value });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [threadId]);
  return read.get(threadId) ?? (exchange?.threadId === threadId ? exchange.value : null);
}

export function ThreadPreview({ thread }: { thread: SpectraThread }) {
  const exchange = useLastExchange(thread._id);
  return (
    <aside aria-label={`${thread.title}, last exchange`} className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-[var(--card-border-soft)] px-5 pb-3 pt-4">
        <h3 className="truncate font-display text-title font-medium leading-6 text-[var(--text-primary)]">{thread.title}</h3>
        <p className="text-micro text-[var(--text-tertiary)]">{formatRelativeTime(thread.lastMessageAt ?? thread.updatedAt)}</p>
      </header>
      <div key={thread._id} className="island-content-in min-h-0 flex-1 overflow-hidden px-5 py-4 [mask-image:linear-gradient(to_bottom,black_80%,transparent)]">
        {!exchange ? (
          <GhostLines count={5} />
        ) : (
          <>
            {exchange.asked ? (
              <p className="mb-3 ml-auto w-fit max-w-[85%] rounded-surface bg-[var(--bg-secondary)] px-3 py-1.5 text-ui leading-6 text-[var(--text-primary)]">{exchange.asked}</p>
            ) : null}
            {exchange.answer ? (
              <SpectraRichContent content={exchange.answer} className="text-ui leading-6 text-[var(--text-primary)]" />
            ) : (
              <p className="text-caption text-[var(--text-tertiary)]">No answer yet.</p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
