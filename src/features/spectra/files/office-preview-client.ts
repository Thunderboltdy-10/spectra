import type { OfficeViewKind } from "./file-kind";
import { officeSizeRefusal } from "./file-kind";
import type { OfficePreview } from "./office-preview";

/*
 * The page's side of reading an Office file: fetch its bytes, refuse what is
 * too big in plain words, and read it in a worker. Where a worker cannot run
 * (an old browser, a test), the reader is loaded only now and runs here.
 */

export type OfficePreviewRequest = { kind: OfficeViewKind; bytes: ArrayBuffer };
export type OfficePreviewResponse = { ok: true; preview: OfficePreview } | { ok: false; code: string };

/** A file the viewer will not read, with the sentence that says why. */
export class OfficePreviewRefusal extends Error {
  constructor(message: string, public readonly reason: "too-large" | "unreadable" | "unreachable") {
    super(message);
    this.name = "OfficePreviewRefusal";
  }
}

async function readInWorker(request: OfficePreviewRequest, signal: AbortSignal) {
  const worker = new Worker(new URL("./office-preview.worker.ts", import.meta.url), { type: "module", name: "spectra-office-preview" });
  try {
    return await new Promise<OfficePreview>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("The file was closed.", "AbortError")), { once: true });
      worker.onmessage = (event: MessageEvent<OfficePreviewResponse>) => {
        if (event.data.ok) resolve(event.data.preview);
        else reject(new OfficePreviewRefusal("Spectra couldn't read this file.", "unreadable"));
      };
      // A worker that cannot start (a blocked script, an old browser) is not
      // the file's fault: the reader runs here instead. The bytes are copied
      // into the worker, not moved, so they are still here for that.
      worker.onerror = (event) => {
        event.preventDefault();
        readHere(request).then(resolve, reject);
      };
      worker.postMessage(request);
    });
  } finally {
    worker.terminate();
  }
}

async function readHere(request: OfficePreviewRequest) {
  const { parseOfficePreview } = await import("./office-preview");
  try {
    return await parseOfficePreview(request.kind, new Uint8Array(request.bytes));
  } catch {
    throw new OfficePreviewRefusal("Spectra couldn't read this file.", "unreadable");
  }
}

/** Reads bytes already in hand, in a worker where one can run. */
export function readOfficeBytes(request: OfficePreviewRequest, signal: AbortSignal) {
  return typeof Worker === "undefined" ? readHere(request) : readInWorker(request, signal);
}

/** Fetches the file at `url` and reads it for showing. `bytes` is its size when the caller already knows it. */
export async function loadOfficePreview(
  { kind, url, bytes }: { kind: OfficeViewKind; url: string; bytes?: number },
  signal: AbortSignal,
): Promise<OfficePreview> {
  const known = officeSizeRefusal(kind, bytes);
  if (known) throw new OfficePreviewRefusal(known, "too-large");
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new OfficePreviewRefusal("Spectra couldn't fetch this file.", "unreachable");
  }
  if (!response.ok) throw new OfficePreviewRefusal("Spectra couldn't fetch this file.", "unreachable");
  const announced = officeSizeRefusal(kind, Number(response.headers.get("content-length")) || undefined);
  if (announced) throw new OfficePreviewRefusal(announced, "too-large");
  const body = await response.arrayBuffer();
  const actual = officeSizeRefusal(kind, body.byteLength);
  if (actual) throw new OfficePreviewRefusal(actual, "too-large");
  return readOfficeBytes({ kind, bytes: body }, signal);
}
