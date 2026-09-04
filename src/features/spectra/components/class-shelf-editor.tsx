"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSpectraPreferences } from "../settings/preference-store";
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
    throw new Error(
      payload?.error?.message ?? "Those class shelves could not be saved.",
    );
  return payload.data ?? payload;
}

export function ClassShelfEditor({
  integration,
  identityRequired = false,
  classes,
  classLoadError = "",
  onSaved,
}: {
  integration?: unknown;
  identityRequired?: boolean;
  classes?: ClassShelfCandidate[];
  classLoadError?: string;
  onSaved?: () => void | Promise<void>;
}) {
  const { update } = useSpectraPreferences();
  const [state, setState] = useState<ClassShelfLoadState>({ kind: "loading" });
  const [loadedClasses, setLoadedClasses] = useState<ClassShelfCandidate[]>(
    classes ?? [],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const inFlight = useRef(false);
  const controlled = Array.isArray(classes);

  const apply = useCallback(
    (next: {
      integration: unknown;
      identityRequired: boolean;
      classes: ClassShelfCandidate[];
      classLoadError?: string;
    }) => {
      const resolved = next.classLoadError
        ? { kind: "error" as const, message: next.classLoadError }
        : classShelfLoadState(next);
      setState(resolved);
      setLoadedClasses(next.classes);
      setSelectedIds(
        next.classes
          .filter((item) => item.workspaceId)
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
        classLoadError,
      });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    void fetchMyClassCandidates()
      .then((result) => {
        if (!cancelled) apply(result);
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: "Check your connection, then try loading classes again.",
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
  ]);

  const linkedIds = loadedClasses
    .filter((item) => item.workspaceId)
    .map((item) => item.recordId);

  async function save() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      const linked = new Set(linkedIds);
      const selected = new Set(selectedIds);
      const toAdd = selectedIds.filter((id) => !linked.has(id));
      const toRemove = linkedIds.filter((id) => !selected.has(id));
      if (toAdd.length)
        await manageBacPost({
          action: "materializeClasses",
          recordIds: toAdd,
        });
      if (toRemove.length)
        await manageBacPost({
          action: "releaseClasses",
          recordIds: toRemove,
        });
      update("integrations", {
        classShelvesStatus: selectedIds.length > 0 ? "chosen" : "skipped",
        classShelfRecordIds: selectedIds,
      });
      await onSaved?.();
    } catch {
      setSubmitError("Those class shelves could not be saved. Try again.");
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
        onSelectedIdsChange={setSelectedIds}
        submitting={submitting}
        submitError={submitError}
        primaryLabel="Save classes"
        onSubmit={() => void save()}
      />
    </section>
  );
}
