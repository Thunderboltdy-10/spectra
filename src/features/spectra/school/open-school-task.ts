"use client";

import { useCallback, type MouseEvent } from "react";
import { useConvex } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { openWorkInSide } from "../components/side-open";

/*
 * Where a ManageBac task opens from outside School (SCHOOL.md, "A task"): as
 * its task work, beside the page in the Side, so a deadline on Home or in the
 * Calendar opens where the student plans it without leaving. Sync makes that
 * work; a task it has not reached yet gets it the first time it is opened.
 * Only when there can be none does it open in School. The link under it stays
 * School's, so a new tab or a copied link still goes somewhere true.
 */

export const schoolTaskHref = (recordId: string) => `/school?task=${encodeURIComponent(recordId)}`;

export function useOpenSchoolTask() {
  const convex = useConvex();
  const router = useRouter();
  /** The task's work, made now if sync has not made it yet; null when it cannot have one. */
  const workOf = useCallback(
    (recordId: string): Promise<string | null> =>
      convex.mutation(api.school.ensureTaskWork, { recordId: recordId as Id<"externalRecords"> }).catch(() => null),
    [convex],
  );
  const open = useCallback(
    async (recordId: string) => {
      const workId = await workOf(recordId);
      if (workId) openWorkInSide(workId);
      else router.push(schoolTaskHref(recordId));
    },
    [router, workOf],
  );
  /** For a link's onClick: a plain press opens the work; a press meant for a new tab keeps the link. */
  const onTaskClick = useCallback(
    (recordId: string) => (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      void open(recordId);
    },
    [open],
  );
  return { open, onTaskClick, workOf };
}
