"use client";
import { downloadDocumentBlob } from "../components/artifact-studio-file-utils";
import { useWorkAvailability } from "../components/use-work-availability";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import { useMutation } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { useCalmQuery } from "../data/use-calm-query";
import { api } from "../../../../convex/_generated/api";
import { useAuthedArgs } from "../data/use-authed-args";
import { Download, ExternalLink, Eye, FileText, FolderOpen, Loader2, Settings, X } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import type { SpectraArtifact } from "../data/api";
import { spectraBus } from "../events";
import { humanizePublicFailure } from "./humanize";
import { useSyncPresentation } from "./use-sync-presentation";
import { useBridgeHealth } from "./use-bridge";
import { DEVICES_HREF, openBridgeFile, revealBridgeFile, type BridgeFile } from "./client";
import { ReconnectAction } from "./storage-toggle-group";
import { FileStorageControls } from "./file-storage-controls";
import { readConvexError } from "../../../../shared/convex-error.mjs";
import { FileViewer, type ViewedFile } from "../files/file-viewer";
import { fileViewKind, type OfficeViewKind } from "../files/file-kind";
import { OfficeGhost } from "../files/office-ghost";

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
  const truth = useCalmQuery(
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
  const activeMounts = useQuery(api.bridge.activeMounts, useAuthedArgs({}));
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
  const [becoming, setBecoming] = useState(false);
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
      setBecoming(true);
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
          result?.message ?? "The original file isn't available anymore.",
        );
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      downloadDocumentBlob(match ? decodeURIComponent(match[1]!) : artifact.title, blob);
    } catch (error) {
      setOpenError(
        error instanceof Error
          ? error.message
          : "The original file isn't available anymore.",
      );
    } finally {
      setFileAction(null);
    }
  }
  const localReplica = truth?.replicas.find(
    (replica) => replica.kind === "local" && replica.deviceId === bridge.status?.deviceId && replica.relativePath,
  );
  const localMount = activeMounts?.find((mount) => mount._id === localReplica?.mountId);
  const onThisComputer: BridgeFile | null =
    bridge.reachability === "connected" && localMount?.grantId && localReplica?.relativePath
      ? { grantId: localMount.grantId, relativePath: localReplica.relativePath }
      : null;
  const lens = DOCUMENT_LENS.has(format) || OFFICE_LENS.has(format);
  async function onComputer(action: "open" | "reveal") {
    if (!onThisComputer) return;
    setOpenError(undefined);
    try {
      await (action === "open" ? openBridgeFile(onThisComputer) : revealBridgeFile(onThisComputer));
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    }
  }
  // An Office file with a kept copy is on its way to being a work of its own: it
  // shows the ghost of that work, not a file page that flips a moment later.
  if (lens && !openError && (becoming || opening || truth === undefined || hasPayload)) {
    const nativeKind: OfficeViewKind = DOCUMENT_LENS.has(format) ? "document" : format.startsWith("x") ? "sheet" : "slides";
    return (
      <section className="resource-surface" aria-label={artifact.title}>
        <OfficeGhost kind={nativeKind} filename={artifact.title} />
      </section>
    );
  }
  return (
    <section className="resource-surface" aria-label={`${artifact.title} file`}>
      <header className="resource-surface-head">
        <div className="min-w-0">
          <h1 className="truncate font-display text-title font-semibold text-[var(--text-primary)]">{artifact.title}</h1>
          <button
            type="button"
            title={presentation.detail}
            className="mt-1 text-caption text-[var(--text-secondary)]"
            onClick={presentation.action?.kind === "reconnect" ? () => router.push(DEVICES_HREF) : undefined}
          >
            {presentation.label}
          </button>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close file" onClick={onClose}>
          <X aria-hidden="true" className="size-4" />
        </Button>
      </header>
      <div className="resource-surface-body">
        <figure className="resource-surface-figure">
          {previewKind === "image" && hasPayload ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={nativeUrl} alt="" className="max-h-[360px] max-w-full rounded-control object-contain" />
          ) : (
            <span className="resource-surface-mark" aria-hidden="true">
              <FileText className="size-10" />
              <span>{format.toUpperCase()}</span>
            </span>
          )}
        </figure>
        <p className="resource-surface-lede">
          {DOCUMENT_LENS.has(format)
            ? "Open it as a Spectra document to edit it. Anything Spectra cannot edit stays in the original file."
            : OFFICE_LENS.has(format)
              ? `Open it as Spectra ${["xlsx", "xlsm", "xltx", "xltm", "xlam"].includes(format) ? "Sheets" : "Slides"} to edit it. Anything Spectra cannot edit stays in the original file.`
              : legacy
                ? "This is an older Office format. Download it to open in its own app, or save it as .docx, .pptx or .xlsx and Spectra opens it here."
                : viewable
                  ? "Spectra shows this file as it is. Open it on your computer to change it."
                  : hasPayload
                    ? "Spectra keeps this file as it is. Open it in its own app to use it."
                    : bridge.reachability === "connected"
                      ? "This file is on this computer. Open it in its own app to use it."
                      : "This file is on one of your computers. Start Spectra Bridge there to open it."}
        </p>
        <div className="resource-surface-actions">
          {lens ? (
            <Button variant="primary" disabled={opening || !hasPayload} onClick={() => void openInSpectra()}>
              {opening ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
              {opening ? "Opening…" : "Open in Spectra"}
            </Button>
          ) : null}
          {viewable ? (
            <Button
              variant={lens ? "ghost" : "primary"}
              onClick={() => setViewing({ key: artifact._id, filename: artifact.title, kind: viewable, url: nativeUrl })}
            >
              <Eye className="size-4" />
              View
            </Button>
          ) : null}
          {onThisComputer ? (
            <>
              <Button variant={lens || viewable ? "ghost" : "primary"} onClick={() => void onComputer("open")}>
                <ExternalLink className="size-4" />
                Open on this computer
              </Button>
              <Button variant="ghost" onClick={() => void onComputer("reveal")}>
                <FolderOpen className="size-4" />
                Show in folder
              </Button>
            </>
          ) : null}
          {hasPayload ? (
            <Button variant="ghost" disabled={fileAction !== null} onClick={() => void downloadCopy()}>
              <Download className="size-4" />
              {fileAction === "download" ? "Preparing…" : "Download"}
            </Button>
          ) : null}
          {presentation.action?.kind === "reconnect" ? <ReconnectAction href={DEVICES_HREF} /> : null}
        </div>
        {openError ? (
          <p className="resource-surface-error" role="alert">
            {humanizePublicFailure(openError)} The file itself has not changed.
          </p>
        ) : null}
        {protectedPending ? (
          <div className="resource-surface-pending">
            <p className="text-ui font-medium text-[var(--text-primary)]">Changes waiting for the original</p>
            <p className="text-caption text-[var(--text-secondary)]">Spectra has changes the file on the computer does not have yet.</p>
            <div className="resource-surface-actions">
              <Button variant="primary" size="sm" disabled={fileAction !== null} onClick={() => void protectedAction("apply")}>
                Save to the original
              </Button>
              <Button variant="ghost" size="sm" disabled={fileAction !== null} onClick={() => void protectedAction("fork")}>
                Keep as a Spectra copy
              </Button>
              <Button variant="ghost" size="sm" disabled={fileAction !== null} onClick={() => void protectedAction("discard")}>
                Discard the changes
              </Button>
            </div>
          </div>
        ) : null}
        <details className="resource-surface-more">
          <summary>File settings</summary>
          <ul className="resource-surface-facts">
            {presentation.disclosure.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <FileStorageControls artifactId={artifact._id} artifactTitle={artifact.title} embedded />
          <button type="button" className="resource-surface-link" onClick={() => router.push(DEVICES_HREF)}>
            <Settings className="size-4" aria-hidden="true" />
            Folder and sync settings are in Devices
          </button>
        </details>
      </div>
      <FileViewer file={viewing} onClose={() => setViewing(null)} />
    </section>
  );
}
