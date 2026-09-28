/**
 * A request that never reached the server is a connection problem. The
 * browser's own wording ("Failed to fetch", "Load failed", "NetworkError when
 * attempting to fetch resource") is not something to print at a student, and
 * Spectra's client helpers forward their error message into a toast or error
 * state. Every same-origin Spectra API call goes through this wrapper.
 */
export const SPECTRA_REQUEST_UNREACHABLE =
  "Spectra could not reach the server. Check your connection, then try again.";

export async function requestSpectra(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    return await globalThis.fetch(input, init);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(SPECTRA_REQUEST_UNREACHABLE, { cause: error });
  }
}

/**
 * Plain copy for a Spectra route that answered with a failure. A short
 * plain-text sentence from the route itself (a 4xx such as "Undo is available
 * after Spectra finishes this run.") is shown as written. A sign-in failure
 * says what to do. A platform error page, a JSON envelope or a server failure
 * becomes the caller's own copy, never raw HTML or an HTTP status.
 */
export async function spectraFailureMessage(
  response: Response,
  copy: { fallback: string; signedOut: string },
) {
  if (response.status === 401) return copy.signedOut;
  if (response.status >= 500) return copy.fallback;
  const plain = (response.headers.get("content-type") ?? "").startsWith(
    "text/plain",
  );
  const text = plain ? (await response.text().catch(() => "")).trim() : "";
  return text && text.length <= 600 && !text.startsWith("<")
    ? text
    : copy.fallback;
}
