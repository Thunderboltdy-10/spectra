"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
  Download,
  FileText,
  Loader2,
} from "lucide-react";
import type { SpectraArtifact } from "../data/api";
import { humanizePublicFailure } from "./humanize";
import { useSyncPresentation } from "./use-sync-presentation";
import { useBridgeHealth } from "./use-bridge";
import { BRIDGE_SETTINGS_HREF } from "./client";
import { ReconnectAction, StorageToggleGroup } from "./storage-toggle-group";
import {
  isProtectedOriginalPreset,
  policyPresetFromToggles,
  storageChoiceFromPreset,
  type StorageChoice,
} from "./sync-toggles";

const DOCUMENT_LENS = new Set(["docx", "docm", "dotx", "dotm"]);
const OFFICE_LENS = new Set([
  "xlsx",
  "xlsm",
  "xltx",
  "xltm",
  "xlam",
  "pptx",
  "pptm",
  "potx",
  "potm",
  "ppsx",
  "ppsm",
  "ppam",
]);

export function ResourceSurface({
  artifact,
  onClose,
}: {
  artifact: SpectraArtifact;
  onClose: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string>();
  const [fileAction, setFileAction] = useState<
    "download" | "materialize" | null
  >(null);
  const truth = useQuery(api.replicas.forWork, {
    workId: artifact._id as never,
  });
  const effectivePolicy = useQuery(api.syncPolicy.effective, {
    itemId: artifact._id,
  });
  const strategyTransition = useQuery(api.replicas.strategyTransitionForWork, {
    workId: artifact._id as never,
  });
  const activeMounts = useQuery(api.bridge.activeMounts, {});
  const applyProtectedPending = useMutation(api.replicas.applyProtectedPending);
  const forkProtectedPending = useMutation(api.replicas.forkProtectedPending);
  const discardProtectedPending = useMutation(
    api.replicas.discardProtectedPending,
  );
  const transitionStorageStrategy = useMutation(
    api.replicas.transitionStorageStrategy,
  );
  const revertPolicy = useMutation(api.syncPolicy.revert);
  const bridge = useBridgeHealth();
  const presentation = useSyncPresentation(truth);
  const format = (
    artifact.nativeFormat ??
    artifact.title.split(".").pop() ??
    "binary"
  ).toLowerCase();
  const previewKind = ["png", "jpg", "jpeg", "gif", "webp"].includes(format)
    ? "image"
    : format === "pdf"
      ? "pdf"
      : [
            "txt",
            "md",
            "json",
            "csv",
            "ts",
            "tsx",
            "js",
            "py",
            "css",
            "html",
          ].includes(format)
        ? "text"
        : "identity";
  const protectedPending =
    truth?.replicas.some(
      (replica) =>
        replica.kind === "local" &&
        replica.protectedOriginal &&
        Boolean(replica.pendingPayloadRef),
    ) ?? false;
  const currentPreset =
    effectivePolicy?.preset ??
    (truth?.replicas.some((replica) => replica.kind === "local")
      ? "both"
      : "spectra");
  const [strategyBusy, setStrategyBusy] = useState(false);
  const strategyPending = strategyBusy || strategyTransition?.state === "pending";
  const autoOpenedRef = useRef<string | undefined>(undefined);
  async function protectedAction(action: "apply" | "fork" | "discard") {
    setFileAction("materialize");
    setOpenError(undefined);
    try {
      if (action === "apply")
        await applyProtectedPending({
          workId: artifact._id as never,
        });
      else if (action === "fork")
        await forkProtectedPending({ workId: artifact._id as never });
      else await discardProtectedPending({ workId: artifact._id as never });
    } catch (error) {
      setOpenError(
        error instanceof Error
          ? error.message
          : "The pending changes could not be resolved.",
      );
    } finally {
      setFileAction(null);
    }
  }
  async function changeStorageStrategy(
    choice: StorageChoice,
    protectedOriginal = isProtectedOriginalPreset(
      effectivePolicy?.preset ?? currentPreset,
    ),
  ) {
    const toPreset = policyPresetFromToggles(choice, protectedOriginal);
    if (toPreset === currentPreset) return;
    setStrategyBusy(true);
    setOpenError(undefined);
    try {
      await transitionStorageStrategy({
        workId: artifact._id as never,
        toPreset,
        ...(toPreset !== "spectra" && !truth?.replicas.some((replica) => replica.kind === "local") && activeMounts?.[0]
          ? { mountId: activeMounts[0]._id, relativePath: artifact.title }
          : {}),
      });
    } catch (error) {
      setOpenError(
        error instanceof Error
          ? error.message
          : "The storage strategy could not be changed. No file was removed.",
      );
    } finally {
      setStrategyBusy(false);
    }
  }
  const openInSpectra = useCallback(async () => {
    setOpening(true);
    setOpenError(undefined);
    try {
      const endpoint = DOCUMENT_LENS.has(format)
        ? "/api/spectra/lenses/docx"
        : "/api/spectra/lenses/office";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", artifactId: artifact._id }),
      });
      const result = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      if (!response.ok)
        throw new Error(
          result?.message ??
            `This ${format.toUpperCase()} file could not be opened safely.`,
        );
      // The lens mutation changes this identity in Convex. Tell the shell to
      // replace its cached overview copy immediately so the open surface can
      // switch from ResourceSurface to DocumentStudio without a remount or a
      // duplicate work item.
      window.dispatchEvent(
        new CustomEvent("spectra:artifact-lens-activated", {
          detail: { artifactId: artifact._id },
        }),
      );
    } catch (error) {
      setOpenError(
        error instanceof Error
          ? error.message
          : `This ${format.toUpperCase()} file could not be opened safely.`,
      );
    } finally {
      setOpening(false);
    }
  }, [artifact._id, format]);

  useEffect(() => {
    if ((!DOCUMENT_LENS.has(format) && !OFFICE_LENS.has(format)) || opening)
      return;
    if (autoOpenedRef.current === artifact._id) return;
    if (!truth?.replicas.some((replica) => Boolean(replica.payloadRef))) return;
    autoOpenedRef.current = artifact._id;
    void openInSpectra().catch(() => {
      autoOpenedRef.current = undefined;
    });
  }, [artifact._id, format, opening, openInSpectra, truth?.replicas]);
  async function downloadCopy() {
    setFileAction("download");
    setOpenError(undefined);
    try {
      const response = await fetch(
        `/api/spectra/native?artifactId=${encodeURIComponent(artifact._id)}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(
          result?.message ?? "The retained native copy is unavailable.",
        );
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = match ? decodeURIComponent(match[1]!) : artifact.title;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      setOpenError(
        error instanceof Error
          ? error.message
          : "The retained native copy is unavailable.",
      );
    } finally {
      setFileAction(null);
    }
  }
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]"
      aria-label={`${artifact.title} file`}
    >
      <header className="flex min-h-[74px] shrink-0 items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-title font-semibold text-[var(--text-primary)]">
            {artifact.title}
          </h1>
          <button
            type="button"
            title={presentation.detail}
            className="mt-1 text-micro font-medium text-[var(--text-secondary)]"
            onClick={
              presentation.action?.kind === "reconnect"
                ? () => {
                    window.location.href = BRIDGE_SETTINGS_HREF;
                  }
                : undefined
            }
          >
            {presentation.label}
          </button>
        </div>
        <button
          type="button"
          className="spectra-icon-action"
          aria-label="Close file"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="mx-auto grid max-w-[860px] gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex min-h-[360px] items-center justify-center rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 text-center">
            <div>
              {previewKind === "image" &&
              truth?.replicas.some((replica) => Boolean(replica.payloadRef)) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/spectra/native?artifactId=${encodeURIComponent(artifact._id)}`}
                  alt=""
                  className="mx-auto max-h-[320px] max-w-full rounded-control object-contain"
                />
              ) : (
                <FileText className="mx-auto size-10 text-[var(--text-tertiary)]" />
              )}
              <p className="mt-4 text-caption font-medium text-[var(--text-primary)]">
                {previewKind === "image" &&
                truth?.replicas.some((replica) => Boolean(replica.payloadRef))
                  ? artifact.title
                  : `${format.toUpperCase()} file`}
              </p>
              <p className="mt-1 max-w-[420px] text-micro leading-5 text-[var(--text-secondary)]">
                {DOCUMENT_LENS.has(format)
                  ? "Open this file as an editable Spectra Document. Unsupported Word features remain in the original package and unrelated edits do not rewrite them."
                  : OFFICE_LENS.has(format)
                    ? `Open this file as editable Spectra ${["xlsx", "xlsm", "xltx", "xltm", "xlam"].includes(format) ? "Sheets" : "Presentation"}. Native features Spectra cannot edit remain preserved in the original package.`
                    : bridge.reachability === "connected"
                      ? "This file is in a selected folder on this PC."
                      : bridge.reachability === "running"
                        ? "Spectra Bridge is running on this PC. Connect this device to use this file."
                        : "This file lives on a computer. Connect Spectra Bridge to use it here."}
              </p>
              {DOCUMENT_LENS.has(format) || OFFICE_LENS.has(format) ? (
                <button
                  type="button"
                  className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-control bg-[var(--text-primary)] px-4 text-caption font-medium text-[var(--bg-primary)] disabled:opacity-45"
                  disabled={
                    opening ||
                    !truth?.replicas.some((replica) =>
                      Boolean(replica.payloadRef),
                    )
                  }
                  onClick={() => void openInSpectra()}
                >
                  {opening ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <FileText className="size-3.5" />
                  )}
                  {opening ? "Opening safely…" : "Open in Spectra"}
                </button>
              ) : null}
              {openError ? (
                <p
                  className="mt-3 max-w-[430px] text-micro leading-5 text-[var(--danger)]"
                  role="alert"
                >
                  {humanizePublicFailure(openError)} The file has not been changed.
                </p>
              ) : null}
            </div>
          </div>
          <aside className="space-y-5">
            {protectedPending ? (
              <div className="rounded-control border border-[color-mix(in_oklab,var(--warning)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_10%,var(--bg-elevated))] p-3">
                <div className="text-caption font-semibold text-[var(--text-primary)]">
                  Original untouched
                </div>
                <p className="mt-1 text-micro leading-5 text-[var(--text-secondary)]">
                  Spectra has pending changes. The linked file has not been
                  written.
                </p>
                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    className="h-8 rounded-control bg-[var(--text-primary)] px-3 text-micro font-medium text-[var(--bg-primary)]"
                    onClick={() => void protectedAction("apply")}
                    disabled={fileAction !== null}
                  >
                    Apply to original
                  </button>
                  <button
                    type="button"
                    className="h-8 rounded-control border border-[var(--border-default)] px-3 text-micro font-medium"
                    onClick={() => void protectedAction("fork")}
                    disabled={fileAction !== null}
                  >
                    Keep as Spectra copy
                  </button>
                  <button
                    type="button"
                    className="h-8 rounded-control border border-[var(--border-default)] px-3 text-micro font-medium"
                    onClick={() => void protectedAction("discard")}
                    disabled={fileAction !== null}
                  >
                    Discard pending changes
                  </button>
                </div>
              </div>
            ) : null}
            <div>
              <h2 className="text-caption font-semibold text-[var(--text-primary)]">
                File details
              </h2>
              <dl className="mt-3 space-y-2 text-micro">
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-tertiary)]">Format</dt>
                  <dd>{format.toUpperCase()}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-tertiary)]">Location</dt>
                  <dd>
                    {truth?.replicas.some(
                      (replica) =>
                        replica.kind === "local" && replica.state === "current",
                    )
                      ? "This device + Spectra"
                      : "Spectra Cloud"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-tertiary)]">Profile</dt>
                  <dd>Strict native</dd>
                </div>
              </dl>
            </div>
            <div>
              <h2 className="text-caption font-semibold text-[var(--text-primary)]">
                Where this file lives
              </h2>
              {presentation.action?.kind === "reconnect" ? (
                <div className="mt-2">
                  <ReconnectAction href={BRIDGE_SETTINGS_HREF} />
                </div>
              ) : null}
              <ul className="mt-3 space-y-2 text-micro text-[var(--text-secondary)]">
                {presentation.disclosure.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="text-caption font-semibold text-[var(--text-primary)]">
                How this file is stored
              </h2>
              <p className="mt-1 text-micro leading-5 text-[var(--text-secondary)]">
                Changing this keeps the same Spectra item. If Spectra stops using a copy on this computer, the file stays on disk.
              </p>
              <div className="mt-3">
                <StorageToggleGroup
                  value={storageChoiceFromPreset(currentPreset)}
                  hasLocalCopy={Boolean(
                    truth?.replicas.some((replica) => replica.kind === "local"),
                  )}
                  protectedOriginal={isProtectedOriginalPreset(currentPreset)}
                  showProtected
                  disabled={strategyPending}
                  onChange={(choice) => void changeStorageStrategy(choice)}
                  onProtectedChange={(next) =>
                    void changeStorageStrategy(
                      storageChoiceFromPreset(currentPreset),
                      next,
                    )
                  }
                />
              </div>
              {effectivePolicy?.source.kind &&
              effectivePolicy.source.kind !== "default" ? (
                <button
                  type="button"
                  className="mt-2 text-micro font-medium text-[var(--text-primary)]"
                  onClick={() =>
                    void revertPolicy({
                      scopeKind: "item",
                      scopeId: artifact._id,
                      idempotencyKey: `revert:${artifact._id}:${Date.now()}`,
                    })
                  }
                >
                  Use the account default
                </button>
              ) : null}
              {strategyTransition?.state === "pending" ? (
                <p className="mt-2 text-micro text-[var(--text-secondary)]">
                  Moving this work between Spectra and this computer. The item stays open while Spectra Bridge verifies the file.
                </p>
              ) : strategyTransition?.state === "failed" ? (
                <p className="mt-2 text-micro text-[var(--danger)]" role="alert">
                  The last storage change did not finish. {humanizePublicFailure(strategyTransition.errorCode ?? "write-failed")} The file on this computer was not removed.
                </p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <button
                type="button"
                className="flex h-9 items-center justify-center gap-2 rounded-control border border-[var(--border-default)] px-3 text-caption font-medium disabled:opacity-45"
                disabled={
                  fileAction !== null ||
                  !truth?.replicas.some((replica) =>
                    Boolean(replica.payloadRef),
                  )
                }
                onClick={() => void downloadCopy()}
              >
                <Download className="size-3.5" />
                {fileAction === "download"
                  ? "Preparing copy…"
                  : "Download native copy"}
              </button>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
