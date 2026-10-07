/// <reference lib="webworker" />

import { parseOfficePreview, previewTransferables } from "./office-preview";
import type { OfficePreviewRequest, OfficePreviewResponse } from "./office-preview-client";

declare const self: DedicatedWorkerGlobalScope;

/* Reads an Office file off the page, so a large deck or workbook never stalls it. */
self.onmessage = async (event: MessageEvent<OfficePreviewRequest>) => {
  try {
    const preview = await parseOfficePreview(event.data.kind, new Uint8Array(event.data.bytes));
    self.postMessage({ ok: true, preview } satisfies OfficePreviewResponse, previewTransferables(preview));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "OFFICE_PREVIEW_UNREADABLE";
    self.postMessage({ ok: false, code } satisfies OfficePreviewResponse);
  }
};

export {};
