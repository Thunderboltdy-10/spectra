"use client";
import { useWorkAvailability } from "../components/use-work-availability";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuthedArgs } from "../data/use-authed-args";
import { Download, Eye, Loader2, FileText, X } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import type { SpectraArtifact } from "../data/api";
import { spectraBus } from "../events";
import { humanizePublicFailure } from "./humanize";
import { locationLabel } from "./status";
import { useSyncPresentation } from "./use-sync-presentation";
import { useBridgeHealth } from "./use-bridge";
import { DEVICES_HREF } from "./client";
import { ReconnectAction } from "./storage-toggle-group";
import { FileStorageControls } from "./file-storage-controls";
import { readConvexError } from "../../../../shared/convex-error.mjs";
import { FileViewer, type ViewedFile } from "../files/file-viewer";
import { fileViewKind } from "../files/file-kind";

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
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string>();
  const [fileAction, setFileAction] = useState<
    "download" | "materialize" | null
  >(null);
  const [viewing, setViewing] = useState<ViewedFile | null>(null);
  const truth = useQuery(
    api.replicas.forWork,
    useAuthedArgs({
      workId: artifact._id as never,
    }),
  );
  useWorkAvailability(artifact._id, truth);
  const applyProtectedPending = useMutation(api.replicas.applyProtectedPending);
  const forkProtectedPending = useMutation(api.replicas.forkProtectedPending);
  const discardProtectedPending = useMutation(
    api.replicas.discardProtectedPending,
  );
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
  const nativeUrl = `/api/spectra/native?artifactId=${encodeURIComponent(artifact._id)}`;
  const hasPayload =
    truth?.replicas.some((replica) => Boolean(replica.payloadRef)) ?? false;
  // The same viewer as school files: photos, PDFs and Office files read-only,
  // from the kept copy. An Office file also opens as editable work; when the
  // lens cannot, this is still a way to read it.
  const viewKind = fileViewKind(undefined, `file.${format}`);
  const legacy = viewKind === "legacy";
  const viewable = hasPayload && viewKind && !legacy ? viewKind : null;
  const protectedPending =
    truth?.replicas.some(
      (replica) =>
        replica.kind === "local" &&
        replica.protectedOriginal &&
        Boolean(replica.pendingPayloadRef),
    ) ?? false;
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
        readConvexError(error).message ||
          "The pending changes could not be resolved.",
      );
    } finally {
      setFileAction(null);
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
      spectraBus.emit("artifact.lensActivated", { artifactId: artifact._id });
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
                ? () => router.push(DEVICES_HREF)
                : undefined
            }
          >
            {presentation.label}
          </button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close file"
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="mx-auto grid max-w-[860px] gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex min-h-[360px] items-center justify-center rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 text-center">
            <div>
              {previewKind === "image" && hasPayload ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={nativeUrl}
                  alt=""
                  className="mx-auto max-h-[320px] max-w-full rounded-control object-contain"
                />
              ) : (
                <FileText className="mx-auto size-10 text-[var(--text-tertiary)]" />
              )}
              <p className="mt-4 text-caption font-medium text-[var(--text-primary)]">
                {previewKind === "image" && hasPayload
                  ? artifact.title
                  : `${format.toUpperCase()} file`}
              </p>
              <p className="mt-1 max-w-[420px] text-micro leading-5 text-[var(--text-secondary)]">
                {DOCUMENT_LENS.has(format)
                  ? "Open this file as an editable Spectra Document. Unsupported Word features remain in the original package and unrelated edits do not rewrite them."
                  : OFFICE_LENS.has(format)
                    ? `Open this file as editable Spectra ${["xlsx", "xlsm", "xltx", "xltm", "xlam"].includes(format) ? "Sheets" : "Presentation"}. Native features Spectra cannot edit remain preserved in the original package.`
                    : legacy
                      ? "Spectra shows Word, PowerPoint and Excel files saved as .docx, .pptx or .xlsx. Download this older file to open it in its own app, or save it in the newer format and add it again."
                      : bridge.reachability === "connected"
                      ? "This file is in a selected folder on this PC."
                      : bridge.reachability === "running"
                        ? "Spectra Bridge is running on this PC. Connect this device to use this file."
                        : "This file lives on a computer. Connect Spectra Bridge to use it here."}
              </p>
              {DOCUMENT_LENS.has(format) || OFFICE_LENS.has(format) ? (
                <Button
                  variant="primary"
                  className="mt-5 px-4"
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
                </Button>
              ) : null}
              {viewable ? (
                <Button
                  variant={DOCUMENT_LENS.has(format) || OFFICE_LENS.has(format) ? "secondary" : "primary"}
                  className={DOCUMENT_LENS.has(format) || OFFICE_LENS.has(format) ? "ml-2 mt-5 px-4" : "mt-5 px-4"}
                  onClick={() =>
                    setViewing({ key: artifact._id, filename: artifact.title, kind: viewable, url: nativeUrl })
                  }
                >
                  <Eye className="size-3.5" />
                  View read-only
                </Button>
              ) : null}
              {openError ? (
                <p
                  className="mt-3 max-w-[430px] text-micro leading-5 text-[var(--danger)]"
                  role="alert"
                >
                  {humanizePublicFailure(openError)} The file has not been
                  changed.
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
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void protectedAction("apply")}
                    disabled={fileAction !== null}
                  >
                    Apply to original
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void protectedAction("fork")}
                    disabled={fileAction !== null}
                  >
                    Keep as Spectra copy
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void protectedAction("discard")}
                    disabled={fileAction !== null}
                  >
                    Discard pending changes
                  </Button>
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
                    {locationLabel(
                      (truth?.replicas ?? []).map((replica) => ({
                        kind: replica.kind,
                        state: replica.state,
                      })),
                    )}
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
                  <ReconnectAction href={DEVICES_HREF} />
                </div>
              ) : null}
              <ul className="mt-3 space-y-2 text-micro text-[var(--text-secondary)]">
                {presentation.disclosure.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <FileStorageControls
              artifactId={artifact._id}
              artifactTitle={artifact.title}
            />
            <div className="grid gap-2">
              <Button
                variant="secondary"
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
              </Button>
            </div>
          </aside>
        </div>
      </div>
      <FileViewer file={viewing} onClose={() => setViewing(null)} />
    </section>
  );
}
