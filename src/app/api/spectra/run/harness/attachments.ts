import { prepareAttachments } from "@/features/spectra/compute/files/attachment-preprocessor";
import { attachmentBytesAsInput, attachmentInputBytes, attachmentSha256 } from "@/features/spectra/compute/files/attachment-retention";
import type { AttachmentInput, PreparedAttachment } from "./contract";
import { act, mutate, query } from "./io";

/*
 * Files sent to a run are stored as that attempt's run attachments, so any
 * worker can read them: the request's own files, and files sent later with a
 * message that joins the run (a steer). Steer files are marked so they are
 * never read again as the request's own.
 */

const MAX_FILES = 4;

/** Stores the files and returns their run attachment ids, in order. */
export async function persistRunAttachments(
  runId: string,
  executionId: string,
  input: AttachmentInput[] | undefined,
  prepared: PreparedAttachment[],
  options: { steer?: boolean } = {},
) {
  const rows = Array.isArray(input) ? input.slice(0, MAX_FILES) : [];
  const ids: string[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const preparedRow = prepared[index];
    if (!preparedRow || !row.handling) throw new Error("ATTACHMENT_SERIALIZATION_INVALID");
    const bytes = attachmentInputBytes(row);
    const beginning = await mutate<
      Record<string, unknown>,
      { runAttachmentId: string; reused: boolean; uploadReceipt?: string; uploadUrl?: string }
    >("spectraRuns:beginRunAttachmentUpload", {
      runId,
      executionId,
      originalFileId: preparedRow.id ?? row.assetId ?? row.importId ?? `file:${preparedRow.name}:${bytes.byteLength}`,
      name: preparedRow.name,
      mimeType: preparedRow.mimeType,
      size: bytes.byteLength,
      handling: row.handling,
      sha256: attachmentSha256(bytes),
      sourceMap: preparedRow.sourceMap,
      provenance: { ...preparedRow.provenance, ...(row.sourceRef ? { sourceRef: row.sourceRef } : {}), ...(options.steer ? { steer: true } : {}) },
    });
    ids.push(beginning.runAttachmentId);
    if (beginning.reused) continue;
    if (!beginning.uploadUrl || !beginning.uploadReceipt) throw new Error("ATTACHMENT_UPLOAD_INTENT_MISSING");
    const uploaded = await fetch(beginning.uploadUrl, {
      method: "POST",
      headers: { "Content-Type": preparedRow.mimeType, "Content-Length": String(bytes.byteLength) },
      body: bytes,
    });
    if (!uploaded.ok) throw new Error("ATTACHMENT_STORAGE_UPLOAD_FAILED");
    const payload = (await uploaded.json()) as { storageId?: string };
    if (!payload.storageId) throw new Error("ATTACHMENT_STORAGE_ID_MISSING");
    const stored = await act<
      { runAttachmentId: string; storageId: string; uploadReceipt: string },
      { status?: string; errorCode?: string }
    >("artifactIntakeActions:verifyUploadedRunAttachment", {
      runAttachmentId: beginning.runAttachmentId,
      storageId: payload.storageId,
      uploadReceipt: beginning.uploadReceipt,
    });
    if (stored.status !== "active") throw new Error(stored.errorCode ?? "ATTACHMENT_UPLOAD_INTEGRITY_FAILED");
  }
  return ids;
}

/**
 * Reads stored files back as prepared attachments: the request's own files,
 * or only the given ones (files a steer brought).
 */
export async function loadRunAttachments(runId: string, executionId: string, runAttachmentIds?: string[]) {
  if (runAttachmentIds && !runAttachmentIds.length) return [];
  const rows = await query<
    { runId: string; executionId: string; runAttachmentIds?: string[] },
    Array<{
      runAttachmentId: string;
      originalFileId?: string;
      name: string;
      mimeType: string;
      size: number;
      handling: PreparedAttachment["handling"];
      sourceMap?: PreparedAttachment["sourceMap"];
      provenance?: PreparedAttachment["provenance"];
      url: string | null;
    }>
  >("spectraRuns:listRunAttachments", { runId, executionId, ...(runAttachmentIds ? { runAttachmentIds } : {}) });
  if (!rows.length) return [];
  const raw = await Promise.all(
    rows.map(async (row) => {
      if (!row.url) throw new Error("ATTACHMENT_STORAGE_URL_EXPIRED");
      const response = await fetch(row.url);
      if (!response.ok) throw new Error("ATTACHMENT_STORAGE_READ_FAILED");
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        row,
        input: attachmentBytesAsInput(bytes, {
          id: row.originalFileId ?? row.runAttachmentId,
          name: row.name,
          mimeType: row.mimeType,
          handling: row.handling,
        }),
      };
    }),
  );
  const prepared = await prepareAttachments(raw.map(({ input }) => input));
  return prepared.map((attachment, index) => ({
    ...attachment,
    id: raw[index]!.row.originalFileId ?? raw[index]!.row.runAttachmentId,
    sourceMap: raw[index]!.row.sourceMap ?? attachment.sourceMap,
    provenance: raw[index]!.row.provenance ?? attachment.provenance,
  }));
}
