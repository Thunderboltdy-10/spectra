import type { MouseEvent } from "react";
import { spectraBus } from "../events";

/*
 * Whatever is pressed opens beside the page, in the Side, not on another
 * page (SHELL.md, "The Side"). A link keeps its address, so a middle press
 * or a modified one still opens it in a new tab the way the browser would.
 */

/** A plain press runs `open` in place of following the link; any other press is the browser's. */
export function sideClick(open: () => void) {
  return (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open();
  };
}

export const openWorkInSide = (workId: string) => void spectraBus.command("work.open", { workId, surface: "panel" });

/** Opens a thread where the page shows threads; false where nothing answers, so its link is followed. */
export const openThreadInSide = (thread: { _id: string; lastRunId?: string }) =>
  spectraBus.command("run.openConversation", { runId: thread.lastRunId ?? thread._id, threadId: thread._id }) > 0;

/** A plain press opens the thread in place where the page can, and follows its link where it cannot. */
export function threadClick(thread: { _id: string; lastRunId?: string }) {
  return (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (openThreadInSide(thread)) event.preventDefault();
  };
}
