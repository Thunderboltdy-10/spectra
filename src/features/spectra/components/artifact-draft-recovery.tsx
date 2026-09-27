"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatByteCount } from "../../../../shared/human-format";
import type {
  LocalRecoveryController,
  LocalRecoveryInspection,
  RecoveryBranch,
} from "../collaboration/recovery-controller";
import { downloadDocumentBlob } from "./artifact-studio-file-utils";
import { DismissibleArtifactNotice } from "./dismissible-artifact-notice";

type Action = "inspect" | "export" | "adopt" | "reapply";

function sameAnchor(
  left: RecoveryBranch["currentAnchor"],
  right: RecoveryBranch["currentAnchor"],
) {
  return (
    left?.roomId === right?.roomId &&
    left?.nextSequence === right?.nextSequence &&
    left?.frontierHash === right?.frontierHash
  );
}

export function describeLocalRecoveryFailure(error: unknown, action: Action) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/LOCAL_RECOVERY_(GENERATION|CURRENT)_CHANGED/.test(message))
    return "This draft or the current version changed. Review it again before applying changes.";
  if (/quota|storage.*full/i.test(message))
    return "There isn’t enough device storage to complete this action. Your draft is still available; export a copy before freeing space.";
  if (/forbidden|denied|permission|unauthorized/i.test(message))
    return "Your access changed. You can still inspect and export the local draft.";
  const operation = {
    inspect: "review this draft",
    export: "export this draft",
    adopt: "use the current version",
    reapply: "apply the selected changes",
  }[action];
  return `Could not ${operation}. Your local draft is still available. Try again when you’re ready.`;
}

function branchDescription(branch: RecoveryBranch) {
  if (branch.reason === "native_overlap") return "Both copies changed";
  if (branch.reason === "unknown_ancestor") return "Earlier local draft";
  return "Retained local draft";
}

