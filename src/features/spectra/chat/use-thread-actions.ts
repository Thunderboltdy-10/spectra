"use client";

import { useState } from "react";
import { toast } from "@/components/ui/toast";
import { describeFailure } from "@/components/ui/truthful-state";
import { postSpectra } from "../data/api";
import { spectraBus } from "../events";
import { useTreeActions, useTreePlacement } from "../organization/tree-client";

/*
 * Rename, pin and delete for the open thread. Each answers every time: a
 * failure says so and leaves the thread as it was, and a delete can be undone
 * from its toast.
 */

type Busy = "title" | "pin" | "trash" | null;

export function useThreadActions({
  threadId,
  pinned,
  onChanged,
  onRenamed,
  onSelect,
}: {
  threadId: string | null;
  pinned: boolean;
  /** Reload the thread after a change. */
  onChanged: () => Promise<unknown>;
  onRenamed: (title: string) => void;
  /** Move to another thread (or a new one, with `null`). */
  onSelect: (threadId: string | null) => void;
}) {
  const [busy, setBusy] = useState<Busy>(null);
  const placement = useTreePlacement("thread", threadId);
  const tree = useTreeActions();

  async function attempt(kind: Exclude<Busy, null>, fallback: string, action: () => Promise<void>) {
    if (!threadId || busy) return false;
    setBusy(kind);
    try {
      await action();
      return true;
    } catch (error) {
      toast.error(describeFailure(error, { fallback }).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const rename = (title: string) =>
    attempt("title", "Could not rename this thread. Try again.", async () => {
      await postSpectra({ action: "updateThread", threadId: threadId!, title });
      onRenamed(title);
      await onChanged().catch(() => undefined);
    });

  const togglePinned = () =>
    attempt("pin", pinned ? "Could not unpin this thread. Try again." : "Could not pin this thread. Try again.", async () => {
      await postSpectra({ action: "updateThread", threadId: threadId!, pinned: !pinned });
      await onChanged().catch(() => undefined);
    });

  const nodeId = placement?.node.nodeId;
  const trash = () =>
    attempt("trash", "Could not delete this thread. Try again.", async () => {
      if (!nodeId) throw new Error("THREAD_NOT_PLACED");
      const trashedId = threadId!;
      await tree.trash([nodeId]);
      spectraBus.emit("threads.changed", {});
      onSelect(null);
      toast.success("Thread moved to Trash.", {
        action: {
          label: "Undo",
          onClick: () =>
            void tree
              .restore([nodeId])
              .then(() => {
                spectraBus.emit("threads.changed", {});
                onSelect(trashedId);
              })
              .catch((error: unknown) =>
                toast.error(describeFailure(error, { fallback: "Could not restore this thread. Find it in the Library Trash." }).message),
              ),
        },
      });
    });

  return { busy, rename, togglePinned, trash, canTrash: Boolean(nodeId) };
}
