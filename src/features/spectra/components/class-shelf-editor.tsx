"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSpectraPreferences } from "../settings/preference-store";
import { describeFailure } from "@/components/ui/truthful-state";
import {
  ClassShelfPicker,
  classShelfLoadState,
  fetchMyClassCandidates,
  type ClassShelfCandidate,
  type ClassShelfIdentityStatus,
  type ClassShelfLoadState,
  type ClassShelfRetention,
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
        .join(": ") || "Those class shelves could not be saved.",
    );
  return payload.data ?? payload;
}

export function ClassShelfEditor({
  integration,
  identityRequired = false,
  classes,
  selectionRevision: controlledSelectionRevision,
  classLoadError = "",
  identityStatus: controlledIdentityStatus,
  onSaved,
}: {
  integration?: unknown;
  identityRequired?: boolean;
  classes?: ClassShelfCandidate[];
  selectionRevision?: number;
  classLoadError?: string;
  identityStatus?: ClassShelfIdentityStatus;
  onSaved?: () => void | Promise<void>;
}) {
  const { update } = useSpectraPreferences();
  const [state, setState] = useState<ClassShelfLoadState>({ kind: "loading" });
  const [loadedClasses, setLoadedClasses] = useState<ClassShelfCandidate[]>(
    classes ?? [],
  );
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
  const controlled = Array.isArray(classes);

  const apply = useCallback(
    (next: {
      integration: unknown;
      identityRequired: boolean;
      classes: ClassShelfCandidate[];
      selectionRevision?: number;
      classLoadError?: string;
      identityStatus?: ClassShelfIdentityStatus;
    }) => {
      const resolved = next.classLoadError
        ? { kind: "error" as const, message: next.classLoadError }
        : classShelfLoadState(next);
      setState(resolved);
      setLoadedClasses(next.classes);
      setSelectionRevision(next.selectionRevision);
      setIdentityStatus(next.identityStatus);
      setRetention(
        next.classes.some(
          (item) => item.selected && item.retention === "archive_projection",
        )
          ? "archive_projection"
          : "keep_in_spectra",
      );
      setSelectedIds(
        next.classes
          .filter((item) => item.selected)
          .map((item) => item.recordId),
      );
    },
    [],
  );

  useEffect(() => {
    if (controlled) {
      apply({
        integration,
        identityRequired,
        classes: classes ?? [],
        selectionRevision: controlledSelectionRevision,
        classLoadError,
        identityStatus: controlledIdentityStatus,
      });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    void fetchMyClassCandidates()
      .then((result) => {
        if (!cancelled) apply(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: describeFailure(error, {
              fallback: "Check your connection, then try loading classes again.",
            }).message,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    apply,
    classLoadError,
    classes,
    controlled,
    identityRequired,
    integration,
    controlledSelectionRevision,
    controlledIdentityStatus,
  ]);

  async function resolveIdentity() {
    if (resolvingIdentity) return;
    setResolvingIdentity(true);
    setSubmitError("");
    try {
      await manageBacPost({ action: "resolveIdentity", bootstrap: true });
      apply(await fetchMyClassCandidates());
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

  async function save() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      const selectionResult = await manageBacPost({
        action: "selectClasses",
        recordIds: selectedIds,
        ...(selectionRevision !== undefined
          ? { expectedRevision: selectionRevision }
          : {}),
        retention,
      });
      if (typeof selectionResult?.selectionRevision === "number")
        setSelectionRevision(selectionResult.selectionRevision);
      update("integrations", {
        classShelvesStatus: selectedIds.length > 0 ? "chosen" : "skipped",
        classShelfRecordIds: selectedIds,
      });
      await onSaved?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setSubmitError(
        message.includes("INTEGRATION_SELECTION_CONFLICT")
          ? "Class choices changed elsewhere. Reload the class list, then reapply your choices."
          : describeFailure(error, {
              fallback: "Those class shelves could not be saved. Try again.",
            }).message,
      );
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-5">
      <header className="px-1 py-3">
        <h2 className="font-display text-heading font-semibold">
          Current classes
        </h2>
        <p className="mt-1 max-w-[52ch] text-caption text-[var(--text-secondary)]">
          Choose the classes you use. Unchosen class work stays in General.
        </p>
      </header>
      <ClassShelfPicker
        state={state}
        selectedIds={selectedIds}
        initialSelectedIds={loadedClasses
          .filter((item) => item.selected)
          .map((item) => item.recordId)}
        onSelectedIdsChange={setSelectedIds}
        submitting={submitting}
        submitError={submitError}
        primaryLabel="Save classes"
        onSubmit={() => void save()}
        retention={retention}
        onRetentionChange={setRetention}
        onResolveIdentity={() => void resolveIdentity()}
        resolvingIdentity={resolvingIdentity}
        identityStatus={identityStatus}
      />
    </section>
  );
}
