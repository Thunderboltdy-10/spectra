/**
 * pdf.js for the browser and the server. In a browser pdf.js needs a worker
 * script; without one every getDocument() fails with "No
 * GlobalWorkerOptions.workerSrc specified". The worker is vendored in
 * public/vendor under the library's exact version, so the two never drift
 * (a test checks the file for the installed version exists).
 */
export function pdfWorkerUrl(version: string) {
  return `/vendor/pdf.worker-${version}.min.mjs`;
}

export async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc)
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl(pdfjs.version);
  return pdfjs;
}
