"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import type { SpectraArtifact } from "../data/api";
import { humanizePublicFailure } from "./humanize";
import { useSyncPresentation } from "./use-sync-presentation";
import { useBridgeHealth } from "./use-bridge";

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
  async function changeStorageStrategy(toPreset: "spectra" | "device" | "both" | "linked") {
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
          <h1 className="truncate font-display text-[20px] font-semibold text-[var(--text-primary)]">
            {artifact.title}
          </h1>
          <button
            type="button"
            title={presentation.detail}
            className="mt-1 text-[11px] font-medium text-[var(--text-secondary)]"
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
          <div className="flex min-h-[360px] items-center justify-center rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 text-center">
            <div>
              {previewKind === "image" ? (
                <ImageIcon className="mx-auto size-10 text-[var(--text-tertiary)]" />
              ) : (
                <FileText className="mx-auto size-10 text-[var(--text-tertiary)]" />
              )}
              <p className="mt-4 text-[13px] font-medium text-[var(--text-primary)]">
                {previewKind === "identity"
                  ? `${format.toUpperCase()} file`
                  : `${previewKind[0]!.toUpperCase()}${previewKind.slice(1)} preview`}
              </p>
              <p className="mt-1 max-w-[420px] text-[11px] leading-5 text-[var(--text-secondary)]">
                {DOCUMENT_LENS.has(format)
                  ? "Open this file as an editable Spectra Document. Unsupported Word features remain in the original package and unrelated edits do not rewrite them."
                  : OFFICE_LENS.has(format)
                    ? `Open this file as editable Spectra ${["xlsx", "xlsm", "xltx", "xltm", "xlam"].includes(format) ? "Sheets" : "Presentation"}. Native features Spectra cannot edit remain preserved in the original package.`
                    : bridge.state === "connected"
                      ? "The Bridge can stream this file from its selected folder without exposing its path to the cloud."
                      : "Connect Spectra Bridge to preview the bytes on this device."}
              </p>
              {DOCUMENT_LENS.has(format) || OFFICE_LENS.has(format) ? (
                <button
                  type="button"
                  className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-[8px] bg-[var(--text-primary)] px-4 text-[12px] font-medium text-[var(--bg-primary)] disabled:opacity-45"
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
                  className="mt-3 max-w-[430px] text-[11px] leading-5 text-[var(--danger)]"
                  role="alert"
                >
                  {humanizePublicFailure(openError)} The file has not been changed.
                </p>
              ) : null}
            </div>
            <div>
              <h2 className="text-[12px] font-semibold text-[var(--text-primary)]">Effective policy</h2>
              <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">
                {effectivePolicy?.source.kind === "default" ? "Using the account default." : `Inherited from ${effectivePolicy?.source.kind ?? "account"}.`}
              </p>
              {effectivePolicy?.source.kind !== "default" ? (
                <button type="button" className="mt-2 text-[11px] font-medium text-[var(--text-primary)]" onClick={() => void revertPolicy({ scopeKind: "item", scopeId: artifact._id, idempotencyKey: crypto.randomUUID() })}>
                  Revert to inherited policy
                </button>
              ) : null}
            </div>
          </div>
          <aside className="space-y-5">
            {protectedPending ? (
              <div className="rounded-[8px] border border-amber-500/40 bg-amber-500/10 p-3">
                <div className="text-[12px] font-semibold text-[var(--text-primary)]">
                  Original untouched
                </div>
                <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">
                  Spectra has pending changes. The linked file has not been
                  written.
                </p>
                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    className="h-8 rounded-[7px] bg-[var(--text-primary)] px-3 text-[11px] font-medium text-[var(--bg-primary)]"
                    onClick={() => void protectedAction("apply")}
                    disabled={fileAction !== null}
                  >
                    Apply to original
                  </button>
                  <button
                    type="button"
                    className="h-8 rounded-[7px] border border-[var(--border-default)] px-3 text-[11px] font-medium"
                    onClick={() => void protectedAction("fork")}
                    disabled={fileAction !== null}
                  >
                    Keep as Spectra copy
                  </button>
                  <button
                    type="button"
                    className="h-8 rounded-[7px] border border-[var(--border-default)] px-3 text-[11px] font-medium"
                    onClick={() => void protectedAction("discard")}
                    disabled={fileAction !== null}
                  >
                    Discard pending changes
                  </button>
                </div>
              </div>
            ) : null}
            <div>
              <h2 className="text-[12px] font-semibold text-[var(--text-primary)]">
                File details
              </h2>
              <dl className="mt-3 space-y-2 text-[11px]">
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
              <h2 className="text-[12px] font-semibold text-[var(--text-primary)]">
                Where this file lives
              </h2>
              <ul className="mt-3 space-y-2 text-[11px] text-[var(--text-secondary)]">
                {presentation.disclosure.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="text-[12px] font-semibold text-[var(--text-primary)]">
                Storage strategy
              </h2>
              <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">
                Changing this keeps the same Spectra item. Removing a copy on this computer leaves the file on disk.
              </p>
              <div className="mt-3 grid gap-2">
                {([
                  ["spectra", "Keep in Spectra"],
                  ["device", "Keep on this device"],
                  ["both", "Keep on device + Spectra"],
                  ["linked", "Link without changing original"],
                ] as const).map(([preset, label]) => (
                  <button
                    key={preset}
                    type="button"
                    className={`h-8 rounded-[7px] border px-3 text-left text-[11px] ${
                      currentPreset === preset
                        ? "border-[var(--text-primary)] bg-[var(--bg-secondary)] font-semibold"
                        : "border-[var(--border-default)]"
                    }`}
                    disabled={strategyPending || currentPreset === preset}
                    onClick={() => void changeStorageStrategy(preset)}
                  >
                    {strategyPending && currentPreset !== preset ? "Updating…" : label}
                  </button>
                ))}
              </div>
              {strategyTransition?.state === "pending" ? (
                <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
                  Moving this work between Spectra and the selected device. The item stays open while the Bridge verifies the file.
                </p>
              ) : strategyTransition?.state === "failed" ? (
                <p className="mt-2 text-[11px] text-[var(--danger)]" role="alert">
                  The last storage change did not finish. {humanizePublicFailure(strategyTransition.errorCode ?? "write-failed")}
                </p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <button
                type="button"
                className="flex h-9 items-center justify-center gap-2 rounded-[8px] bg-[var(--text-primary)] px-3 text-[12px] font-medium text-[var(--bg-primary)] disabled:opacity-45"
                disabled={bridge.state !== "connected"}
              >
                <ExternalLink className="size-3.5" />
                Open on device
              </button>
              <button
                type="button"
                className="flex h-9 items-center justify-center gap-2 rounded-[8px] border border-[var(--border-default)] px-3 text-[12px] font-medium disabled:opacity-45"
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
