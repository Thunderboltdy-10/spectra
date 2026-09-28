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
