"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSpectraPreferences } from "../settings/preference-store";
import { describeFailure } from "@/components/ui/truthful-state";
import {
  ClassShelfPicker,
  classShelfLoadState,
  type ClassShelfIdentityStatus,
  type ClassShelfRetention,
  fetchMyClassCandidates,
  type ClassShelfCandidate,
  type ClassShelfLoadState,
} from "./class-shelf-picker";
import { requestSpectra } from "../data/request";
import { toast } from "@/components/ui/toast";

async function manageBacPost(body: Record<string, unknown>) {
  const response = await requestSpectra("/api/spectra/managebac", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      [payload?.error?.code, payload?.error?.message]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join(": ") || "Class shelves could not be saved.",
    );
  return payload.data ?? payload;
}

export function ClassShelfOnboarding({
  open,
  onCompleted,
  onDismiss,
}: {
  open: boolean;
  onCompleted: () => void | Promise<void>;
  /** Put away for now: nothing is saved, and School offers the choice again. */
  onDismiss: () => void;
}) {
  const submitting = useRef(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing is "not now", never a lost choice: a save under way finishes first.
        if (!next && !submitting.current) onDismiss();
      }}
    >
      <DialogContent
        className="max-w-[min(720px,calc(100vw-32px))] gap-0 p-5 sm:p-6"
        // A press beside the dialog is too easy to make by accident while choosing.
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogTitle>Choose this year&apos;s classes</DialogTitle>
        <DialogDescription className="mt-1.5 max-w-xl text-caption">
          Each class you pick becomes a workspace, and its tasks and artifacts come
          in from ManageBac. Close this to decide later in School, Sync.
        </DialogDescription>
        <div className="mt-5">
          <ClassShelfChoice active={open} onCompleted={onCompleted} onSubmitting={(value) => (submitting.current = value)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The class choice itself, in the dialog above or a step of Setup. It loads each time it becomes active. */
export function ClassShelfChoice({
  active,
  onCompleted,
  onSubmitting,
}: {
  active: boolean;
  onCompleted: () => void | Promise<void>;
  onSubmitting?: (submitting: boolean) => void;
}) {
  const open = active;
  const { update } = useSpectraPreferences();
  const [state, setState] = useState<ClassShelfLoadState>({ kind: "loading" });
  const [classes, setClasses] = useState<ClassShelfCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionRevision, setSelectionRevision] = useState<number>();
  const [identityStatus, setIdentityStatus] = useState<ClassShelfIdentityStatus>();
  const [retention, setRetention] = useState<ClassShelfRetention>(
    "keep_in_spectra",
  );
  const [submitting, setSubmitting] = useState(false);
  const [resolvingIdentity, setResolvingIdentity] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setSubmitError("");
    try {
      const result = await fetchMyClassCandidates();
      const next = classShelfLoadState(result);
      setClasses(result.classes);
      setState(next);
      setSelectionRevision(result.selectionRevision);
      setIdentityStatus(result.identityStatus);
      setRetention(
        result.classes.some(
          (item) => item.selected && item.retention === "archive_projection",
        )
          ? "archive_projection"
          : "keep_in_spectra",
      );
      setSelectedIds(
        result.classes
          .filter((item) => item.selected)
          .map((item) => item.recordId),
      );
    } catch (error) {
      setState({
        kind: "error",
        message: describeFailure(error, {
          fallback: "Check your connection, then try loading classes again.",
        }).message,
      });
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  async function resolveIdentity() {
    if (resolvingIdentity) return;
    setResolvingIdentity(true);
    setSubmitError("");
    try {
      await manageBacPost({ action: "resolveIdentity", syncClasses: true });
      await load();
    } catch (error) {
      setSubmitError(
        describeFailure(error, {
          fallback: "Your school account could not be matched. Try again or continue in General.",
        }).message,
      );
    } finally {
      setResolvingIdentity(false);
    }
  }

  /* The first sync runs after the dialog has gone: a slow or failed sync
     never holds the page. A failure says so, with a retry, and School keeps
     the same Sync now. */
  function syncInBackground() {
    void manageBacPost({ action: "sync" }).catch((error) =>
      toast.error("Your classes are saved. The first sync didn't finish.", {
        description: describeFailure(error, { fallback: "Try again now, or from School when the connection is ready." }).message,
        action: { label: "Try again", onClick: () => syncInBackground() },
      }),
    );
  }

  async function finish(status: "chosen" | "skipped", recordIds: string[]) {
    if (inFlight.current) return;
    if (state.kind === "loading" || state.kind === "error") return;
    if (
      (state.kind === "ready" || state.kind === "empty") &&
      (!Number.isSafeInteger(selectionRevision) || selectionRevision! < 0)
    )
      return;
    inFlight.current = true;
    setSubmitting(true);
    onSubmitting?.(true);
    setSubmitError("");
    try {
      if (state.kind === "ready" || state.kind === "empty") {
        const result = await manageBacPost({
          action: "selectClasses",
          recordIds,
          expectedRevision: selectionRevision!,
          retention,
        });
        if (typeof result?.selectionRevision === "number")
          setSelectionRevision(result.selectionRevision);
      }
      update("integrations", {
        classShelvesStatus: status,
        classShelfRecordIds: recordIds,
      });
      if (status === "chosen" && recordIds.length > 0) syncInBackground();
      await onCompleted();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setSubmitError(
        message.includes("INTEGRATION_SELECTION_CONFLICT")
          ? "Class choices changed elsewhere. Reload the list, then reapply your choices."
          : describeFailure(error, {
              fallback: "Those class shelves could not be saved. Try again.",
            }).message,
      );
    } finally {
      inFlight.current = false;
      setSubmitting(false);
      onSubmitting?.(false);
    }
  }

  const canChoose =
    state.kind === "ready" &&
    classes.length > 0 &&
    Number.isSafeInteger(selectionRevision) &&
    selectionRevision! >= 0;
  const canContinue =
    state.kind !== "loading" &&
    state.kind !== "error" &&
    ((state.kind !== "ready" && state.kind !== "empty") ||
      (Number.isSafeInteger(selectionRevision) && selectionRevision! >= 0));
  const initialSelectedIds = classes
    .filter((item) => item.selected)
    .map((item) => item.recordId);

  return (
    <ClassShelfPicker
      state={state}
      selectedIds={selectedIds}
      initialSelectedIds={initialSelectedIds}
      onSelectedIdsChange={setSelectedIds}
      submitting={submitting}
      submitError={submitError}
      submitDisabled={!canContinue}
      primaryLabel={
        canChoose
          ? selectedIds.length > 0
            ? "Use selected classes"
            : "Continue without classes"
          : "Continue"
      }
      onSubmit={() =>
        void finish(
          canChoose && selectedIds.length > 0 ? "chosen" : "skipped",
          canChoose ? selectedIds : [],
        )
      }
      skipLabel={canChoose ? "Skip" : undefined}
      onSkip={canChoose ? () => void finish("skipped", []) : undefined}
      retention={retention}
      onRetentionChange={setRetention}
      onResolveIdentity={() => void resolveIdentity()}
      resolvingIdentity={resolvingIdentity}
      identityStatus={identityStatus}
    />
  );
}
