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
    throw new Error(payload?.error?.message ?? "Class shelves could not be saved.");
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
  const [submitting, setSubmitting] = useState(false);
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
      setSelectedIds(
        result.classes
          .filter((item) => item.workspaceId)
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

  async function finish(status: "chosen" | "skipped", recordIds: string[]) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      if (status === "chosen" && recordIds.length > 0) {
        const linked = new Set(
          classes
            .filter((item) => item.workspaceId)
            .map((item) => item.recordId),
        );
        const toAdd = recordIds.filter((id) => !linked.has(id));
        if (toAdd.length)
          await manageBacPost({
            action: "materializeClasses",
            recordIds: toAdd,
          });
      }
      update("integrations", {
        classShelvesStatus: status,
        classShelfRecordIds: recordIds,
      });
      await onCompleted();
    } catch {
      setSubmitError("Those class shelves could not be saved. Try again.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const canChoose = state.kind === "ready" && classes.length > 0;

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
            onSelectedIdsChange={setSelectedIds}
            submitting={submitting}
            submitError={submitError}
            primaryLabel={canChoose ? "Use selected classes" : "Continue"}
            onSubmit={() =>
              void finish(
                canChoose && selectedIds.length > 0 ? "chosen" : "skipped",
                canChoose ? selectedIds : [],
              )
            }
            skipLabel={canChoose ? "Skip" : undefined}
            onSkip={canChoose ? () => void finish("skipped", []) : undefined}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
