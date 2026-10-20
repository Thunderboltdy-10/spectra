"use client";

import { useEffect, useState } from "react";
import { getSpectraThreadMessages } from "../data/api";

/** The last few messages hold a finished run's reply; older ones belong to earlier runs. */
const RECENT_MESSAGES = 6;

/**
 * The reply a finished run wrote, whole. The tab index carries only its
 * first lines (it is polled, so it stays small); the card reading it needs
 * all of it.
 */
export function useRunReply(threadId: string, runId: string, finished: boolean) {
  const [reply, setReply] = useState<{ runId: string; text: string } | null>(null);
  useEffect(() => {
    if (!finished) return;
    let current = true;
    getSpectraThreadMessages(threadId, undefined, RECENT_MESSAGES)
      .then(({ messages }) => {
        const text = messages
          .filter((message) => message.role === "assistant" && message.runId === runId)
          .map((message) => message.content.trim())
          .filter(Boolean)
          .join("\n\n");
        if (current && text) setReply({ runId, text });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [finished, runId, threadId]);
  return reply?.runId === runId ? reply.text : null;
}

/**
 * What the run has streamed so far, kept once the stream closes: the live
 * exchange is let go a moment before the run reads as finished, and the card
 * must not fall empty in between.
 */
export function useKeptStream(runId: string, streamed: string) {
  const [kept, setKept] = useState({ runId, text: streamed });
  if (streamed && (kept.runId !== runId || kept.text !== streamed)) setKept({ runId, text: streamed });
  return kept.runId === runId ? kept.text : "";
}