type Props = {
  artifactId: string;
  controller: LocalRecoveryController;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ArtifactDraftRecovery(props: Props) {
  // Changing work must also retire every in-flight view callback, including an
  // A → B → A navigation where the branch IDs happen to be unchanged.
  return <ArtifactDraftRecoveryView key={props.artifactId} {...props} />;
}

function ArtifactDraftRecoveryView({
  artifactId,
  controller,
  open,
  onOpenChange,
}: Props) {
  const { recovery } = controller;
  const [selectedId, setSelectedId] = useState<string>();
  const selected = recovery.branches.find((branch) => branch.id === selectedId);
  const [inspection, setInspection] = useState<LocalRecoveryInspection | null>(
    null,
  );
  const [regionIds, setRegionIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [reviewRequired, setReviewRequired] = useState(false);
  const mounted = useRef(false);
  const request = useRef<{ action: Action; abort: AbortController } | null>(
    null,
  );
  const current = useRef({ open, selectedId, recovery });
  current.current = { open, selectedId, recovery };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort.abort();
      request.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      request.current?.abort.abort();
      request.current = null;
      setBusy(null);
      setInspection(null);
      setRegionIds([]);
      setError(undefined);
      setMessage(undefined);
      setReviewRequired(false);
    }
  }, [open]);

  function isCurrent(token: object, branch: RecoveryBranch) {
    return (
      mounted.current &&
      request.current === token &&
      current.current.open &&
      current.current.selectedId === branch.id &&
      current.current.recovery.branches.some(
        (candidate) =>
          candidate.id === branch.id &&
          candidate.generation === branch.generation,
      )
    );
  }

  async function inspect(branch: RecoveryBranch) {
    if (request.current && request.current.action !== "inspect") return;
    request.current?.abort.abort();
    const token = { action: "inspect" as const, abort: new AbortController() };
    request.current = token;
    // Update the selection fence synchronously: two clicks before the next
    // render must not let the first request publish into the second branch.
    current.current = { ...current.current, selectedId: branch.id };
    setSelectedId(branch.id);
    setInspection(null);
    setRegionIds([]);
    setBusy("inspect");
    setError(undefined);
    setMessage(undefined);
    setReviewRequired(false);
    try {
      const result = await controller.inspectLocalRecovery(branch.id, {
        signal: token.abort.signal,
      });
      if (!isCurrent(token, branch)) return;
      if (
        result.branch.id !== branch.id ||
        result.branch.generation !== branch.generation
      ) {
        setReviewRequired(true);
        setError(
          "This draft changed. Review it again to see the latest local changes.",
        );
        return;
      }
      setInspection(result);
    } catch (cause) {
      if (isCurrent(token, branch))
        setError(describeLocalRecoveryFailure(cause, "inspect"));
    } finally {
      if (request.current === token) {
        request.current = null;
        if (mounted.current) setBusy(null);
      }
    }
  }

  async function perform(action: Exclude<Action, "inspect">) {
    if (!selected || request.current || recovery.state === "saving") return;
    const branch = selected;
    if (
      !current.current.open ||
      current.current.selectedId !== branch.id ||
      !current.current.recovery.branches.some(
        (candidate) => candidate.id === branch.id && candidate.generation === branch.generation,
      )
    ) return;
    const reviewed = inspection?.branch;
    if (
      action !== "export" &&
      (!reviewed ||
        reviewRequired ||
        reviewed.generation !== branch.generation ||
        !sameAnchor(reviewed.currentAnchor, branch.currentAnchor) ||
        !reviewed.currentAnchor ||
        !branch.canReadCurrent || !reviewed.canReadCurrent ||
        (action === "reapply" &&
          (!branch.canReapply || regionIds.length === 0)))
    )
      return;
    const token = { action, abort: new AbortController() };
    request.current = token;
    setBusy(action);
    setError(undefined);
    setMessage(undefined);
    try {
      if (action === "export") {
        const result = await controller.exportLocalRecovery(branch.id, {
          signal: token.abort.signal,
        });
        if (isCurrent(token, branch))
          downloadDocumentBlob(result.fileName, result.blob);
      } else {
        // Use exactly the witness the user inspected. A stale error requires
        // another deliberate review, never a retry with a newer anchor.
        const witness = {
          branchId: branch.id,
          expectedGeneration: reviewed!.generation,
          expectedCurrentAnchor: reviewed!.currentAnchor!,
          signal: token.abort.signal,
        };
        if (action === "adopt") {
          await controller.archiveAndAdoptCurrent(witness);
          if (isCurrent(token, branch)) {
            setMessage(
              "Using the current version. Your original draft remains in Local drafts.",
            );
          }
        } else {
          await controller.reapplyLocalRecovery({
            ...witness,
            regionIds: [...regionIds],
          });
          if (isCurrent(token, branch))
            setMessage(
              "Selected changes applied. Your original draft remains in Local drafts.",
            );
        }
        if (isCurrent(token, branch)) setReviewRequired(true);
      }
    } catch (cause) {
      if (isCurrent(token, branch)) {
        setError(describeLocalRecoveryFailure(cause, action));
        if (action !== "export") setReviewRequired(true);
      }
    } finally {
      if (request.current === token) {
        request.current = null;
        if (mounted.current) setBusy(null);
      }
    }
  }

  const active = recovery.branches.find(
    (branch) => branch.id === recovery.activeBranchId,
  );
  const sameDraft =
    selected &&
    inspection?.branch.id === selected.id &&
    inspection.branch.generation === selected.generation;
  const hasCurrentReview = Boolean(
    sameDraft &&
    !reviewRequired &&
    selected?.canReadCurrent &&
    inspection?.branch.canReadCurrent &&
    inspection.branch.currentAnchor &&
    sameAnchor(selected.currentAnchor, inspection.branch.currentAnchor),
  );
  const saving =
    busy === "adopt" || busy === "reapply" || recovery.state === "saving";
  const previews = sameDraft ? inspection.previews : [];

  return (
    <>
      {active && (recovery.state === "review_required" || saving) ? (
        <DismissibleArtifactNotice
          artifactId={artifactId}
          identity={active.id}
          className="shrink-0 border-y border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-5 py-2 text-caption text-[var(--text-secondary)]"
        >
          <span className="min-w-0 flex-1">
            A local draft needs review. It is kept on this device.
          </span>
          <Button size="sm" onClick={() => onOpenChange(true)}>
            Review local draft
          </Button>
        </DismissibleArtifactNotice>
      ) : null}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Local drafts</DialogTitle>
            <DialogDescription>
              Review a draft before applying changes. Exporting or using the
              current version keeps the original draft on this device.
            </DialogDescription>
          </DialogHeader>
          {recovery.state === "loading" ? (
            <p
              role="status"
              className="text-caption text-[var(--text-secondary)]"
            >
              Loading local drafts…
            </p>
          ) : null}
          {recovery.state === "error" ? (
            <p
              role="alert"
              className="text-caption text-[var(--text-secondary)]"
            >
              {recovery.error
                ? describeLocalRecoveryFailure(recovery.error, "inspect")
                : "Local drafts could not be refreshed. Any drafts listed below are still available."}
            </p>
          ) : null}
          {recovery.state !== "loading" &&
          recovery.state !== "error" &&
          recovery.branches.length === 0 ? (
            <p className="text-caption text-[var(--text-secondary)]">
              No local drafts need recovery on this device.
            </p>
          ) : null}
          <ul className="divide-y divide-[var(--border-subtle)]">
            {recovery.branches.map((branch) => (
              <li key={branch.id}>
                <button
                  type="button"
                  disabled={saving || busy === "export"}
                  aria-pressed={selected?.id === branch.id}
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-control px-2 py-3 text-left text-caption hover:bg-[var(--bg-hover)] aria-pressed:bg-[var(--bg-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] disabled:opacity-50"
                  onClick={() => void inspect(branch)}
                >
                  <span className="font-medium">
                    {branchDescription(branch)}
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    {new Date(branch.createdAt).toLocaleString()} ·{" "}
                    {formatByteCount(branch.bytes)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {busy === "inspect" ? (
            <p
              role="status"
              className="text-caption text-[var(--text-secondary)]"
            >
              Reading the selected draft…
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="text-caption text-[var(--text-secondary)]"
            >
              {error}
            </p>
          ) : null}
          {message ? (
            <p
              role="status"
              className="text-caption text-[var(--text-secondary)]"
            >
              {message}
            </p>
          ) : null}
          {selected &&
          !busy &&
          (!sameDraft || (inspection && !hasCurrentReview)) ? (
            <div className="flex flex-wrap items-center gap-2 text-caption text-[var(--text-secondary)]">
              <span>
                {selected.canReadCurrent
                  ? "Review again before applying changes."
                  : "Current access is unavailable. You can inspect and export this local draft."}
              </span>
              <Button size="sm" onClick={() => void inspect(selected)}>
                Review again
              </Button>
            </div>
          ) : null}
          {sameDraft ? (
            <div className="grid min-w-0 gap-3">
              <p className="text-caption text-[var(--text-secondary)]">
                These are excerpts. Export the draft to keep a complete recovery
                copy.
              </p>
              {previews.length === 0 ? (
                <p className="text-caption text-[var(--text-secondary)]">
                  No text preview is available for this draft. You can export
                  the complete copy.
                </p>
              ) : null}
              {previews.map((preview) => (
                <div
                  key={preview.regionId}
                  className="min-w-0 border-t border-[var(--border-subtle)] pt-3"
                >
                  <label className="flex items-center gap-2 text-caption font-medium">
                    <input
                      type="checkbox"
                      checked={regionIds.includes(preview.regionId)}
                      disabled={
                        !hasCurrentReview ||
                        !selected?.canReapply ||
                        Boolean(busy) ||
                        !selected.regionIds.includes(preview.regionId)
                      }
                      onChange={(event) =>
                        setRegionIds((ids) =>
                          event.target.checked
                            ? [...new Set([...ids, preview.regionId])]
                            : ids.filter((id) => id !== preview.regionId),
                        )
                      }
                    />
                    {preview.label}
                  </label>
                  <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <p className="text-micro font-medium text-[var(--text-secondary)]">
                        Local draft
                      </p>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-caption">
                        {preview.draft || "(Empty)"}
                      </pre>
                    </div>
                    <div className="min-w-0">
                      <p className="text-micro font-medium text-[var(--text-secondary)]">
                        Current version
                      </p>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-caption">
                        {hasCurrentReview
                          ? (preview.current ?? "Preview unavailable")
                          : "Review with current access to compare."}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {selected ? (
            <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
              <Button
                size="sm"
                disabled={Boolean(busy) || saving}
                onClick={() => void perform("export")}
              >
                {busy === "export" ? "Preparing export…" : "Export draft"}
              </Button>
              <Button
                size="sm"
                disabled={Boolean(busy) || saving || !hasCurrentReview}
                onClick={() => void perform("adopt")}
              >
                {busy === "adopt"
                  ? "Keeping draft and switching…"
                  : "Use current version"}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={
                  Boolean(busy) ||
                  saving ||
                  !hasCurrentReview ||
                  !selected.canReapply ||
                  regionIds.length === 0
                }
                onClick={() => void perform("reapply")}
              >
                {busy === "reapply"
                  ? "Applying changes…"
                  : "Apply selected changes"}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
