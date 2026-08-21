"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Download, ExternalLink, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import type { SpectraArtifact } from "../data/api";
import { replicaDisclosure, selectSyncTruth } from "./status";
import { useBridgeHealth } from "./use-bridge";

const DOCUMENT_LENS = new Set(["docx", "docm", "dotx", "dotm"]);
const OFFICE_LENS = new Set(["xlsx", "xlsm", "xltx", "xltm", "xlam", "pptx", "pptm", "potx", "potm", "ppsx", "ppsm", "ppam"]);

export function ResourceSurface({ artifact, onClose }: { artifact: SpectraArtifact; onClose: () => void }) {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string>();
  const [fileAction, setFileAction] = useState<"download" | "materialize" | null>(null);
  const truth = useQuery(api.replicas.forWork, { workId: artifact._id as never });
  const bridge = useBridgeHealth();
  const replicas = truth?.replicas.map((replica) => ({ kind: replica.kind, state: replica.state, lastVerifiedAt: replica.lastVerifiedAt, errorCode: replica.errorCode, unavailableReason: replica.unavailableReason })) ?? [];
  const status = selectSyncTruth({ replicas, openConflictCount: truth?.openConflictCount ?? 0, pendingCount: truth?.pendingCount ?? 0, online: bridge.state === "connected" });
  const format = (artifact.nativeFormat ?? artifact.title.split(".").pop() ?? "binary").toLowerCase();
  const previewKind = ["png", "jpg", "jpeg", "gif", "webp"].includes(format) ? "image" : format === "pdf" ? "pdf" : ["txt", "md", "json", "csv", "ts", "tsx", "js", "py", "css", "html"].includes(format) ? "text" : "identity";
  async function openInSpectra() {
    setOpening(true);
    setOpenError(undefined);
    try {
      const endpoint = DOCUMENT_LENS.has(format) ? "/api/spectra/lenses/docx" : "/api/spectra/lenses/office";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", artifactId: artifact._id }),
      });
      const result = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      if (!response.ok)
        throw new Error(result?.message ?? `This ${format.toUpperCase()} file could not be opened safely.`);
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
  }
  async function downloadCopy() {
    setFileAction("download");
    setOpenError(undefined);
    try {
      const response = await fetch(`/api/spectra/native?artifactId=${encodeURIComponent(artifact._id)}`, { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(result?.message ?? "The retained native copy is unavailable.");
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
      setOpenError(error instanceof Error ? error.message : "The retained native copy is unavailable.");
    } finally {
      setFileAction(null);
    }
  }
  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]" aria-label={`${artifact.title} file`}>
      <header className="flex min-h-[74px] shrink-0 items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-3">
        <div className="min-w-0"><h1 className="truncate font-display text-[20px] font-semibold text-[var(--text-primary)]">{artifact.title}</h1><button type="button" title={status.detail} className="mt-1 text-[11px] font-medium text-[var(--text-secondary)]">{status.label}</button></div>
        <button type="button" className="spectra-icon-action" aria-label="Close file" onClick={onClose}>×</button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="mx-auto grid max-w-[860px] gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex min-h-[360px] items-center justify-center rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 text-center">
            <div>{previewKind === "image" ? <ImageIcon className="mx-auto size-10 text-[var(--text-tertiary)]" /> : <FileText className="mx-auto size-10 text-[var(--text-tertiary)]" />}<p className="mt-4 text-[13px] font-medium text-[var(--text-primary)]">{previewKind === "identity" ? `${format.toUpperCase()} file` : `${previewKind[0]!.toUpperCase()}${previewKind.slice(1)} preview`}</p><p className="mt-1 max-w-[420px] text-[11px] leading-5 text-[var(--text-secondary)]">{DOCUMENT_LENS.has(format) ? "Open this file as an editable Spectra Document. Unsupported Word features remain in the original package and unrelated edits do not rewrite them." : OFFICE_LENS.has(format) ? `Open this file as editable Spectra ${["xlsx", "xlsm", "xltx", "xltm", "xlam"].includes(format) ? "Sheets" : "Presentation"}. Native features Spectra cannot edit remain preserved in the original package.` : bridge.state === "connected" ? "The Bridge can stream this file from its selected folder without exposing its path to the cloud." : "Connect Spectra Bridge to preview the bytes on this device."}</p>{DOCUMENT_LENS.has(format) || OFFICE_LENS.has(format) ? <button type="button" className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-[8px] bg-[var(--text-primary)] px-4 text-[12px] font-medium text-[var(--bg-primary)] disabled:opacity-45" disabled={opening || !truth?.replicas.some((replica) => Boolean(replica.payloadRef))} onClick={() => void openInSpectra()}>{opening ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}{opening ? "Opening safely…" : "Open in Spectra"}</button> : null}{openError ? <p className="mt-3 max-w-[430px] text-[11px] leading-5 text-[var(--danger)]" role="alert">{openError} The file has not been changed.</p> : null}</div>
          </div>
          <aside className="space-y-5"><div><h2 className="text-[12px] font-semibold text-[var(--text-primary)]">File details</h2><dl className="mt-3 space-y-2 text-[11px]"><div className="flex justify-between gap-3"><dt className="text-[var(--text-tertiary)]">Format</dt><dd>{format.toUpperCase()}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--text-tertiary)]">Location</dt><dd>{truth?.replicas.some((replica) => replica.kind === "local" && replica.state === "current") ? "This device + Spectra" : "Spectra Cloud"}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--text-tertiary)]">Profile</dt><dd>Strict native</dd></div></dl></div><div><h2 className="text-[12px] font-semibold text-[var(--text-primary)]">Replicas</h2><ul className="mt-3 space-y-2 text-[11px] text-[var(--text-secondary)]">{replicaDisclosure(replicas).map((line) => <li key={line}>{line}</li>)}</ul></div><div className="grid gap-2"><button type="button" className="flex h-9 items-center justify-center gap-2 rounded-[8px] bg-[var(--text-primary)] px-3 text-[12px] font-medium text-[var(--bg-primary)] disabled:opacity-45" disabled={bridge.state !== "connected"}><ExternalLink className="size-3.5" />Open on device</button><button type="button" className="flex h-9 items-center justify-center gap-2 rounded-[8px] border border-[var(--border-default)] px-3 text-[12px] font-medium disabled:opacity-45" disabled={fileAction !== null || !truth?.replicas.some((replica) => Boolean(replica.payloadRef))} onClick={() => void downloadCopy()}><Download className="size-3.5" />{fileAction === "download" ? "Preparing copy…" : "Download native copy"}</button></div></aside>
        </div>
      </div>
    </section>
  );
}
