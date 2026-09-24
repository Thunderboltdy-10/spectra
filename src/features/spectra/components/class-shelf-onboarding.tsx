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
import { Button } from "@/components/ui/button";
import {
  ClassShelfPicker,
  classShelfLoadState,
  type ClassShelfIdentityStatus,
  type ClassShelfRetention,
  fetchMyClassCandidates,
  type ClassShelfCandidate,
  type ClassShelfLoadState,
} from "./class-shelf-picker";

async function manageBacPost(body: Record<string, unknown>) {
  const response = await fetch("/api/spectra/managebac", {
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
}: {
  open: boolean;
  onCompleted: () => void | Promise<void>;
}) {
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
  const [syncing, setSyncing] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [syncError, setSyncError] = useState("");
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setSubmitError("");
    setSyncError("");
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
      await manageBacPost({ action: "resolveIdentity", bootstrap: true });
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

  async function syncSelection() {
    setSyncError("");
    setSyncing(true);
    try {
      await manageBacPost({ action: "sync", kind: "manual" });
      return true;
    } catch (error) {
      setSyncError(
        describeFailure(error, {
          fallback: "Your classes were saved, but the first sync did not finish. Retry from School when the connection is ready.",
        }).message,
      );
      return false;
    } finally {
      setSyncing(false);
    }
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
    setSubmitError("");
    setSyncError("");
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
      if (status === "chosen" && recordIds.length > 0) {
        setSubmitting(false);
        if (!(await syncSelection())) return;
      }
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
    <Dialog open={open}>
      <DialogContent
        hideCloseButton
        className="max-w-[min(560px,calc(100vw-32px))] gap-0 p-5 sm:p-6"
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogTitle>Choose this year&apos;s classes</DialogTitle>
        <DialogDescription className="mt-1.5 text-caption">
          Spectra files class work onto those shelves. Skip to start in General
          and pick classes later from School.
        </DialogDescription>
        <div className="mt-5">
          <ClassShelfPicker
            state={state}
            selectedIds={selectedIds}
            initialSelectedIds={initialSelectedIds}
            onSelectedIdsChange={setSelectedIds}
            submitting={submitting || syncing}
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
          {syncing ? (
            <p className="mt-3 text-center text-micro text-[var(--text-secondary)]" role="status">
              Syncing the classes you chose…
            </p>
          ) : syncError ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-control border border-[color-mix(in_oklab,var(--danger)_25%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--danger)_6%,var(--bg-primary))] px-3 py-2 text-micro text-[var(--danger)]" role="alert">
              <span>{syncError}</span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  void syncSelection().then((ok) => {
                    if (ok) void onCompleted();
                  })
                }
              >
                Retry sync
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
